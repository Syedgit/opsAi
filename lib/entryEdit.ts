/**
 * Admin web edits for confirmed WhatsApp entries.
 * Reuses WhatsApp FIX field names; clears matching needs_review flags after a successful patch.
 */

import { applyFixToPayload } from './understanding/plan';

export type EntryPatch = { field: string; value: string };

const FIX_CLEARS_REVIEW: Record<string, string[]> = {
  cash: ['cashSales', 'cash'],
  card: ['cardSales', 'card'],
  gas: ['fuelSales', 'fuel_sales', 'gas'],
  gallons: ['fuelGallons', 'gallons'],
  deposit: ['reportedDeposit', 'deposit'],
  total: ['storeSalesTotal', 'total', 'total_inside', 'amount'],
  amount: ['total', 'amount', 'storeSalesTotal'],
  date: ['reportDate', 'invoiceDate', 'depositDate', 'date'],
  vendor: ['vendor', 'vendorName'],
  due: ['dueDate', 'due'],
  due_date: ['dueDate', 'due'],
  duedate: ['dueDate', 'due'],
  payby: ['dueDate', 'payBy'],
  pay_by: ['dueDate', 'payBy'],
  remaining: ['remaining'],
  paid: ['payments', 'payments.amount', 'paid'],
  method: ['remaining', 'remainingMethod'],
  how: ['remaining', 'remainingMethod'],
};

function reviewKeysClearedBy(field: string): string[] {
  const key = field.toLowerCase().trim();
  return FIX_CLEARS_REVIEW[key] || [key];
}

export function clearNeedsReviewFields(
  payload: Record<string, unknown>,
  fields: string[],
  clearAll = false
): Record<string, unknown> {
  if (clearAll) {
    return { ...payload, needs_review: [] };
  }
  const current = Array.isArray(payload.needs_review)
    ? (payload.needs_review as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  if (current.length === 0) return payload;
  const drop = new Set(fields.flatMap(reviewKeysClearedBy).map((k) => k.toLowerCase()));
  const next = current.filter((f) => {
    const low = f.toLowerCase();
    const bare = low.replace(/^invoice\./, '').replace(/^reports?\.\d*\.?/, '');
    return !drop.has(low) && !drop.has(bare);
  });
  return { ...payload, needs_review: next };
}

export type AdminEntryEditResult =
  | { ok: true; payload: Record<string, unknown>; clearedFlags: boolean }
  | { ok: false; message: string };

/**
 * Apply one or more FIX-style patches to a confirmed entry payload.
 * When clearFlags is true, all needs_review flags are cleared after patches (or alone).
 */
export function applyAdminEntryEdit(
  payload: Record<string, unknown>,
  patches: EntryPatch[],
  opts: { clearFlags?: boolean; now?: Date } = {}
): AdminEntryEditResult {
  let next = { ...payload };
  const now = opts.now ?? new Date();
  const appliedFields: string[] = [];

  for (const patch of patches) {
    const field = String(patch.field || '').trim();
    const value = String(patch.value ?? '').trim();
    if (!field) return { ok: false, message: 'Each fix needs a field name.' };
    if (!value && field.toLowerCase() !== 'vendor') {
      return { ok: false, message: `Missing value for ${field}.` };
    }
    const result = applyFixToPayload(next, field, value, now);
    if (!result.ok) return { ok: false, message: result.message };
    next = result.payload;
    appliedFields.push(field);
  }

  if (opts.clearFlags) {
    next = clearNeedsReviewFields(next, [], true);
  } else if (appliedFields.length > 0) {
    next = clearNeedsReviewFields(next, appliedFields, false);
  }

  if (patches.length === 0 && !opts.clearFlags) {
    return { ok: false, message: 'Nothing to change. Send field fixes or clear flags.' };
  }

  return {
    ok: true,
    payload: next,
    clearedFlags: Boolean(opts.clearFlags) || appliedFields.length > 0,
  };
}

export const SALES_EDIT_FIELDS = [
  { field: 'cash', label: 'Cash' },
  { field: 'card', label: 'Card' },
  { field: 'total', label: 'Inside total' },
  { field: 'gas', label: 'Gas sales' },
  { field: 'gallons', label: 'Gallons' },
  { field: 'deposit', label: 'Deposit' },
  { field: 'date', label: 'Day (MM/DD)' },
] as const;

export const INVOICE_EDIT_FIELDS = [
  { field: 'vendor', label: 'Vendor' },
  { field: 'total', label: 'Amount' },
  { field: 'remaining', label: 'Remaining' },
  { field: 'paid', label: 'Paid so far' },
  { field: 'due', label: 'Due (MM/DD)' },
  { field: 'date', label: 'Invoice date (MM/DD)' },
  { field: 'method', label: 'Remaining method (cash/check/other)' },
] as const;
