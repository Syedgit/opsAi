import type { PrismaClient } from '@prisma/client';
import { formatMoney } from '../understanding/checks';
import type { Invoice } from '../understanding/schema';
import { TaskTemplateInputSchema } from './schedule';
import { addDaysLocal, localMinutesOfDay, parseHHMM } from './time';

/** WhatsApp reminder is posted this many store-local days before the invoice due date. */
export const INVOICE_REMINDER_DAYS_BEFORE = 3;
const DEFAULT_REMIND_AT = '10:00';
const MAX_TEMPLATES_PER_STORE = 100;
const KEY_PREFIX = 'invoice-due:';

export function invoiceIsUnpaid(invoice: Pick<Invoice, 'paymentStatus'>): boolean {
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

export function invoiceReminderTitle(invoice: Pick<Invoice, 'vendorName' | 'invoiceNumber'>): string {
  const vendor = (invoice.vendorName ?? 'vendor').trim() || 'vendor';
  const number = invoice.invoiceNumber?.trim();
  const title = number ? `Pay ${vendor} #${number}` : `Pay ${vendor} invoice`;
  return title.slice(0, 120);
}

export function invoiceReminderKey(invoice: Pick<Invoice, 'vendorName' | 'invoiceNumber' | 'dueDate'>): string {
  const vendor = (invoice.vendorName ?? '').trim().toLowerCase();
  const number = (invoice.invoiceNumber ?? '').trim().toLowerCase();
  return `${KEY_PREFIX}${vendor}:${number}:${invoice.dueDate ?? ''}`;
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
  if (!invoiceIsUnpaid(invoice)) return { scheduled: false, reason: 'paid' };
  if (!invoice.dueDate) return { scheduled: false, reason: 'no_due_date' };
  const reminderDate = paymentDueReminderDate(invoice.dueDate, opts.today);
  if (!reminderDate) return { scheduled: false, reason: 'past_due' };

  const key = invoiceReminderKey(invoice);
  const existing = await prisma.taskTemplate.findMany({
    where: { storeId, active: true },
    select: { id: true, instructions: true },
  });
  if (existing.some((t) => (t.instructions ?? '').startsWith(key))) {
    return { scheduled: false, reason: 'duplicate' };
  }
  if (existing.length >= MAX_TEMPLATES_PER_STORE) return { scheduled: false, reason: 'limit' };

  const vendor = invoice.vendorName?.trim() || 'this vendor';
  const number = invoice.invoiceNumber?.trim();
  const due = formatInvoiceDay(invoice.dueDate);
  const instructions = [
    key,
    `Pay ${vendor}${number ? ` invoice #${number}` : ''} for ${formatMoney(invoice.total)}. Due ${due}. Send a photo of the paid receipt or reply DONE.`,
  ].join('\n');

  const parsed = TaskTemplateInputSchema.safeParse({
    title: invoiceReminderTitle(invoice),
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
