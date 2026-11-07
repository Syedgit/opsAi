import { invoiceSampleText, sampleFromInvoicePhoto } from '../invoiceSample';
import type { MessageUnderstander } from '../extractor';
import type { Understanding } from '../schema';

const pepsi = {
  vendorName: 'Pepsi',
  invoiceNumber: '88',
  invoiceDate: '2026-10-12',
  lineItems: [] as Array<{ description: string; amount: number }>,
  total: 184.2,
  paymentStatus: 'paid_cash' as const,
};

describe('invoice sample wording', () => {
  it('turns a read invoice into a typical WhatsApp-style line', () => {
    expect(invoiceSampleText(pepsi)).toBe('Pepsi invoice #88 184.20 paid cash');
  });

  it('includes a few line-item names when they are on the page', () => {
    expect(
      invoiceSampleText({
        ...pepsi,
        invoiceNumber: null,
        lineItems: [
          { description: 'Lays', amount: 45.36 },
          { description: 'Doritos', amount: 45.36 },
        ],
      }),
    ).toBe('Pepsi invoice 184.20 paid cash Lays, Doritos');
  });
});

function understander(result: Understanding): MessageUnderstander {
  return { understand: async () => result };
}

describe('invoice sample from a photo', () => {
  const image = { base64: 'a'.repeat(100), mimeType: 'image/jpeg' };

  it('saves the wording and does not keep the file', async () => {
    const result = await sampleFromInvoicePhoto(image, understander({
      kind: 'invoice',
      confidence: 0.9,
      needsReview: [],
      invoice: pepsi,
    }));
    expect(result).toEqual({ ok: true, text: 'Pepsi invoice #88 184.20 paid cash' });
  });

  it('asks them to type it when the photo is not an invoice', async () => {
    const result = await sampleFromInvoicePhoto(image, understander({
      kind: 'unknown',
      confidence: 0.2,
      needsReview: [],
      reason: 'not an invoice',
    }));
    expect(result.ok).toBe(false);
  });

  it('rejects a non-image', async () => {
    const result = await sampleFromInvoicePhoto({ base64: 'a'.repeat(100), mimeType: 'application/pdf' });
    expect(result).toMatchObject({ ok: false });
  });
});
