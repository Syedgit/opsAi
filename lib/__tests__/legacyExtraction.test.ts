import { ClassificationType } from '@prisma/client';
import { classifyMessage } from '../messageClassifier';
import { extractDataFromText, unusedNumbers } from '../messageExtraction';

/** Bugs found by running the real 10/12 owner message through the old rules. */
describe('rule-based extraction (fallback path)', () => {
  it('does not read a date as money', () => {
    const { fields } = extractDataFromText('STORE_SALES', '10/12/2026 Rockaway cash 106 card 334');
    expect(fields.cash).toBe(106);
    expect(fields.card).toBe(334);
    expect(fields.tax).toBe(0);
    expect(fields.total_inside).toBe(440);
  });

  it('computes inside total as cash + card, not the last number', () => {
    const { fields } = extractDataFromText('STORE_SALES', 'Daily sales cash 2100 card 5400');
    expect(fields.total_inside).toBe(7500);
  });

  it('reads numbers next to their labels in any order', () => {
    const { fields } = extractDataFromText('STORE_SALES', 'card 5400 cash 2100');
    expect(fields.cash).toBe(2100);
    expect(fields.card).toBe(5400);
  });

  it('falls back to position without labels', () => {
    const { fields } = extractDataFromText('STORE_SALES', 'sales 2100 5400');
    expect(fields.cash).toBe(2100);
    expect(fields.card).toBe(5400);
  });

  it('reads fuel gallons and sales', () => {
    const { fields } = extractDataFromText('FUEL_SALES', 'Fuel sales 6992.13, 1609.62 gallons');
    expect(fields.gallons).toBe(1609.62);
    expect(fields.fuel_sales).toBe(6992.13);
  });

  it('reads an invoice total and ignores the date', () => {
    const { fields } = extractDataFromText('INVOICE_EXPENSE', 'Invoice from Empire Snacks 10/12 total 136.08');
    expect(fields.amount).toBe(136.08);
  });
});

describe('rule-based classification (fallback path)', () => {
  it('treats "paid out" as a paid-out, not an invoice', () => {
    expect(classifyMessage('paid out 142 to Lays').type).toBe(ClassificationType.PAID_OUT);
  });

  it('treats "cash out" as a paid-out, not sales', () => {
    expect(classifyMessage('cash out 50 for ice').type).toBe(ClassificationType.PAID_OUT);
  });

  it('treats "fuel sales" as fuel, not store sales', () => {
    expect(classifyMessage('fuel sales 6992 gallons 1609').type).toBe(ClassificationType.FUEL_SALES);
  });

  it('still treats a plain sales message as store sales', () => {
    expect(classifyMessage('cash 298 card 1355 gas 1440').type).toBe(ClassificationType.STORE_SALES);
  });

  it('still treats a bare gas message as fuel', () => {
    expect(classifyMessage('gas 1440').type).toBe(ClassificationType.FUEL_SALES);
  });

  it('still treats "paid" invoices as invoices', () => {
    expect(classifyMessage('paid Empire Snacks invoice 136').type).toBe(ClassificationType.INVOICE_EXPENSE);
  });
});

describe('numbers the rules would drop', () => {
  const check = (type: Parameters<typeof extractDataFromText>[0], text: string) =>
    unusedNumbers(type, text, extractDataFromText(type, text).fields);

  it('finds nothing unused in a simple report', () => {
    expect(check('STORE_SALES', 'Daily sales cash 2100 card 5400')).toEqual([]);
    expect(check('STORE_SALES', '10/12/2026 cash 106 card 334')).toEqual([]);
    expect(check('INVOICE_EXPENSE', 'Invoice from Empire Snacks 10/12 total 136.08')).toEqual([]);
    expect(check('FUEL_SALES', 'Fuel sales 6992.13, 1609.62 gallons')).toEqual([]);
  });

  it('catches the gas and deposit in a fuller one-store message', () => {
    expect(check('STORE_SALES', 'Rockaway cash 298 card 1355 gas 1440 deposit 1653')).toEqual([1440, 1653]);
  });

  it('catches everything the second store would have lost in the real two-store message', () => {
    const real = `10/12/2026
RockAway*
Store credit:  $ 334
Store cash:    $ 106
Gas:              $ 1355
Lays: $ 142
Total deposit Rockaway:  $ 1653

Danville*
Store credit:  $  23
Store cash.:   $ 3
Gas:             $ 872
Total deposit Denville: $ 875`;
    const left = check('STORE_SALES', real);
    expect(left).toEqual(expect.arrayContaining([1355, 142, 1653, 23, 3, 872, 875]));
  });

  it('does not apply to orders', () => {
    expect(check('ORDER_REQUEST', 'need 24 Lays and 12 Doritos')).toEqual([]);
  });
});
