import type { PrismaClient } from '@prisma/client';
import { formatMoney } from '../understanding/checks';
import { invoiceFromPayload, paymentDueOn, remainingOf, stillDue } from '../understanding/invoiceBalance';
import type { Invoice } from '../understanding/schema';
import { TaskTemplateInputSchema } from './schedule';
import { addDaysLocal, localMinutesOfDay, parseHHMM } from './time';

/** WhatsApp reminder is posted this many store-local days before the invoice due date. */
export const INVOICE_REMINDER_DAYS_BEFORE = 3;
const DEFAULT_REMIND_AT = '10:00';
const MAX_TEMPLATES_PER_STORE = 100;
const KEY_PREFIX = 'invoice-due:';

export function invoiceIsUnpaid(invoice: Invoice | Pick<Invoice, 'paymentStatus'>): boolean {
  if ('total' in invoice && typeof invoice.total === 'number') return stillDue(invoice as Invoice);
  return invoice.paymentStatus !== 'paid_cash' && invoice.paymentStatus !== 'paid_other';
}

/**
 * The store-local day to ping about an unpaid bill. Three days before the due date, or today
 * when that day has already passed and the bill is still not due. Null when there is nothing
 * to remind about (no due date, already paid, or already past due).
 */
export function paymentDueReminderDate(
  dueDate: string | null | undefined,
  today: string,
  daysBefore = INVOICE_REMINDER_DAYS_BEFORE
): string | null {
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  if (dueDate < today) return null;
  const want = addDaysLocal(dueDate, -daysBefore);
  return want < today ? today : want;
}

export function invoiceReminderTitle(invoice: Pick<Invoice, 'vendorName' | 'invoiceNumber'> & Partial<Invoice>): string {
  const vendor = (invoice.vendorName ?? 'vendor').trim() || 'vendor';
  const number = invoice.invoiceNumber?.trim();
  const left = typeof invoice.total === 'number' ? remainingOf(invoice as Invoice) : null;
  const money = left != null && left > 0.005 ? ` ${formatMoney(left)}` : '';
  const title = number ? `Pay ${vendor} #${number}${money}` : `Pay ${vendor} invoice${money}`;
  return title.slice(0, 120);
}

export function invoiceReminderKey(invoice: Pick<Invoice, 'vendorName' | 'invoiceNumber'>): string {
  const vendor = (invoice.vendorName ?? '').trim().toLowerCase();
  const number = (invoice.invoiceNumber ?? '').trim().toLowerCase();
  return `${KEY_PREFIX}${vendor}:${number}`;
}

async function deactivateInvoiceReminder(prisma: PrismaClient, storeId: string, invoice: Invoice): Promise<void> {
  const prefix = invoiceReminderKey(invoice);
  const existing = await prisma.taskTemplate.findMany({
    where: { storeId, active: true },
    select: { id: true, instructions: true },
  });
  for (const row of existing) {
    if ((row.instructions ?? '').startsWith(prefix)) {
      await prisma.taskTemplate.update({ where: { id: row.id }, data: { active: false } });
    }
  }
}

