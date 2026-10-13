import { applyFixToPayload, formatEntriesReply, planUnderstanding } from '../plan';
import { buildDefaultProfile } from '../profile';
import type { Understanding } from '../schema';

const NOW = new Date('2026-10-12T18:00:00Z');

const profiles = [
  buildDefaultProfile({ storeId: 'S001', storeName: 'Rockaway' }),
  buildDefaultProfile({ storeId: 'S002', storeName: 'Denville' }),
];
const ctx = { profiles, primaryStoreId: 'S001', now: NOW };

/** The real text message of 10/12/2026 covering two stores. */
const twoStoreText: Understanding = {
  kind: 'daily_close',
  confidence: 0.95,
  needsReview: [],
  reports: [
    {
      storeHint: 'RockAway*',
      reportDate: '2026-10-12',
      cardSales: 334,
      cashSales: 106,
      fuelSales: 1355,
      payouts: [{ label: 'Lays', amount: 142 }],
      reportedDeposit: 1653,
    },
    {
      storeHint: 'Danville*',
      reportDate: '2026-10-12',
      cardSales: 23,
      cashSales: 3,
      fuelSales: 872,
      payouts: [],
      reportedDeposit: 875,
    },
  ],
};

describe('planUnderstanding: daily close', () => {
  it('splits one message into one entry per store, matching the misspelled name', () => {
    const plan = planUnderstanding(twoStoreText, ctx);
    expect(plan.entries.map((e) => e.storeId)).toEqual(['S001', 'S002']);
    expect(plan.entries.every((e) => e.actionType === 'STORE_SALES')).toBe(true);
    expect(plan.notice).toBeNull();
  });

  it('keeps the legacy dashboard fields in the payload', () => {
    const [rockaway] = planUnderstanding(twoStoreText, ctx).entries;
    expect(rockaway.payload).toMatchObject({
      _kind: 'daily_close',
      cash: 106,
      card: 334,
      total_inside: 440,
      fuel_sales: 1355,
      deposit: 1653,
    });
  });

  it('confirms each deposit against the numbers without any configured rule', () => {
    const plan = planUnderstanding(twoStoreText, ctx);
    expect(plan.entries[0].lines.join('\n')).toContain('✅ Deposit matches: card + cash + gas − vendor payouts.');
    expect(plan.entries[1].lines.join('\n')).toContain('✅ Deposit matches: cash + gas.');
  });

  it('shows the report in a readable summary', () => {
    const [rockaway] = planUnderstanding(twoStoreText, ctx).entries;
    expect(rockaway.lines[0]).toBe('🧾 Rockaway · Mon, Oct 12');
    expect(rockaway.lines).toContain('Card $334 · Cash $106');
    expect(rockaway.lines).toContain('Gas $1,355');
    expect(rockaway.lines).toContain('Paid out: Lays $142');
    expect(rockaway.lines).toContain('Deposit $1,653');
  });

  it('keeps the sender store and warns when the store name matches nothing', () => {
    const understanding: Understanding = {
      ...twoStoreText,
      reports: [{ ...twoStoreText.reports[0], storeHint: 'Springfield' }],
    } as Understanding;
    const [entry] = planUnderstanding(understanding, ctx).entries;
    expect(entry.storeId).toBe('S001');
    expect(entry.checks.some((c) => c.id === 'store_unmatched')).toBe(true);
    expect(entry.lines.join('\n')).toContain('I could not match "Springfield"');
  });

  it('uses the sender store when the message names none', () => {
    const understanding = {
      ...twoStoreText,
      reports: [{ ...twoStoreText.reports[0], storeHint: null }],
    } as Understanding;
    const [entry] = planUnderstanding(understanding, ctx).entries;
    expect(entry.storeId).toBe('S001');
    expect(entry.checks.some((c) => c.id === 'store_unmatched')).toBe(false);
  });

  it('warns a multi-store sender when no store is named, but not a single-store sender', () => {
    const unnamed = {
      ...twoStoreText,
      reports: [{ ...twoStoreText.reports[0], storeHint: null }],
    } as Understanding;
    const multi = planUnderstanding(unnamed, { ...ctx, multiStoreSender: true }).entries[0];
    expect(multi.storeId).toBe('S001');
    expect(multi.lines.join('\n')).toContain('No store name found, so this is under Rockaway');
    const single = planUnderstanding(unnamed, ctx).entries[0];
    expect(single.checks.some((c) => c.id === 'store_not_named')).toBe(false);
  });

  it('flags a deposit that does not add up and shows the numbers', () => {
    const understanding = {
      ...twoStoreText,
      reports: [{ ...twoStoreText.reports[0], reportedDeposit: 1700 }],
    } as Understanding;
    const [entry] = planUnderstanding(understanding, ctx).entries;
    expect(entry.lines.join('\n')).toContain('⚠️ Deposit does not match');
  });

  it('asks for the missing date', () => {
    const understanding = {
      ...twoStoreText,
      reports: [{ ...twoStoreText.reports[0], reportDate: null }],
    } as Understanding;
    const [entry] = planUnderstanding(understanding, ctx).entries;
    expect(entry.lines.join('\n')).toContain('Which day is this for?');
  });

  it('lists fields the AI was unsure about', () => {
    const understanding = { ...twoStoreText, needsReview: ['fuelSales'] } as Understanding;
    const [entry] = planUnderstanding(understanding, ctx).entries;
    expect(entry.lines.join('\n')).toContain('❓ Please check: fuelSales');
  });
});

