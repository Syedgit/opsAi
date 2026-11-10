import type { PrismaClient } from '@prisma/client';
import { createPendingAction } from '../pendingActionService';
import { updateMessageLog } from '../messageLogService';
import { sendWhatsAppMessage } from '../whatsappMessaging';
import { downloadWhatsAppMedia } from '../whatsappMedia';
import { UnderstandingUnavailableError, type MessageUnderstander } from './extractor';
import { describeEntryPayload, formatEntriesReply, planUnderstanding, type PlanContext, type PlannedEntry } from './plan';
import { storeForSheet } from './closeSources';
import { loadOpenInvoices } from '../tasks/invoiceReminder';
import { loadConfirmedTillCash } from './daySummary';
import { loadOpenCloses, openCloseFromAction } from './closeMerge';
import { reportFromClosePayload } from './depositDue';
import { loadStoreProfiles } from './storeProfiles';
import { transcribeAudio } from './transcribe';
import type { AiUsageRecord } from './usage';
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
  /** WhatsApp group the sheet/photo came from, so OK can post hours back there. */
  groupId?: string | null;
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

/** Photos from one sender this close together are one report (two POS pages, POS + handwritten sheet). */
const PHOTO_GAP_MS = 45_000;
const PHOTO_SETTLE_MS = 4_000;
const PHOTO_WAIT_MS = 25_000;

type PhotoRow = { messageId: string; createdAt: Date; processed: boolean };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** This sender's recent photos that belong with this one, oldest first. Empty if the log is unavailable. */
async function photoBatch(prisma: PrismaClient, phoneE164: string, messageId: string): Promise<{ rows: PhotoRow[]; mine: number }> {
  try {
    const rows: PhotoRow[] = await prisma.messageLog.findMany({
      where: { phoneE164, messageType: { startsWith: 'image' }, createdAt: { gte: new Date(Date.now() - 10 * 60_000) } },
      select: { messageId: true, createdAt: true, processed: true },
      orderBy: { createdAt: 'asc' },
    });
    const mine = rows.findIndex((r) => r.messageId === messageId);
    if (mine < 0) return { rows: [], mine: -1 };
    let start = mine;
    while (start > 0 && rows[start].createdAt.getTime() - rows[start - 1].createdAt.getTime() <= PHOTO_GAP_MS) start -= 1;
    let end = mine;
    while (end < rows.length - 1 && rows[end + 1].createdAt.getTime() - rows[end].createdAt.getTime() <= PHOTO_GAP_MS) end += 1;
    return { rows: rows.slice(start, end + 1), mine: mine - start };
  } catch {
    return { rows: [], mine: -1 };
  }
}

/** Let earlier photos in the batch save first, so this one adds to the same close instead of racing it. */
async function waitForEarlierPhotos(prisma: PrismaClient, phoneE164: string, messageId: string): Promise<void> {
  const until = Date.now() + PHOTO_WAIT_MS;
  while (Date.now() < until) {
    const { rows, mine } = await photoBatch(prisma, phoneE164, messageId);
    if (mine <= 0 || rows.slice(0, mine).every((r) => r.processed)) return;
    await sleep(1000);
  }
}

/** True when a later photo in the batch is still being read; that one sends the single reply. */
async function laterPhotoPending(prisma: PrismaClient, phoneE164: string, messageId: string): Promise<boolean> {
  const first = await photoBatch(prisma, phoneE164, messageId);
  if (first.mine < 0) return false;
  const wait = first.rows[first.mine].createdAt.getTime() + PHOTO_SETTLE_MS - Date.now();
  if (wait > 0) await sleep(wait);
  const { rows, mine } = await photoBatch(prisma, phoneE164, messageId);
  return mine >= 0 && rows.slice(mine + 1).some((r) => !r.processed);
}

/**
 * Entries earlier photos in the batch saved quietly (an invoice next to the close, say). They are
 * moved onto this message so one OK or CANCEL covers the whole batch, and their lines are returned.
 */
