import type { Prisma, PrismaClient } from '@prisma/client';
import { sendWhatsAppGroupMessage, sendWhatsAppMessage } from '../whatsappMessaging';
import {
  askWhichMessage,
  doneMessage,
  describeLimit,
  hasLimit,
  managerAlertMessage,
  needsNumberMessage,
  needsPhotoMessage,
  needsTextMessage,
  noSuchTaskMessage,
  openTasksMessage,
  outOfRangeMessage,
  photoRejectedMessage,
  photoStuckMessage,
  photoUnclearMessage,
  problemMessage,
  type MessageRun,
} from './messages';
import { notifyManagers } from './tick';
import { downloadWhatsAppMedia } from '../whatsappMedia';
import { createPhotoChecker, photoChecksLeft, type PhotoChecker, type PhotoVerdict } from './photoCheck';
import type { AiUsageRecord } from '../understanding/usage';

/**
 * Employees answer a task by sending proof. This decides whether an incoming WhatsApp message is
 * such an answer, which task it is for, and whether the proof is enough to close the task.
 *
 * Rules, chosen so that sales, invoice and deposit photos are never swallowed by mistake:
 *  - Text or caption that starts with a task number ("3", "#3", "task 3 done", "3 190F") answers that task.
 *  - A photo with no caption from STAFF answers the one open task that wants a photo. If several
 *    are open we ask which one, and the next message with a number picks it.
 *  - A photo with no caption from an owner or manager is left alone (it is probably a sales or invoice photo).
 *  - "done" alone answers the only open task, when there is exactly one.
 *  - A task stays open until the proof matches what it asks for (photo, text, either, or just "done").
 */

const PENDING_PHOTO_CLASS = 'TASK_PHOTO_PENDING';
const PENDING_WINDOW_MS = 15 * 60 * 1000;

export interface EvidenceInput {
  messageId: string;
  phoneE164: string;
  storeId: string;
  text: string;
  mediaId?: string;
  groupId?: string | null;
  role?: string | null;
  now?: Date;
  /** Tests pass a fake. Left out: the real AI check (or none, when AI is not configured). */
  photoChecker?: PhotoChecker | null;
}

interface OpenRun {
  id: string;
  templateId: string;
  title: string;
  evidence: string;
  dueAt: Date;
  code: number;
  lateAfterMinutes: number;
  alertedAt: Date | null;
  standardId: string | null;
  criticality: string | null;
  minValue: number | null;
  maxValue: number | null;
  unit: string | null;
  fallback: string | null;
  outcome: string | null;
  photoCheck: string | null;
  photoMisses: number;
}

// Deliberately not "ok" or "yes": those answer other prompts (OK confirms a pending entry).
const DONE_WORDS = /^(done|finished|completed|complete|✅|✔️)\W*$/i;
// "3", "#3", "task 3", "3.", "3:", "3) text", "3 done"
const LEADING_CODE = /^\s*(?:task\s*)?#?(\d{1,3})(?=$|\s|[:.)\]-](?:\s|$))[\s:.)\]-]*(.*)$/is;

export interface ParsedReply {
  code: number | null;
  rest: string;
}

export function parseTaskReply(text: string): ParsedReply {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 300) return { code: null, rest: trimmed };
  const m = LEADING_CODE.exec(trimmed);
  if (m) return { code: Number(m[1]), rest: m[2].trim() };
  return { code: null, rest: trimmed };
}

const asMessageRun = (r: OpenRun): MessageRun => ({
  code: r.code,
  title: r.title,
  evidence: r.evidence,
  dueAt: r.dueAt,
  standardId: r.standardId,
  criticality: r.criticality,
  minValue: r.minValue,
  maxValue: r.maxValue,
  unit: r.unit,
  fallback: r.fallback,
});

/** First number in a reply: "38", "38F", "it is 38 degrees", "-5". */
export function parseNumber(text: string): number | null {
  const m = /-?\d+(?:\.\d+)?/.exec(text);
  return m ? Number(m[0]) : null;
}

/** Whether a reading is inside the task's limits. */
export function withinLimits(run: Pick<MessageRun, 'minValue' | 'maxValue'>, value: number): boolean {
  if (run.minValue !== null && run.minValue !== undefined && value < run.minValue) return false;
  if (run.maxValue !== null && run.maxValue !== undefined && value > run.maxValue) return false;
  return true;
}

