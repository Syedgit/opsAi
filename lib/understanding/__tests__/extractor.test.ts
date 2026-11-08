import {
  buildUserContent,
  createOpenAiUnderstander,
  parseModelOutput,
  UnderstandingUnavailableError,
  type ChatClientLike,
} from '../extractor';
import { getAiConfig } from '../config';
import { buildDefaultProfile } from '../profile';
import { buildSystemPrompt } from '../prompt';
import { audioExtension } from '../transcribe';

const rockaway = {
  ...buildDefaultProfile({ storeId: 'rockaway', storeName: 'Rockaway' }),
  vendorAliases: { lays: 'Empire Snacks LLC' },
};

const NOW = new Date('2026-10-12T12:00:00Z');

interface SentRequest {
  model: string;
  response_format: unknown;
  messages: Array<{ role: string; content: string | unknown[] }>;
}

function fakeClient(reply: string | null, capture?: (params: unknown) => void): ChatClientLike {
  return {
    chat: {
      completions: {
        create: async (params) => {
          capture?.(params);
          return { choices: [{ message: { content: reply } }] };
        },
      },
    },
  };
}

const validDailyClose = JSON.stringify({
  kind: 'daily_close',
  reports: [
    {
      storeHint: 'Rockaway',
      reportDate: '2026-10-12',
      cardSales: 1355,
      cashSales: 298,
      storeSalesTotal: null,
      fuelSales: 1440,
      fuelGallons: null,
      fuelDiscounts: null,
      payouts: [{ label: 'Lays', amount: 142, vendorHint: null }],
      reportedDeposit: 1653,
      reportedDayTotal: null,
      periodClosed: null,
    },
  ],
  confidence: 0.9,
  needsReview: [],
});

describe('parseModelOutput', () => {
  it('accepts a valid daily close', () => {
    const result = parseModelOutput(validDailyClose);
    expect(result.kind).toBe('daily_close');
    if (result.kind === 'daily_close') {
      expect(result.reports[0].cardSales).toBe(1355);
    }
  });

  it('accepts JSON wrapped in a code fence', () => {
    expect(parseModelOutput('```json\n' + validDailyClose + '\n```').kind).toBe('daily_close');
  });

  it('turns empty output into unknown', () => {
    expect(parseModelOutput('').kind).toBe('unknown');
    expect(parseModelOutput(null).kind).toBe('unknown');
  });

  it('turns invalid JSON into unknown', () => {
    expect(parseModelOutput('Sure! Here are the numbers').kind).toBe('unknown');
  });

  it('turns a wrong shape into unknown and never guesses', () => {
    const wrong = JSON.stringify({ kind: 'daily_close', reports: [{ cardSales: 'a lot' }] });
    const result = parseModelOutput(wrong);
    expect(result.kind).toBe('unknown');
  });

  it('turns an unrecognised kind into unknown', () => {
    expect(parseModelOutput(JSON.stringify({ kind: 'payroll' })).kind).toBe('unknown');
  });

  it('keeps an invoice due date and still accepts invoices without one', () => {
    const withDue = parseModelOutput(
      JSON.stringify({
        kind: 'invoice',
        invoice: { vendorName: 'Pepsi', invoiceNumber: '88', invoiceDate: '2026-10-12', dueDate: '2026-10-28', lineItems: [], total: 850, paymentStatus: 'unpaid' },
        confidence: 0.9,
        needsReview: [],
      })
    );
    expect(withDue.kind).toBe('invoice');
    if (withDue.kind === 'invoice') expect(withDue.invoice.dueDate).toBe('2026-10-28');

    const partial = parseModelOutput(
      JSON.stringify({
        kind: 'invoice',
        invoice: {
          vendorName: 'Pepsi',
          invoiceNumber: '88',
          invoiceDate: '2026-10-12',
          lineItems: [],
          total: 900,
          paymentStatus: 'unpaid',
          payments: [{ amount: 500, method: 'cash' }],
          remainingDue: 400,
          remainingMethod: 'check',
          payBy: '2026-10-17',
        },
        confidence: 0.9,
        needsReview: [],
      })
    );
    expect(partial.kind).toBe('invoice');
    if (partial.kind === 'invoice') {
      expect(partial.invoice.remainingDue).toBe(400);
      expect(partial.invoice.remainingMethod).toBe('check');
      expect(partial.invoice.payments).toEqual([{ amount: 500, method: 'cash' }]);
    }

    const withoutDue = parseModelOutput(
      JSON.stringify({
        kind: 'invoice',
        invoice: { vendorName: 'Pepsi', invoiceNumber: null, invoiceDate: null, lineItems: [], total: 10, paymentStatus: 'unknown' },
        confidence: 0.8,
        needsReview: [],
      })
    );
    expect(withoutDue.kind).toBe('invoice');
  });
});

