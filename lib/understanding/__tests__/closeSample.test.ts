import { dailyCloseSampleText, sampleFromDailyClosePhoto } from '../closeSample';
import type { MessageUnderstander } from '../extractor';
import type { DailyCloseReport, Understanding } from '../schema';

const denville: DailyCloseReport = {
  storeHint: 'Denville Exxon',
  reportDate: '2026-11-07',
  cardSales: null,
  cashSales: null,
  storeSalesTotal: 0,
  fuelSales: 6088.32,
  fuelGallons: 1455.22,
  fuelDiscounts: 2.84,
  payouts: [],
  reportedDeposit: null,
  reportedDayTotal: null,
  periodClosed: false,
};

describe('daily close sample wording', () => {
  it('turns a POS Store Close into a typical line that names fuel', () => {
    expect(dailyCloseSampleText(denville)).toBe(
      'Denville Exxon Store Close 2026-11-07 fuel 6088.32 gallons 1455.22 discounts 2.84 non-fuel 0 period open',
    );
  });

  it('names Cash Acceptor Cash as cash on the tender page', () => {
    expect(
      dailyCloseSampleText({
        ...denville,
        fuelSales: null,
        fuelGallons: null,
        fuelDiscounts: null,
        storeSalesTotal: 0,
        cardSales: 0,
        cashSales: 765.14,
      }),
    ).toBe('Denville Exxon Store Close 2026-11-07 non-fuel 0 card 0 cash 765.14 period open');
  });
});

function understander(result: Understanding): MessageUnderstander {
  return { understand: async () => result };
}

describe('daily close sample from a photo', () => {
  const image = { base64: 'a'.repeat(100), mimeType: 'image/jpeg' };

  it('saves the wording and does not keep the file', async () => {
    const result = await sampleFromDailyClosePhoto(
      image,
      understander({
        kind: 'daily_close',
        confidence: 0.9,
        needsReview: [],
        reports: [denville],
      }),
    );
    expect(result).toEqual({
      ok: true,
      text: 'Denville Exxon Store Close 2026-11-07 fuel 6088.32 gallons 1455.22 discounts 2.84 non-fuel 0 period open',
    });
  });

  it('asks them to type it when the photo is not a close', async () => {
    const result = await sampleFromDailyClosePhoto(
      image,
      understander({
        kind: 'unknown',
        confidence: 0.2,
        needsReview: [],
        reason: 'not a close',
      }),
    );
    expect(result.ok).toBe(false);
  });
});
