import { randomUUID } from 'crypto';

/** Where matching mail is delivered on WhatsApp. */
export type GmailAlertRoute = 'dm' | 'group' | 'both';

export type GmailOwnerRule = {
  id: string;
  /** Short name shown in WhatsApp digest. */
  label: string;
  /** Exact address, substring, or @domain (e.g. @chase.com). */
  from: string | null;
  /** Case-insensitive match against subject + snippet. */
  contains: string | null;
  /** alert = fire when hit. digest reserved for later. */
  mode: 'alert' | 'digest';
  /** dm = owner WhatsApp; group = store WhatsApp group; both = DM + group. */
  route: GmailAlertRoute;
};

export type GmailBuiltinRuleInfo = {
  id: string;
  label: string;
};

/** Shown in UI so owners know what ships by default. */
export const GMAIL_BUILTIN_RULE_INFO: GmailBuiltinRuleInfo[] = [
  { id: 'past_due', label: 'Past due' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'payment_due', label: 'Payment due' },
  { id: 'action_required', label: 'Action required' },
  { id: 'final_notice', label: 'Final notice' },
  { id: 'invoice_due', label: 'Invoice due' },
  { id: 'service_appointment', label: 'Upcoming service appointment' },
  { id: 'appointment_window', label: 'Appointment time window' },
];

const MAX_RULES = 20;
const MAX_FROM = 120;
const MAX_CONTAINS = 120;
const MAX_LABEL = 40;

function asObj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim().replace(/\s+/g, ' ');
  if (!t) return null;
  return t.slice(0, max);
}

export function parseGmailAlertRoute(value: unknown): GmailAlertRoute {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (raw === 'group' || raw === 'both') return raw;
  return 'dm';
}

export function parseGmailOwnerRules(raw: unknown): GmailOwnerRule[] {
  if (!Array.isArray(raw)) return [];
  const out: GmailOwnerRule[] = [];
  for (const item of raw) {
    const row = asObj(item);
    if (!row) continue;
    const from = cleanText(row.from, MAX_FROM);
    const contains = cleanText(row.contains, MAX_CONTAINS);
    if (!from && !contains) continue;
    const label =
      cleanText(row.label, MAX_LABEL) ||
      (from ? `From ${from}` : `Contains “${contains}”`);
    const mode = row.mode === 'digest' ? 'digest' : 'alert';
    const route = parseGmailAlertRoute(row.route);
    const id =
      typeof row.id === 'string' && row.id.trim() ? row.id.trim().slice(0, 64) : randomUUID();
    out.push({ id, label, from, contains, mode, route });
    if (out.length >= MAX_RULES) break;
  }
  return out;
}

export function normalizeNewGmailRule(input: {
  label?: unknown;
  from?: unknown;
  contains?: unknown;
  mode?: unknown;
  route?: unknown;
}): { ok: true; rule: GmailOwnerRule } | { ok: false; error: string } {
  const from = cleanText(input.from, MAX_FROM);
  const contains = cleanText(input.contains, MAX_CONTAINS);
  if (!from && !contains) {
    return { ok: false, error: 'Add a From address/domain and/or text to match.' };
  }
  const label =
    cleanText(input.label, MAX_LABEL) ||
    (from ? `From ${from}` : `Contains “${contains}”`);
  const mode = input.mode === 'digest' ? 'digest' : 'alert';
  const route = parseGmailAlertRoute(input.route);
  return {
    ok: true,
    rule: { id: randomUUID(), label, from, contains, mode, route },
  };
}

/** Delivery channels needed for a set of scan hits (by matching rule label). */
export function channelsForGmailHits(
  reasons: string[],
  rules: GmailOwnerRule[]
): { dm: boolean; group: boolean } {
  let dm = false;
  let group = false;
  const byLabel = new Map(rules.filter((r) => r.mode === 'alert').map((r) => [r.label, r]));
  for (const reason of reasons) {
    const route = byLabel.get(reason)?.route ?? 'dm';
    if (route === 'dm' || route === 'both') dm = true;
    if (route === 'group' || route === 'both') group = true;
  }
  if (!dm && !group) dm = true;
  return { dm, group };
}

/** Extract email from "Name <a@b.com>" or bare address. */
export function extractEmailAddress(fromHeader: string): string {
  const angle = fromHeader.match(/<([^>]+)>/);
  const raw = (angle ? angle[1] : fromHeader).trim().toLowerCase();
  return raw.replace(/^mailto:/i, '');
}

export function matchOwnerFrom(fromHeader: string, pattern: string): boolean {
  const email = extractEmailAddress(fromHeader);
  const p = pattern.trim().toLowerCase();
  if (!p) return false;
  if (p.startsWith('@')) {
    const domain = p.slice(1);
    return domain.length > 0 && email.endsWith(`@${domain}`);
  }
  return email.includes(p) || fromHeader.toLowerCase().includes(p);
}

/**
 * Owner custom rules: From (if set) AND contains (if set).
 * Returns the rule label as the hit reason, or null.
 */
export function matchGmailOwnerRule(
  fromHeader: string,
  subject: string,
  snippet: string,
  rules: GmailOwnerRule[]
): string | null {
  const text = `${subject}\n${snippet}`.toLowerCase();
  for (const rule of rules) {
    if (rule.mode !== 'alert') continue;
    if (rule.from && !matchOwnerFrom(fromHeader, rule.from)) continue;
    if (rule.contains && !text.includes(rule.contains.toLowerCase())) continue;
    return rule.label;
  }
  return null;
}
