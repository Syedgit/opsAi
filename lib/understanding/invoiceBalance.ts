/**
 * How much of a vendor bill is still owed. Payments are cash / check / other —
 * never wages. Remaining drives the "pay this" reminder.
 */
import { InvoiceSchema, type Invoice, type InvoicePayment, type InvoicePaymentMethod } from './schema';

const METHOD_LABEL: Record<InvoicePaymentMethod, string> = {
  cash: 'cash',
  check: 'check',
  other: 'other',
};

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function paidOf(invoice: Pick<Invoice, 'payments' | 'total' | 'paymentStatus'>): number {
  const listed = (invoice.payments ?? []).reduce((sum, p) => sum + p.amount, 0);
  if (listed > 0) return roundMoney(listed);
  if (invoice.paymentStatus === 'paid_cash' || invoice.paymentStatus === 'paid_other') return roundMoney(invoice.total);
  return 0;
}

export function remainingOf(invoice: Invoice): number {
  if (invoice.remainingDue != null && Number.isFinite(invoice.remainingDue)) {
    return roundMoney(Math.max(0, invoice.remainingDue));
  }
  return roundMoney(Math.max(0, invoice.total - paidOf(invoice)));
}

export function stillDue(invoice: Invoice): boolean {
  return remainingOf(invoice) > 0.005;
}

export function paymentDueOn(invoice: Invoice): string | null {
  return invoice.payBy || invoice.dueDate || null;
}

/** Fill payments / remaining / status from what was written, without inventing numbers. */
export function settleInvoice(invoice: Invoice): Invoice {
  const payments = [...(invoice.payments ?? [])];
  let total = invoice.total;
  let remainingDue = invoice.remainingDue ?? null;

  if (payments.length === 0 && remainingDue != null && total > remainingDue + 0.005) {
    const method: InvoicePaymentMethod =
      invoice.paymentStatus === 'paid_other' ? 'other' : invoice.paymentStatus === 'paid_cash' ? 'cash' : 'cash';
    payments.push({ amount: roundMoney(total - remainingDue), method });
  } else if (payments.length === 0 && (invoice.paymentStatus === 'paid_cash' || invoice.paymentStatus === 'paid_other')) {
    payments.push({
      amount: total,
      method: invoice.paymentStatus === 'paid_cash' ? 'cash' : 'other',
    });
    remainingDue = 0;
  } else if (payments.length > 0 && remainingDue == null) {
    const paid = payments.reduce((sum, p) => sum + p.amount, 0);
    if (paid > 0 && paid < total - 0.005) remainingDue = roundMoney(total - paid);
    else if (paid >= total - 0.005) remainingDue = 0;
  }

  if (payments.length > 0 && remainingDue != null && Math.abs(total - (paidSum(payments) + remainingDue)) > 0.02) {
    // Sender gave paid + remaining; that pair is the bill when they did not give the original total.
    const inferred = roundMoney(paidSum(payments) + remainingDue);
    if (inferred > 0 && (total === paidSum(payments) || total < inferred)) total = inferred;
  }

  const remaining = remainingDue != null ? roundMoney(Math.max(0, remainingDue)) : roundMoney(Math.max(0, total - paidSum(payments)));
  const paymentStatus: Invoice['paymentStatus'] = remaining <= 0.005
    ? payments.length > 0 && payments.every((p) => p.method === 'cash')
      ? 'paid_cash'
      : 'paid_other'
    : 'unpaid';

  return {
    ...invoice,
    total,
    payments,
    remainingDue: remaining <= 0.005 ? 0 : remaining,
    paymentStatus,
    remainingMethod: remaining > 0.005 ? invoice.remainingMethod ?? null : null,
    payBy: remaining > 0.005 ? invoice.payBy ?? invoice.dueDate ?? null : invoice.payBy ?? null,
  };
}

function paidSum(payments: InvoicePayment[]): number {
  return roundMoney(payments.reduce((sum, p) => sum + p.amount, 0));
}

export function looksLikePaymentUpdate(invoice: Invoice): boolean {
  const payments = invoice.payments ?? [];
  if (invoice.lineItems.length > 0) return false;
  if (payments.length > 0) return true;
  return invoice.remainingDue != null && invoice.remainingDue + 0.005 < invoice.total;
}

export function invoiceFromPayload(payload: unknown): Invoice | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (p._kind === 'invoice_payment') return null;
  const parsed = InvoiceSchema.safeParse(p.invoice);
  if (!parsed.success) return null;
  return settleInvoice(parsed.data);
}

export function applyPayments(base: Invoice, incoming: Invoice): Invoice {
  const extra = incoming.payments ?? [];
  const merged: Invoice = {
    ...base,
    payments: [...(base.payments ?? []), ...extra],
    payBy: incoming.payBy || base.payBy || base.dueDate || null,
    remainingMethod: incoming.remainingMethod ?? base.remainingMethod ?? null,
    remainingDue: incoming.remainingDue ?? null,
  };
  if (incoming.invoiceNumber && !base.invoiceNumber) merged.invoiceNumber = incoming.invoiceNumber;
  return settleInvoice(merged);
}

export function matchOpenInvoice(
  incoming: Invoice,
  open: Array<{ actionId: string; storeId: string; invoice: Invoice }>,
  storeId: string
): { actionId: string; storeId: string; invoice: Invoice } | null {
  const vendor = (incoming.vendorName ?? '').trim().toLowerCase();
  if (!vendor) return null;
  const number = (incoming.invoiceNumber ?? '').trim().toLowerCase();
  const pool = open.filter((row) => row.storeId === storeId && stillDue(row.invoice));
  const sameVendor = pool.filter((row) => (row.invoice.vendorName ?? '').trim().toLowerCase() === vendor);
  if (number) {
    const numbered = sameVendor.filter((row) => (row.invoice.invoiceNumber ?? '').trim().toLowerCase() === number);
    if (numbered.length === 1) return numbered[0];
    if (numbered.length > 1) return numbered[0];
  }
  if (sameVendor.length === 1) return sameVendor[0];
  return null;
}

export function describeBalance(invoice: Invoice): string {
  const remaining = remainingOf(invoice);
  const paid = paidOf(invoice);
  if (remaining <= 0.005) {
    const how = invoice.payments?.some((p) => p.method === 'check') ? 'paid (check)' : invoice.paymentStatus === 'paid_cash' ? 'paid cash' : 'paid';
    return how;
  }
  const bits = [`${money(remaining)} still due`];
  if (paid > 0.005) bits.unshift(`paid ${money(paid)}`);
  if (invoice.remainingMethod) bits.push(METHOD_LABEL[invoice.remainingMethod]);
  return bits.join(' · ');
}

function money(n: number): string {
  const whole = Number.isInteger(n);
  const body = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `$${body}`;
}

export function tillCashPayments(invoice: Invoice): InvoicePayment[] {
  return (invoice.payments ?? []).filter((p) => p.method === 'cash');
}