// "problem label printer broken", "broken", "not working", "can't find the thermometer"
const PROBLEM_RE = /^(problem|issue|broken|not working|out of order|can'?t|cannot|unable|no power)\b/i;
export function isProblemReport(rest: string): boolean {
  return PROBLEM_RE.test(rest.trim());
}

function wantsPhoto(run: OpenRun): boolean {
  return run.evidence === 'photo' || run.evidence === 'either';
}

async function reply(prisma: PrismaClient, input: EvidenceInput, text: string): Promise<void> {
  // Answer where the employee wrote: in the group if they wrote there, otherwise privately.
  if (input.groupId) await sendWhatsAppGroupMessage(prisma, input.groupId, text, input.storeId);
  else await sendWhatsAppMessage(prisma, input.phoneE164, text, input.storeId);
}

async function finishLog(prisma: PrismaClient, messageId: string, classification: string, storeId: string, usage: AiUsageRecord[] = []): Promise<void> {
  await prisma.messageLog.update({
    where: { messageId },
    data: { classification, processed: true, storeId, ...(usage.length > 0 ? { extractedData: { usage } as unknown as Prisma.InputJsonValue } : {}) },
  });
}

type PhotoOutcome = { checked: PhotoVerdict; usage: AiUsageRecord[] } | { checked: null; why: string };

/** Ask the AI whether the photo shows what the task needs. Never throws: any trouble means "not checked". */
async function checkProofPhoto(prisma: PrismaClient, input: EvidenceInput, run: OpenRun, mediaId: string, now: Date): Promise<PhotoOutcome> {
  const checker = input.photoChecker === undefined ? createPhotoChecker() : input.photoChecker;
  if (!checker) return { checked: null, why: 'AI is not switched on' };
  try {
    if (!(await photoChecksLeft(prisma, input.storeId, now))) return { checked: null, why: "today's photo-check limit was reached" };
    const media = await downloadWhatsAppMedia(mediaId);
    if (!/^image\//i.test(media.mimeType)) return { checked: null, why: 'the file was not a photo' };
    const usage: AiUsageRecord[] = [];
    const checked = await checker.check({
      title: run.title,
      expectation: run.photoCheck as string,
      image: { base64: media.buffer.toString('base64'), mimeType: media.mimeType },
      onUsage: (u) => usage.push(u),
    });
    return { checked, usage };
  } catch (error) {
    console.error('Photo check failed', { runId: run.id, error: error instanceof Error ? error.message : error });
    return { checked: null, why: 'the check could not run' };
  }
}

/** True when the message was a task answer (or a question about tasks) and has been handled. */
export async function tryTaskEvidence(prisma: PrismaClient, input: EvidenceInput): Promise<boolean> {
  const now = input.now ?? new Date();
  const text = input.text.trim();

  const open = ((await prisma.taskRun.findMany({ where: { storeId: input.storeId, status: 'OPEN' } })) as OpenRun[])
    .filter((r) => r.alertedAt)
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime() || a.code - b.code);
  if (open.length === 0) return false;

  const store = await prisma.storeConfig.findUnique({ where: { storeId: input.storeId }, select: { timezone: true, storeName: true } });
  const timeZone = store?.timezone || 'America/New_York';
  const storeName = store?.storeName ?? input.storeId;
  const isStaff = input.role === 'STAFF';

  const parsed = parseTaskReply(text);
  let code = parsed.code;
  let rest = parsed.rest;
  let mediaId = input.mediaId;

  // A bare "done" answers the only open task.
  if (code === null && !mediaId && DONE_WORDS.test(text)) {
    if (open.length === 1) {
      code = open[0].code;
      rest = text;
    } else {
      await reply(prisma, input, await describeOpenTasks(prisma, input.storeId));
      await finishLog(prisma, input.messageId, 'TASK_QUESTION', input.storeId);
      return true;
    }
  }

  // A number with no photo may be the answer to a photo sent a moment ago and not yet matched.
  if (code !== null && !mediaId) {
    const since = new Date(now.getTime() - PENDING_WINDOW_MS);
    const pending = await prisma.messageLog.findFirst({
      where: { phoneE164: input.phoneE164, classification: PENDING_PHOTO_CLASS, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
    });
    const target = open.find((r) => r.code === code);
    if (pending?.mediaId && target && wantsPhoto(target)) {
      mediaId = pending.mediaId;
      await prisma.messageLog.update({ where: { messageId: pending.messageId }, data: { classification: 'TASK_PHOTO_USED' } });
    }
  }

  // Staff photo with no number.
  if (code === null && mediaId) {
    if (!isStaff) return false;
    const photoTasks = open.filter(wantsPhoto);
    if (photoTasks.length === 0) return false;
    if (photoTasks.length === 1) {
      code = photoTasks[0].code;
    } else {
      await prisma.messageLog.update({ where: { messageId: input.messageId }, data: { classification: PENDING_PHOTO_CLASS, processed: true, storeId: input.storeId } });
      await reply(prisma, input, askWhichMessage(photoTasks.map(asMessageRun), timeZone));
      return true;
    }
  }

  if (code === null) return false;

  const run = open.find((r) => r.code === code);
  if (!run) {
    // Only speak up when the message is plainly an attempt to answer a task ("7", "7 done"), never for other text.
    const plain = !mediaId && (rest === '' || DONE_WORDS.test(rest)) && text.length <= 12;
    if (!plain && !mediaId) return false;
    await reply(prisma, input, noSuchTaskMessage(code, open.map(asMessageRun), timeZone));
    await finishLog(prisma, input.messageId, 'TASK_QUESTION', input.storeId);
    return true;
  }

  const hasPhoto = Boolean(mediaId);
  const hasText = rest.length > 0;
  const asRun = asMessageRun(run);
  const everWrong = run.outcome === 'fail' || run.outcome === 'problem' || run.outcome === 'photo_fail';

  // Something is broken: say so, get told how to cope, the task stays open and the managers hear about it.
  if (hasText && isProblemReport(rest)) {
    let told = everWrong;
    if (run.outcome !== 'problem') {
      const sent = await notifyManagers(prisma, input.storeId, managerAlertMessage(storeName, asRun, `Reported by staff: ${rest.slice(0, 200)}`));
      told = told || sent > 0;
    }
    await prisma.taskRun.update({ where: { id: run.id }, data: { outcome: 'problem', issueText: rest.slice(0, 300) } });
    await reply(prisma, input, problemMessage(asRun, rest.replace(/^(problem|issue)\b[:\s-]*/i, '').slice(0, 200), told));
    await finishLog(prisma, input.messageId, 'TASK_PROBLEM', input.storeId);
    return true;
  }

  // "2 cases of milk arrived" is a report that happens to start with a number, not proof for a photo task.
  if (run.evidence === 'photo' && !hasPhoto && hasText && !DONE_WORDS.test(rest)) return false;

  // A task with a limit needs a number, and the number has to be inside the limit.
  let reading: number | null = null;
  if (hasLimit(run)) {
    reading = hasText ? parseNumber(rest) : null;
    if (reading === null) {
      await reply(prisma, input, needsNumberMessage(asRun));
      await finishLog(prisma, input.messageId, 'TASK_NEEDS_EVIDENCE', input.storeId);
      return true;
    }
    if (!withinLimits(run, reading)) {
      let told = everWrong;
      if (run.outcome !== 'fail') {
        const detail = `Reading ${reading}${run.unit ? ` ${run.unit}` : ''} is not ${describeLimit(run)}.`;
        const sent = await notifyManagers(prisma, input.storeId, managerAlertMessage(storeName, asRun, detail));
        told = told || sent > 0;
      }
      await prisma.taskRun.update({ where: { id: run.id }, data: { outcome: 'fail', resultValue: reading } });
      await reply(prisma, input, outOfRangeMessage(asRun, reading, told));
      await finishLog(prisma, input.messageId, 'TASK_OUT_OF_RANGE', input.storeId);
      return true;
    }
  }

  // Does the proof match what the task asks for?
  let enough = true;
  let nudge: string | null = null;
  switch (run.evidence) {
    case 'photo':
      enough = hasPhoto;
      nudge = needsPhotoMessage(asRun);
      break;
    case 'text':
      enough = hasText;
      nudge = needsTextMessage(asRun);
      break;
    case 'either':
      enough = hasPhoto || hasText;
      nudge = needsPhotoMessage(asRun);
      break;
    default:
      enough = true;
  }
  if (!enough) {
    await reply(prisma, input, nudge as string);
    await finishLog(prisma, input.messageId, 'TASK_NEEDS_EVIDENCE', input.storeId);
    return true;
  }

  // A task with "what the photo must show": the AI looks. Only a clear "no" or "cannot tell" holds the task open.
  let photoVerdict: string | null = null;
  let photoNote: string | null = null;
  let photoUsage: AiUsageRecord[] = [];
  if (run.photoCheck && hasPhoto && mediaId) {
    const result = await checkProofPhoto(prisma, input, run, mediaId, now);
    if (result.checked === null) {
      photoVerdict = 'unchecked';
      photoNote = result.why;
    } else if (result.checked.verdict !== 'pass') {
      const { verdict, reason } = result.checked;
      const misses = (run.photoMisses ?? 0) + 1;
      let told = run.outcome === 'photo_fail';
      if (verdict === 'fail' && run.outcome !== 'photo_fail') {
        const sent = await notifyManagers(prisma, input.storeId, managerAlertMessage(storeName, asRun, `Photo did not pass: ${reason}`));
        told = told || sent > 0;
      }
      if (misses === 3) await notifyManagers(prisma, input.storeId, photoStuckMessage(storeName, asRun, misses));
      await prisma.taskRun.update({
        where: { id: run.id },
        data: {
          photoVerdict: verdict,
          photoNote: reason,
          photoMisses: misses,
          evidenceType: 'photo',
          evidenceMediaId: mediaId,
          evidenceMessageId: input.messageId,
          ...(verdict === 'fail' && !run.outcome ? { outcome: 'photo_fail' } : {}),
        },
      });
      await reply(prisma, input, verdict === 'fail' ? photoRejectedMessage(asRun, reason, told) : photoUnclearMessage(asRun, reason));
      await finishLog(prisma, input.messageId, verdict === 'fail' ? 'TASK_PHOTO_REJECTED' : 'TASK_PHOTO_UNCLEAR', input.storeId, result.usage);
      return true;
    } else {
      photoVerdict = 'pass';
      photoNote = result.checked.reason;
      photoUsage = result.usage;
    }
  }

  const lateMinutes = Math.max(0, Math.round((now.getTime() - run.dueAt.getTime()) / 60000) - run.lateAfterMinutes);
  await prisma.taskRun.update({
    where: { id: run.id },
    data: {
      status: 'DONE',
      completedAt: now,
      completedByPhone: input.phoneE164,
      evidenceType: hasPhoto ? 'photo' : hasText ? 'text' : 'none',
      evidenceText: hasText ? rest.slice(0, 500) : null,
      evidenceMediaId: mediaId ?? null,
      evidenceMessageId: input.messageId,
      outcome: everWrong ? 'fixed' : 'pass',
      resultValue: reading,
      ...(photoVerdict ? { photoVerdict, photoNote } : {}),
    },
  });
  await finishLog(prisma, input.messageId, photoVerdict === 'pass' ? 'TASK_PHOTO_PASSED' : 'TASK_EVIDENCE', input.storeId, photoUsage);
  await reply(prisma, input, doneMessage(asRun, now, timeZone, lateMinutes, open.length - 1, reading !== null ? `${reading}${run.unit && /^[A-Za-z]{1,2}$/.test(run.unit) ? run.unit : run.unit ? ` ${run.unit}` : ''}` : undefined) + (photoVerdict === 'pass' && photoNote ? `\n🔍 Photo checked: ${photoNote}` : ''));
  return true;
}

/** "TASKS": what is open for this store right now. */
export async function describeOpenTasks(prisma: PrismaClient, storeId: string): Promise<string> {
  const store = await prisma.storeConfig.findUnique({ where: { storeId }, select: { storeName: true, timezone: true } });
  const open = ((await prisma.taskRun.findMany({ where: { storeId, status: 'OPEN' } })) as OpenRun[])
    .filter((r) => r.alertedAt)
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime() || a.code - b.code);
  return openTasksMessage(store?.storeName ?? storeId, open.map(asMessageRun), store?.timezone || 'America/New_York');
}
