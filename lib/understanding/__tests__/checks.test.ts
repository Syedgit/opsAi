import {
  checkDailyClose,
  checkDepositReceipt,
  checkInvoice,
  checkReportDate,
  computeExpectedDeposit,
  describeDepositRule,
  formatMoney,
  inferDepositRules,
  matchInvoiceToPayout,
  matchStore,
  worstStatus,
} from '../checks';
import { buildDefaultProfile, type DepositRule } from '../profile';
import type { DailyCloseReport, DepositReceipt, Invoice } from '../schema';

/**
 * Golden cases taken from real owner messages and photos (see samples/real-inputs, local only).
 * Values are what a correct reading of each sample should produce.
 */

function report(overrides: Partial<DailyCloseReport>): DailyCloseReport {
  return { storeHint: null, reportDate: null, payouts: [], ...overrides };
}

// Text message of 10/12/2026, store 1.
const rockaway = report({
  storeHint: 'Rockaway',
  reportDate: '2026-10-12',
  cardSales: 334,
  cashSales: 106,
  fuelSales: 1355,
  payouts: [{ label: 'Lays', amount: 142 }],
  reportedDeposit: 1653,
});

// Text message of 10/12/2026, store 2.
const denville = report({
  storeHint: 'Danville',
  reportDate: '2026-10-12',
  cardSales: 23,
  cashSales: 3,
  fuelSales: 872,
  reportedDeposit: 875,
});

// Handwritten notebook page, 10 Oct 2026 (store without a POS).
const notebook = report({
  reportDate: '2026-10-10',
  cardSales: 281,
  cashSales: 66,
  storeSalesTotal: 347,
  fuelSales: 1827,
  reportedDayTotal: 2174,
});

// POS "Store Close" screen photo, Denville Exxon.
const posClose = report({
  storeHint: 'Denville Exxon',
  reportDate: '2026-10-12',
  storeSalesTotal: 23,
  fuelSales: 6992.13,
  fuelGallons: 1609.62,
  fuelDiscounts: -3.28,
  reportedDayTotal: 7011.85,
  periodClosed: false,
});

describe('deposit rule inference', () => {
  it('finds the single rule that explains Rockaway (card + cash + gas - payouts)', () => {
    const rules = inferDepositRules(rockaway);
    expect(rules).toEqual([
      { includeCardSales: true, includeFuelSales: true, subtractPayouts: true, floatLeftInRegister: 0 },
    ]);
    expect(describeDepositRule(rules[0])).toBe('card + cash + gas − vendor payouts');
  });

  it('finds a different rule for Denville (cash + gas, card not deposited)', () => {
    const rules = inferDepositRules(denville);
    expect(rules).toHaveLength(1);
    expect(rules[0].includeCardSales).toBe(false);
    expect(rules[0].includeFuelSales).toBe(true);
    expect(describeDepositRule(rules[0])).toBe('cash + gas');
  });

  it('returns nothing when no usual rule explains the deposit', () => {
    expect(inferDepositRules({ ...denville, reportedDeposit: 1000 })).toEqual([]);
  });

  it('returns nothing without a reported deposit', () => {
    expect(inferDepositRules(notebook)).toEqual([]);
  });
});

describe('computeExpectedDeposit', () => {
  const rockawayRule: DepositRule = {
    includeCardSales: true,
    includeFuelSales: true,
    subtractPayouts: true,
    floatLeftInRegister: 0,
  };

  it('computes the Rockaway deposit', () => {
    expect(computeExpectedDeposit(rockaway, rockawayRule)).toBe(1653);
  });

  it('subtracts the float left in the register', () => {
    expect(computeExpectedDeposit(rockaway, { ...rockawayRule, floatLeftInRegister: 200 })).toBe(1453);
  });

  it('returns null when the needed numbers are missing', () => {
    const noInside = report({ fuelSales: 100 });
    expect(computeExpectedDeposit(noInside, { ...rockawayRule, includeCardSales: false })).toBeNull();
  });
});