describe('planUnderstanding: other kinds', () => {
  it('plans an invoice and flags a wrong total', () => {
    const plan = planUnderstanding(
      {
        kind: 'invoice',
        confidence: 0.9,
        needsReview: [],
        invoice: {
          vendorName: 'Empire Snacks LLC',
          invoiceNumber: '1234',
          invoiceDate: '2026-10-12',
          lineItems: [
            { description: 'Lays', quantity: 24, unitPrice: 1.89, amount: 45.36 },
            { description: 'Doritos', quantity: 24, unitPrice: 1.89, amount: 45.36 },
            { description: 'Cheetos', quantity: 24, unitPrice: 1.89, amount: 45.36 },
          ],
          total: 136.8,
          paymentStatus: 'paid_cash',
        },
      },
      ctx
    );
    const entry = plan.entries[0];
    expect(entry.actionType).toBe('INVOICE_EXPENSE');
    expect(entry.payload).toMatchObject({ vendor: 'Empire Snacks LLC', amount: 136.8 });
    expect(entry.lines.join('\n')).toContain('⚠️ Line items do not add up to the invoice total.');
  });

  it('stores a deposit slip as a hidden UNKNOWN entry and never includes a balance', () => {
    const plan = planUnderstanding(
      {
        kind: 'deposit_receipt',
        confidence: 0.8,
        needsReview: [],
        receipts: [{ bank: 'Bank of America', depositDate: '2026-10-12', accountLast4: '1234', totalDeposit: 2183, cashCounts: [] }],
      },
      ctx
    );
    const entry = plan.entries[0];
    expect(entry.actionType).toBe('UNKNOWN');
    expect(JSON.stringify(entry.payload).toLowerCase()).not.toContain('balance');
    expect(entry.lines.join('\n')).toContain('account …1234');
  });

  it('files a deposit slip under the store its printed location matches', () => {
    const plan = planUnderstanding(
      {
        kind: 'deposit_receipt',
        confidence: 0.8,
        needsReview: [],
        receipts: [{ bank: 'Bank of America', storeHint: 'Denville East Main St', depositDate: '2026-10-12', accountLast4: '4707', totalDeposit: 2183, cashCounts: [] }],
      },
      { ...ctx, multiStoreSender: true }
    );
    expect(plan.entries[0].storeId).toBe('S002');
    expect(plan.entries[0].lines[0]).toBe('🏦 Deposit · Denville');
  });

  it('warns on a deposit slip that names no store when the sender has several', () => {
    const plan = planUnderstanding(
      {
        kind: 'deposit_receipt',
        confidence: 0.8,
        needsReview: [],
        receipts: [{ depositDate: '2026-10-12', totalDeposit: 500, cashCounts: [] }],
      },
      { ...ctx, multiStoreSender: true }
    );
    expect(plan.entries[0].storeId).toBe('S001');
    expect(plan.entries[0].lines.join('\n')).toContain('No store name found');
  });

  it('does not print "equipment" when no equipment was named', () => {
    const plan = planUnderstanding(
      {
        kind: 'equipment_issue',
        confidence: 0.8,
        needsReview: [],
        issue: { equipment: null, category: 'unknown', description: 'Something is wrong', severity: 'unknown', questions: [] },
      },
      ctx
    );
    expect(plan.notice?.startsWith('🔧 Problem noted\n')).toBe(true);
  });

  it('replies to an equipment problem right away, with the category and questions', () => {
    const plan = planUnderstanding(
      {
        kind: 'equipment_issue',
        confidence: 0.85,
        needsReview: [],
        issue: {
          equipment: null,
          category: 'payment_network',
          description: 'Pump screen shows an error',
          screenText: 'Discount Host Unavailable',
          severity: 'high',
          questions: ['Which pump is it?', 'Can customers still pay at the pump?'],
        },
      },
      ctx
    );
    expect(plan.entries).toHaveLength(0);
    expect(plan.equipment?.category).toBe('payment_network');
    expect(plan.notice).toContain('Discount Host Unavailable');
    expect(plan.notice).toContain('Card reader / network (not pump hardware)');
    expect(plan.notice).toContain('1. Which pump is it?');
  });

  it('explains when it could not read the message', () => {
    const plan = planUnderstanding({ kind: 'unknown', reason: 'blurry', confidence: 0, needsReview: [] }, ctx);
    expect(plan.entries).toHaveLength(0);
    expect(plan.notice).toContain("couldn't read that");
  });
});

