import type { PrismaClient } from '@prisma/client';
import { postToStoreGroups, sendWhatsAppMessage } from '../whatsappMessaging';
import { maybeMorningDepositText } from '../understanding/depositDue';
import { alertMessage, escalationMessage, reminderMessage, type MessageRun } from './messages';
import { dueSoFar } from './schedule';
import { localDateString } from './time';
import { logApp, logAppError, serializeError } from '../requestLog';

/**
 * The heartbeat of the task system. Called every few minutes by a scheduler (see README).
 * Each call, for every store with active tasks:
 *   1. creates a run for each task that has come due,
 *   2. closes runs that were replaced by a newer one (or are over a day old),
 *   3. announces newly due tasks, reminds about open ones, and escalates stale ones to the owner.
 * It is safe to call twice in a row: runs are unique per task and due time, and each message is
 * only sent once its own timer has elapsed.
 */

const MAX_REMINDERS = 12;
const HARD_CAP_MS = 24 * 60 * 60 * 1000;
/** A task that only comes round every few days or once a month gets longer to be finished before it counts as missed. */
const RARE_TASK_CAP_MS = 72 * 60 * 60 * 1000;
const DEFAULT_REMIND_MINUTES = 15;
const DEFAULT_ESCALATE_MINUTES = 60;

export interface TickResult {
  stores: number;
  created: number;
  alerted: number;
  reminded: number;
  escalated: number;
  closed: number;
  errors: number;
  depositNudges: number;
}

interface TemplateRow {
  id: string;
  storeId: string;
  title: string;
  instructions: string | null;
  category: string;
  standardId: string | null;
  criticality: string | null;
  minValue: number | null;
  maxValue: number | null;
  unit: string | null;
  fallback: string | null;
  startTime: string;
  endTime: string | null;
  repeatEveryMinutes: number | null;
  frequency: string;
  intervalDays: number | null;
  monthDays: number[];
  anchorDate: string | null;
  daysOfWeek: number[];
  evidence: string;
  photoCheck: string | null;
  points: number;
  remindEveryMinutes: number;
  escalateAfterMinutes: number | null;
  lateAfterMinutes: number;
  active: boolean;
  createdAt: Date;
}

interface RunRow {
  id: string;
  templateId: string;
  storeId: string;
  title: string;
  standardId: string | null;
  criticality: string | null;
  minValue: number | null;
  maxValue: number | null;
  unit: string | null;
  fallback: string | null;
  evidence: string;
  photoCheck: string | null;
  dueAt: Date;
  code: number;
  status: string;
  alertedAt: Date | null;
  lastReminderAt: Date | null;
  reminderCount: number;
  escalatedAt: Date | null;
}

const toMessageRun = (run: RunRow, instructions?: string | null): MessageRun => ({
  code: run.code,
  title: run.title,
  evidence: run.evidence,
  dueAt: run.dueAt,
  instructions,
  standardId: run.standardId,
  criticality: run.criticality,
  minValue: run.minValue,
  maxValue: run.maxValue,
  unit: run.unit,
  fallback: run.fallback,
});

/** Group first (the shift sees it together); otherwise a private message to each staff member and manager. */
export async function deliverToStore(prisma: PrismaClient, storeId: string, text: string): Promise<number> {
  const posted = await postToStoreGroups(prisma, storeId, text);
  if (posted > 0) return posted;

  const members = await prisma.userDirectory.findMany({ where: { storeId, isActive: true } });
  let sent = 0;
  for (const member of members) {
    if (member.role === 'OWNER') continue;
    if (await sendWhatsAppMessage(prisma, member.phoneE164, text, storeId)) sent += 1;
  }
  return sent;
}

/** Owners and managers of the store, by private message. */
export async function notifyManagers(prisma: PrismaClient, storeId: string, text: string): Promise<number> {
  const members = await prisma.userDirectory.findMany({ where: { storeId, isActive: true } });
  let sent = 0;
  for (const member of members) {
    if (member.role !== 'OWNER' && member.role !== 'MANAGER') continue;
    if (await sendWhatsAppMessage(prisma, member.phoneE164, text, storeId)) sent += 1;
  }
  return sent;
}

function smallestFreeCode(used: Set<number>): number {
  let code = 1;
  while (used.has(code)) code += 1;
  return code;
}

