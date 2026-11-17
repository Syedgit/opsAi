import { routeFromKeywords, parseSupervisorRoute, normalizeRoute } from '../agents/supervisor';
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

    const follow = routeFromKeywords('paid ones', [
      { role: 'user', text: 'how many invoices this month' },
      { role: 'assistant', text: 'You have 3 invoices…' },
    ]);
    expect(follow.toolId).toBe('invoice_period_summary');
    expect(follow.slots?.status).toBe('paid');
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