describe('formatEntriesReply', () => {
  it('offers OK-all / CANCEL-all for several entries and FIX for one', () => {
    const plan = planUnderstanding(twoStoreText, ctx);
    expect(formatEntriesReply(plan.entries)).toContain('Reply OK to save all, or CANCEL to discard all.');
    expect(formatEntriesReply([plan.entries[0]])).toContain('FIX <field> <value>');
  });
});

describe('applyFixToPayload', () => {
  const [rockaway] = planUnderstanding(twoStoreText, ctx).entries;

  it('changes a field and recalculates the checks', () => {
    const result = applyFixToPayload(rockaway.payload, 'gas', '1400', NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.fuel_sales).toBe(1400);
      const checks = result.payload.checks as Array<{ id: string; status: string }>;
      expect(checks.find((c) => c.id === 'deposit_unexplained')?.status).toBe('warn');
    }
  });

  it('accepts dollar signs and commas', () => {
    const result = applyFixToPayload(rockaway.payload, 'card', '$1,260.50', NOW);
    expect(result.ok && result.payload.card).toBe(1260.5);
  });

  it('rejects a value that is not a number', () => {
    const result = applyFixToPayload(rockaway.payload, 'cash', 'lots', NOW);
    expect(result.ok).toBe(false);
  });

  it('rejects an unknown field and says what can be fixed', () => {
    const result = applyFixToPayload(rockaway.payload, 'color', 'red', NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('cash, card, gas');
  });

  it('fixes the date with month/day', () => {
    const result = applyFixToPayload(rockaway.payload, 'date', '10/11', NOW);
    expect(result.ok && result.payload.report_date).toBe(`${new Date().getUTCFullYear()}-10-11`);
  });

  it('fixes an invoice total and re-checks it', () => {
    const [invoiceEntry] = planUnderstanding(
      {
        kind: 'invoice',
        confidence: 0.9,
        needsReview: [],
        invoice: {
          vendorName: 'Empire Snacks LLC',
          invoiceNumber: null,
          invoiceDate: null,
          lineItems: [{ description: 'Lays', quantity: 2, unitPrice: 5, amount: 10 }],
          total: 11,
          paymentStatus: 'unknown',
        },
      },
      ctx
    ).entries;
    const result = applyFixToPayload(invoiceEntry.payload, 'total', '10', NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const checks = result.payload.checks as Array<{ id: string; status: string }>;
      expect(checks.find((c) => c.id === 'lines_sum_total')?.status).toBe('pass');
    }
  });

  it('does not touch legacy entries', () => {
    expect(applyFixToPayload({ cash: 1 }, 'cash', '2').ok).toBe(false);
  });
});

