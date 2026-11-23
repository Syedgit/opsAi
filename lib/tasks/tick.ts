import type { PrismaClient } from '@prisma/client';
import {
  managerPhonesForStore,
  postToStoreGroups,
  sendWelcomeTemplate,
  sendWhatsAppMessage,
} from '../whatsappMessaging';
import { maybeMorningDepositText } from '../understanding/depositDue';
import { releaseAwaitingCloses } from '../understanding/awaitingText';
import { maybeThursdayHoursText } from '../understanding/hoursDigest';
import { alertMessage, reminderMessage, type MessageRun } from './messages';
import { dueSoFar } from './schedule';
import { localDateString } from './time';
import { logApp, logAppError, maskPhone, serializeError } from '../requestLog';
import { taskAlertsEnabled } from '../notify/channels';
import {
  adminDailySummaryMessageId,
  adminSummaryWindow,
  adminWeeklySummaryMessageId,
  filterRunsForCadence,
  formatAdminTaskSummary,
  shouldSendDailyAdminSummary,
  shouldSendWeeklyAdminSummary,
  weekDatesInclusive,
  type SummaryRun,
  type SummaryTemplate,
} from './adminSummary';

/**
 * The heartbeat of the task system. Called every few minutes by a scheduler (see README).
 * Each call, for every store with active tasks:
 *   1. creates a run for each task that has come due,
 *   2. closes runs that were replaced by a newer one (or are over a day old),
 *   3. announces newly due tasks and reminds staff about open ones,
 *   4. sends brief daily / weekly summaries to owners (not per-task escalations).
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
  hoursDigests: number;
  dailySummaries: number;
  weeklySummaries: number;
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

/** Why WhatsApp task alerts may not land — used by Send alerts / test alert UI. */
export async function diagnoseTaskAlertDelivery(
  prisma: PrismaClient,
  storeId: string
): Promise<{
  alertsEnabled: boolean;
  groupCount: number;
  staffCount: number;
  managerCount: number;
  fallbackManagerCount: number;
  /** True when this business has no local People row but an owner phone from another of your businesses will get DMs. */
  usingLinkedOwnerPhone: boolean;
  linkedOwnerPhoneMasked: string | null;
  canDeliver: boolean;
  hint: string;
}> {
  const store = await prisma.storeConfig.findUnique({
    where: { storeId },
    select: { profileJson: true },
  });
  const alertsEnabled = store ? taskAlertsEnabled(store.profileJson) : false;
  const groups = await prisma.storeWhatsAppGroup.count({ where: { storeId, active: true } });
  const members = await prisma.userDirectory.findMany({
    where: { storeId, isActive: true },
    select: { role: true, phoneE164: true },
  });
  const staffCount = members.filter((m) => m.role === 'STAFF').length;
  const managerCount = members.filter((m) => m.role === 'OWNER' || m.role === 'MANAGER').length;
  const fallback = await managerPhonesForStore(prisma, storeId);
  const localPhones = new Set(members.map((m) => m.phoneE164));
  const linkedOnly = fallback.filter((p) => !localPhones.has(p));
  const usingLinkedOwnerPhone = members.length === 0 && linkedOnly.length > 0;
  const linkedOwnerPhoneMasked = usingLinkedOwnerPhone ? maskPhone(linkedOnly[0]) ?? null : null;
  const canDeliver = groups > 0 || staffCount > 0 || managerCount > 0 || fallback.length > 0;
  let hint = '';
  if (!alertsEnabled) {
    hint = 'WhatsApp task alerts are off for this business. Turn them on under Setup → Tasks.';
  } else if (!canDeliver) {
    hint =
      'No WhatsApp group or people on this business. Add staff (or an owner/manager phone) under People, or link a store WhatsApp group — then tap Send alerts again.';
  } else if (usingLinkedOwnerPhone) {
    hint =
      `Your owner WhatsApp (${linkedOwnerPhoneMasked || 'linked number'}) is on another business you own — task alerts for this one still DM that number. Add staff under People so the shift gets them too.`;
  } else if (groups === 0 && staffCount === 0) {
    hint =
      'No staff listing and no group — alerts will DM the owner/manager phone. Add staff under People so the shift gets them.';
  } else {
    hint = 'Delivery path looks ready. If nothing arrives, the person may need to message opsAi first (24-hour WhatsApp window), or reply to a welcome template.';
  }
  return {
    alertsEnabled,
    groupCount: groups,
    staffCount,
    managerCount,
    fallbackManagerCount: fallback.length,
    usingLinkedOwnerPhone,
    linkedOwnerPhoneMasked,
    canDeliver,
    hint,
  };
}

