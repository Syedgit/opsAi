import type { StoreProfile } from './profile';
import type { DailyCloseReport } from './schema';
import { createOpenAiUnderstander, type MessageUnderstander } from './extractor';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MIN_BASE64 = 80;
const MAX_BASE64 = 2_500_000;

function amountText(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** Compact wording saved as this store's typical close, from a typed message or a POS photo we just read. */
export function dailyCloseSampleText(report: DailyCloseReport): string {
  return [
    report.storeHint?.trim() || null,
    'Store Close',
    report.reportDate,
    report.fuelSales != null ? `fuel ${amountText(report.fuelSales)}` : null,
    report.fuelGallons != null ? `gallons ${amountText(report.fuelGallons)}` : null,
    report.fuelDiscounts != null ? `discounts ${amountText(report.fuelDiscounts)}` : null,
    report.storeSalesTotal != null ? `non-fuel ${amountText(report.storeSalesTotal)}` : null,
    report.cardSales != null ? `card ${amountText(report.cardSales)}` : null,
    report.cashSales != null ? `cash ${amountText(report.cashSales)}` : null,
    report.reportedDayTotal != null ? `total ${amountText(report.reportedDayTotal)}` : null,
    report.periodClosed === false ? 'period open' : report.periodClosed === true ? 'period closed' : null,
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000);
}

export async function sampleFromDailyClosePhoto(
  image: { base64: string; mimeType: string },
  understander?: MessageUnderstander | null,
  profiles: StoreProfile[] = [],
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const mime = image.mimeType.trim().toLowerCase();
  if (!ALLOWED_MIME.has(mime)) {
    return { ok: false, error: 'Use a JPEG, PNG, or WebP photo of the Store Close screen.' };
  }
  if (!image.base64 || image.base64.length < MIN_BASE64) {
    return { ok: false, error: 'That photo is too small to read.' };
  }
  if (image.base64.length > MAX_BASE64) {
    return { ok: false, error: 'That photo is too large. Use a picture under 2 MB, or type the close.' };
  }

  const reader = understander === undefined ? createOpenAiUnderstander() : understander;
  if (!reader) {
    return { ok: false, error: 'Photo reading is not on. Type what the close usually says, or try again later.' };
  }

  try {
    const understanding = await reader.understand({ image, profiles, now: new Date() });
    if (understanding.kind !== 'daily_close' || understanding.reports.length === 0) {
      return { ok: false, error: 'Could not read that as a Store Close or daily sales page. Type the totals, or try a clearer photo.' };
    }
    const text = dailyCloseSampleText(understanding.reports[0]);
    if (!text) {
      return { ok: false, error: 'Could not read fuel or store totals on that page. Type what it usually says.' };
    }
    return { ok: true, text };
  } catch {
    return { ok: false, error: 'Could not read the photo. Type what the close usually says.' };
  }
}