describe('checkDailyClose', () => {
  it('passes every check on the notebook page', () => {
    const checks = checkDailyClose(notebook);
    expect(checks.map((c) => [c.id, c.status])).toEqual([
      ['store_sales_sum', 'pass'],
      ['day_total_sum', 'pass'],
    ]);
    expect(worstStatus(checks)).toBe('pass');
  });

  it('fails when the written day total does not add up', () => {
    const checks = checkDailyClose({ ...notebook, reportedDayTotal: 2184 });
    const failed = checks.find((c) => c.id === 'day_total_sum');
    expect(failed?.status).toBe('fail');
    expect(failed?.difference).toBe(10);
  });

  it('adds up the POS close screen (fuel - discounts + non-fuel) and flags the open period', () => {
    const checks = checkDailyClose(posClose);
    expect(checks.find((c) => c.id === 'day_total_sum')?.status).toBe('pass');
    expect(checks.find((c) => c.id === 'period_open')?.status).toBe('warn');
  });

  it('explains both text-message deposits without any configured rule', () => {
    expect(checkDailyClose(rockaway).find((c) => c.id === 'deposit_explained')?.status).toBe('pass');
    expect(checkDailyClose(denville).find((c) => c.id === 'deposit_explained')?.status).toBe('pass');
  });

  it("warns when a configured store rule disagrees with the reported deposit", () => {
    const profile = buildDefaultProfile({ storeId: 'S002', storeName: 'Denville' });
    profile.depositRule = {
      includeCardSales: true,
      includeFuelSales: true,
      subtractPayouts: true,
      floatLeftInRegister: 0,
    };
    const check = checkDailyClose(denville, profile).find((c) => c.id === 'deposit_rule');
    expect(check?.status).toBe('warn');
    expect(check?.expected).toBe(898);
    expect(check?.actual).toBe(875);
    expect(check?.difference).toBe(-23);
  });

  it('flags a deposit that no usual rule explains', () => {
    const check = checkDailyClose({ ...denville, reportedDeposit: 1000 }).find(
      (c) => c.id === 'deposit_unexplained'
    );
    expect(check?.status).toBe('warn');
  });
});

describe('checkInvoice', () => {
  const empireSnacks: Invoice = {
    vendorName: 'Empire Snacks LLC',
    invoiceNumber: null,
    invoiceDate: '2026-10-12',
    storeHint: 'Rockaway',
    lineItems: [
      { description: 'Lays mix', quantity: 24, unitPrice: 1.89, amount: 45.36 },
      { description: 'Lays mix', quantity: 24, unitPrice: 1.89, amount: 45.36 },
      { description: 'Lays mix', quantity: 24, unitPrice: 1.89, amount: 45.36 },
    ],
    total: 136.08,
    paymentStatus: 'unknown',
  };

  it('passes on the handwritten Empire Snacks invoice', () => {
    const checks = checkInvoice(empireSnacks);
    expect(checks.map((c) => [c.id, c.status])).toEqual([
      ['line_math', 'pass'],
      ['lines_sum_total', 'pass'],
    ]);
  });

  it('fails when the total is wrong', () => {
    const checks = checkInvoice({ ...empireSnacks, total: 136.8 });
    expect(checks.find((c) => c.id === 'lines_sum_total')?.status).toBe('fail');
  });

  it('fails when quantity x price does not match a line', () => {
    const lines = [...empireSnacks.lineItems];
    lines[1] = { ...lines[1], amount: 54.36 };
    const check = checkInvoice({ ...empireSnacks, lineItems: lines }).find((c) => c.id === 'line_math');
    expect(check?.status).toBe('fail');
    expect(check?.message).toContain('line 2');
  });

  it('compares the invoice with the till payout, using the store vendor alias', () => {
    const check = matchInvoiceToPayout(empireSnacks, rockaway.payouts, { lays: 'Empire Snacks LLC' });
    expect(check?.status).toBe('warn');
    expect(check?.difference).toBe(5.92);
    expect(check?.message).toContain('$136.08');
    expect(check?.message).toContain('$142');
  });

  it('passes when invoice and payout agree', () => {
    const check = matchInvoiceToPayout(empireSnacks, [{ label: 'Lays', amount: 136.08 }], {
      lays: 'Empire Snacks LLC',
    });
    expect(check?.status).toBe('pass');
  });

  it('finds no match when the payout label is unknown to the store', () => {
    expect(matchInvoiceToPayout(empireSnacks, rockaway.payouts, {})).toBeNull();
  });
});

