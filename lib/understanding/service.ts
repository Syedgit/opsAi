import type { PrismaClient } from '@prisma/client';
import { createPendingAction } from '../pendingActionService';
import { updateMessageLog } from '../messageLogService';
import { sendWhatsAppMessage } from '../whatsappMessaging';
import { downloadWhatsAppMedia } from '../whatsappMedia';
import { UnderstandingUnavailableError, type MessageUnderstander } from './extractor';
import { formatEntriesReply, planUnderstanding } from './plan';
import { loadStoreProfiles } from './storeProfiles';
import { transcribeAudio } from './transcribe';
import type { Understanding } from './schema';

export interface UnderstandParams {
  messageId: string;
  phoneE164: string;
  storeId: string;
  text: string;
  mediaId?: string;
  /** "image/jpeg", "audio", ... as passed by the webhook. */
  mediaType?: string;
  understander: MessageUnderstander;
  now?: Date;
}

/**
 * 'handled'  the sender got a reply and the message is done.
 * 'fallback' AI was unavailable for a text-only message; the caller may use the rule-based path.
 */
export type UnderstandOutcome = 'handled' | 'fallback';

const FIRST_REPORT_INTRO =
  '👋 This is your first report. Check each number below. If something is wrong, reply FIX and the field (for example FIX card 1260), then OK. After that, keep sending reports the same way.';

const RETRY_MESSAGE =
  "😕 I couldn't read that right now. Please send it again in a minute, or type the numbers like: cash 298 card 1355 gas 1440.";

/** What the sender sees as the "extracted" record in message_log (no raw media is kept). */
function logPayload(understanding: Understanding, transcript: string | null): Record<string, unknown> {
  return { understanding, ...(transcript ? { transcript } : {}) };
}

/**
 * Read one message (text, photo, or voice note), save each finding as a pending entry,
 * and reply with what was understood and what looks off.
 */
export async function understandAndRespond(prisma: PrismaClient, params: UnderstandParams): Promise<UnderstandOutcome> {
  const { messageId, phoneE164, storeId, mediaId, mediaType, understander } = params;
  const now = params.now ?? new Date();
  const isAudio = Boolean(mediaId && mediaType?.toLowerCase().startsWith('audio'));
  const isImage = Boolean(mediaId && !isAudio);

  let text = params.text.trim();
  let transcript: string | null = null;
  let image: { base64: string; mimeType: string } | undefined;

  const finish = async (reply: string, classification: string, extracted?: unknown) => {
    await sendWhatsAppMessage(prisma, phoneE164, reply, storeId);
    await updateMessageLog(prisma, messageId, {
      classification,
      ...(extracted !== undefined ? { extractedData: extracted } : {}),
      processed: true,
      storeId,
    });
  };

  if (mediaId) {
    let media;
    try {
      media = await downloadWhatsAppMedia(mediaId);
    } catch (error) {
      console.error('Media download failed', { messageId, error: error instanceof Error ? error.message : error });
      await finish("😕 I couldn't open that file. Please send it again.", 'MEDIA_ERROR');
      return 'handled';
    }

    if (isAudio) {
      try {
        transcript = await transcribeAudio({ buffer: media.buffer, mimeType: media.mimeType });
      } catch (error) {
        console.error('Transcription failed', { messageId, error: error instanceof Error ? error.message : error });
        await finish(RETRY_MESSAGE, 'AI_UNAVAILABLE');
        return 'handled';
      }
      if (!transcript) {
        await finish(
          "🎙️ Voice notes aren't switched on yet. Please send a photo or type it, like: cash 298 card 1355 gas 1440.",
          'AUDIO_UNSUPPORTED'
        );
        return 'handled';
      }
      text = text ? `${text}\n${transcript}` : transcript;
    } else if (isImage) {
      image = { base64: media.buffer.toString('base64'), mimeType: media.mimeType.startsWith('image/') ? media.mimeType : 'image/jpeg' };
    }
  }

  // Owners and managers can report for every store the owner has; staff only for their own.
  const member = await prisma.userDirectory.findUnique({ where: { phoneE164 }, select: { role: true } });
  const canReportForAllStores = member?.role === 'OWNER' || member?.role === 'MANAGER';
  const profiles = await loadStoreProfiles(prisma, storeId, { includeOwnerSiblings: canReportForAllStores });
  const multiStoreSender = canReportForAllStores && profiles.length > 1;

  let understanding: Understanding;
  try {
    understanding = await understander.understand({ text, image, profiles, now });
  } catch (error) {
    if (!(error instanceof UnderstandingUnavailableError)) throw error;
    console.error('AI understanding unavailable', { messageId, error: error.message });
    if (!image && !isAudio) return 'fallback';
    await finish(RETRY_MESSAGE, 'AI_UNAVAILABLE');
    return 'handled';
  }

  const plan = planUnderstanding(understanding, {
    profiles,
    primaryStoreId: storeId,
    now,
    multiStoreSender,
    canTeachRules: canReportForAllStores,
  });
  const heard = transcript ? `🎙️ I heard: "${transcript}"\n\n` : '';

  if (plan.entries.length === 0) {
    await finish(`${heard}${plan.notice ?? RETRY_MESSAGE}`, understanding.kind.toUpperCase(), logPayload(understanding, transcript));
    return 'handled';
  }

  for (const entry of plan.entries) {
    await createPendingAction(prisma, phoneE164, entry.storeId, entry.actionType, entry.payload, entry.confidence, messageId);
  }

  // The first report from a store doubles as its setup: the owner checks what was read and fixes it once.
  const confirmedBefore = await prisma.pendingActions.count({
    where: { storeId, status: 'CONFIRMED' },
  });
  const welcome = confirmedBefore === 0 ? `${FIRST_REPORT_INTRO}\n\n` : '';

  await finish(
    `${heard}${welcome}${formatEntriesReply(plan.entries)}`,
    understanding.kind.toUpperCase(),
    logPayload(understanding, transcript)
  );
  return 'handled';
}