describe('createOpenAiUnderstander', () => {
  it('sends text with the store vocabulary and asks for JSON', async () => {
    let sent: SentRequest | undefined;
    const understander = createOpenAiUnderstander({
      client: fakeClient(validDailyClose, (p) => (sent = p as SentRequest)),
      model: 'test-model',
    });
    const result = await understander!.understand({
      text: 'Rockaway store credit 1355',
      profiles: [rockaway],
      now: NOW,
    });

    expect(result.kind).toBe('daily_close');
    expect(sent?.model).toBe('test-model');
    expect(sent?.response_format).toEqual({ type: 'json_object' });
    expect(sent?.messages[0].content).toContain('"store credit" means card_sales');
    expect(sent?.messages[0].content).toContain('"lays" is Empire Snacks LLC');
    expect((sent?.messages[1].content as Array<{ text: string }>)[0].text).toContain('Rockaway store credit 1355');
  });

  it('sends a photo as a data URL', async () => {
    let sent: SentRequest | undefined;
    const understander = createOpenAiUnderstander({
      client: fakeClient(JSON.stringify({ kind: 'unknown', reason: 'blurry', confidence: 0.1, needsReview: [] }), (p) => (sent = p as SentRequest)),
      model: 'test-model',
    });
    await understander!.understand({
      image: { base64: 'QUJD', mimeType: 'image/jpeg' },
      profiles: [rockaway],
      now: NOW,
    });
    const parts = sent?.messages[1].content as Array<{ type: string; image_url?: { url: string } }>;
    expect(parts.some((p) => p.type === 'image_url' && p.image_url?.url === 'data:image/jpeg;base64,QUJD')).toBe(true);
  });

  it('returns unknown without calling the AI when there is nothing to read', async () => {
    const create = jest.fn();
    const understander = createOpenAiUnderstander({
      client: { chat: { completions: { create } } },
      model: 'test-model',
    });
    const result = await understander!.understand({ text: '   ', profiles: [rockaway] });
    expect(result.kind).toBe('unknown');
    expect(create).not.toHaveBeenCalled();
  });

  it('raises UnderstandingUnavailableError when the provider fails', async () => {
    const understander = createOpenAiUnderstander({
      client: {
        chat: {
          completions: {
            create: async () => {
              throw new Error('rate limited');
            },
          },
        },
      },
      model: 'test-model',
    });
    await expect(understander!.understand({ text: 'hello', profiles: [] })).rejects.toBeInstanceOf(
      UnderstandingUnavailableError
    );
  });

  it('is unavailable without configuration', () => {
    const saved = { key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_EXTRACTION_MODEL };
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_EXTRACTION_MODEL;
    try {
      expect(createOpenAiUnderstander()).toBeNull();
    } finally {
      if (saved.key !== undefined) process.env.OPENAI_API_KEY = saved.key;
      if (saved.model !== undefined) process.env.OPENAI_EXTRACTION_MODEL = saved.model;
    }
  });
});

describe('buildUserContent', () => {
  it('labels a photo-only message', () => {
    const parts = buildUserContent({ image: { base64: 'QQ==', mimeType: 'image/png' }, profiles: [] });
    expect(parts).toHaveLength(2);
  });
});

