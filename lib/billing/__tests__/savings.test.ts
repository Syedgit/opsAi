import {
  EMPTY_COUNTS,
  bucketSavedEntry,
  deskValueUsd,
  formatSavedTime,
  minutesSaved,
  summarizeSavings,
} from '../savings';

describe('bucketSavedEntry', () => {
  it('maps closes, invoices, and sheets', () => {
    expect(bucketSavedEntry('STORE_SALES', 'daily_close')).toBe('closes');
    expect(bucketSavedEntry('INVOICE_EXPENSE', 'invoice')).toBe('invoices');
    expect(bucketSavedEntry('UNKNOWN', 'work_schedule')).toBe('schedules');
    expect(bucketSavedEntry('UNKNOWN', 'fuel_prices')).toBe('prices');
  });

  it('does not count a payment on an existing invoice', () => {
    expect(bucketSavedEntry('INVOICE_EXPENSE', 'invoice_payment')).toBeNull();
  });
});

describe('minutes and copy', () => {
  it('three closes are 36 minutes of typing skipped', () => {
    const counts = { ...EMPTY_COUNTS, closes: 3 };
    expect(minutesSaved(counts)).toBe(36);
    expect(formatSavedTime(36)).toBe('36 minutes');
    expect(deskValueUsd(36)).toBe(11);
  });

  it('formats hours after 60 minutes', () => {
    expect(formatSavedTime(90)).toBe('1.5 hours');
    expect(formatSavedTime(60)).toBe('1 hour');
  });

  it('flags when desk time is worth more than the monthly fee', () => {
    const busy = summarizeSavings({ ...EMPTY_COUNTS, closes: 30, invoices: 20 }, 25);
    expect(busy.minutes).toBe(30 * 12 + 20 * 8);
    expect(busy.worthMoreThanFee).toBe(true);
    expect(summarizeSavings({ ...EMPTY_COUNTS, closes: 1 }, 25).worthMoreThanFee).toBe(false);
  });
});
