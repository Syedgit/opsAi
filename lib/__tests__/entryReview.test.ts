import { countEntriesNeedingReview, entryReview, needsReviewFields } from '../entryReview';

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
});
