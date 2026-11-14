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
