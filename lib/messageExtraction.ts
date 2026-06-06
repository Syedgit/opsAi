import type { ClassificationType } from '@prisma/client';

export interface ExtractionResult {
  fields: Record<string, unknown>;
  confidence: number;
}

/** Rule-based extraction fallback when AI/OCR is unavailable. */
export function extractDataFromText(
  classificationType: ClassificationType,
  text: string
): ExtractionResult {
  const fields: Record<string, unknown> = { raw_text: text };

  const money = [...text.matchAll(/\$?\s*([\d,]+(?:\.\d{2})?)/g)].map((m) =>
    parseFloat(m[1].replace(/,/g, ''))
  );

  switch (classificationType) {
    case 'STORE_SALES':
      fields.cash = money[0] ?? 0;
      fields.card = money[1] ?? 0;
      fields.tax = money[2] ?? 0;
      fields.total_inside = money[3] ?? money[money.length - 1] ?? 0;
      break;
    case 'INVOICE_EXPENSE': {
      const vendorMatch = text.match(/\b(?:vendor|from)\s*[:\-]?\s*([A-Za-z0-9 &]+)/i);
      fields.vendor = vendorMatch?.[1]?.trim() || 'Unknown';
      fields.amount = money[0] ?? 0;
      break;
    }
    case 'FUEL_SALES':
      fields.gallons = money[0] ?? 0;
      fields.fuel_sales = money[1] ?? 0;
      fields.fuel_gp = money[2] ?? 0;
      break;
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
