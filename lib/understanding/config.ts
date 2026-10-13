/**
 * AI understanding is opt-in. It turns on only when both an API key and a model are set,
 * so no model name is baked into the code (models change faster than deployments).
 *
 *   OPENAI_API_KEY                 required
 *   OPENAI_EXTRACTION_MODEL        required; must support image input for photo reading
 *   OPENAI_TRANSCRIPTION_MODEL     optional; enables voice notes
 *   AI_UNDERSTANDING=off           optional kill switch
 *
 * OPENAI_MODEL is a separate setting used by the dashboard summary and is not reused here.
 */

export interface AiConfig {
  apiKey: string;
  extractionModel: string;
  /** null disables voice notes only. */
  transcriptionModel: string | null;
}

export function getAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig | null {
  if ((env.AI_UNDERSTANDING ?? '').trim().toLowerCase() === 'off') return null;

  const apiKey = env.OPENAI_API_KEY?.trim();
  const extractionModel = env.OPENAI_EXTRACTION_MODEL?.trim();
  if (!apiKey || !extractionModel) return null;

  return {
    apiKey,
    extractionModel,
    transcriptionModel: env.OPENAI_TRANSCRIPTION_MODEL?.trim() || null,
  };
}

export function isAiUnderstandingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return getAiConfig(env) !== null;
}
