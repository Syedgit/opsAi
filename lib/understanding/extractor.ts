import OpenAI from 'openai';
import { getAiConfig } from './config';
import type { StoreProfile } from './profile';
import { buildSystemPrompt } from './prompt';
import { UnderstandingSchema, unknownUnderstanding, type Understanding } from './schema';

export interface UnderstandInput {
  /** Typed text, or a voice-note transcript. */
  text?: string;
  image?: { base64: string; mimeType: string };
  /** Stores this sender can report for. */
  profiles: StoreProfile[];
  now?: Date;
}

/** One implementation per AI provider; tests use a fake. */
export interface MessageUnderstander {
  understand(input: UnderstandInput): Promise<Understanding>;
}

/** Thrown when the AI provider cannot be reached or rejects the call. */
export class UnderstandingUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'UnderstandingUnavailableError';
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/** Parse and validate the model's reply. Anything malformed becomes "unknown", never a guess. */
export function parseModelOutput(raw: string | null | undefined): Understanding {
  if (!raw || !raw.trim()) return unknownUnderstanding('The AI returned an empty answer.');

  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');

  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch {
    return unknownUnderstanding('The AI answer was not valid JSON.');
  }

  const parsed = UnderstandingSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first ? `${first.path.join('.') || 'root'}: ${first.message}` : 'unknown field';
    return unknownUnderstanding(`The AI answer did not match the expected format (${where}).`);
  }
  return parsed.data;
}

/* Minimal structural view of the OpenAI client so tests can pass a fake. */
type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail: 'high' } };

interface ChatCreateParams {
  model: string;
  messages: Array<{ role: 'system' | 'user'; content: string | ContentPart[] }>;
  response_format: { type: 'json_object' };
}

export interface ChatClientLike {
  chat: {
    completions: {
      create(params: ChatCreateParams): Promise<{ choices: Array<{ message: { content: string | null } }> }>;
    };
  };
}

export function buildUserContent(input: UnderstandInput): ContentPart[] {
  const parts: ContentPart[] = [];
  const text = input.text?.trim();
  if (text) {
    parts.push({ type: 'text', text: `Message text:\n${text}` });
  }
  if (input.image) {
    parts.push({
      type: 'image_url',
      image_url: { url: `data:${input.image.mimeType};base64,${input.image.base64}`, detail: 'high' },
    });
    if (!text) {
      parts.push({ type: 'text', text: 'The message is the attached photo.' });
    }
  }
  return parts;
}

export function createOpenAiUnderstander(overrides?: {
  client?: ChatClientLike;
  model?: string;
}): MessageUnderstander | null {
  const config = getAiConfig();
  const model = overrides?.model ?? config?.extractionModel;
  if (!model) return null;

  let client = overrides?.client;
  if (!client) {
    if (!config) return null;
    client = new OpenAI({ apiKey: config.apiKey }) as unknown as ChatClientLike;
  }
  const chat = client;

  return {
    async understand(input: UnderstandInput): Promise<Understanding> {
      const content = buildUserContent(input);
      if (content.length === 0) return unknownUnderstanding('There was nothing to read.');

      let raw: string | null | undefined;
      try {
        const response = await chat.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: buildSystemPrompt(input.profiles, input.now ?? new Date()) },
            { role: 'user', content },
          ],
          response_format: { type: 'json_object' },
        });
        raw = response.choices[0]?.message?.content;
      } catch (error) {
        throw new UnderstandingUnavailableError(
          `AI request failed: ${error instanceof Error ? error.message : 'unknown error'}`,
          { cause: error }
        );
      }
      return parseModelOutput(raw);
    },
  };
}