describe('checkDepositReceipt', () => {
  const receiptTwo: DepositReceipt = {
    bank: 'Bank of America',
    depositDate: '2026-10-12',
    postsOn: '2026-10-13',
    accountLast4: '4707',
    totalDeposit: 2183,
    cashCounts: [
      { denomination: 100, count: 5 },
      { denomination: 1, count: 23 },
      { denomination: 5, count: 26 },
      { denomination: 10, count: 8 },
      { denomination: 20, count: 71 },
    ],
  };

  it('warns when the bill counts do not add up (the receipt 2 reading)', () => {
    const [check] = checkDepositReceipt(receiptTwo);
    expect(check.status).toBe('warn');
    expect(check.expected).toBe(2153);
    expect(check.difference).toBe(30);
  });

  it('passes once the unclear count is corrected (32 fives)', () => {
    const counts = receiptTwo.cashCounts.map((c) => (c.denomination === 5 ? { ...c, count: 32 } : c));
    const [check] = checkDepositReceipt({ ...receiptTwo, cashCounts: counts });
    expect(check.status).toBe('pass');
  });

  it('has nothing to check without counts', () => {
    expect(checkDepositReceipt({ ...receiptTwo, cashCounts: [] })).toEqual([]);
  });
});

describe('matchStore', () => {
  const stores = [
    buildDefaultProfile({ storeId: 'S001', storeName: 'Rockaway' }),
    buildDefaultProfile({ storeId: 'S002', storeName: 'Denville Exxon' }),
  ];

  it('matches a name with stray punctuation and casing', () => {
    expect(matchStore('RockAway*', stores).profile?.storeId).toBe('S001');
  });

  it('matches the misspelling Danville to Denville', () => {
    expect(matchStore('Danville', stores).profile?.storeId).toBe('S002');
  });

  it('matches the exact spelling and a name with the brand', () => {
    expect(matchStore('Denville', stores).profile?.storeId).toBe('S002');
    expect(matchStore('DENVILLE EXXON', stores).profile?.storeId).toBe('S002');
  });

  it('does not guess for an unknown name', () => {
    const result = matchStore('Springfield', stores);
    expect(result.profile).toBeNull();
    expect(result.ambiguous).toBe(false);
  });

  it('uses store aliases', () => {
    const withAlias = [{ ...stores[0], aliases: ['Rock Mart'] }, stores[1]];
    expect(matchStore('Rock Mart', withAlias).profile?.storeId).toBe('S001');
  });

  it('reports ambiguity instead of picking one of two equally good stores', () => {
    const twins = [
      buildDefaultProfile({ storeId: 'A', storeName: 'Main Street Gas' }),
      buildDefaultProfile({ storeId: 'B', storeName: 'Main Street Food' }),
    ];
    const result = matchStore('Main Street', twins);
    expect(result.profile).toBeNull();
    expect(result.ambiguous).toBe(true);
  });

  it('returns no match with no hint', () => {
    expect(matchStore(null, stores).profile).toBeNull();
  });
});

describe('checkReportDate', () => {
  const now = new Date('2026-10-13T12:00:00Z');

  it('accepts a recent date', () => {
    expect(checkReportDate('2026-10-12', now)).toBeNull();
  });

  it('flags a missing date', () => {
    expect(checkReportDate(null, now)?.id).toBe('date_missing');
  });

  it('flags a future date', () => {
    expect(checkReportDate('2026-11-12', now)?.status).toBe('fail');
  });

  it('flags a stale date', () => {
    expect(checkReportDate('2026-06-01', now)?.status).toBe('warn');
  });
});

describe('formatMoney', () => {
  it('formats whole and fractional amounts', () => {
    expect(formatMoney(2174)).toBe('$2,174');
    expect(formatMoney(136.08)).toBe('$136.08');
    expect(formatMoney(1355)).toBe('$1,355');
    expect(formatMoney(-23)).toBe('-$23');
  });
});