async function tickStore(prisma: PrismaClient, storeId: string, templates: TemplateRow[], now: Date, result: TickResult): Promise<void> {
  const store = await prisma.storeConfig.findUnique({ where: { storeId }, select: { storeName: true, timezone: true, active: true } });
  if (!store || store.active === false) return;
  const timeZone = store.timezone || 'America/New_York';
  const today = localDateString(now, timeZone);
  const byId = new Map(templates.map((t) => [t.id, t]));

  const openRows = (await prisma.taskRun.findMany({ where: { storeId, status: 'OPEN' } })) as RunRow[];
  const todayRows = (await prisma.taskRun.findMany({ where: { storeId, localDate: today } })) as RunRow[];
  const known = new Set([...openRows, ...todayRows].map((r) => `${r.templateId}|${r.dueAt.getTime()}`));
  const usedCodes = new Set(openRows.map((r) => r.code));
  const open: RunRow[] = [...openRows];

  // 1. Create a run for everything that has come due and has no run yet.
  const due: Array<{ template: TemplateRow; dueAt: Date }> = [];
  for (const template of templates) {
    // "Every N days" counts from the day the task was made, unless the owner picked a start date.
    const schedule = { ...template, anchorDate: template.anchorDate ?? localDateString(template.createdAt, timeZone) };
    for (const dueAt of dueSoFar(schedule, now, timeZone, template.createdAt)) {
      if (!known.has(`${template.id}|${dueAt.getTime()}`)) due.push({ template, dueAt });
    }
  }
  due.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  for (const { template, dueAt } of due) {
    const code = smallestFreeCode(usedCodes);
    try {
      const created = (await prisma.taskRun.create({
        data: {
          templateId: template.id,
          storeId,
          title: template.title,
          category: template.category,
          standardId: template.standardId,
          criticality: template.criticality,
          minValue: template.minValue,
          maxValue: template.maxValue,
          unit: template.unit,
          fallback: template.fallback,
          evidence: template.evidence,
          photoCheck: template.photoCheck,
          points: template.points,
          lateAfterMinutes: template.lateAfterMinutes,
          dueAt,
          localDate: today,
          code,
          status: 'OPEN',
        },
      })) as RunRow;
      usedCodes.add(code);
      open.push(created);
      result.created += 1;
    } catch (error) {
      // Another tick created it first (unique per task and due time): nothing to do.
      if ((error as { code?: string }).code !== 'P2002') throw error;
    }
  }

  // 2. Close runs nobody can still be expected to do: replaced by a newer one, over a day old, or the task was removed.
  const toClose: string[] = [];
  const cancelled: string[] = [];
  const newestByTemplate = new Map<string, RunRow>();
  for (const run of open) {
    const newest = newestByTemplate.get(run.templateId);
    if (!newest || run.dueAt.getTime() > newest.dueAt.getTime()) newestByTemplate.set(run.templateId, run);
  }
  for (const run of open) {
    const template = byId.get(run.templateId);
    if (!template) cancelled.push(run.id);
    else if (newestByTemplate.get(run.templateId) !== run || now.getTime() - run.dueAt.getTime() > (template.frequency === 'weekly' ? HARD_CAP_MS : RARE_TASK_CAP_MS)) toClose.push(run.id);
  }
  if (cancelled.length > 0) await prisma.taskRun.updateMany({ where: { id: { in: cancelled } }, data: { status: 'CANCELLED' } });
  if (toClose.length > 0) await prisma.taskRun.updateMany({ where: { id: { in: toClose } }, data: { status: 'MISSED' } });
  result.closed += cancelled.length + toClose.length;
  const gone = new Set([...cancelled, ...toClose]);
  const live = open.filter((r) => !gone.has(r.id)).sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime() || a.code - b.code);

  // 3a. Announce what just came due, in one message.
  const fresh = live.filter((r) => !r.alertedAt);
  if (fresh.length > 0) {
    const text = alertMessage(store.storeName, fresh.map((r) => toMessageRun(r, byId.get(r.templateId)?.instructions)), timeZone);
    if ((await deliverToStore(prisma, storeId, text)) > 0) {
      await prisma.taskRun.updateMany({ where: { id: { in: fresh.map((r) => r.id) } }, data: { alertedAt: now } });
      fresh.forEach((r) => (r.alertedAt = now));
      result.alerted += fresh.length;
    }
  }

  // 3b. Remind about open tasks whose own reminder interval has passed, in one message.
  const nag = live.filter((r) => {
    if (!r.alertedAt || fresh.includes(r) || r.reminderCount >= MAX_REMINDERS) return false;
    const every = (byId.get(r.templateId)?.remindEveryMinutes ?? DEFAULT_REMIND_MINUTES) * 60000;
    return now.getTime() - (r.lastReminderAt ?? r.alertedAt).getTime() >= every;
  });
  if (nag.length > 0) {
    const text = reminderMessage(store.storeName, nag.map((r) => toMessageRun(r)), timeZone, now);
    if ((await deliverToStore(prisma, storeId, text)) > 0) {
      for (const r of nag) {
        await prisma.taskRun.update({ where: { id: r.id }, data: { lastReminderAt: now, reminderCount: r.reminderCount + 1 } });
      }
      result.reminded += nag.length;
    }
  }

  // 4. Tell the owner and managers about tasks still open well past due.
  const stale = live.filter((r) => {
    if (r.escalatedAt || !r.alertedAt) return false;
    const minutes = byId.get(r.templateId)?.escalateAfterMinutes ?? DEFAULT_ESCALATE_MINUTES;
    return now.getTime() - r.dueAt.getTime() >= minutes * 60000;
  });
  if (stale.length > 0) {
    const text = escalationMessage(store.storeName, stale.map((r) => toMessageRun(r)), timeZone, now);
    if ((await notifyManagers(prisma, storeId, text)) > 0) {
      await prisma.taskRun.updateMany({ where: { id: { in: stale.map((r) => r.id) } }, data: { escalatedAt: now } });
      result.escalated += stale.length;
    }
  }
}

