/**
 * Flatten till cash that left the drawer: typed paid-outs, daily-close payout lines,
 * and cash paid on vendor invoices. Checks are not till cash. Never wages.
 */
import { InvoiceSchema } from './schema';
import { settleInvoice, tillCashPayments } from './invoiceBalance';

export type TillPaidOutRow = {
  id: string;
  date: Date;
  data: { amount: number; reason: string; employee: string };
  confidence: number;
};

export function sourceActionId(id: string): string {
  return id.replace(/:(?:payout|cash):\d+$/, '');
}

export function flattenTillPaidOuts(
  rows: Array<{
    actionId: string;
    type: string;
    createdAt: Date;
    payloadJson: unknown;
    confidence: number;
  }>
): TillPaidOutRow[] {
  const out: TillPaidOutRow[] = [];
  for (const row of rows) {
    const payload = (row.payloadJson ?? {}) as Record<string, unknown>;
    if (row.type === 'PAID_OUT') {
      const amount = typeof payload.amount === 'number' ? payload.amount : 0;
      const reason = String(payload.reason ?? payload.label ?? 'paid out').trim() || 'paid out';
      out.push({
        id: row.actionId,
        date: row.createdAt,
        data: { amount, reason, employee: String(payload.employee ?? '').trim() || 'N/A' },
        confidence: row.confidence,
      });
      continue;
    }
    if (row.type === 'STORE_SALES' || payload._kind === 'daily_close') {
      const report = payload.report as { payouts?: Array<{ label?: string; amount?: number }> } | undefined;
      (report?.payouts ?? []).forEach((payout, i) => {
        if (typeof payout.amount !== 'number' || !Number.isFinite(payout.amount)) return;
        out.push({
          id: `${row.actionId}:payout:${i}`,
          date: row.createdAt,
          data: {
            amount: payout.amount,
            reason: (payout.label || 'paid out').trim() || 'paid out',
            employee: 'N/A',
          },
          confidence: row.confidence,
        });
      });
      continue;
    }
    if (row.type === 'INVOICE_EXPENSE' && payload._kind !== 'invoice_payment') {
      const parsed = InvoiceSchema.safeParse(payload.invoice);
      if (!parsed.success) continue;
      const invoice = settleInvoice(parsed.data);
      const vendor = (invoice.vendorName ?? String(payload.vendor ?? 'vendor')).trim() || 'vendor';
      tillCashPayments(invoice).forEach((payment, i) => {
        out.push({
          id: `${row.actionId}:cash:${i}`,
          date: row.createdAt,
          data: {
            amount: payment.amount,
            reason: `${vendor} cash`,
            employee: 'N/A',
          },
          confidence: row.confidence,
        });
      });
    }
  }
  return out.sort((a, b) => b.date.getTime() - a.date.getTime());
}
