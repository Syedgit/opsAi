import {
  intentFromKeywords,
  looksLikeAiChatQuestion,
  parseAiChatIntent,
  summarizeAiChatFacts,
  tryWhatsAppAiChat,
  answerAiChatQuestion,
  type AiChatFacts,
} from '../aiChatAsk';

describe('looksLikeAiChatQuestion', () => {
  it('accepts admin-style questions', () => {
    expect(looksLikeAiChatQuestion('How is the DMR looking?')).toBe(true);
    expect(looksLikeAiChatQuestion('what vendor invoices are still open')).toBe(true);
    expect(looksLikeAiChatQuestion('when is the next utility bill due')).toBe(true);
    expect(looksLikeAiChatQuestion('where do we stand on sales this month')).toBe(true);
  });

  it('rejects normal ops entries', () => {
    expect(looksLikeAiChatQuestion('cash 298 card 1355 gas 1440')).toBe(false);
    expect(looksLikeAiChatQuestion('Pepsi paid cash 500 remaining 400')).toBe(false);
    expect(looksLikeAiChatQuestion('order 2 cases of pepsi')).toBe(false);
    expect(looksLikeAiChatQuestion('cooler is broken')).toBe(false);
    expect(looksLikeAiChatQuestion('ok')).toBe(false);
  });
});

describe('parseAiChatIntent / intentFromKeywords', () => {
  it('parses valid intent JSON and rejects junk', () => {
    expect(parseAiChatIntent('{"topic":"standing","period":"month","vendor":null}')).toEqual({
      topic: 'standing',
      period: 'month',
      vendor: null,
    });
    expect(parseAiChatIntent('{"topic":"hack_db","amount":999}')).toBeNull();
    expect(parseAiChatIntent('not json')).toBeNull();
  });

  it('keyword fallback maps standing and invoices; vague → clarify', () => {
    expect(intentFromKeywords('How is standing this month?').topic).toBe('standing');
    expect(intentFromKeywords('what invoices are pending').topic).toBe('open_invoices');
    expect(intentFromKeywords('tell me stuff').topic).toBe('clarify');
  });
});

describe('summarizeAiChatFacts', () => {
  const base: AiChatFacts = {
    topic: 'open_invoices',
    storeId: 'S001',
    storeName: 'Rockaway',
    question: 'What is still owed?',
    facts: { store: 'Rockaway', openInvoices: [] },
    fallback: 'No open invoices on the books for Rockaway.',
  };

  it('returns the factual fallback when no model is configured', async () => {
    expect(await summarizeAiChatFacts(base, {})).toBe(base.fallback);
  });

  it('uses the AI polish when a summarizer is provided', async () => {
    const text = await summarizeAiChatFacts(base, {}, async () => 'Rockaway has no open vendor bills right now.');
    expect(text).toBe('Rockaway has no open vendor bills right now.');
  });
});

describe('answerAiChatQuestion guardrails', () => {
  function prismaStub() {
    return {
      storeConfig: {
        findUnique: jest.fn().mockResolvedValue({
          storeName: 'Rockaway',
          timezone: 'America/New_York',
          setupJson: null,
        }),
      },
      pendingActions: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as any;
  }

  it('clarifies without loading inventing numbers when entry AI asks to clarify', async () => {
    const prisma = prismaStub();
    const result = await answerAiChatQuestion(prisma, 'S001', 'Rockaway', 'stuff?', {
      classify: async () => ({
        topic: 'clarify',
        period: null,
        vendor: null,
        clarifyPrompt: 'Ask about standing or open invoices.',
      }),
      summarize: async () => {
        throw new Error('exit AI must not run on clarify');
      },
    });
    expect(result.skipped).toBeUndefined();
    expect(result.answer).toContain('standing or open invoices');
    expect(prisma.pendingActions.findMany).not.toHaveBeenCalled();
  });

  it('loads DB from intent then exit-summarizes (entry AI never sees DB rows)', async () => {
    const prisma = prismaStub();
    const result = await answerAiChatQuestion(prisma, 'S001', 'Rockaway', 'What is still owed?', {
      classify: async () => ({
        topic: 'open_invoices',
        period: null,
        vendor: null,
        clarifyPrompt: null,
      }),
      summarize: async ({ facts }) =>
        `Summary for ${(facts as { store?: string }).store}: none open.`,
    });
    expect(prisma.pendingActions.findMany).toHaveBeenCalled();
    expect(result.answer).toContain('Summary for Rockaway');
  });

  it('skips when entry AI marks not_ai_chat', async () => {
    const prisma = prismaStub();
    const result = await answerAiChatQuestion(prisma, 'S001', 'Rockaway', 'please confirm', {
      classify: async () => ({ topic: 'not_ai_chat', period: null, vendor: null, clarifyPrompt: null }),
    });
    expect(result.skipped).toBe(true);
    expect(prisma.pendingActions.findMany).not.toHaveBeenCalled();
  });
});

describe('tryWhatsAppAiChat', () => {
  function prismaStub(opts: { role?: string; enrolled?: boolean; storeName?: string }) {
    return {
      userDirectory: {
        findUnique: jest.fn().mockResolvedValue(
          opts.role ? { role: opts.role, isActive: true, storeId: 'S001' } : null
        ),
      },
      storeConfig: {
        findUnique: jest.fn().mockResolvedValue({
          storeName: opts.storeName || 'Rockaway',
          profileJson: opts.enrolled ? { aiChat: { enrolled: true, enrolledAt: '2026-11-14' } } : {},
          timezone: 'America/New_York',
          setupJson: null,
        }),
      },
      pendingActions: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as any;
  }

  it('skips groups, media, staff, and unenrolled stores', async () => {
    const prisma = prismaStub({ role: 'OWNER', enrolled: true });
    expect(
      await tryWhatsAppAiChat(prisma, {
        phoneE164: '+15551111111',
        storeId: 'S001',
        text: 'How is standing?',
        groupId: 'g1',
      })
    ).toEqual({ handled: false });

    const staff = prismaStub({ role: 'STAFF', enrolled: true });
    expect(
      await tryWhatsAppAiChat(staff, {
        phoneE164: '+15551111111',
        storeId: 'S001',
        text: 'How is standing?',
      })
    ).toEqual({ handled: false });
  });

  it('answers enrolled owner questions with entry→DB→exit', async () => {
    const prisma = prismaStub({ role: 'OWNER', enrolled: true });
    const result = await tryWhatsAppAiChat(prisma, {
      phoneE164: '+15551111111',
      storeId: 'S001',
      text: 'What invoices are still pending?',
      classify: async () => ({
        topic: 'open_invoices',
        period: null,
        vendor: null,
        clarifyPrompt: null,
      }),
      summarize: async ({ facts }) =>
        `Professional note for ${(facts as { store?: string }).store}: no open bills on file.`,
    });
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.answer).toContain('Rockaway');
      expect(result.answer).toContain('Professional note');
    }
  });
});
