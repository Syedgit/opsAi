import OpenAI, { toFile } from 'openai';
import { getAiConfig } from './config';

export interface AudioInput {
  buffer: Buffer;
  /** e.g. "audio/ogg; codecs=opus" (WhatsApp voice notes). */
  mimeType: string;
}

export interface TranscriberLike {
  audio: {
    transcriptions: {
      create(params: { file: Awaited<ReturnType<typeof toFile>>; model: string }): Promise<{ text: string }>;
    };
  };
}

export function audioExtension(mimeType: string): string {
  const type = mimeType.toLowerCase();
  if (type.includes('ogg') || type.includes('opus')) return 'ogg';
  if (type.includes('mpeg') || type.includes('mp3')) return 'mp3';
  if (type.includes('mp4') || type.includes('m4a') || type.includes('aac')) return 'm4a';
  if (type.includes('wav')) return 'wav';
  if (type.includes('webm')) return 'webm';
  return 'ogg';
}

/**
 * Turn a voice note into text. Returns null when voice is not configured
 * (no OPENAI_TRANSCRIPTION_MODEL), so callers can say so politely.
 * Audio is sent for transcription only and is not stored by opsAi.
 */
export async function transcribeAudio(
  audio: AudioInput,
  overrides?: { client?: TranscriberLike; model?: string }
): Promise<string | null> {
  const config = getAiConfig();
  const model = overrides?.model ?? config?.transcriptionModel;
  if (!model) return null;

  let client = overrides?.client;
  if (!client) {
    if (!config) return null;
    client = new OpenAI({ apiKey: config.apiKey }) as unknown as TranscriberLike;
  }

  const file = await toFile(audio.buffer, `voice.${audioExtension(audio.mimeType)}`, {
    type: audio.mimeType.split(';')[0].trim() || 'audio/ogg',
  });
  const result = await client.audio.transcriptions.create({ file, model });
  const text = result.text?.trim();
  return text ? text : null;
}
