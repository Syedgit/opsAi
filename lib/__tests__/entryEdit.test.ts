import { applyAdminEntryEdit, clearNeedsReviewFields } from '../entryEdit';

describe('entryEdit', () => {
  const closePayload = {
    _kind: 'daily_close',
    needs_review: ['cashSales', 'cardSales'],
    checks: [],
    report: {
      reportDate: '2026-11-10',
      cashSales: 100,
      cardSales: 200,
      storeSalesTotal: 300,
      fuelSales: null,
      fuelGallons: null,
      reportedDeposit: 90,
      payouts: [],
    },
    cash: 100,
    card: 200,
    total_inside: 300,
    deposit: 90,
  };

  it('clears matching needs_review keys after a field fix', () => {
    const result = applyAdminEntryEdit(closePayload, [{ field: 'cash', value: '1260' }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.cash).toBe(1260);
    expect(result.payload.needs_review).toEqual(['cardSales']);
  });

  it('clearFlags empties needs_review without requiring patches', () => {
    const result = applyAdminEntryEdit(closePayload, [], { clearFlags: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.needs_review).toEqual([]);
    expect(result.payload.cash).toBe(100);
  });

  it('rejects empty edits', () => {
    const result = applyAdminEntryEdit(closePayload, []);
    expect(result.ok).toBe(false);
  });

  it('clearNeedsReviewFields can wipe all flags', () => {
    expect(clearNeedsReviewFields(closePayload, [], true).needs_review).toEqual([]);
  });
});
