import { applyFixToPayload, describeEntryPayload, formatEntriesReply, planUnderstanding, scheduleGroupMessage } from '../plan';
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
    expect(plan.entries[0].lines.join('\n')).toContain('✅ Deposit matches: card + cash + gas − payouts.');
    expect(plan.entries[1].lines.join('\n')).toContain('✅ Deposit matches: cash + gas.');
  });

  it('shows the report in a readable summary', () => {
    const [rockaway] = planUnderstanding(twoStoreText, ctx).entries;
    expect(rockaway.lines[0]).toBe('🧾 Rockaway · Mon, Oct 12');
    expect(rockaway.lines).toContain('Inside card $334 · Inside cash $106');
    expect(rockaway.lines).toContain('Gas $1,355');
    expect(rockaway.lines).toContain('Paid out: Lays $142');
    expect(rockaway.lines).toContain('Deposit $1,653');
  });

  it('subtracts same-day invoice cash from leftover cash, not from another store', () => {
    const tillCash = [
      { storeId: 'S001', label: 'LA PROVEEDORA LATINA LLC cash', amount: 1061.53, day: '2026-10-12' },
    ];
    const [rockaway, denville] = planUnderstanding(twoStoreText, { ...ctx, tillCash }).entries;
    expect(rockaway.lines).toContain('Till cash already out: LA PROVEEDORA LATINA LLC cash $1,061.53');
    expect(rockaway.lines.join('\n')).toContain('Payouts exceed cash by $1,097.53');
    expect(denville.lines.join('\n')).not.toContain('PROVEEDORA');
    const otherDay = planUnderstanding(twoStoreText, {
      ...ctx,
      tillCash: [{ ...tillCash[0], day: '2026-10-11' }],
    }).entries[0];
    expect(otherDay.lines.join('\n')).not.toContain('PROVEEDORA');
  });

  it('reads a person-name till payout and keeps a deposit typo as written', () => {
    const nov6: Understanding = {
      kind: 'daily_close',
      confidence: 0.9,
      needsReview: [],
      reports: [
        {
          storeHint: 'RockAway*',
          reportDate: '2026-11-06',
          cardSales: 242,
          cashSales: 125,
          fuelSales: 1206,
          payouts: [{ label: 'Ahsan', amount: 21 }],
          reportedDeposit: 1566,
        },
        {
          storeHint: 'Danville*',
          reportDate: '2026-11-06',
          cardSales: 0,
          cashSales: 0,
          fuelSales: 661,
          payouts: [{ label: 'Umar', amount: 220 }],
          reportedDeposit: 6611,
        },
      ],
    };
    const plan = planUnderstanding(nov6, { ...ctx, now: new Date('2026-11-06T22:00:00-05:00') });
    expect(plan.entries.map((e) => e.storeId)).toEqual(['S001', 'S002']);
    expect(plan.entries[0].lines).toContain('Paid out: Ahsan $21');
    expect(plan.entries[0].lines).toContain('Deposit $1,566');
    expect(plan.entries[0].lines.join('\n')).toContain('⚠️ Deposit does not match');
    expect(plan.entries[1].lines).toContain('Paid out: Umar $220');
    expect(plan.entries[1].lines).toContain('Deposit $6,611');
    expect(plan.entries.map((e) => e.lines.join('\n')).join('\n')).not.toMatch(/salary|wage|hourly|hours/i);
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
    expect(entry.lines.join('\n')).not.toContain("I'll remind");
  });

  it('does not ask to check payments.amount when paid cash already covers the total', () => {
    const plan = planUnderstanding(
      {
        kind: 'invoice',
        confidence: 0.9,
        needsReview: ['payments.amount'],
        invoice: {
          vendorName: 'LA PROVEEDORA LATINA LLC',
          invoiceNumber: '200242668',
          invoiceDate: '2026-10-22',
          lineItems: [{ description: 'item', quantity: 1, unitPrice: 1061.53, amount: 1061.53 }],
          total: 1061.53,
          paymentStatus: 'paid_cash',
        },
      },
      ctx
    );
    expect(plan.entries[0].lines.join('\n')).toContain('paid cash');
    expect(plan.entries[0].lines.join('\n')).not.toContain('Please check');
  });

  it('offers a 3-days-before reminder on an unpaid invoice with a due date', () => {
    const plan = planUnderstanding(
      {
        kind: 'invoice',
        confidence: 0.9,
        needsReview: [],
        invoice: {
          vendorName: 'Pepsi',
          invoiceNumber: '88',
          invoiceDate: '2026-10-12',
          dueDate: '2026-10-28',
          lineItems: [],
          total: 850,
          paymentStatus: 'unpaid',
        },
      },
      ctx
    );
    const text = plan.entries[0].lines.join('\n');
    expect(text).toContain('due Wed, Oct 28');
    expect(text).toContain("I'll remind 3 days before, on Sun, Oct 25");
    expect(text).toContain('$850 still due');
    expect(plan.entries[0].payload).toMatchObject({ due_date: '2026-10-28', paid: 'N', remaining: 850 });
  });

  it('merges a later cash payment onto the open vendor bill', () => {
    const open = {
      vendorName: 'Pepsi',
      invoiceNumber: '88',
      invoiceDate: '2026-10-12',
      dueDate: '2026-10-28',
      lineItems: [],
      total: 900,
      paymentStatus: 'unpaid' as const,
    };
    const plan = planUnderstanding(
      {
        kind: 'invoice',
        confidence: 0.9,
        needsReview: [],
        invoice: {
          vendorName: 'Pepsi',
          invoiceNumber: null,
          invoiceDate: null,
          lineItems: [],
          total: 500,
          paymentStatus: 'paid_cash',
          payments: [{ amount: 500, method: 'cash' }],
          remainingDue: 400,
          remainingMethod: 'check',
          payBy: '2026-10-17',
        },
      },
      { ...ctx, openInvoices: [{ actionId: 'inv-1', storeId: 'S001', invoice: open }] }
    );
    const entry = plan.entries[0];
    expect(entry.payload).toMatchObject({
      _kind: 'invoice_payment',
      updates_action_id: 'inv-1',
      remaining: 400,
      paid: 'N',
      remaining_method: 'check',
      due_date: '2026-10-17',
    });
    expect(entry.lines[0]).toContain('Payment on Pepsi');
    expect(entry.lines.join('\n')).toContain('$400 still due');
    expect(entry.lines.join('\n')).toContain('check');
  });

  it('reminds today when the due date is fewer than 3 days away', () => {
    const plan = planUnderstanding(
      {
        kind: 'invoice',
        confidence: 0.9,
        needsReview: [],
        invoice: {
          vendorName: 'Pepsi',
          invoiceNumber: null,
          invoiceDate: '2026-10-12',
          dueDate: '2026-10-13',
          lineItems: [],
          total: 850,
          paymentStatus: 'unknown',
        },
      },
      ctx
    );
    expect(plan.entries[0].lines.join('\n')).toContain("I'll remind today");
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

  it('fixes an invoice due date', () => {
    const [invoiceEntry] = planUnderstanding(
      {
        kind: 'invoice',
        confidence: 0.9,
        needsReview: [],
        invoice: {
          vendorName: 'Pepsi',
          invoiceNumber: null,
          invoiceDate: '2026-10-12',
          lineItems: [],
          total: 850,
          paymentStatus: 'unpaid',
        },
      },
      ctx
    ).entries;
    const result = applyFixToPayload(invoiceEntry.payload, 'due', '10/28', NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.due_date).toBe(`${new Date().getUTCFullYear()}-10-28`);
      expect((result.payload.invoice as { dueDate: string }).dueDate).toBe(`${new Date().getUTCFullYear()}-10-28`);
    }
  });

  it('fixes remaining due on an invoice', () => {
    const [invoiceEntry] = planUnderstanding(
      {
        kind: 'invoice',
        confidence: 0.9,
        needsReview: [],
        invoice: {
          vendorName: 'Pepsi',
          invoiceNumber: null,
          invoiceDate: '2026-10-12',
          lineItems: [],
          total: 900,
          paymentStatus: 'unpaid',
          remainingDue: 400,
        },
      },
      ctx
    ).entries;
    const result = applyFixToPayload(invoiceEntry.payload, 'remaining', '300', NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.remaining).toBe(300);
      expect(result.payload.paid).toBe('N');
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
    expect(rockaway.lines.join('\n')).toContain("OK also teaches me Rockaway's deposit rule (card + cash + gas − payouts)");
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

describe('planUnderstanding: work schedule', () => {
  const sheet = (employees: unknown[], extra: Record<string, unknown> = {}): Understanding =>
    ({
      kind: 'work_schedule',
      confidence: 0.9,
      needsReview: [],
      schedule: { storeHint: 'Rockaway', weekStart: '2026-10-26', employees, ...extra },
    }) as unknown as Understanding;

  const day = (d: string, start: string | null, end: string | null) => ({ date: null, day: d, start, end, breakMinutes: null });
  const maria = { name: 'Maria', statedTotalHours: null, adjustedHours: null, shifts: [day('Mon', '09:00', '17:00'), day('Tue', '09:00', '17:00')] };
  const mariana = { name: 'Mariana', statedTotalHours: null, adjustedHours: null, shifts: [day('Wed', '10:00', '14:00')] };
  const sam = { name: 'Sam', statedTotalHours: null, adjustedHours: null, shifts: [day('Thu', '14:00', '22:00')] };
  const manager = { ...ctx, canManageSchedules: true };

  it('is saved as one entry with hours per employee, under UNKNOWN (no database change)', () => {
    const plan = planUnderstanding(sheet([maria, sam]), manager);
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0]).toMatchObject({ kind: 'work_schedule', actionType: 'UNKNOWN', storeId: 'S001' });
    expect(plan.entries[0].payload).toMatchObject({
      _kind: 'work_schedule',
      week_start: '2026-10-26',
      total_hours: 24,
      employees: [
        { name: 'Maria', hours: 16 },
        { name: 'Sam', hours: 8 },
      ],
    });
    expect(plan.entries[0].lines).toEqual(['📅 Rockaway · week of Mon, Oct 26', 'Maria 16h', 'Sam 8h', 'Total 24h']);
  });

  it('turns a 7-Eleven Time In/Out sheet into hours and never keeps pay', () => {
    const plan = planUnderstanding(
      sheet(
        [
          {
            name: 'Umar',
            statedTotalHours: 72,
            adjustedHours: null,
            shifts: [day('Fri', '05:45', '16:06'), day('Sat', '05:53', '16:10')],
          },
          {
            name: 'Raeen',
            statedTotalHours: null,
            adjustedHours: null,
            shifts: [day('Fri', '21:00', '07:00')],
          },
        ],
        { weekStart: '2026-10-30' }
      ),
      manager
    );
    expect(plan.entries[0].payload).toMatchObject({ _kind: 'work_schedule', week_start: '2026-10-30' });
    expect(plan.entries[0].lines.join('\n')).toContain('Umar');
    expect(plan.entries[0].lines.join('\n')).toContain('Raeen 10h');
    expect(JSON.stringify(plan.entries[0].payload)).not.toMatch(/wage|salary|payroll|Pay Period|\$/i);
  });

  it('only lets owners and managers post a schedule', () => {
    const plan = planUnderstanding(sheet([maria]), ctx);
    expect(plan.entries).toEqual([]);
    expect(plan.notice).toContain('Only the owner or a manager');
    expect(plan.notice).toContain('Maria 16h');
    expect(plan.notice).toContain('Total 16h');
    expect(plan.notice).not.toMatch(/wage|salary|payroll|\$/i);
  });

  it('saves nothing when no shift can be read', () => {
    const plan = planUnderstanding(sheet([{ ...maria, shifts: [day('Mon', null, null)] }]), manager);
    expect(plan.entries).toEqual([]);
    expect(plan.notice).toContain("couldn't read any shift times");
  });

  it('never keeps pay, even if the model returns it', () => {
    const greedy = sheet([{ ...maria, hourlyRate: 18.5, wage: 1200, shifts: [{ ...day('Mon', '09:00', '17:00'), pay: 148 }] }], { totalPayroll: 5000 });
    const [entry] = planUnderstanding(greedy, manager).entries;
    const everything = JSON.stringify(entry.payload) + entry.lines.join(' ') + scheduleGroupMessage(entry.payload, 'Rockaway');
    expect(everything).not.toMatch(/hourlyRate|wage|payroll|\$|18\.5|1200|5000|148/);
  });

  it('warns when the store name does not match, like other entries', () => {
    const plan = planUnderstanding(sheet([maria], { storeHint: 'Nowhere Mart' }), { ...manager, multiStoreSender: true });
    expect(plan.entries[0].checks.map((c) => c.id)).toContain('store_unmatched');
    expect(plan.entries[0].lines.join('\n')).toContain('Nowhere Mart');
  });

  it('asks for OK to post and explains FIX <name> <hours>', () => {
    const reply = formatEntriesReply(planUnderstanding(sheet([maria]), manager).entries);
    expect(reply).toContain('Reply OK to save and post the hours');
    expect(reply).toContain('FIX <name> <hours>');
  });

  describe('FIX <name> <hours>', () => {
    const entry = () => planUnderstanding(sheet([maria, mariana, sam]), manager).entries[0];

    it('adjusts one person and re-adds the total', () => {
      const fixed = applyFixToPayload(entry().payload, 'sam', '6');
      expect(fixed.ok && fixed.payload).toMatchObject({ total_hours: 16 + 4 + 6 });
      expect(fixed.ok && (fixed.payload.employees as Array<{ name: string; hours: number; adjusted: boolean }>)[2]).toMatchObject({ name: 'Sam', hours: 6, adjusted: true });
    });

    it('accepts "30h" and decimals', () => {
      expect(applyFixToPayload(entry().payload, 'sam', '7.5h').ok).toBe(true);
    });

    it('matches a unique name start but refuses an ambiguous one', () => {
      expect(applyFixToPayload(entry().payload, 'sa', '6').ok).toBe(true);
      const ambiguous = applyFixToPayload(entry().payload, 'maria', '6'); // exact "Maria" wins over "Mariana"
      expect(ambiguous.ok).toBe(true);
      const tooShort = applyFixToPayload(entry().payload, 'mar', '6');
      expect(tooShort).toEqual({ ok: false, message: '"mar" matches Maria and Mariana. Type more of the name.' });
    });

    it('handles two-word names', () => {
      const two = planUnderstanding(sheet([{ ...maria, name: 'Mary Ann' }, sam]), manager).entries[0];
      const fixed = applyFixToPayload(two.payload, 'mary', 'ann 20');
      expect(fixed.ok && fixed.payload.total_hours).toBe(28);
    });

    it('explains mistakes', () => {
      expect(applyFixToPayload(entry().payload, 'sam', 'lots')).toMatchObject({ ok: false, message: expect.stringContaining('Usage: FIX <name> <hours>') });
      expect(applyFixToPayload(entry().payload, 'zed', '6')).toMatchObject({ ok: false, message: expect.stringContaining('Names: Maria, Mariana, Sam') });
      expect(applyFixToPayload(entry().payload, 'sam', '500')).toMatchObject({ ok: false });
    });

    it('shows the corrected schedule and keeps it in the group message', () => {
      const fixed = applyFixToPayload(entry().payload, 'sam', '6');
      if (!fixed.ok) throw new Error('fix failed');
      expect(describeEntryPayload(fixed.payload, 'Rockaway')).toContain('Sam 6h (adjusted)');
      expect(scheduleGroupMessage(fixed.payload, 'Rockaway')).toContain('Sam 6h (adjusted)');
    });
  });

  it('builds a group message of hours only', () => {
    const [e] = planUnderstanding(sheet([maria, sam]), manager).entries;
    expect(scheduleGroupMessage(e.payload, 'Rockaway')).toBe(
      ['📅 Rockaway · hours for week of Mon, Oct 26', 'Maria 16h', 'Sam 8h', 'Total 24h', '', 'Hours come from the posted sheet.'].join('\n')
    );
    expect(scheduleGroupMessage({ _kind: 'daily_close' }, 'Rockaway')).toBeNull();
  });
});

describe('planUnderstanding: order list', () => {
  const catalog = [
    { name: 'HLA', category: 'cigarettes' as const },
    { name: 'ABC', category: 'drinks' as const },
    { name: 'RPS', category: 'auto' as const },
  ];
  const withVendors = {
    ...ctx,
    profiles: [{ ...profiles[0], vendors: catalog }, profiles[1]],
  };
  const cigs: Understanding = {
    kind: 'order',
    confidence: 0.9,
    needsReview: [],
    order: {
      storeHint: 'Rockaway',
      vendorHint: 'HLA',
      items: [
        { description: 'Marlboro Red King', quantity: 10, unit: 'carton' },
        { description: 'Newport', quantity: 5, unit: 'carton' },
      ],
    },
  };

  it('returns the list and matched vendor for the owner to confirm', () => {
    const [entry] = planUnderstanding(cigs, withVendors).entries;
    expect(entry.actionType).toBe('ORDER_REQUEST');
    expect(entry.payload).toMatchObject({
      _kind: 'order',
      vendor: 'HLA',
      vendor_category: 'cigarettes',
      vendor_groups: [{
        vendor: 'HLA',
        items: [
          { name: 'Marlboro Red King', qty: 10, unit: 'carton' },
          { name: 'Newport', qty: 5, unit: 'carton' },
        ],
      }],
    });
    expect(entry.lines[0]).toBe('📦 Order · Rockaway');
    expect(entry.lines.join('\n')).toContain('Vendor: HLA (Cigarettes / tobacco)');
    expect(entry.lines).toContain('• 10 carton Marlboro Red King');
    expect(entry.lines.join('\n')).toContain('Please confirm this list so we can send this order to HLA.');
    expect(formatEntriesReply([entry])).toContain('FIX vendor HLA');
  });

  it('guesses ABC from drink products when the sheet names no vendor', () => {
    const [entry] = planUnderstanding(
      {
        kind: 'order',
        confidence: 0.8,
        needsReview: [],
        order: { storeHint: null, vendorHint: null, items: [{ description: 'Pepsi 12oz', quantity: 12, unit: 'case' }] },
      },
      withVendors
    ).entries;
    expect(entry.payload.vendor).toBe('ABC');
    expect(entry.lines.join('\n')).toContain('Please confirm this list so we can send this order to ABC.');
  });

  it('asks FIX vendor when the store has no catalog yet', () => {
    const [entry] = planUnderstanding(cigs, ctx).entries;
    expect(entry.checks.map((c) => c.id)).toContain('vendor_unmatched');
    expect(entry.lines.join('\n')).toContain('add HLA / ABC / RPS');
  });

  it('lets FIX vendor switch to another catalog name', () => {
    const [entry] = planUnderstanding(cigs, withVendors).entries;
    const fixed = applyFixToPayload(entry.payload, 'vendor', 'ABC');
    expect(fixed.ok && fixed.payload.vendor).toBe('ABC');
    expect(fixed.ok && fixed.payload.vendor_category).toBe('drinks');
    const after = describeEntryPayload(fixed.ok ? fixed.payload : {}, 'Rockaway')?.join('\n') ?? '';
    expect(after).toContain('ABC (Drinks)');
    expect(after).toContain('Please confirm this list so we can send this order to ABC.');
  });
});
