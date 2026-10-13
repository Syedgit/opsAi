import type { ClassificationType } from '@prisma/client';

export interface ExtractionResult {
  fields: Record<string, unknown>;
  confidence: number;
}

const DATE_RE = /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g;
const MONEY_RE = /\$?\s*(\d[\d,]*(?:\.\d+)?)/g;

function toNumber(raw: string): number {
  return parseFloat(raw.replace(/,/g, ''));
}

/** Every number in the text, ignoring dates such as 10/12/2026 (they are not money). */
function moneyValues(text: string): number[] {
  const withoutDates = text.replace(DATE_RE, ' ');
  return [...withoutDates.matchAll(MONEY_RE)].map((m) => toNumber(m[1])).filter((n) => Number.isFinite(n));
}

/** The number written right after one of the labels ("cash 2100", "card: $5,400"). */
function amountAfter(text: string, labels: string[]): number | null {
  const withoutDates = text.replace(DATE_RE, ' ');
  const re = new RegExp(`\\b(?:${labels.join('|')})\\b\\s*[:\\-=]?\\s*\\$?\\s*(\\d[\\d,]*(?:\\.\\d+)?)`, 'i');
  const match = withoutDates.match(re);
  return match ? toNumber(match[1]) : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Rule-based extraction, used only when AI understanding is not configured or unreachable.
 * Prefers numbers written next to a label; falls back to position when there are no labels.
 */
export function extractDataFromText(
  classificationType: ClassificationType,
  text: string
): ExtractionResult {
  const fields: Record<string, unknown> = { raw_text: text };
  const money = moneyValues(text);

  switch (classificationType) {
    case 'STORE_SALES': {
      const cash = amountAfter(text, ['cash']) ?? money[0] ?? 0;
      const card = amountAfter(text, ['card', 'credit']) ?? money[1] ?? 0;
      fields.cash = cash;
      fields.card = card;
      fields.tax = amountAfter(text, ['tax']) ?? 0;
      // Inside sales are cash + card. The last number in a message is not a total.
      fields.total_inside = round2(cash + card);
      break;
    }
    case 'INVOICE_EXPENSE': {
      const vendorMatch = text.match(/\b(?:vendor|from)\s*[:-]?\s*([A-Za-z0-9 &]+)/i);
      fields.vendor = vendorMatch?.[1]?.trim() || 'Unknown';
      fields.amount = amountAfter(text, ['total', 'amount', 'invoice']) ?? money[0] ?? 0;
      break;
    }
    case 'FUEL_SALES': {
      const gallonsBefore = text.replace(DATE_RE, ' ').match(/(\d[\d,]*(?:\.\d+)?)\s*(?:gallons?|gal)\b/i);
      fields.gallons = gallonsBefore ? toNumber(gallonsBefore[1]) : (amountAfter(text, ['gallons?', 'gal']) ?? money[0] ?? 0);
      fields.fuel_sales = amountAfter(text, ['fuel sales', 'gas sales', 'sales', 'fuel', 'gas']) ?? money[1] ?? 0;
      fields.fuel_gp = amountAfter(text, ['fuel gp', 'gp']) ?? money[2] ?? 0;
      break;
    }
    case 'PAID_OUT':
      fields.amount = money[0] ?? 0;
      fields.reason = text.slice(0, 120);
      break;
    case 'ORDER_REQUEST':
      fields.order_batch_id = `order-${Date.now()}`;
      fields.vendor_groups = [{ vendor: 'General', items: [{ name: text.slice(0, 80), qty: 1, unit: 'each' }] }];
      break;
    default:
      break;
  }

  return { fields, confidence: 0.6 };
}

const USED_FIELDS: Partial<Record<string, string[]>> = {
  STORE_SALES: ['cash', 'card', 'tax'],
  INVOICE_EXPENSE: ['amount'],
  FUEL_SALES: ['gallons', 'fuel_sales', 'fuel_gp'],
  PAID_OUT: ['amount'],
};

/**
 * Numbers in the message that the rules did not use (gas, a second store, a deposit, ...).
 * The rule-based path reads very little, so a reply that looks complete but dropped these would
 * mislead the owner. Callers should ask the sender to resend instead of saving a partial reading.
 */
export function unusedNumbers(classificationType: ClassificationType, text: string, fields: Record<string, unknown>): number[] {
  const usedKeys = USED_FIELDS[classificationType];
  if (!usedKeys) return [];
  const remaining = moneyValues(text);
  for (const key of usedKeys) {
    const value = fields[key];
    if (typeof value !== 'number') continue;
    const index = remaining.indexOf(value);
    if (index >= 0) remaining.splice(index, 1);
  }
  return remaining;
}
