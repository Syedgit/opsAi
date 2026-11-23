import {
  acceptPolishedAnswer,
  inferAskIntent,
  parseExitLeadJson,
  polishIntroducesNewAmounts,
  verifyAndDraftAnswer,
} from '../agents/askVerify';
import { planFromKeywords } from '../agents/supervisor';

describe('parseExitLeadJson', () => {
  const draft = 'Open invoices: Pepsi · $40.00 due 2026-11-20';

  it('keeps answer polish without new dollars', () => {
    const out = parseExitLeadJson(
      JSON.stringify({ action: 'answer', text: 'Pepsi still owes $40.00, due Nov 20.' }),
      draft
    );
    expect(out).toEqual({ kind: 'answer', text: 'Pepsi still owes $40.00, due Nov 20.' });
  });

  it('ignores clarify action — exit is answer-only', () => {
    const out = parseExitLeadJson(
      JSON.stringify({ action: 'clarify', text: 'This week or this month?' }),
      draft
    );
    expect(out).toEqual({ kind: 'answer', text: draft });
  });

  it('rejects polish that invents amounts', () => {
    const out = parseExitLeadJson(
      JSON.stringify({ action: 'answer', text: 'Pepsi owes $999.00' }),
      draft
    );
    expect(out).toEqual({ kind: 'answer', text: draft });
  });
});

describe('inferAskIntent', () => {
  it('detects vendor directory vs open due', () => {
    expect(inferAskIntent('what are all the vendors name')).toBe('vendor_directory');
    expect(inferAskIntent('just in general what are all the vendors we have been using')).toBe(
      'vendor_directory'
    );
    expect(inferAskIntent('is there any pending invoice')).toBe('open_due');
  });

  it('detects vendor payment method vs standing', () => {
    expect(
      inferAskIntent('the standing amount we paid cash or card and when did we make this payment')
    ).toBe('vendor_payment_method');
    expect(inferAskIntent('how was the sale for the month so far')).toBe('standing');
  });
});

describe('planFromKeywords + verify', () => {
  it('routes vendor directory to invoice_period_summary all', () => {
    const plan = planFromKeywords('what are all the vendors name');
    expect(plan.steps[0].toolId).toBe('invoice_period_summary');
    expect(plan.steps[0].slots.status).toBe('all');
  });

  it('rejects open_invoices-only for vendor directory', () => {
    const verified = verifyAndDraftAnswer({
      question: 'what are all the vendors we use',
      parts: [
        {
          purpose: 'open_due',
          toolId: 'open_invoices',
          facts: { openInvoices: [] },
          fallback: 'No open invoices.',
        },
      ],
    });
    expect(verified.status).toBe('reject');
    if (verified.status === 'reject') {
      expect(verified.text.toLowerCase()).toMatch(/open invoices only|cannot list all vendors/);
    }
  });

  it('answers vendor directory from summary topVendors', () => {
    const verified = verifyAndDraftAnswer({
      question: 'what are all the vendors name',
      parts: [
        {
          purpose: 'vendor_directory',
          toolId: 'invoice_period_summary',
          facts: {
            period: 'Nov 2026',
            invoiceCount: 1,
            paidCount: 0,
            openCount: 1,
            topVendors: [{ vendor: 'LA PROVEEDORA', amount: 1061.53 }],
          },
          fallback: 'fallback',
        },
      ],
    });
    expect(verified.status).toBe('answer');
    if (verified.status === 'answer') {
      expect(verified.polish).toBe(false);
      expect(verified.text).toContain('LA PROVEEDORA');
      expect(verified.text).toContain('$1061.53');
    }
  });

  it('rejects standing tender as vendor payment method', () => {
    const verified = verifyAndDraftAnswer({
      question: 'how much we paid the vendor was it cash or card',
      parts: [
        {
          purpose: 'standing',
          toolId: 'standing_report',
          facts: { cashSales: 614.98, cardSales: 1150.6, standing: 704.05 },
          fallback: 'Cash $614.98 Card $1150.60 Standing $704.05',
        },
      ],
    });
    expect(verified.status).toBe('reject');
    if (verified.status === 'reject') {
      expect(verified.text.toLowerCase()).toMatch(/sales tender|not how a vendor/);
    }
  });
});

describe('polish guards', () => {
  it('blocks new dollar amounts and fluff', () => {
    expect(polishIntroducesNewAmounts('Total $10.00', 'Total $10.00 and tip $2.00')).toBe(true);
    expect(polishIntroducesNewAmounts('Total $10.00', 'Total is $10.00')).toBe(false);
    expect(
      acceptPolishedAnswer('Standing $5.00', 'Standing $5.00. Feel free to ask if you need more!')
    ).toBe('Standing $5.00');
  });
});
