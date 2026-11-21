/**
 * Regression corpus: common owner asks must route deterministically.
 * Add a line here whenever production misroutes a real question.
 */
import {
  demoteNotAiChatForAskChannel,
  extractVendorHint,
  isConfidentAskPlan,
  isConfidentBooksRoute,
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
  { q: 'what about buying and expenses', toolId: 'standing_report' },
  { q: 'what invoices are still open', toolId: 'open_invoices' },
  { q: 'what do we still owe', toolId: 'open_invoices' },
  { q: 'pending vendor bills', toolId: 'open_invoices' },
  { q: 'what do we still owe Pepsi', toolId: 'open_invoices' },
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

  it('production path does not call AI for confident keywords', async () => {
    const route = await runSupervisor('who was the vendor paid last time', {
      booksEnrolled: true,
      env: {}, // no API key — would fail if LLM were required
    });
    expect(route.toolId).toBe('invoice_period_summary');
    expect(route.slots?.status).toBe('paid');
  });

  it('web channel demotes not_ai_chat to clarify', () => {
    const demoted = demoteNotAiChatForAskChannel(
      { agentId: 'books', toolId: 'not_ai_chat', clarity: 'not_ai_chat', slots: {}, ask: null },
      'hello there',
      'web'
    );
    expect(demoted.toolId).toBe('clarify');
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