describe('buildSystemPrompt', () => {
  it('includes today, the rules, and mentions JSON', () => {
    const prompt = buildSystemPrompt([rockaway], NOW);
    expect(prompt).toContain('Today is 2026-10-12');
    expect(prompt).toContain('Never invent numbers');
    expect(prompt).toContain('JSON');
    expect(prompt).toContain('Rockaway');
    expect(prompt).toContain('dueDate');
    expect(prompt).toContain('Pay by');
    expect(prompt).toContain('"kind":"order"');
    expect(prompt).toContain('handwritten "store sales" notebook');
    expect(prompt).toContain('that page is the document');
    expect(prompt).toContain('footer totals only');
    expect(prompt).toContain('Grand Total Store Sales Reading');
    expect(prompt).toContain('Total Fuel Sales');
    expect(prompt).toContain('Cash Acceptor Cash');
    expect(prompt).toContain('Store Tender Reading');
    expect(prompt).toContain('Do not subtract it from Cash Acceptor Cash');
    expect(prompt).toContain('Usual gas-station POS close');
    expect(prompt).toContain('"store credit" means card_sales');
    expect(prompt).toContain('"cash acceptor cash" means cash_sales');
    expect(prompt).toContain('remainingDue');
    expect(prompt).toContain('paid cash 500 remaining 400');
  });

  it('lists the store vendors the owner set at signup', () => {
    const prompt = buildSystemPrompt(
      [{ ...rockaway, vendors: [{ name: 'HLA', category: 'cigarettes' }, { name: 'ABC', category: 'drinks' }] }],
      NOW,
    );
    expect(prompt).toContain('this store orders from: HLA (cigarettes), ABC (drinks)');
  });

  it('includes an owner picture map for a close photo', () => {
    const prompt = buildSystemPrompt(
      [
        {
          ...rockaway,
          pictureTemplates: [
            {
              id: 'pic_exxon',
              kind: 'daily_close',
              title: 'Exxon Store Close (fuel page)',
              note: 'Fuel is Total Fuel Sales.',
              fields: [{ label: 'Total Fuel Sales', purpose: 'fuel' }],
            },
          ],
        },
      ],
      NOW,
    );
    expect(prompt).toContain('picture map "Exxon Store Close (fuel page)"');
    expect(prompt).toContain('take "Total Fuel Sales" as fuelSales');
    expect(prompt).toContain('Owner note: Fuel is Total Fuel Sales.');
  });

  it('includes an owner-pasted daily close sample', () => {
    const prompt = buildSystemPrompt(
      [{ ...rockaway, messageSamples: { dailyClose: 'Rockaway cash 106 card 334 gas 1355 deposit 1653' } }],
      NOW,
    );
    expect(prompt).toContain('typical daily close looks like');
    expect(prompt).toContain('cash 106');
  });

  it('copes with no stores', () => {
    expect(buildSystemPrompt([], NOW)).toContain('no stores configured');
  });
});

describe('getAiConfig', () => {
  it('needs both a key and a model', () => {
    expect(getAiConfig({ OPENAI_API_KEY: 'k' } as NodeJS.ProcessEnv)).toBeNull();
    expect(getAiConfig({ OPENAI_EXTRACTION_MODEL: 'm' } as NodeJS.ProcessEnv)).toBeNull();
    expect(getAiConfig({ OPENAI_API_KEY: 'k', OPENAI_EXTRACTION_MODEL: 'm' } as NodeJS.ProcessEnv)).toEqual({
      apiKey: 'k',
      extractionModel: 'm',
      textModel: null,
      transcriptionModel: null,
    });
  });

  it('enables voice only with a transcription model', () => {
    const config = getAiConfig({
      OPENAI_API_KEY: 'k',
      OPENAI_EXTRACTION_MODEL: 'm',
      OPENAI_TRANSCRIPTION_MODEL: 't',
    } as NodeJS.ProcessEnv);
    expect(config?.transcriptionModel).toBe('t');
  });

  it('honours the kill switch', () => {
    expect(
      getAiConfig({ OPENAI_API_KEY: 'k', OPENAI_EXTRACTION_MODEL: 'm', AI_UNDERSTANDING: 'off' } as NodeJS.ProcessEnv)
    ).toBeNull();
  });
});

describe('audioExtension', () => {
  it('maps WhatsApp voice notes to ogg', () => {
    expect(audioExtension('audio/ogg; codecs=opus')).toBe('ogg');
    expect(audioExtension('audio/mpeg')).toBe('mp3');
    expect(audioExtension('audio/mp4')).toBe('m4a');
  });
});

describe('text model', () => {
  it('uses the cheaper text model for typed text and the main model for photos', async () => {
    const seen: string[] = [];
    const client: ChatClientLike = {
      chat: {
        completions: {
          create: async (params) => {
            seen.push(params.model);
            return { choices: [{ message: { content: JSON.stringify({ kind: 'unknown', reason: 'x', confidence: 0, needsReview: [] }) } }] };
          },
        },
      },
    };
    const previous = { ...process.env };
    process.env.OPENAI_API_KEY = 'k';
    process.env.OPENAI_EXTRACTION_MODEL = 'big-model';
    process.env.OPENAI_TEXT_MODEL = 'small-model';
    try {
      const understander = createOpenAiUnderstander({ client })!;
      await understander.understand({ text: 'cash 100', profiles: [] });
      await understander.understand({ image: { base64: 'abc', mimeType: 'image/jpeg' }, profiles: [] });
    } finally {
      process.env = previous;
    }
    expect(seen).toEqual(['small-model', 'big-model']);
  });
});
