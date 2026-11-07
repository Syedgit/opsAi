import type { Invoice } from './schema';
import { createOpenAiUnderstander, type MessageUnderstander } from './extractor';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MIN_BASE64 = 80;
const MAX_BASE64 = 2_500_000;

function amountText(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function paidText(status: Invoice['paymentStatus']): string | null {
  if (status === 'paid_cash') return 'paid cash';
  if (status === 'paid_other') return 'paid';
  if (status === 'unpaid') return 'unpaid';
  return null;
}

/** Compact wording saved as this store's typical invoice, from a typed message or a photo we just read. */
export function invoiceSampleText(invoice: Invoice): string {
  const items = invoice.lineItems
    .map((item) => item.description.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join(', ');
  return [
    invoice.vendorName?.trim() || null,
    'invoice',
    invoice.invoiceNumber ? `#${invoice.invoiceNumber}` : null,
    amountText(invoice.total),
    paidText(invoice.paymentStatus),
    items || null,
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000);
}

export async function sampleFromInvoicePhoto(
  image: { base64: string; mimeType: string },
  understander?: MessageUnderstander | null,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const mime = image.mimeType.trim().toLowerCase();
  if (!ALLOWED_MIME.has(mime)) {
    return { ok: false, error: 'Use a JPEG, PNG, or WebP photo of the invoice.' };
  }
  if (!image.base64 || image.base64.length < MIN_BASE64) {
    return { ok: false, error: 'That photo is too small to read.' };
  }
  if (image.base64.length > MAX_BASE64) {
    return { ok: false, error: 'That photo is too large. Use a picture under 2 MB, or type the invoice.' };
  }

  const reader = understander === undefined ? createOpenAiUnderstander() : understander;
  if (!reader) {
    return { ok: false, error: 'Photo reading is not on. Type what the invoice usually says, or try again later.' };
  }

  try {
    const understanding = await reader.understand({ image, profiles: [], now: new Date() });
    if (understanding.kind !== 'invoice') {
      return { ok: false, error: 'Could not read that as an invoice. Type what it usually says, or try a clearer photo.' };
    }
    const text = invoiceSampleText(understanding.invoice);
    if (!text) {
      return { ok: false, error: 'Could not read that as an invoice. Type what it usually says.' };
    }
    return { ok: true, text };
  } catch {
    return { ok: false, error: 'Could not read the photo. Type what the invoice usually says.' };
  }
}
