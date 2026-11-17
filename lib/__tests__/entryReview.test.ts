import {
  adminFlagNotice,
  countEntriesNeedingReview,
  entryReview,
  failCheckMessages,
  needsReviewFields,
  shortReviewBlurb,
  whatsAppReviewFollowUp,
} from '../entryReview';

describe('entryReview', () => {
  it('surfaces check warns and needs_review fields', () => {
    const review = entryReview(
      {
        checks: [
          { status: 'pass', message: 'ok' },
          { status: 'warn', message: 'Deposit looks high' },
        ],
        needs_review: ['cashSales', 'reports.0.fuelGallons'],
      },
      0.9
    );
    expect(review.hasIssues).toBe(true);
    expect(review.messages).toContain('Deposit looks high');
    expect(review.messages.some((m) => m.includes('cash') && m.includes('gallons'))).toBe(true);
    expect(review.lowConfidence).toBe(false);
  });

  it('flags low confidence even when checks look clean', () => {
    const review = entryReview({ checks: [{ status: 'pass', message: 'ok' }], needs_review: [] }, 0.6);
    expect(review.hasIssues).toBe(true);
    expect(review.lowConfidence).toBe(true);
    expect(review.messages[0]).toMatch(/60%/);
  });

  it('reads needs_review keys and counts rows that need a look', () => {
    expect(needsReviewFields({ needs_review: ['vendor', 'vendor'] })).toEqual(['vendor']);
    expect(
      countEntriesNeedingReview([
        { payloadJson: { needs_review: [] }, confidence: 0.95 },
        { payloadJson: { needs_review: ['total'] }, confidence: 0.9 },
        { payloadJson: {}, confidence: 0.5 },
      ])
    ).toBe(2);
  });

  it('blocks hard fails and repeats soft flags after save', () => {
    expect(failCheckMessages({ checks: [{ status: 'fail', message: 'Deposit broken' }] })).toEqual(['Deposit broken']);
    expect(whatsAppReviewFollowUp({ checks: [{ status: 'fail', message: 'Deposit broken' }] })).toBeNull();
    expect(whatsAppReviewFollowUp({ needs_review: ['cashSales'] }, 0.9)).toContain('Saved with flags');
    expect(whatsAppReviewFollowUp({ needs_review: ['cashSales'] }, 0.9)).toContain('FIX');
  });

  it('builds a short blurb and an admin notice after the report', () => {
    expect(shortReviewBlurb({ needs_review: ['cashSales'], checks: [{ status: 'warn', message: 'Deposit looks high' }] })).toContain(
      'Deposit looks high'
    );
    const notice = adminFlagNotice('Rockaway', ['Deposit looks high · Unclear: cash']);
    expect(notice).toContain('Rockaway');
    expect(notice).toContain('Deposit looks high');
    expect(notice).toContain('dashboard');
  });

  it('ignores partial-day / period_open noise and AI prose in needs_review', () => {
    const review = entryReview(
      {
        checks: [
          { id: 'period_open', status: 'warn', message: 'This looks like a partial day (the register period is still open).' },
          { status: 'warn', message: 'Deposit looks high' },
        ],
        needs_review: [
          'fuelSales not shown',
          'Net Sales of 1660.75 is not mapped to a total field',
          'Report is for an unfinished day',
          'cashSales',
        ],
      },
      0.9
    );
    expect(review.messages).toEqual(['Deposit looks high', 'Unclear: cash']);
    expect(review.messages.join(' ')).not.toMatch(/partial day|unfinished|Net Sales|fuelSales not shown/i);
  });
});