/** Phones we would DM for a store alert (staff first, else owners/managers, else fallback). */
async function alertDmPhones(prisma: PrismaClient, storeId: string): Promise<string[]> {
  const members = await prisma.userDirectory.findMany({ where: { storeId, isActive: true } });
  const staff = members.filter((m) => m.role === 'STAFF');
  const bosses = members.filter((m) => m.role === 'OWNER' || m.role === 'MANAGER');
  const targets = staff.length > 0 ? staff : bosses.length > 0 ? bosses : members;
  const phones = [...new Set(targets.map((m) => m.phoneE164))];
  if (phones.length > 0) return phones;
  return managerPhonesForStore(prisma, storeId);
}

/** One-off WhatsApp ping so owners can verify delivery without waiting for a due task. */
export async function sendTaskAlertTest(
  prisma: PrismaClient,
  storeId: string
): Promise<{
  sent: number;
  welcomed: number;
  delivery: Awaited<ReturnType<typeof diagnoseTaskAlertDelivery>>;
}> {
  const delivery = await diagnoseTaskAlertDelivery(prisma, storeId);
  if (!delivery.alertsEnabled || !delivery.canDeliver) {
    return { sent: 0, welcomed: 0, delivery };
  }
  const store = await prisma.storeConfig.findUnique({
    where: { storeId },
    select: { storeName: true },
  });
  const storeName = store?.storeName || storeId;
  const text = [
    `✅ ${storeName} · opsAi test alert`,
    'Task reminders are connected for this business.',
    'When a shift task is due, staff get a WhatsApp message like this. Reply with the task number and proof (photo or “1 done”).',
  ].join('\n');
  let sent = await deliverToStore(prisma, storeId, text);
  let welcomed = 0;
  let hint = delivery.hint;
  // Free-form fails outside Meta's 24h window — nudge with the approved welcome template instead.
  if (sent === 0 && delivery.groupCount === 0) {
    for (const phone of await alertDmPhones(prisma, storeId)) {
      if (await sendWelcomeTemplate(prisma, phone, { storeId, storeName })) welcomed += 1;
    }
    hint =
      welcomed > 0
        ? 'Free-form test could not deliver (WhatsApp 24-hour window). Sent a welcome template instead — reply OK on WhatsApp, then tap Test WhatsApp again.'
        : 'Could not reach WhatsApp (token, phone id, or Meta window). Confirm the number is correct and that person has messaged opsAi recently.';
  }
  return { sent, welcomed, delivery: { ...delivery, hint } };
}

/**
 * Group first (the shift sees it together). Otherwise DM store staff.
 * Owners/managers are not CC'd on every due/remind — they get brief daily/weekly summaries.
 * If there is no staff listing, fall back to owners/managers, then manager phones.
 */
export async function deliverToStore(prisma: PrismaClient, storeId: string, text: string): Promise<number> {
  const posted = await postToStoreGroups(prisma, storeId, text);
  if (posted > 0) return posted;

  const members = await prisma.userDirectory.findMany({ where: { storeId, isActive: true } });
  const staff = members.filter((member) => member.role === 'STAFF');
  const bosses = members.filter((member) => member.role === 'OWNER' || member.role === 'MANAGER');
  const targets = staff.length > 0 ? staff : bosses.length > 0 ? bosses : members;
  const seen = new Set<string>();
  let sent = 0;
  for (const member of targets) {
    if (seen.has(member.phoneE164)) continue;
    seen.add(member.phoneE164);
    if (await sendWhatsAppMessage(prisma, member.phoneE164, text, storeId)) sent += 1;
  }
  if (sent > 0) return sent;
  const fallback = await managerPhonesForStore(prisma, storeId);
  for (const phone of fallback) {
    if (seen.has(phone)) continue;
    seen.add(phone);
    if (await sendWhatsAppMessage(prisma, phone, text, storeId)) sent += 1;
  }
  return sent;
}

