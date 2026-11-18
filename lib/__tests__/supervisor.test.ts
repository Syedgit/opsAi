import {
  routeFromKeywords,
  parseSupervisorRoute,
  normalizeRoute,
  shouldPreferKeywordRoute,
  runSupervisor,
} from '../agents/supervisor';
import { toolsForSupervisor, isCrewToolId } from '../agents/tools/catalog';

describe('crew tool catalog', () => {
  it('exposes books tools when enrolled', () => {
    const tools = toolsForSupervisor({ booksEnrolled: true });
    expect(tools.some((t) => t.id === 'invoice_period_summary')).toBe(true);
    expect(tools.some((t) => t.id === 'standing_report')).toBe(true);
    expect(isCrewToolId('open_invoices')).toBe(true);
  });
});

describe('routeFromKeywords', () => {
  it('maps standing and open invoices', () => {
    expect(routeFromKeywords('How is standing this month?').toolId).toBe('standing_report');
    expect(routeFromKeywords('what invoices are pending').toolId).toBe('open_invoices');
  });

  it('maps invoice counts and paid follow-ups with history', () => {
    expect(routeFromKeywords('how many invoices we made so far this month').toolId).toBe(
      'invoice_period_summary'
    );
    expect(routeFromKeywords('total paid invoices').toolId).toBe('invoice_period_summary');
    expect(routeFromKeywords('total paid invoices').slots?.status).toBe('paid');
    expect(routeFromKeywords('who was the vendor paid last time').toolId).toBe(
      'invoice_period_summary'
    );
    expect(routeFromKeywords('who was the vendor paid last time').slots?.status).toBe('paid');

    const follow = routeFromKeywords('paid ones', [
      { role: 'user', text: 'how many invoices this month' },
      { role: 'assistant', text: 'You have 3 invoices…' },
    ]);
    expect(follow.toolId).toBe('invoice_period_summary');
    expect(follow.slots?.status).toBe('paid');
  });

  it('overrides AI not_ai_chat when keywords map a books question', async () => {
    const keyword = routeFromKeywords('who was the vendor paid last time');
    expect(
      shouldPreferKeywordRoute(
        'who was the vendor paid last time',
        { agentId: 'books', toolId: 'not_ai_chat', clarity: 'not_ai_chat', slots: {}, ask: null },
        keyword
      )
    ).toBe(true);
    expect(
      shouldPreferKeywordRoute(
        'Pepsi paid cash 500 remaining 400',
        { agentId: 'books', toolId: 'not_ai_chat', clarity: 'not_ai_chat', slots: {}, ask: null },
        routeFromKeywords('Pepsi paid cash 500 remaining 400')
      )
    ).toBe(false);

    const route = await runSupervisor('who was the vendor paid last time', {
      booksEnrolled: true,
      route: async () => ({
        agentId: 'books',
        toolId: 'not_ai_chat',
        clarity: 'not_ai_chat',
        slots: {},
        ask: null,
      }),
    });
    expect(route.toolId).toBe('invoice_period_summary');
    expect(route.slots?.status).toBe('paid');
  });

  it('uses thread for short total after invoices', () => {
    const route = routeFromKeywords('total', [
      { role: 'user', text: 'how many invoices this month?' },
      { role: 'assistant', text: '3 invoices billed' },
    ]);
    expect(route.toolId).toBe('invoice_period_summary');
  });
});

describe('parseSupervisorRoute / normalizeRoute', () => {
  it('parses JSON and blocks tools when books not enrolled', () => {
    expect(
      parseSupervisorRoute(
        '{"agentId":"books","toolId":"standing_report","clarity":"ok","slots":{"period":"month"}}'
      )?.toolId
    ).toBe('standing_report');

    const blocked = normalizeRoute(
      {
        agentId: 'books',
        toolId: 'standing_report',
        clarity: 'ok',
        slots: { period: 'month' },
        ask: null,
      },
      false
    );
    expect(blocked.toolId).toBe('clarify');
  });
});