describe('deposit rule suggestion (learn by asking once)', () => {
  const teach = { ...ctx, canTeachRules: true };
  const rockawayReport = twoStoreText.kind === 'daily_close' ? twoStoreText.reports[0] : null;

  it('proposes the single matching rule to an owner and tells them what OK does', () => {
    const [rockaway, denville] = planUnderstanding(twoStoreText, teach).entries;
    expect(rockaway.payload.suggested_deposit_rule).toEqual({
      includeCardSales: true,
      includeFuelSales: true,
      subtractPayouts: true,
      floatLeftInRegister: 0,
    });
    expect(rockaway.lines.join('\n')).toContain("OK also teaches me Rockaway's deposit rule (card + cash + gas − vendor payouts)");
    // Each store gets its own rule.
    expect(denville.payload.suggested_deposit_rule).toMatchObject({ includeCardSales: false, includeFuelSales: true });
  });

  it('never proposes a rule from a staff message', () => {
    const entry = planUnderstanding(twoStoreText, ctx).entries[0];
    expect(entry.payload.suggested_deposit_rule).toBeNull();
    expect(entry.lines.join('\n')).not.toContain('teaches me');
  });

  it('does not propose when the store already has a rule', () => {
    const withRule = [{ ...profiles[0], depositRule: { includeCardSales: true, includeFuelSales: true, subtractPayouts: true, floatLeftInRegister: 0 } }, profiles[1]];
    const entry = planUnderstanding(twoStoreText, { ...teach, profiles: withRule }).entries[0];
    expect(entry.payload.suggested_deposit_rule).toBeNull();
  });

  it('does not propose when more than one rule fits (that would be a guess)', () => {
    // cash 100, gas 100, a 100 payout, deposit 100: "cash + gas - payouts" and "cash only" both give 100.
    const ambiguous: Understanding = {
      kind: 'daily_close',
      confidence: 0.9,
      needsReview: [],
      reports: [
        {
          storeHint: null,
          reportDate: '2026-10-12',
          cashSales: 100,
          fuelSales: 100,
          payouts: [{ label: 'Lays', amount: 100 }],
          reportedDeposit: 100,
        },
      ],
    };
    const entry = planUnderstanding(ambiguous, teach).entries[0];
    expect(entry.payload.suggested_deposit_rule).toBeNull();
  });

  it('does not propose when the deposit matches no usual rule', () => {
    const odd = { ...twoStoreText, reports: [{ ...rockawayReport!, reportedDeposit: 1700 }] } as Understanding;
    expect(planUnderstanding(odd, teach).entries[0].payload.suggested_deposit_rule).toBeNull();
  });

  it('keeps the proposal after a FIX only when the corrected report still fits one rule', () => {
    const entry = planUnderstanding(twoStoreText, teach).entries[0];
    const stillFits = applyFixToPayload(entry.payload, 'date', '10/11', NOW);
    expect(stillFits.ok && stillFits.payload.suggested_deposit_rule).toBeTruthy();

    const broken = applyFixToPayload(entry.payload, 'gas', '1400', NOW);
    expect(broken.ok && broken.payload.suggested_deposit_rule).toBeNull();
  });
});