async function otherBatchEntries(
  prisma: PrismaClient,
  phoneE164: string,
  messageId: string,
  touched: Set<string>,
  profiles: Array<{ storeId: string; storeName: string }>
): Promise<string[]> {
  try {
    const { rows } = await photoBatch(prisma, phoneE164, messageId);
    const earlier = rows.map((r) => r.messageId).filter((id) => id !== messageId);
    if (earlier.length === 0) return [];
    const pending = await prisma.pendingActions.findMany({
      where: { phoneE164, status: 'PENDING', messageIdInbound: { in: earlier } },
      orderBy: { createdAt: 'asc' },
    });
    const extra = pending.filter((p) => !touched.has(p.actionId));
    if (extra.length === 0) return [];
    await prisma.pendingActions.updateMany({
      where: { actionId: { in: extra.map((p) => p.actionId) } },
      data: { messageIdInbound: messageId },
    });
    return extra.flatMap((p) => {
      const name = profiles.find((s) => s.storeId === p.storeId)?.storeName ?? p.storeId;
      const lines = describeEntryPayload((p.payloadJson ?? {}) as Record<string, unknown>, name);
      return lines ? [lines.join('\n')] : [];
    });
  } catch (error) {
    console.warn('Could not gather the rest of the photo batch', error instanceof Error ? error.message : error);
    return [];
  }
}

/**
 * A handwritten sheet sent before the day's text has no store name, so it waited under the
 * sender's first store. When a typed close arrives whose credit and cash match that sheet, the
 * sheet becomes that store's photo proof and the stray entry is dropped.
 */
async function absorbUnnamedSheets(
  prisma: PrismaClient,
  phoneE164: string,
  entries: PlannedEntry[],
  closes: Array<{ index: number; actionId: string }>,
  ctx: PlanContext,
  confidence: number
): Promise<void> {
  const typed = closes.filter((c) => entries[c.index].payload.text_report);
  if (typed.length === 0) return;
  try {
    const strays = await prisma.pendingActions.findMany({
      where: {
        phoneE164,
        status: 'PENDING',
        type: 'STORE_SALES',
        createdAt: { gte: new Date(Date.now() - 36 * 60 * 60 * 1000) },
        actionId: { notIn: closes.map((c) => c.actionId) },
      },
    });
    for (const stray of strays) {
      const payload = (stray.payloadJson ?? {}) as Record<string, unknown>;
      const checks = Array.isArray(payload.checks) ? (payload.checks as Array<{ id?: string }>) : [];
      if (!checks.some((c) => c.id === 'store_not_named')) continue;
      const sheet = reportFromClosePayload(payload);
      if (!sheet) continue;
      for (const close of typed) {
        const entry = entries[close.index];
        const mine = openCloseFromAction({ actionId: close.actionId, storeId: entry.storeId, status: 'PENDING', payloadJson: entry.payload });
        if (!mine || storeForSheet(sheet, mine.report.reportDate, [mine], [entry.storeId]) !== entry.storeId) continue;
        const [merged] = planUnderstanding(
          { kind: 'daily_close', confidence, needsReview: [], reports: [{ ...sheet, storeHint: entry.storeName }] },
          { ...ctx, source: 'photo', openCloses: [mine] }
        ).entries;
        if (!merged || merged.storeId !== entry.storeId) continue;
        const { updates_action_id: _self, ...rest } = merged.payload;
        const earlierUpdate = entry.payload.updates_action_id;
        const nextPayload = {
          ...rest,
          ...(typeof earlierUpdate === 'string' && earlierUpdate !== close.actionId ? { updates_action_id: earlierUpdate } : {}),
        };
        await prisma.pendingActions.update({ where: { actionId: close.actionId }, data: { payloadJson: nextPayload as object } });
        await prisma.pendingActions.update({ where: { actionId: stray.actionId }, data: { status: 'CANCELLED' } });
        entries[close.index] = { ...merged, payload: nextPayload };
        break;
      }
    }
  } catch (error) {
    console.warn('Could not match the unnamed sheet to a store', error instanceof Error ? error.message : error);
  }
}

