/**
 * What each AI call used, kept on the message log (extractedData.usage) so cost can be reported
 * per store and per month without a new table.
 */

export interface AiUsageRecord {
  kind: 'extraction' | 'transcription';
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Voice notes: size of the audio sent. */
  audioBytes?: number;
}

/** US dollars per 1 million tokens. Approximate list prices; override with AI_PRICE_INPUT_PER_M / AI_PRICE_OUTPUT_PER_M. */
const PRICES: Record<string, { input: number; output: number }> = {
  'gpt-6-astra': { input: 10.0, output: 50.0 },
  'gpt-6.1-sol': { input: 2.0, output: 10.0 },
  'gpt-6.1-terra': { input: 1.0, output: 5.0 },
  'gpt-6-sol': { input: 2.0, output: 10.0 },
  'gpt-6-luna': { input: 0.1, output: 0.5 },
  'gpt-4.1': { input: 2.0, output: 8.0 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
};

function priceFor(model: string, env: NodeJS.ProcessEnv): { input: number; output: number } | null {
  const input = Number.parseFloat(env.AI_PRICE_INPUT_PER_M ?? '');
  const output = Number.parseFloat(env.AI_PRICE_OUTPUT_PER_M ?? '');
  if (Number.isFinite(input) && Number.isFinite(output)) return { input, output };

  // Dated model names ("gpt-4.1-2025-04-14") use the base model's price.
  const key = Object.keys(PRICES)
    .sort((a, b) => b.length - a.length)
    .find((name) => model === name || model.startsWith(`${name}-`));
  return key ? PRICES[key] : null;
}

/** Estimated dollars for one call, or null when the model's price is unknown or tokens were not reported. */
export function estimateCostUsd(record: AiUsageRecord, env: NodeJS.ProcessEnv = process.env): number | null {
  if (record.kind !== 'extraction') return null;
  if (record.inputTokens == null || record.outputTokens == null) return null;
  const price = priceFor(record.model, env);
  if (!price) return null;
  return (record.inputTokens * price.input + record.outputTokens * price.output) / 1_000_000;
}

export interface UsageRow {
  storeId: string | null;
  createdAt: Date;
  extractedData: unknown;
}

export interface StoreUsage {
  storeId: string;
  messages: number;
  aiCalls: number;
  voiceNotes: number;
  inputTokens: number;
  outputTokens: number;
  estCostUsd: number;
  /** Calls whose price is unknown, so the cost above is a minimum. */
  unpricedCalls: number;
}

export function usageFromExtractedData(extractedData: unknown): AiUsageRecord[] {
  const usage = (extractedData as { usage?: unknown } | null | undefined)?.usage;
  return Array.isArray(usage) ? (usage as AiUsageRecord[]) : [];
}

/** Add up usage per store. Messages without AI usage (OK, CANCEL, rule-based text) count as messages only. */
export function summarizeUsage(rows: UsageRow[], env: NodeJS.ProcessEnv = process.env): { stores: StoreUsage[]; total: StoreUsage } {
  const empty = (storeId: string): StoreUsage => ({
    storeId,
    messages: 0,
    aiCalls: 0,
    voiceNotes: 0,
    inputTokens: 0,
    outputTokens: 0,
    estCostUsd: 0,
    unpricedCalls: 0,
  });
  const byStore = new Map<string, StoreUsage>();
  const total = empty('TOTAL');

  for (const row of rows) {
    const key = row.storeId ?? 'unlinked';
    const entry = byStore.get(key) ?? empty(key);
    byStore.set(key, entry);

    for (const target of [entry, total]) {
      target.messages += 1;
      for (const call of usageFromExtractedData(row.extractedData)) {
        target.aiCalls += 1;
        if (call.kind === 'transcription') target.voiceNotes += 1;
        target.inputTokens += call.inputTokens ?? 0;
        target.outputTokens += call.outputTokens ?? 0;
        const cost = estimateCostUsd(call, env);
        if (cost == null) target.unpricedCalls += call.kind === 'extraction' ? 1 : 0;
        else target.estCostUsd += cost;
      }
    }
  }

  const stores = [...byStore.values()].sort((a, b) => b.estCostUsd - a.estCostUsd);
  return { stores, total };
}
