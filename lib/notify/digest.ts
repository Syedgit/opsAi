import type { PrismaClient } from '@prisma/client';
import { formatMoney } from '../understanding/checks';
import { paymentDueOn, remainingOf } from '../understanding/invoiceBalance';
import { loadStoreReport } from '../storeReport';
import { loadOpenInvoices } from '../tasks/invoiceReminder';
import { localDateString } from '../tasks/time';
import { readChannelPrefs } from './channels';
import { emailConfig, sendEmail } from './email';
import { postSlackMessage, slackConfig } from './slack';
import { logApp, logAppError, serializeError } from '../requestLog';

export type DigestPayload = {
  storeId: string;
  storeName: string;
  subject: string;
  text: string;
  html: string;
};

function escHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Pure builder — confirmed report facts only, no new AI brain. */
export function formatOwnerDigest(input: {
  storeName: string;
  today: string;
  standing: number | null;
  sales: number | null;
  missingCloses: number;
  openInvoices: Array<{ vendor: string; remaining: number; due: string | null }>;
  note?: string | null;
}): { storeName: string; subject: string; text: string; html: string } {
  const open = input.openInvoices.slice(0, 8);
  const overdue = open.filter((row) => row.due && row.due < input.today);
  const lines: string[] = [
    `${input.storeName} · morning brief · ${input.today}`,
    '',
  ];
  if (input.standing != null) {
    lines.push(
      `Standing (this week): ${formatMoney(input.standing)}` +
        (input.sales != null ? ` · sales ${formatMoney(input.sales)}` : '')
    );
  } else {
    lines.push('Standing: no confirmed closes in range yet.');
  }
  if (input.missingCloses > 0) {
    lines.push(`Missing closes: ${input.missingCloses} day${input.missingCloses === 1 ? '' : 's'} without a confirmed close.`);
  } else {
    lines.push('Missing closes: none in this week’s window.');
  }
  if (open.length === 0) {
    lines.push('Open invoices: none.');
  } else {
    lines.push(`Open invoices: ${open.length}` + (overdue.length ? ` (${overdue.length} past due)` : ''));
    for (const inv of open) {
      lines.push(
        `• ${inv.vendor} · ${formatMoney(inv.remaining)} left` +
          (inv.due ? ` · due ${inv.due}` : '')
      );
    }
  }
  if (input.note) lines.push('', input.note);
  lines.push('', '— opsAi · confirmed data only · open Crew or WhatsApp to dig in');

  const text = lines.join('\n');
  const htmlLines = lines.map((line) => {
    if (!line) return '<br>';
    if (line.startsWith('• ')) return `<div style="margin:2px 0 2px 12px;">${escHtml(line)}</div>`;
    if (line.startsWith('— ')) return `<p style="color:#666;font-size:12px;margin-top:16px;">${escHtml(line)}</p>`;
    return `<div>${escHtml(line)}</div>`;
  });
  return {
    storeName: input.storeName,
    subject: `${input.storeName}: morning brief`,
    text,
    html: `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.45;color:#1a1a1a;">${htmlLines.join('')}</div>`,
  };
}

export async function buildStoreDigest(
  prisma: PrismaClient,
  storeId: string,
  now: Date = new Date()
): Promise<DigestPayload | null> {
  const store = await prisma.storeConfig.findUnique({
    where: { storeId },
    select: { storeId: true, storeName: true, timezone: true, active: true },
  });
  if (!store?.active) return null;
  const timeZone = store.timezone || 'America/New_York';
  const today = localDateString(now, timeZone);
  const report = await loadStoreReport(prisma, storeId, { period: 'week' });
  const openRows = await loadOpenInvoices(prisma, [storeId]);
  const openInvoices = openRows
    .filter((row) => row.storeId === storeId)
    .slice(0, 8)
    .map((row) => ({
      vendor: row.invoice.vendorName || 'Vendor',
      remaining: remainingOf(row.invoice),
      due: paymentDueOn(row.invoice) || null,
    }));

  if ('error' in report) {
    const built = formatOwnerDigest({
      storeName: store.storeName,
      today,
      standing: null,
      sales: null,
      missingCloses: 0,
      openInvoices,
    });
    return { storeId, ...built };
  }

  const built = formatOwnerDigest({
    storeName: store.storeName,
    today,
    standing: report.totals.standing,
    sales: report.totals.sales,
    missingCloses: report.totals.missingCloses,
    openInvoices,
    note: report.note || null,
  });
  return { storeId, ...built };
}

async function ownerEmailsForStore(prisma: PrismaClient, storeId: string): Promise<string[]> {
  const rows = await prisma.userStore.findMany({
    where: { storeId, role: { in: ['OWNER', 'MANAGER'] } },
    select: { user: { select: { email: true, isActive: true } } },
  });
  return rows
    .filter((row) => row.user.isActive && row.user.email.includes('@'))
    .map((row) => row.user.email.trim().toLowerCase());
}

export type DigestRunResult = {
  stores: number;
  emailed: number;
  slacked: number;
  skipped: number;
  errors: number;
};

/** Morning brief for stores that opted into email and/or Slack. */
export async function runOwnerDigests(
  prisma: PrismaClient,
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env
): Promise<DigestRunResult> {
  const result: DigestRunResult = { stores: 0, emailed: 0, slacked: 0, skipped: 0, errors: 0 };
  const emailReady = emailConfig(env).ready;
  const slackReady = slackConfig(env).ready;
  if (!emailReady && !slackReady) {
    logApp('digest.run', { ok: false, reason: 'no_channels_configured' });
    return result;
  }

  const stores = await prisma.storeConfig.findMany({
    where: { active: true },
    select: { storeId: true, profileJson: true },
    take: 500,
  });
  result.stores = stores.length;

  for (const store of stores) {
    const prefs = readChannelPrefs(store.profileJson);
    const wantEmail = prefs.emailDigest.enabled && emailReady;
    const wantSlack = prefs.slack.enabled && slackReady && (prefs.slack.channelId || env.SLACK_DEFAULT_CHANNEL);
    if (!wantEmail && !wantSlack) {
      result.skipped += 1;
      continue;
    }
    try {
      const digest = await buildStoreDigest(prisma, store.storeId, now);
      if (!digest) {
        result.skipped += 1;
        continue;
      }
      if (wantEmail) {
        const to = prefs.emailDigest.to
          ? [prefs.emailDigest.to]
          : await ownerEmailsForStore(prisma, store.storeId);
        if (to.length === 0) {
          result.skipped += 1;
        } else {
          const sent = await sendEmail(
            { to, subject: digest.subject, text: digest.text, html: digest.html },
            env
          );
          if (sent.ok) result.emailed += 1;
          else result.errors += 1;
        }
      }
      if (wantSlack) {
        const channel = prefs.slack.channelId || env.SLACK_DEFAULT_CHANNEL || '';
        const posted = await postSlackMessage({ channel, text: digest.text }, env);
        if (posted.ok) result.slacked += 1;
        else result.errors += 1;
      }
    } catch (error: unknown) {
      result.errors += 1;
      logAppError('digest.store', { storeId: store.storeId, ...serializeError(error) });
    }
  }

  logApp('digest.run', result);
  return result;
}