/** Stores whose confirmed closes in the last three weeks came from the owner's typed daily post. */
async function loadTextStores(prisma: PrismaClient, storeIds: string[]): Promise<string[]> {
  try {
    const rows = await prisma.pendingActions.findMany({
      where: {
        storeId: { in: storeIds },
        type: 'STORE_SALES',
        status: 'CONFIRMED',
        createdAt: { gte: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000) },
      },
      select: { storeId: true, payloadJson: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return [...new Set(rows.filter((r) => (r.payloadJson as { text_report?: unknown } | null)?.text_report).map((r) => r.storeId))];
  } catch {
    return [];
  }
}

/** What the sender sees as the "extracted" record in message_log (no raw media is kept). */
function logPayload(understanding: Understanding, transcript: string | null, usage: AiUsageRecord[]): Record<string, unknown> {
  return { understanding, ...(transcript ? { transcript } : {}), ...(usage.length > 0 ? { usage } : {}) };
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
  const usage: AiUsageRecord[] = [];
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
        transcript = await transcribeAudio({ buffer: media.buffer, mimeType: media.mimeType }, { onUsage: (u) => usage.push(u) });
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
    understanding = await understander.understand({ text, image, profiles, now, onUsage: (u) => usage.push(u) });
  } catch (error) {
    if (!(error instanceof UnderstandingUnavailableError)) throw error;
    console.error('AI understanding unavailable', { messageId, error: error.message });
    if (!image && !isAudio) return 'fallback';
    await finish(RETRY_MESSAGE, 'AI_UNAVAILABLE');
    return 'handled';
  }

  if (isImage) await waitForEarlierPhotos(prisma, phoneE164, messageId);

  const ctx: PlanContext = {
    profiles,
    primaryStoreId: storeId,
    now,
    multiStoreSender,
    canTeachRules: canReportForAllStores,
    canManageSchedules: canReportForAllStores,
    openInvoices: await loadOpenInvoices(
      prisma,
      profiles.map((p) => p.storeId)
    ).catch((error) => {
      console.warn('Could not load open invoices', error instanceof Error ? error.message : error);
      return [];
    }),
    tillCash: await loadConfirmedTillCash(
      prisma,
      profiles.map((p) => p.storeId),
      now
    ).catch((error) => {
      console.warn('Could not load till cash', error instanceof Error ? error.message : error);
      return [];
    }),
    openCloses: await loadOpenCloses(
      prisma,
      profiles.map((p) => p.storeId)
    ).catch((error) => {
      console.warn('Could not load open closes', error instanceof Error ? error.message : error);
      return [];
    }),
    messageText: text,
    source: isImage ? 'photo' : 'text',
    textStores: isImage ? await loadTextStores(prisma, profiles.map((p) => p.storeId)) : [],
  };
  const plan = planUnderstanding(understanding, ctx);
  const entries = plan.entries.slice();
  const heard = transcript ? `🎙️ I heard: "${transcript}"\n\n` : '';

  if (entries.length === 0) {
    await finish(`${heard}${plan.notice ?? RETRY_MESSAGE}`, understanding.kind.toUpperCase(), logPayload(understanding, transcript, usage));
    return 'handled';
  }

  const groupId = params.groupId?.trim() || null;
  const touched = new Set<string>();
  const closes: Array<{ index: number; actionId: string }> = [];
  for (const [index, entry] of entries.entries()) {
    const payload = groupId ? { ...entry.payload, source_group_id: groupId } : entry.payload;
    const updateId = typeof payload.updates_action_id === 'string' ? payload.updates_action_id : '';
    if (entry.kind === 'daily_close' && updateId) {
      const original = await prisma.pendingActions.findFirst({
        where: { actionId: updateId, storeId: entry.storeId },
      });
      if (original?.status === 'PENDING') {
        const { updates_action_id: _ignored, ...rest } = payload;
        await prisma.pendingActions.update({
          where: { actionId: original.actionId },
          data: {
            payloadJson: rest as object,
            confidence: entry.confidence,
            messageIdInbound: messageId,
          },
        });
        touched.add(original.actionId);
        closes.push({ index, actionId: original.actionId });
        continue;
      }
    }
    const actionId = await createPendingAction(prisma, phoneE164, entry.storeId, entry.actionType, payload, entry.confidence, messageId);
    touched.add(actionId);
    if (entry.kind === 'daily_close') closes.push({ index, actionId });
  }

  if (isImage && (await laterPhotoPending(prisma, phoneE164, messageId))) {
    await updateMessageLog(prisma, messageId, {
      classification: understanding.kind.toUpperCase(),
      extractedData: logPayload(understanding, transcript, usage),
      processed: true,
      storeId,
    });
    return 'handled';
  }
  await absorbUnnamedSheets(prisma, phoneE164, entries, closes, ctx, understanding.confidence);
  const others = isImage ? await otherBatchEntries(prisma, phoneE164, messageId, touched, profiles) : [];

  // The first report from a store doubles as its setup: the owner checks what was read and fixes it once.
  const confirmedBefore = await prisma.pendingActions.count({
    where: { storeId, status: 'CONFIRMED' },
  });
  const isMoneyReport = entries.some((e) => e.kind !== 'work_schedule' && e.kind !== 'fuel_prices');
  const welcome = confirmedBefore === 0 && isMoneyReport ? `${FIRST_REPORT_INTRO}\n\n` : '';

  const body =
    others.length === 0
      ? formatEntriesReply(entries)
      : `${[...entries.map((e) => e.lines.join('\n')), ...others].join('\n\n')}\n\nReply OK to save all, or CANCEL to discard all.`;
  await finish(
    `${heard}${welcome}${body}`,
    understanding.kind.toUpperCase(),
    logPayload(understanding, transcript, usage)
  );
  return 'handled';
}
