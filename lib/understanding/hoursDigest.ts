/**
 * Thursday 1:1 hours note for owners and managers. Hours only — never pay.
 * Uses the existing task tick (no extra Vercel cron).
 */
import type { PrismaClient } from '@prisma/client';
import { ClassificationType, PendingStatus } from '@prisma/client';
import { localDateString, localMinutesOfDay, weekdayOf } from '../tasks/time';
import { formatHours, hoursLines, scheduleWeekStartOf, summarizeSchedule, weekContainsDate } from './schedule';
import { WorkScheduleSchema, type WorkSchedule } from './schema';

const NOT_BEFORE_MINUTES = 9 * 60;
const THURSDAY = 4;

export function hoursDigestMessageId(storeId: string, day: string): string {
  return `hours-digest:${storeId}:${day}`;
}

export function sundayOf(isoDate: string): string {
  return scheduleWeekStartOf(isoDate, 0);
}

export function shouldSendHoursDigest(today: string, nowMinutes: number): boolean {
  return weekdayOf(today) === THURSDAY && nowMinutes >= NOT_BEFORE_MINUTES;
}

function weekLabel(weekStart: string | null): string {
  if (!weekStart) return 'this week';
  const parsed = new Date(`${weekStart}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return 'this week';
  return `week of ${parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
}

export function hoursDigestText(storeName: string, schedule: WorkSchedule): string {
  const summary = summarizeSchedule(schedule);
  return [
    `📅 ${storeName} · hours ${weekLabel(summary.weekStart)}`,
    ...hoursLines(summary),
    `Total ${formatHours(summary.totalHours)}`,
    '',
    'From the posted sheet. Hours only.',
  ].join('\n');
}

export async function maybeThursdayHoursText(
  prisma: PrismaClient,
  store: { storeId: string; storeName: string; timezone?: string | null; active?: boolean },
  now: Date
): Promise<{ messageId: string; text: string } | null> {
  if (store.active === false) return null;
  const timeZone = store.timezone?.trim() || 'America/New_York';
  const today = localDateString(now, timeZone);
  if (!shouldSendHoursDigest(today, localMinutesOfDay(now, timeZone))) return null;
  const messageId = hoursDigestMessageId(store.storeId, today);
  const already = await prisma.messageLog.findUnique({ where: { messageId }, select: { messageId: true } });
  if (already) return null;

  const rows = await prisma.pendingActions.findMany({
    where: { storeId: store.storeId, type: ClassificationType.UNKNOWN, status: PendingStatus.CONFIRMED },
    orderBy: { createdAt: 'desc' },
    take: 80,
  });
  const match = rows.find((row) => {
    const data = row.payloadJson as { _kind?: string; week_start?: string; schedule?: unknown } | null;
    return data?._kind === 'work_schedule' && typeof data.week_start === 'string' && weekContainsDate(data.week_start, today);
  });
  if (!match) return null;
  const parsed = WorkScheduleSchema.safeParse((match.payloadJson as { schedule?: unknown }).schedule);
  if (!parsed.success) return null;
  return { messageId, text: hoursDigestText(store.storeName, parsed.data) };
}
