import { estimateCostUsd, summarizeUsage, usageFromExtractedData } from '../usage';
import { createOpenAiUnderstander, type ChatClientLike } from '../extractor';
import { transcribeAudio, type TranscriberLike } from '../transcribe';
import { unknownUnderstanding } from '../schema';

const NOW = new Date('2026-10-13T12:00:00Z');

describe('estimateCostUsd', () => {
  const call = { kind: 'extraction' as const, model: 'gpt-4.1', inputTokens: 3000, outputTokens: 500 };

  it('prices a call from its tokens', () => {
    // 3000 * $2/M + 500 * $8/M = $0.006 + $0.004
    expect(estimateCostUsd(call, {} as NodeJS.ProcessEnv)).toBeCloseTo(0.01, 6);
  });

  it('handles dated model names and cheaper models', () => {
    expect(estimateCostUsd({ ...call, model: 'gpt-4.1-2025-04-14' }, {} as NodeJS.ProcessEnv)).toBeCloseTo(0.01, 6);
    expect(estimateCostUsd({ ...call, model: 'gpt-4.1-mini' }, {} as NodeJS.ProcessEnv)).toBeCloseTo(0.002, 6);
    // Luna $0.10 / $0.50 per 1M: 3000 * 0.10/1e6 + 500 * 0.50/1e6
    expect(estimateCostUsd({ ...call, model: 'gpt-6-luna' }, {} as NodeJS.ProcessEnv)).toBeCloseTo(0.00055, 6);
    // Terra $1 / $5 per 1M
    expect(estimateCostUsd({ ...call, model: 'gpt-6.1-terra' }, {} as NodeJS.ProcessEnv)).toBeCloseTo(0.0055, 6);
  });

  it('returns null rather than guessing for an unknown model, missing tokens, or voice', () => {
    expect(estimateCostUsd({ ...call, model: 'some-new-model' }, {} as NodeJS.ProcessEnv)).toBeNull();
    expect(estimateCostUsd({ kind: 'extraction', model: 'gpt-4.1' }, {} as NodeJS.ProcessEnv)).toBeNull();
    expect(estimateCostUsd({ kind: 'transcription', model: 'x', audioBytes: 1000 }, {} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('lets prices be overridden for new models', () => {
    const env = { AI_PRICE_INPUT_PER_M: '1', AI_PRICE_OUTPUT_PER_M: '2' } as unknown as NodeJS.ProcessEnv;
    expect(estimateCostUsd({ ...call, model: 'some-new-model' }, env)).toBeCloseTo(0.004, 6);
  });
});

describe('summarizeUsage', () => {
  const photo = { usage: [{ kind: 'extraction', model: 'gpt-4.1', inputTokens: 3000, outputTokens: 500 }] };
  const voice = {
    usage: [
      { kind: 'transcription', model: 'gpt-4o-mini-transcribe', audioBytes: 9000 },
      { kind: 'extraction', model: 'gpt-4.1', inputTokens: 1000, outputTokens: 200 },
    ],
  };

  it('adds up per store, counting messages without AI as messages only', () => {
    const { stores, total } = summarizeUsage(
      [
        { storeId: 'S001', createdAt: NOW, extractedData: photo },
        { storeId: 'S001', createdAt: NOW, extractedData: null }, // an "OK"
        { storeId: 'S001', createdAt: NOW, extractedData: voice },
        { storeId: 'S002', createdAt: NOW, extractedData: photo },
      ],
      {} as NodeJS.ProcessEnv
    );
    const s1 = stores.find((s) => s.storeId === 'S001')!;
    expect(s1).toMatchObject({ messages: 3, aiCalls: 3, voiceNotes: 1, inputTokens: 4000, outputTokens: 700 });
    expect(s1.estCostUsd).toBeCloseTo(0.01 + 0.0036, 6);
    expect(total.messages).toBe(4);
    expect(total.estCostUsd).toBeCloseTo(0.01 + 0.0036 + 0.01, 6);
    expect(stores[0].estCostUsd).toBeGreaterThanOrEqual(stores[1].estCostUsd);
  });

  it('flags calls it could not price, so the total is read as a minimum', () => {
    const { total } = summarizeUsage(
      [{ storeId: 'S001', createdAt: NOW, extractedData: { usage: [{ kind: 'extraction', model: 'mystery', inputTokens: 5, outputTokens: 5 }] } }],
      {} as NodeJS.ProcessEnv
    );
    expect(total.unpricedCalls).toBe(1);
    expect(total.estCostUsd).toBe(0);
  });

  it('ignores rows with no or malformed usage', () => {
    expect(usageFromExtractedData(null)).toEqual([]);
    expect(usageFromExtractedData({ usage: 'nope' })).toEqual([]);
    expect(usageFromExtractedData({ understanding: {} })).toEqual([]);
  });
});

describe('usage reporting from the AI calls', () => {
  it('reports tokens from a reading', async () => {
    const client: ChatClientLike = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ message: { content: JSON.stringify(unknownUnderstanding('x')) } }],
            usage: { prompt_tokens: 1234, completion_tokens: 56 },
          }),
        },
      },
    };
    const understander = createOpenAiUnderstander({ client, model: 'gpt-4.1' })!;
    const seen: unknown[] = [];
    await understander.understand({ text: 'hi', profiles: [], onUsage: (u) => seen.push(u) });
    expect(seen).toEqual([{ kind: 'extraction', model: 'gpt-4.1', inputTokens: 1234, outputTokens: 56 }]);
  });

  it('reports a voice transcription', async () => {
    const client: TranscriberLike = { audio: { transcriptions: { create: async () => ({ text: 'cash 100' }) } } };
    const seen: unknown[] = [];
    await transcribeAudio({ buffer: Buffer.alloc(500), mimeType: 'audio/ogg' }, { client, model: 'gpt-4o-mini-transcribe', onUsage: (u) => seen.push(u) });
    expect(seen).toEqual([{ kind: 'transcription', model: 'gpt-4o-mini-transcribe', audioBytes: 500 }]);
  });
});
