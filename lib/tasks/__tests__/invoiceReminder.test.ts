import {
  invoiceIsUnpaid,
  invoiceReminderKey,
  invoiceReminderTitle,
  paymentDueReminderDate,
  scheduleInvoicePaymentReminder,
} from '../invoiceReminder';
import type { Invoice } from '../../understanding/schema';

const unpaid: Invoice = {
  vendorName: 'Pepsi',
  invoiceNumber: '88',
  invoiceDate: '2026-10-12',
  dueDate: '2026-10-28',
  lineItems: [],
  total: 850,
  paymentStatus: 'unpaid',
};

describe('paymentDueReminderDate', () => {
  it('is 3 days before the due date', () => {
    expect(paymentDueReminderDate('2026-10-28', '2026-10-12')).toBe('2026-10-25');
  });

  it('moves up to today when those 3 days have already passed', () => {
    expect(paymentDueReminderDate('2026-10-13', '2026-10-12')).toBe('2026-10-12');
    expect(paymentDueReminderDate('2026-10-12', '2026-10-12')).toBe('2026-10-12');
  });

  it('skips bills that are already past due, or have no date', () => {
    expect(paymentDueReminderDate('2026-10-11', '2026-10-12')).toBeNull();
    expect(paymentDueReminderDate(null, '2026-10-12')).toBeNull();
    expect(paymentDueReminderDate('soon', '2026-10-12')).toBeNull();
  });
});

describe('who gets a reminder', () => {
  it('skips paid invoices', () => {
    expect(invoiceIsUnpaid({ paymentStatus: 'paid_cash' })).toBe(false);
    expect(invoiceIsUnpaid({ paymentStatus: 'paid_other' })).toBe(false);
    expect(invoiceIsUnpaid({ paymentStatus: 'unpaid' })).toBe(true);
    expect(invoiceIsUnpaid({ paymentStatus: 'unknown' })).toBe(true);
  });

  it('names the vendor and invoice number', () => {
    expect(invoiceReminderTitle(unpaid)).toBe('Pay Pepsi #88');
    expect(invoiceReminderTitle({ vendorName: 'Pepsi', invoiceNumber: null })).toBe('Pay Pepsi invoice');
    expect(invoiceReminderKey(unpaid)).toBe('invoice-due:pepsi:88:2026-10-28');
  });
});

function fakePrisma(existing: Array<{ instructions: string | null }> = []) {
  const created: Array<Record<string, unknown>> = [];
  return {
    created,
    taskTemplate: {
      findMany: async () => existing.map((t, i) => ({ id: `t${i}`, instructions: t.instructions })),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: `new-${created.length}`, ...data };
      },
    },
  };
}

describe('scheduleInvoicePaymentReminder', () => {
  const opts = { today: '2026-10-12', now: new Date('2026-10-12T14:00:00Z'), timeZone: 'America/New_York' };

  it('creates a one-off task 3 days before the due date', async () => {
    const db = fakePrisma();
    const result = await scheduleInvoicePaymentReminder(db as never, 'S001', unpaid, opts);
    expect(result).toEqual({ scheduled: true, reminderDate: '2026-10-25', title: 'Pay Pepsi #88' });
    expect(db.created[0]).toMatchObject({
      storeId: 'S001',
      frequency: 'once',
      anchorDate: '2026-10-25',
      startTime: '10:00',
      category: 'reports',
    });
    expect(String(db.created[0].instructions)).toContain('invoice-due:pepsi:88:2026-10-28');
    expect(String(db.created[0].instructions)).toContain('Due Wed, Oct 28');
  });

  it('does not remind when the invoice is already paid', async () => {
    const db = fakePrisma();
    const result = await scheduleInvoicePaymentReminder(db as never, 'S001', { ...unpaid, paymentStatus: 'paid_cash' }, opts);
    expect(result).toEqual({ scheduled: false, reason: 'paid' });
    expect(db.created).toHaveLength(0);
  });

  it('does not duplicate a reminder for the same invoice', async () => {
    const db = fakePrisma([{ instructions: 'invoice-due:pepsi:88:2026-10-28\nPay Pepsi' }]);
    const result = await scheduleInvoicePaymentReminder(db as never, 'S001', unpaid, opts);
    expect(result).toEqual({ scheduled: false, reason: 'duplicate' });
    expect(db.created).toHaveLength(0);
  });

  it('reminds today at the next couple of minutes when the due date is close', async () => {
    const db = fakePrisma();
    const now = new Date('2026-10-12T16:00:00Z'); // 12:00pm New York
    const result = await scheduleInvoicePaymentReminder(
      db as never,
      'S001',
      { ...unpaid, dueDate: '2026-10-13' },
      { today: '2026-10-12', now, timeZone: 'America/New_York' }
    );
    expect(result).toMatchObject({ scheduled: true, reminderDate: '2026-10-12' });
    expect(db.created[0].startTime).toBe('12:02');
  });
});