export function formatInvoiceDay(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function reminderStartTime(reminderDate: string, today: string, now: Date, timeZone: string): string {
  if (reminderDate !== today) return DEFAULT_REMIND_AT;
  const nowMinutes = localMinutesOfDay(now, timeZone);
  const usual = parseHHMM(DEFAULT_REMIND_AT) ?? 10 * 60;
  if (nowMinutes < usual) return DEFAULT_REMIND_AT;
  const at = Math.min(nowMinutes + 2, 23 * 60 + 59);
  return `${String(Math.floor(at / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}`;
}

export type InvoiceReminderResult =
  | { scheduled: true; reminderDate: string; title: string }
  | { scheduled: false; reason: 'paid' | 'no_due_date' | 'past_due' | 'duplicate' | 'limit' | 'invalid' };

/** One-off group task 3 days before an unpaid invoice is due. Safe to call twice: duplicates are skipped. */
export async function scheduleInvoicePaymentReminder(
  prisma: PrismaClient,
  storeId: string,
  invoice: Invoice,
  opts: { today: string; now: Date; timeZone: string }
): Promise<InvoiceReminderResult> {
  if (!invoiceIsUnpaid(invoice)) {
    await deactivateInvoiceReminder(prisma, storeId, invoice);
    return { scheduled: false, reason: 'paid' };
  }
  const dueDate = paymentDueOn(invoice);
  if (!dueDate) return { scheduled: false, reason: 'no_due_date' };
  const reminderDate = paymentDueReminderDate(dueDate, opts.today);
  if (!reminderDate) return { scheduled: false, reason: 'past_due' };

  const key = invoiceReminderKey(invoice);
  const existing = await prisma.taskTemplate.findMany({
    where: { storeId, active: true },
    select: { id: true, instructions: true },
  });
  const already = existing.find((t) => (t.instructions ?? '').startsWith(key));
  const vendor = invoice.vendorName?.trim() || 'this vendor';
  const number = invoice.invoiceNumber?.trim();
  const due = formatInvoiceDay(dueDate);
  const left = remainingOf(invoice);
  const how = invoice.remainingMethod ? ` by ${invoice.remainingMethod}` : '';
  const instructions = [
    key,
    `Pay ${vendor}${number ? ` invoice #${number}` : ''} ${formatMoney(left)} remaining${how}. Due ${due}. Send a photo of the paid receipt or reply DONE.`,
  ].join('\n');
  const title = invoiceReminderTitle(invoice);

  if (already) {
    await prisma.taskTemplate.update({
      where: { id: already.id },
      data: {
        title,
        instructions,
        anchorDate: reminderDate,
        startTime: reminderStartTime(reminderDate, opts.today, opts.now, opts.timeZone),
      },
    });
    return { scheduled: true, reminderDate, title };
  }
  if (existing.length >= MAX_TEMPLATES_PER_STORE) return { scheduled: false, reason: 'limit' };

  const parsed = TaskTemplateInputSchema.safeParse({
    title,
    instructions,
    category: 'reports',
    startTime: reminderStartTime(reminderDate, opts.today, opts.now, opts.timeZone),
    frequency: 'once',
    anchorDate: reminderDate,
    evidence: 'either',
    remindEveryMinutes: 60,
    escalateAfterMinutes: 240,
    lateAfterMinutes: 180,
  });
  if (!parsed.success) return { scheduled: false, reason: 'invalid' };

  await prisma.taskTemplate.create({ data: { ...parsed.data, storeId } });
  return { scheduled: true, reminderDate, title: parsed.data.title };
}

export type OpenInvoice = { actionId: string; storeId: string; invoice: Invoice };

export async function loadOpenInvoices(prisma: PrismaClient, storeIds: string[]): Promise<OpenInvoice[]> {
  if (storeIds.length === 0) return [];
  const rows = await prisma.pendingActions.findMany({
    where: { storeId: { in: storeIds }, type: 'INVOICE_EXPENSE', status: 'CONFIRMED' },
    select: { actionId: true, storeId: true, payloadJson: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  const open: OpenInvoice[] = [];
  for (const row of rows) {
    const invoice = invoiceFromPayload(row.payloadJson);
    if (invoice && stillDue(invoice)) open.push({ actionId: row.actionId, storeId: row.storeId, invoice });
  }
  return open;
}

export function describeOpenBills(
  rows: OpenInvoice[],
  storeNames: Record<string, string>,
  showStore: boolean
): string {
  if (rows.length === 0) {
    return 'No vendor bills still owed. Send an invoice photo, or text like: Pepsi paid cash 500 remaining 400 send check Friday.';
  }
  const sorted = [...rows].sort((a, b) => {
    const byDate = (paymentDueOn(a.invoice) ?? '9999').localeCompare(paymentDueOn(b.invoice) ?? '9999');
    if (byDate !== 0) return byDate;
    return (a.invoice.vendorName ?? '').localeCompare(b.invoice.vendorName ?? '');
  });
  const lines = ['💸 Still owed'];
  for (const row of sorted) {
    const vendor = row.invoice.vendorName?.trim() || 'Vendor';
    const number = row.invoice.invoiceNumber?.trim() ? ` #${row.invoice.invoiceNumber.trim()}` : '';
    const store = showStore ? ` · ${storeNames[row.storeId] ?? row.storeId}` : '';
    const how = row.invoice.remainingMethod ? ` ${row.invoice.remainingMethod}` : '';
    const due = paymentDueOn(row.invoice);
    const when = due ? ` due ${formatInvoiceDay(due)}` : '';
    lines.push(`• ${vendor}${number}${store}: ${formatMoney(remainingOf(row.invoice))} remaining${how}${when}`);
  }
  return lines.join('\n');
}