async function tickMorningDeposits(
  prisma: PrismaClient,
  now: Date,
  options: { storeId?: string },
  result: TickResult
): Promise<void> {
  const stores = await prisma.storeConfig.findMany({
    where: { active: true, ...(options.storeId ? { storeId: options.storeId } : {}) },
    select: { storeId: true, storeName: true, timezone: true, setupJson: true, profileJson: true, active: true },
  });
  for (const store of stores) {
    try {
      const due = await maybeMorningDepositText(prisma, store, now);
      if (!due) continue;
      if ((await deliverToStore(prisma, store.storeId, due.text)) === 0) continue;
      try {
        await prisma.messageLog.create({
          data: {
            messageId: due.messageId,
            phoneE164: 'opsai',
            storeId: store.storeId,
            messageType: 'deposit_due',
            messageText: due.text,
            processed: true,
          },
        });
      } catch (error) {
        if ((error as { code?: string }).code !== 'P2002') throw error;
      }
      result.depositNudges += 1;
    } catch (error) {
      result.errors += 1;
      logAppError('tick.deposit', { storeId: store.storeId, ...serializeError(error) });
    }
  }
}

export async function runTaskTick(prisma: PrismaClient, now: Date = new Date(), options: { storeId?: string } = {}): Promise<TickResult> {
  const result: TickResult = { stores: 0, created: 0, alerted: 0, reminded: 0, escalated: 0, closed: 0, errors: 0, depositNudges: 0 };

  const all = (await prisma.taskTemplate.findMany({ where: options.storeId ? { storeId: options.storeId } : {} })) as TemplateRow[];
  const activeByStore = new Map<string, TemplateRow[]>();
  const stores = new Set<string>();
  for (const t of all) {
    stores.add(t.storeId);
    if (t.active) activeByStore.set(t.storeId, [...(activeByStore.get(t.storeId) ?? []), t]);
  }
  // A store whose tasks were all switched off still needs its open runs closed, so it is visited too.
  const stillOpen = (await prisma.taskRun.findMany({ where: options.storeId ? { storeId: options.storeId, status: 'OPEN' } : { status: 'OPEN' } })) as RunRow[];
  stillOpen.forEach((r) => stores.add(r.storeId));

  for (const storeId of stores) {
    result.stores += 1;
    try {
      // Inactive and deleted templates are passed on as "not there", so their open runs get cancelled.
      await tickStore(prisma, storeId, activeByStore.get(storeId) ?? [], now, result);
    } catch (error) {
      result.errors += 1;
      logAppError('tick.store', { storeId, ...serializeError(error) });
    }
  }

  try {
    await tickMorningDeposits(prisma, now, options, result);
  } catch (error) {
    result.errors += 1;
    logAppError('tick.deposit', serializeError(error));
  }
  logApp('tick.done', { store: options.storeId || 'all', ...result });
  return result;
}
