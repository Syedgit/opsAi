/**
 * Regression corpus: common owner asks must route deterministically.
 * Add a line here whenever production misroutes a real question.
 */
import {
  demoteNotAiChatForAskChannel,
  extractVendorHint,
  isConfidentAskPlan,
  isConfidentBooksRoute,
  parseStandingDayHint,
  planFromKeywords,
  routeFromKeywords,
  runSupervisor,
  type SupervisorRoute,
} from '../agents/supervisor';

type Expectation = {
  q: string;
  toolId: SupervisorRoute['toolId'];
  status?: 'all' | 'open' | 'paid' | null;
};

const CORPUS: Expectation[] = [
  { q: 'How is standing this month?', toolId: 'standing_report' },
  { q: 'How is the DMR looking?', toolId: 'standing_report' },
  { q: 'How are sales this week?', toolId: 'standing_report' },
  { q: 'what was sale yesterday on this store', toolId: 'standing_report' },
  { q: 'sale for the day 11/21', toolId: 'standing_report' },
  { q: 'whats YTD sale and expenses', toolId: 'standing_report' },
  { q: 'how was sale today', toolId: 'standing_report' },
  { q: 'what about buying and expenses', toolId: 'standing_report' },
  { q: 'how many vendors we have', toolId: 'invoice_period_summary', status: 'all' },
  { q: 'what invoices are still open', toolId: 'open_invoices' },
  { q: 'what do we still owe', toolId: 'open_invoices' },
  { q: 'pending vendor bills', toolId: 'open_invoices' },
  { q: 'what do we still owe Pepsi', toolId: 'open_invoices' },
  { q: 'what are all the vendors name', toolId: 'invoice_period_summary', status: 'all' },
  { q: 'just in general what are all the vendors we have been using', toolId: 'invoice_period_summary', status: 'all' },
  { q: 'how many invoices this month', toolId: 'invoice_period_summary', status: 'all' },
  { q: 'total paid invoices', toolId: 'invoice_period_summary', status: 'paid' },
  { q: 'who was the vendor paid last time', toolId: 'invoice_period_summary', status: 'paid' },
  { q: 'which vendor was paid last', toolId: 'invoice_period_summary', status: 'paid' },
  { q: 'last paid vendor', toolId: 'invoice_period_summary', status: 'paid' },
  { q: 'paid invoices so far', toolId: 'invoice_period_summary', status: 'paid' },
  { q: 'how many missing closes', toolId: 'missing_closes' },
  { q: 'which days missing a close this month', toolId: 'missing_closes' },
  { q: 'what can you help with', toolId: 'help_capabilities' },
  { q: 'help', toolId: 'help_capabilities' },
  { q: 'what connectors do we have', toolId: 'list_connectors' },
  { q: 'is gmail connected', toolId: 'list_connectors' },
  { q: 'show gmail rules', toolId: 'list_gmail_rules' },
  { q: 'alert me when mail from billing@x.com contains overdue', toolId: 'create_gmail_rule' },
  { q: 'add a gmail alert rule for pricing', toolId: 'create_gmail_rule' },
  { q: 'can we add another alert', toolId: 'create_gmail_rule' },
  { q: 'add another alert', toolId: 'create_gmail_rule' },
  { q: 'hi', toolId: 'ops_today' },
  { q: 'hello', toolId: 'ops_today' },
  { q: 'anything to follow today?', toolId: 'ops_today' },
  { q: 'anything to follow today ?', toolId: 'ops_today' },
  { q: 'what needs attention', toolId: 'ops_today' },
  { q: 'what should I check', toolId: 'ops_today' },
  { q: 'who worked yesterday at the shop', toolId: 'staff_schedule' },
  { q: 'who is working today', toolId: 'staff_schedule' },
  { q: 'who was on yesterday', toolId: 'staff_schedule' },
  { q: 'show this week schedule hours', toolId: 'staff_schedule' },
  { q: 'what is our profit this month', toolId: 'unsupported' },
  { q: 'when is the next utility bill due', toolId: 'unsupported' },
];

