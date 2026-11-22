import type { OAuth2Client } from 'google-auth-library';
import { gmail_v1, google } from 'googleapis';
import { matchGmailOwnerRule, type GmailOwnerRule } from './rules';

export type GmailHit = {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  date: string | null;
  reason: string;
};

/** Built-in subject/snippet rules for “needs attention” mail. */
export const GMAIL_ACTION_RULES: Array<{ id: string; re: RegExp }> = [
  { id: 'past_due', re: /\bpast[-\s]?due\b/i },
  { id: 'overdue', re: /\boverdue\b/i },
  { id: 'payment_due', re: /\bpayment\s+due\b/i },
  { id: 'action_required', re: /\baction\s+required\b/i },
  { id: 'final_notice', re: /\bfinal\s+notice\b/i },
  { id: 'invoice_due', re: /\binvoice\b.{0,40}\b(due|overdue|past)\b/i },
  // Vendor / tech visit confirmations (e.g. Action Termite & Pest Control)
  { id: 'service_appointment', re: /\bupcoming\s+service\s+appointment\b/i },
  { id: 'appointment_window', re: /\bappointment\b.{0,80}\bbetween\b.{0,40}\b\d{1,2}:\d{2}\s*(am|pm)\b/i },
];

export function matchGmailActionReason(subject: string, snippet: string): string | null {
  const text = `${subject}\n${snippet}`;
  for (const rule of GMAIL_ACTION_RULES) {
    if (rule.re.test(text)) return rule.id;
  }
  return null;
}

/** Built-in rules first, then owner From/contains rules. */
export function matchGmailHitReason(
  fromHeader: string,
  subject: string,
  snippet: string,
  ownerRules: GmailOwnerRule[] = []
): string | null {
  return (
    matchGmailActionReason(subject, snippet) ||
    matchGmailOwnerRule(fromHeader, subject, snippet, ownerRules)
  );
}

function headerValue(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  const hit = (headers || []).find((h) => (h.name || '').toLowerCase() === name.toLowerCase());
  return (hit?.value || '').trim();
}

/**
 * List recent messages and keep ones matching action rules.
 * Read-only. Does not download attachments in v1 (metadata + snippet only).
 */
export async function scanGmailForActionItems(
  auth: OAuth2Client,
  options: { afterMs?: number; maxMessages?: number; ownerRules?: GmailOwnerRule[] } = {}
): Promise<GmailHit[]> {
  const gmail = google.gmail({ version: 'v1', auth });
  const maxMessages = Math.min(Math.max(options.maxMessages ?? 40, 1), 100);
  const ownerRules = options.ownerRules || [];
  const afterSec =
    typeof options.afterMs === 'number' && Number.isFinite(options.afterMs)
      ? Math.floor(options.afterMs / 1000)
      : Math.floor((Date.now() - 36 * 60 * 60 * 1000) / 1000);

  const list = await gmail.users.messages.list({
    userId: 'me',
    q: `newer_than:2d -in:chats after:${afterSec}`,
    maxResults: maxMessages,
  });

  const ids = (list.data.messages || []).map((m) => m.id).filter(Boolean) as string[];
  const hits: GmailHit[] = [];

  for (const id of ids) {
    const msg = await gmail.users.messages.get({
      userId: 'me',
      id,
      format: 'metadata',
      metadataHeaders: ['From', 'Subject', 'Date'],
    });
    const headers = msg.data.payload?.headers;
    const subject = headerValue(headers, 'Subject');
    const from = headerValue(headers, 'From');
    const date = headerValue(headers, 'Date') || null;
    const snippet = (msg.data.snippet || '').trim();
    const reason = matchGmailHitReason(from, subject, snippet, ownerRules);
    if (!reason) continue;
    hits.push({
      id,
      threadId: msg.data.threadId || id,
      from,
      subject: subject || '(no subject)',
      snippet: snippet.slice(0, 240),
      date,
      reason,
    });
  }

  return hits;
}

function shortFrom(fromHeader: string): string {
  const angle = fromHeader.match(/^([^<]+)</);
  const name = angle ? angle[1].trim().replace(/^"|"$/g, '') : '';
  if (name && name.length <= 40) return name;
  const email = (fromHeader.match(/<([^>]+)>/) || [])[1] || fromHeader;
  return email.trim().slice(0, 40) || '—';
}

function shortSubject(subject: string): string {
  const s = subject.replace(/\s+/g, ' ').trim();
  if (s.length <= 90) return s;
  return `${s.slice(0, 87)}…`;
}

/** Compact WhatsApp DM — no AI, no long snippets. */
export function formatGmailHitsDigest(email: string, hits: GmailHit[]): string {
  const n = hits.length;
  const lines = [`Gmail alert · ${n} new`, ''];
  for (const hit of hits.slice(0, 8)) {
    const label = hit.reason && hit.reason !== hit.subject ? hit.reason : null;
    const head = label ? `${label} — ${shortSubject(hit.subject)}` : shortSubject(hit.subject);
    lines.push(`• ${head}`);
    lines.push(`  ${shortFrom(hit.from)}`);
  }
  if (hits.length > 8) lines.push(`…+${hits.length - 8} more`);
  lines.push('', `Inbox: ${email}`);
  return lines.join('\n').trim();
}
