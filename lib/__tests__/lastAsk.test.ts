import { applyLastAskToPlan, lastAskFromPlan, parseLastAsk } from '../agents/lastAsk';
import { planFromKeywords } from '../agents/supervisor';

describe('lastAsk thread binding', () => {
  it('parses and round-trips lastAsk', () => {
    const raw = {
      toolId: 'standing_report',
      slots: { period: 'custom', from: '2026-11-21', to: '2026-11-21' },
    };
    expect(parseLastAsk(raw)).toMatchObject(raw);
    expect(lastAskFromPlan(planFromKeywords('what was sale yesterday'))?.toolId).toBe(
      'standing_report'
    );
  });

  it('binds a bare date to previous standing ask', () => {
    const lastAsk = {
      toolId: 'standing_report' as const,
      slots: { period: 'custom' as const, from: '2026-11-21', to: '2026-11-21' },
    };
    // Without lastAsk, a bare date alone is ops_today / leftover.
    const drifted = {
      clarity: 'ok' as const,
      ask: null,
      steps: [{ toolId: 'ops_today' as const, slots: {}, purpose: 'ops_today' }],
    };
    const bound = applyLastAskToPlan('11/22', drifted, lastAsk);
    expect(bound.steps[0].toolId).toBe('standing_report');
    expect(bound.steps[0].slots).toMatchObject({
      period: 'custom',
      from: '2026-11-22',
      to: '2026-11-22',
    });
  });

  it('keeps standing on “it was about sale”', () => {
    const lastAsk = {
      toolId: 'standing_report' as const,
      slots: { period: 'month' as const, from: null, to: null },
    };
    const drifted = {
      clarity: 'ok' as const,
      ask: null,
      steps: [{ toolId: 'clarify' as const, slots: {}, purpose: 'clarify' }],
    };
    const bound = applyLastAskToPlan('it was about sale', drifted, lastAsk);
    expect(bound.steps[0].toolId).toBe('standing_report');
  });

  it('does not glue YTD or vendors onto a prior day standing ask', () => {
    const lastAsk = {
      toolId: 'standing_report' as const,
      slots: { period: 'custom' as const, from: '2026-11-22', to: '2026-11-22' },
    };
    const ytdPlan = planFromKeywords('whats YTD sale and expenses');
    expect(applyLastAskToPlan('whats YTD sale and expenses', ytdPlan, lastAsk).steps[0].slots).toMatchObject({
      period: 'custom',
      from: '2026-01-01',
    });
    const vendorPlan = {
      clarity: 'ok' as const,
      ask: null,
      steps: [
        {
          toolId: 'invoice_period_summary' as const,
          slots: { period: 'month' as const, status: 'all' as const },
          purpose: 'vendor_directory',
        },
      ],
    };
    expect(
      applyLastAskToPlan('how many vendors we have and is there any pending payment?', vendorPlan, lastAsk)
        .steps[0].toolId
    ).toBe('invoice_period_summary');
  });
});