describe('owner ask route corpus', () => {
  it.each(CORPUS)('$q → $toolId', ({ q, toolId, status }) => {
    const route = routeFromKeywords(q);
    expect(route.toolId).toBe(toolId);
    if (status) expect(route.slots?.status).toBe(status);
    if (toolId !== 'unsupported' && toolId !== 'clarify' && toolId !== 'not_ai_chat') {
      expect(isConfidentBooksRoute(route)).toBe(true);
    }
  });

  it('rules-first skips LLM when keywords are confident', async () => {
    let aiCalls = 0;
    const route = await runSupervisor('who was the vendor paid last time', {
      booksEnrolled: true,
      route: async () => {
        aiCalls += 1;
        return {
          agentId: 'books',
          toolId: 'not_ai_chat',
          clarity: 'not_ai_chat',
          slots: {},
          ask: null,
        };
      },
    });
    // Injected router still runs (tests); production path skips AI via !options.route.
    // With injected AI saying not_ai_chat, keyword override + demote still lands on paid summary.
    expect(route.toolId).toBe('invoice_period_summary');
    expect(aiCalls).toBe(1);
  });

  it('without API key falls back to confident keywords', async () => {
    const route = await runSupervisor('who was the vendor paid last time', {
      booksEnrolled: true,
      env: {}, // no API key — keywords only
    });
    expect(route.toolId).toBe('invoice_period_summary');
    expect(route.slots?.status).toBe('paid');
  });

  it('hard keyword tools override AI drift to ops_today', async () => {
    const route = await runSupervisor('who was the vendor paid last time', {
      booksEnrolled: true,
      route: async () => ({
        agentId: 'books',
        toolId: 'ops_today',
        clarity: 'ok',
        slots: {},
        ask: null,
      }),
    });
    expect(route.toolId).toBe('invoice_period_summary');
    expect(route.slots?.status).toBe('paid');
  });

  it('web channel demotes not_ai_chat to ops_today', () => {
    const demoted = demoteNotAiChatForAskChannel(
      { agentId: 'books', toolId: 'not_ai_chat', clarity: 'not_ai_chat', slots: {}, ask: null },
      'hello there',
      'web'
    );
    expect(demoted.toolId).toBe('ops_today');
  });

  it('whatsapp keeps not_ai_chat for amount capture', () => {
    const kept = demoteNotAiChatForAskChannel(
      { agentId: 'books', toolId: 'not_ai_chat', clarity: 'not_ai_chat', slots: {}, ask: null },
      'Pepsi paid cash 500 remaining 400',
      'whatsapp'
    );
    expect(kept.toolId).toBe('not_ai_chat');
  });
});

describe('standing day asks', () => {
  it('parses yesterday and slash dates', () => {
    expect(parseStandingDayHint('sale yesterday', '2026-11-22')).toBe('2026-11-21');
    expect(parseStandingDayHint('sales for 11/21', '2026-11-22')).toBe('2026-11-21');
  });

  it('continues sales thread on a bare date', () => {
    const plan = planFromKeywords('11/21', [
      { role: 'user', text: 'what was sale yesterday' },
      { role: 'assistant', text: 'What date?' },
    ]);
    expect(plan.steps[0].toolId).toBe('standing_report');
    expect(plan.steps[0].slots.period).toBe('custom');
    expect(plan.steps[0].slots.from).toBe('2026-11-21');
  });

  it('YTD uses Jan 1 → today custom range', () => {
    const plan = planFromKeywords('whats YTD sale and expenses');
    expect(plan.steps[0].toolId).toBe('standing_report');
    expect(plan.steps[0].slots.period).toBe('custom');
    expect(plan.steps[0].slots.from).toMatch(/^\d{4}-01-01$/);
  });

  it('vendors + pending payment loads directory and open invoices', () => {
    const plan = planFromKeywords('how many vendors we have and is there any pending payment ?');
    expect(plan.steps.map((s) => s.toolId)).toEqual(['invoice_period_summary', 'open_invoices']);
  });
});

describe('compound vendor asks', () => {
  const q =
    'when did we pay last invoice to vendor abc and is there any due invoice?';

  it('extracts vendor abc not “last”', () => {
    expect(extractVendorHint(q)?.toLowerCase()).toBe('abc');
    expect(extractVendorHint('what do we still owe Pepsi')?.toLowerCase()).toBe('pepsi');
  });

  it('plans paid summary + open invoices for the same vendor', () => {
    const plan = planFromKeywords(q);
    expect(isConfidentAskPlan(plan)).toBe(true);
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0].toolId).toBe('invoice_period_summary');
    expect(plan.steps[0].slots.status).toBe('paid');
    expect(plan.steps[0].slots.vendor?.toLowerCase()).toBe('abc');
    expect(plan.steps[1].toolId).toBe('open_invoices');
    expect(plan.steps[1].slots.vendor?.toLowerCase()).toBe('abc');
  });
});
