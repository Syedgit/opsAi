import type { ClassificationType } from '@prisma/client';
import { shortReviewBlurb } from './entryReview';
import { reportFromClosePayload } from './understanding/depositDue';

/** Tab title is a calendar month (2026-11) or that month's invoices / paid-outs detail. */
export type SheetAppend = { tab: string; headers: string[]; row: (string | number)[] };

const PLACEHOLDER_SHEET = 'pending_google_sheet';

/** Accept a full Google Sheets URL or a raw spreadsheet id. */
export function parseGoogleSheetId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const fromUrl = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (fromUrl?.[1]) return fromUrl[1];
  if (/^[a-zA-Z0-9-_]{30,}$/.test(trimmed)) return trimmed;
  return null;
}

export function isSheetConnected(sheetId: string | null | undefined): boolean {
  const id = (sheetId || '').trim();
  return Boolean(id) && id !== PLACEHOLDER_SHEET;
}

export function sheetsServiceAccountEmail(): string | null {
  return process.env.GOOGLE_SHEETS_CLIENT_EMAIL?.trim() || null;
}

export function sheetsCredentialsConfigured(): boolean {
  return Boolean(sheetsServiceAccountEmail() && process.env.GOOGLE_SHEETS_PRIVATE_KEY?.trim());
}

/** YYYY-MM from a report day; used as the sheet tab for that month all year. */
export function monthTab(day: string, savedAtIso?: string): string {
  if (/^\d{4}-\d{2}/.test(day)) return day.slice(0, 7);
  if (savedAtIso && /^\d{4}-\d{2}/.test(savedAtIso)) return savedAtIso.slice(0, 7);
  return new Date().toISOString().slice(0, 7);
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

const DAILY_HEADERS = [
  'Date',
  'Store',
  'Store ID',
  'Cash',
  'Card',
  'Inside total',
  'Gas sales',
  'Gallons',
  'Paid outs',
  'Deposit',
  'Flags',
  'Saved at',
];

const INVOICE_HEADERS = [
  'Date',
  'Store',
  'Store ID',
  'Vendor',
  'Invoice #',
  'Amount',
  'Paid',
  'Remaining',
  'Due',
  'Flags',
  'Saved at',
];

const PAIDOUT_HEADERS = [
  'Date',
  'Store',
  'Store ID',
  'Amount',
  'Reason',
  'Source',
  'Flags',
  'Saved at',
];

/**
 * One spreadsheet per store for the year. Daily closes append to a tab named YYYY-MM.
 * Invoices and paid outs go to companion tabs for that same month.
 */
export function rowsForConfirmedAction(
  type: ClassificationType,
  payloadJson: unknown,
  meta: { storeId: string; storeName?: string; savedAt?: Date; confidence?: number | null } = {
    storeId: '',
  }
): SheetAppend[] {
  const payload =
    payloadJson && typeof payloadJson === 'object' ? (payloadJson as Record<string, unknown>) : {};
  const savedAt = (meta.savedAt ?? new Date()).toISOString();
  const storeId = meta.storeId;
  const storeName = meta.storeName || storeId;
  const flag = shortReviewBlurb(payload, meta.confidence) || '';
  const out: SheetAppend[] = [];

  if (type === 'STORE_SALES' || payload._kind === 'daily_close') {
    const report = reportFromClosePayload(payload);
    const day = str(payload.report_date || report?.reportDate || savedAt.slice(0, 10));
    const month = monthTab(day, savedAt);
    const cash = num(payload.cash ?? report?.cashSales);
    const card = num(payload.card ?? report?.cardSales);
    const inside = num(payload.total_inside) || Math.round((cash + card) * 100) / 100;
    const fuel = num(payload.fuel_sales ?? report?.fuelSales);
    const gallons = num(payload.gallons ?? report?.fuelGallons);
    const deposit = payload.deposit ?? report?.reportedDeposit;
    const payouts = Array.isArray(report?.payouts)
      ? report!.payouts
      : Array.isArray((payload.report as { payouts?: unknown } | undefined)?.payouts)
        ? ((payload.report as { payouts: Array<{ label?: string; amount?: number }> }).payouts)
        : [];
    const payoutTotal = Math.round(payouts.reduce((s, p) => s + num(p.amount), 0) * 100) / 100;
    out.push({
      tab: month,
      headers: DAILY_HEADERS,
      row: [
        day,
        storeName,
        storeId,
        cash,
        card,
        inside,
        fuel,
        gallons,
        payoutTotal,
        deposit == null ? '' : num(deposit),
        flag,
        savedAt,
      ],
    });
    for (const p of payouts) {
      out.push({
        tab: `${month} Paid outs`,
        headers: PAIDOUT_HEADERS,
        row: [
          day,
          storeName,
          storeId,
          num(p.amount),
          str(p.label) || 'Paid out',
          'close',
          flag,
          savedAt,
        ],
      });
    }
    return out;
  }

  if (type === 'INVOICE_EXPENSE' || payload._kind === 'invoice' || payload._kind === 'invoice_payment') {
    const day = str(payload.invoice_date || savedAt.slice(0, 10));
    const month = monthTab(day, savedAt);
    out.push({
      tab: `${month} Invoices`,
      headers: INVOICE_HEADERS,
      row: [
        day,
        storeName,
        storeId,
        str(payload.vendor),
        str(payload.invoice_number),
        num(payload.amount),
        str(payload.paid) || 'N',
        payload.remaining == null ? '' : num(payload.remaining),
        str(payload.due_date),
        flag,
        savedAt,
      ],
    });
    return out;
  }

  if (type === 'PAID_OUT') {
    const day = str(payload.date || savedAt.slice(0, 10));
    const month = monthTab(day, savedAt);
    out.push({
      tab: `${month} Paid outs`,
      headers: PAIDOUT_HEADERS,
      row: [
        day,
        storeName,
        storeId,
        num(payload.amount),
        str(payload.reason || payload.description || payload.category) || 'Paid out',
        'paid_out',
        flag,
        savedAt,
      ],
    });
    return out;
  }

  if (type === 'FUEL_SALES') {
    // Fuel-only confirm still lands on that month's daily tab so the year stays one place.
    const day = str(payload.date || payload.report_date || savedAt.slice(0, 10));
    const month = monthTab(day, savedAt);
    out.push({
      tab: month,
      headers: DAILY_HEADERS,
      row: [
        day,
        storeName,
        storeId,
        '',
        '',
        '',
        num(payload.fuel_sales),
        num(payload.gallons),
        '',
        '',
        flag,
        savedAt,
      ],
    });
    return out;
  }

  if (type === 'ORDER_REQUEST' || payload._kind === 'order') {
    const day = savedAt.slice(0, 10);
    const month = monthTab(day, savedAt);
    const items = Array.isArray((payload.order as { items?: unknown } | undefined)?.items)
      ? ((payload.order as { items: unknown[] }).items.length)
      : '';
    out.push({
      tab: `${month} Orders`,
      headers: ['Date', 'Store', 'Store ID', 'Vendor', 'Items', 'Flags', 'Saved at'],
      row: [day, storeName, storeId, str(payload.vendor), items, flag, savedAt],
    });
    return out;
  }

  return out;
}
