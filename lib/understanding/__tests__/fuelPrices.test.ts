import { buildDefaultProfile } from '../profile';
import {
  applyFuelPriceFix,
  checkFuelPrices,
  formatFuelPrice,
  isFuelPriceTaskTitle,
  resolveFuelSource,
} from '../fuelPrices';
import type { FuelPrices } from '../schema';
import { parseModelOutput } from '../extractor';

const rockaway = buildDefaultProfile({ storeId: 'S001', storeName: 'Rockaway' });
const rockawayExxon = { ...rockaway, aliases: ['Rockaway Exxon'] };

function board(over: Partial<FuelPrices> = {}): FuelPrices {
  return {
    stationHint: 'BP',
    sourceHint: 'unknown',
    grades: [
      { product: 'Regular', price: 4.099 },
      { product: 'Diesel', price: 6.559 },
    ],
    ...over,
  };
}

describe('formatFuelPrice', () => {
  it('keeps the tenths digit from the pole', () => {
    expect(formatFuelPrice(4.099)).toBe('$4.099');
    expect(formatFuelPrice(6.559)).toBe('$6.559');
    expect(formatFuelPrice(4.09)).toBe('$4.090');
  });
});

describe('resolveFuelSource', () => {
  it('treats a BP pole as competition when this store is not BP', () => {
    const hit = resolveFuelSource(board(), [rockaway]);
    expect(hit.source).toBe('competitor');
    expect(hit.reason).toContain('not this store');
  });

  it('treats an Exxon board as ours when the store is aliased Exxon', () => {
    const hit = resolveFuelSource(board({ stationHint: 'Exxon' }), [rockawayExxon]);
    expect(hit.source).toBe('own');
  });

  it('uses the caption before the brand on the sign', () => {
    expect(resolveFuelSource(board(), [rockaway], 'prices updated').source).toBe('own');
    expect(resolveFuelSource(board({ stationHint: 'Exxon' }), [rockawayExxon], 'competitor down the street').source).toBe(
      'competitor'
    );
  });

  it('falls back to competitor and says so when the sign is unlabeled', () => {
    const hit = resolveFuelSource(board({ stationHint: null, sourceHint: 'unknown' }), [rockaway]);
    expect(hit.source).toBe('competitor');
    expect(hit.reason).toContain('could not tell');
  });
});

describe('checkFuelPrices', () => {
  it('warns on a price that cannot be a US pump', () => {
    const checks = checkFuelPrices(board({ grades: [{ product: 'Regular', price: 40.99 }] }));
    expect(checks[0]?.status).toBe('warn');
  });
});

describe('applyFuelPriceFix', () => {
  it('changes source and a grade', () => {
    const reading = board();
    const source = applyFuelPriceFix(reading, 'competitor', 'source', 'own');
    expect(source.ok).toBe(true);
    if (source.ok) expect(source.source).toBe('own');
    const diesel = applyFuelPriceFix(reading, 'competitor', 'diesel', '6.459');
    expect(diesel.ok).toBe(true);
    if (diesel.ok) expect(diesel.reading.grades.find((g) => g.product === 'Diesel')?.price).toBe(6.459);
  });
});

describe('isFuelPriceTaskTitle', () => {
  it('matches the competitor nag and not a milk-label proof', () => {
    expect(isFuelPriceTaskTitle('Send competitor gas prices')).toBe(true);
    expect(isFuelPriceTaskTitle('Milk labels')).toBe(false);
  });
});

describe('parseModelOutput fuel_prices', () => {
  it('keeps tenths as a third decimal', () => {
    const parsed = parseModelOutput(
      JSON.stringify({
        kind: 'fuel_prices',
        prices: {
          stationHint: 'BP',
          sourceHint: 'competitor',
          grades: [
            { product: 'Regular', price: 4.099 },
            { product: 'Diesel', price: 6.559 },
          ],
        },
        confidence: 0.94,
        needsReview: [],
      })
    );
    expect(parsed.kind).toBe('fuel_prices');
    if (parsed.kind === 'fuel_prices') {
      expect(parsed.prices.grades).toEqual([
        { product: 'Regular', price: 4.099 },
        { product: 'Diesel', price: 6.559 },
      ]);
    }
  });
});