/** Owners and managers of the store, by private message (includes owner phone linked from another business you own). */
export async function notifyManagers(prisma: PrismaClient, storeId: string, text: string): Promise<number> {
  const members = await prisma.userDirectory.findMany({ where: { storeId, isActive: true } });
  const seen = new Set<string>();
  let sent = 0;
  for (const member of members) {
    if (member.role !== 'OWNER' && member.role !== 'MANAGER') continue;
    if (seen.has(member.phoneE164)) continue;
    seen.add(member.phoneE164);
    if (await sendWhatsAppMessage(prisma, member.phoneE164, text, storeId)) sent += 1;
  }
  if (sent > 0) return sent;
  for (const phone of await managerPhonesForStore(prisma, storeId)) {
    if (seen.has(phone)) continue;
    seen.add(phone);
    if (await sendWhatsAppMessage(prisma, phone, text, storeId)) sent += 1;
  }
  return sent;
}

function smallestFreeCode(used: Set<number>): number {
  let code = 1;
  while (used.has(code)) code += 1;
  return code;
}

async function tickStore(prisma: PrismaClient, storeId: string, templates: TemplateRow[], now: Date, result: TickResult): Promise<void> {
  const store = await prisma.storeConfig.findUnique({
    where: { storeId },
    select: { storeName: true, timezone: true, active: true, profileJson: true },
  });
  if (!store || store.active === false) return;
  const timeZone = store.timezone || 'America/New_York';
  const today = localDateString(now, timeZone);
  const byId = new Map(templates.map((t) => [t.id, t]));
  // When alerts are off we still advance run state so turning them back on does not dump a backlog.
  const alertsOn = taskAlertsEnabled(store.profileJson);

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

  // 3a. Announce what just came due, in one message (or quietly mark alerted when muted).
  const fresh = live.filter((r) => !r.alertedAt);
  if (fresh.length > 0) {
    const text = alertMessage(store.storeName, fresh.map((r) => toMessageRun(r, byId.get(r.templateId)?.instructions)), timeZone);
    const ok = alertsOn ? (await deliverToStore(prisma, storeId, text)) > 0 : true;
    if (ok) {
      await prisma.taskRun.updateMany({ where: { id: { in: fresh.map((r) => r.id) } }, data: { alertedAt: now } });
      fresh.forEach((r) => (r.alertedAt = now));
      if (alertsOn) result.alerted += fresh.length;
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
    const ok = alertsOn ? (await deliverToStore(prisma, storeId, text)) > 0 : true;
    if (ok) {
      for (const r of nag) {
        await prisma.taskRun.update({ where: { id: r.id }, data: { lastReminderAt: now, reminderCount: r.reminderCount + 1 } });
      }
      if (alertsOn) result.reminded += nag.length;
    }
  }

  // 4. Mark overdue runs as escalated for the board, but do not WhatsApp the owner —
  // they get a brief daily / weekly summary instead (see tickAdminSummaries).
  const stale = live.filter((r) => {
    if (r.escalatedAt || !r.alertedAt) return false;
    const minutes = byId.get(r.templateId)?.escalateAfterMinutes ?? DEFAULT_ESCALATE_MINUTES;
    return now.getTime() - r.dueAt.getTime() >= minutes * 60000;
  });
  if (stale.length > 0) {
    await prisma.taskRun.updateMany({ where: { id: { in: stale.map((r) => r.id) } }, data: { escalatedAt: now } });
    result.escalated += stale.length;
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
      await releaseAwaitingCloses(prisma, store, now);
    } catch (error) {
      result.errors += 1;
      logAppError('tick.awaiting_text', { storeId: store.storeId, ...serializeError(error) });
    }
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

async function tickThursdayHours(
  prisma: PrismaClient,
  now: Date,
  options: { storeId?: string },
  result: TickResult
): Promise<void> {
  const stores = await prisma.storeConfig.findMany({
    where: { active: true, ...(options.storeId ? { storeId: options.storeId } : {}) },
    select: { storeId: true, storeName: true, timezone: true, active: true },
  });
  for (const store of stores) {
    try {
      const due = await maybeThursdayHoursText(prisma, store, now);
      if (!due) continue;
      if ((await notifyManagers(prisma, store.storeId, due.text)) === 0) continue;
      try {
        await prisma.messageLog.create({
          data: {
            messageId: due.messageId,
            phoneE164: 'opsai',
            storeId: store.storeId,
            messageType: 'hours_digest',
            messageText: due.text,
            processed: true,
          },
        });
      } catch (error) {
        if ((error as { code?: string }).code !== 'P2002') throw error;
      }
      result.hoursDigests += 1;
    } catch (error) {
      result.errors += 1;
      logAppError('tick.hours', { storeId: store.storeId, ...serializeError(error) });
    }
  }
}

async function tickAdminSummaries(
  prisma: PrismaClient,
  now: Date,
  options: { storeId?: string },
  result: TickResult
): Promise<void> {
  const stores = await prisma.storeConfig.findMany({
    where: { active: true, ...(options.storeId ? { storeId: options.storeId } : {}) },
    select: { storeId: true, storeName: true, timezone: true, profileJson: true, active: true },
  });
  for (const store of stores) {
    try {
      if (!taskAlertsEnabled(store.profileJson)) continue;
      const timeZone = store.timezone?.trim() || 'America/New_York';
      const { today, nowMinutes, weekStart } = adminSummaryWindow(now, timeZone);
      const templates = (await prisma.taskTemplate.findMany({
        where: { storeId: store.storeId, active: true },
        select: { id: true, frequency: true, daysOfWeek: true },
      })) as SummaryTemplate[];
      if (templates.length === 0) continue;

      const sendIfDue = async (
        cadence: 'daily' | 'weekly',
        messageId: string,
        dates: Set<string>,
        label: string
      ) => {
        const already = await prisma.messageLog.findUnique({ where: { messageId }, select: { messageId: true } });
        if (already) return;
        const dateList = [...dates];
        const runs = (await prisma.taskRun.findMany({
          where: { storeId: store.storeId, localDate: { in: dateList } },
          select: { title: true, status: true, localDate: true, templateId: true },
          take: 2000,
        })) as SummaryRun[];
        const scoped = filterRunsForCadence(runs, templates, cadence, dates);
        const text = formatAdminTaskSummary({ storeName: store.storeName, cadence, label, runs: scoped });
        if (!text) return;
        if ((await notifyManagers(prisma, store.storeId, text)) === 0) return;
        try {
          await prisma.messageLog.create({
            data: {
              messageId,
              phoneE164: 'opsai',
              storeId: store.storeId,
              messageType: cadence === 'daily' ? 'task_summary_daily' : 'task_summary_weekly',
              messageText: text,
              processed: true,
            },
          });
        } catch (error) {
          if ((error as { code?: string }).code !== 'P2002') throw error;
        }
        if (cadence === 'daily') result.dailySummaries += 1;
        else result.weeklySummaries += 1;
      };

      if (shouldSendDailyAdminSummary(today, nowMinutes)) {
        await sendIfDue('daily', adminDailySummaryMessageId(store.storeId, today), new Set([today]), today);
      }
      if (shouldSendWeeklyAdminSummary(today, nowMinutes)) {
        await sendIfDue(
          'weekly',
          adminWeeklySummaryMessageId(store.storeId, weekStart),
          weekDatesInclusive(weekStart, today),
          `week of ${weekStart}`
        );
      }
    } catch (error) {
      result.errors += 1;
      logAppError('tick.admin_summary', { storeId: store.storeId, ...serializeError(error) });
    }
  }
}

export async function runTaskTick(prisma: PrismaClient, now: Date = new Date(), options: { storeId?: string } = {}): Promise<TickResult> {
  const result: TickResult = {
    stores: 0,
    created: 0,
    alerted: 0,
    reminded: 0,
    escalated: 0,
    closed: 0,
    errors: 0,
    depositNudges: 0,
    hoursDigests: 0,
    dailySummaries: 0,
    weeklySummaries: 0,
  };

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
  try {
    await tickThursdayHours(prisma, now, options, result);
  } catch (error) {
    result.errors += 1;
    logAppError('tick.hours', serializeError(error));
  }
  try {
    await tickAdminSummaries(prisma, now, options, result);
  } catch (error) {
    result.errors += 1;
    logAppError('tick.admin_summary', serializeError(error));
  }
  logApp('tick.done', { store: options.storeId || 'all', ...result });
  return result;
}
