/**
 * What an owner should double-check on a confirmed WhatsApp entry.
 * Uses checks + needs_review already stored on the payload — no change to OK / FIX.
 */

const FIELD_LABEL: Record<string, string> = {
  cardSales: 'card/credit',
  cashSales: 'cash',
  storeSalesTotal: 'non-fuel total',
  fuelSales: 'gas sales',
  fuelGallons: 'gallons',
  fuelDiscounts: 'fuel discounts',
  reportedDeposit: 'deposit',
  reportedDayTotal: 'day total',
  reportDate: 'date',
  storeHint: 'store name',
  payouts: 'paid outs',
  invoiceNumber: 'invoice #',
  invoiceDate: 'invoice date',
  dueDate: 'due date',
  vendor: 'vendor',
  vendorName: 'vendor',
  total: 'total',
  tax: 'tax',
  remaining: 'remaining',
  amount: 'amount',
  payments: 'payments',
  'payments.amount': 'payment amount',
  accountLast4: 'account last 4',
  depositDate: 'deposit date',
  weekStart: 'week start',
  employees: 'employees',
  regular: 'regular price',
  midgrade: 'midgrade price',
  premium: 'premium price',
  diesel: 'diesel price',
};

/** Confidence at or below this means the read was shaky even if checks passed. */
export const LOW_CONFIDENCE = 0.75;

export type EntryCheck = { status?: string; message?: string; id?: string };

export type EntryReview = {
  /** Short lines for badges and detail panels. */
  messages: string[];
  /** True when the model flagged fields or checks failed/warned. */
  hasIssues: boolean;
  lowConfidence: boolean;
};

function labelForField(raw: string): string {
  const key = raw.replace(/^reports?\.\d*\.?/, '').trim();
  if (!key) return raw;
  return FIELD_LABEL[key] ?? FIELD_LABEL[key.replace(/^invoice\./, '')] ?? key;
}

export function needsReviewFields(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const list = (payload as { needs_review?: unknown }).needs_review;
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()))];
}

export function checkIssueMessages(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const checks = (payload as { checks?: unknown }).checks;
  if (!Array.isArray(checks)) return [];
  return checks
    .filter((c): c is EntryCheck => Boolean(c) && typeof c === 'object')
    .filter((c) => c.status === 'warn' || c.status === 'fail')
    .map((c) => (typeof c.message === 'string' && c.message.trim() ? c.message.trim() : 'Check failed'))
    .filter(Boolean);
}

/** Hard problems — do not confirm with OK until FIX (or CANCEL). */
export function failCheckMessages(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const checks = (payload as { checks?: unknown }).checks;
  if (!Array.isArray(checks)) return [];
  return checks
    .filter((c): c is EntryCheck => Boolean(c) && typeof c === 'object')
    .filter((c) => c.status === 'fail')
    .map((c) => (typeof c.message === 'string' && c.message.trim() ? c.message.trim() : 'Check failed'))
    .filter(Boolean);
}

/** Soft flags to repeat in the OK reply so the person finishes in WhatsApp, not on the dashboard. */
export function whatsAppReviewFollowUp(payload: unknown, confidence?: number | null): string | null {
  const fails = failCheckMessages(payload);
  if (fails.length > 0) return null;
  const review = entryReview(payload, confidence);
  if (!review.hasIssues) return null;
  return `⚠️ Saved with flags:\n${review.messages.map((m) => `• ${m}`).join('\n')}\nReply FIX <field> <value> if something is wrong.`;
}

/** One short line for lists / admin pings (first two messages). */
export function shortReviewBlurb(payload: unknown, confidence?: number | null): string | null {
  const review = entryReview(payload, confidence);
  if (!review.hasIssues) return null;
  return review.messages.slice(0, 2).join(' · ');
}

/** WhatsApp note for owners/managers right after a flagged report was saved. */
export function adminFlagNotice(storeName: string, blurbs: string[]): string | null {
  const lines = blurbs.map((b) => b.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  return [
    `⚠️ ${storeName} — report saved with flags:`,
    ...lines.map((b) => `• ${b}`),
    'Ask the closer to FIX on WhatsApp if a number is wrong, or check Daily sales / Invoices on the dashboard.',
  ].join('\n');
}

export function entryReview(payload: unknown, confidence?: number | null): EntryReview {
  const checkMsgs = checkIssueMessages(payload);
  const fields = needsReviewFields(payload);
  const fieldMsgs = fields.length ? [`Unclear: ${fields.map(labelForField).join(', ')}`] : [];
  const lowConfidence = typeof confidence === 'number' && confidence >= 0 && confidence <= LOW_CONFIDENCE;
  const messages = [...checkMsgs, ...fieldMsgs];
  if (lowConfidence) messages.push(`Low confidence read (${Math.round(confidence * 100)}%)`);
  return {
    messages,
    hasIssues: messages.length > 0,
    lowConfidence,
  };
}

/** How many of these confirmed rows still deserve an owner look. */
export function countEntriesNeedingReview(
  rows: Array<{ payloadJson?: unknown; confidence?: number | null }>
): number {
  return rows.filter((row) => entryReview(row.payloadJson, row.confidence).hasIssues).length;
}
