/**
 * Brief admin rollups: daily tasks → daily summary, weekly (and rarer) → weekly summary.
 * Staff still get due/remind WhatsApps; owners get these digests instead of per-task escalations.
 */

import { sundayOf } from '../understanding/hoursDigest';
import { localDateString, localMinutesOfDay, weekdayOf } from './time';

/** First send window: 8pm store time (end of shift). */
export const ADMIN_SUMMARY_AFTER_MINUTES = 20 * 60;
const SUNDAY = 0;
const MAX_TITLES = 5;

export type SummaryCadence = 'daily' | 'weekly';

export type SummaryRun = {
  title: string;
  status: string;
  localDate: string;
  templateId: string;
};

export type SummaryTemplate = {
  id: string;
  frequency: string;
  daysOfWeek: number[];
};

/** Daily = every day of the week. Everything else rolls into the weekly admin brief. */
export function templateCadence(t: SummaryTemplate): SummaryCadence {
  if (t.frequency === 'monthly' || t.frequency === 'interval' || t.frequency === 'once') return 'weekly';
  const days = Array.isArray(t.daysOfWeek) ? t.daysOfWeek.length : 7;
  return days >= 7 ? 'daily' : 'weekly';
}

export function adminDailySummaryMessageId(storeId: string, day: string): string {
  return `task-summary:daily:${storeId}:${day}`;
}

export function adminWeeklySummaryMessageId(storeId: string, weekStart: string): string {
  return `task-summary:weekly:${storeId}:${weekStart}`;
}

export function shouldSendDailyAdminSummary(_today: string, nowMinutes: number): boolean {
  return nowMinutes >= ADMIN_SUMMARY_AFTER_MINUTES;
}

export function shouldSendWeeklyAdminSummary(today: string, nowMinutes: number): boolean {
  return weekdayOf(today) === SUNDAY && nowMinutes >= ADMIN_SUMMARY_AFTER_MINUTES;
}

function tally(runs: SummaryRun[]): { done: number; open: number; missed: number; openTitles: string[]; missedTitles: string[] } {
  let done = 0;
  let open = 0;
  let missed = 0;
  const openTitles: string[] = [];
  const missedTitles: string[] = [];
  for (const r of runs) {
    if (r.status === 'DONE') done += 1;
    else if (r.status === 'OPEN') {
      open += 1;
      if (openTitles.length < MAX_TITLES) openTitles.push(r.title);
    } else if (r.status === 'MISSED') {
      missed += 1;
      if (missedTitles.length < MAX_TITLES) missedTitles.push(r.title);
    }
  }
  return { done, open, missed, openTitles, missedTitles };
}

function shortList(label: string, titles: string[]): string | null {
  if (!titles.length) return null;
  return `${label}: ${titles.join(', ')}`;
}

/** Pure brief WhatsApp text for owners/managers. */
export function formatAdminTaskSummary(input: {
  storeName: string;
  cadence: SummaryCadence;
  label: string;
  runs: SummaryRun[];
}): string | null {
  if (runsEmpty(input.runs)) return null;
  const { done, open, missed, openTitles, missedTitles } = tally(input.runs);
  const lines = [
    `${input.storeName} · ${input.cadence === 'daily' ? 'daily' : 'weekly'} tasks · ${input.label}`,
    `${done} done · ${open} open · ${missed} missed`,
  ];
  const openLine = shortList('Open', openTitles);
  const missedLine = shortList('Missed', missedTitles);
  if (openLine) lines.push(openLine);
  if (missedLine) lines.push(missedLine);
  return lines.join('\n');
}

function runsEmpty(runs: SummaryRun[]): boolean {
  return runs.every((r) => r.status === 'CANCELLED') || runs.length === 0;
}

export function filterRunsForCadence(
  runs: SummaryRun[],
  templates: SummaryTemplate[],
  cadence: SummaryCadence,
  localDates: Set<string>
): SummaryRun[] {
  const byId = new Map(templates.map((t) => [t.id, t]));
  return runs.filter((r) => {
    if (!localDates.has(r.localDate)) return false;
    if (r.status === 'CANCELLED') return false;
    const t = byId.get(r.templateId);
    if (!t) return false;
    return templateCadence(t) === cadence;
  });
}

export function weekDatesInclusive(weekStart: string, weekEnd: string): Set<string> {
  const out = new Set<string>();
  const start = new Date(`${weekStart}T12:00:00Z`);
  const end = new Date(`${weekEnd}T12:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return out;
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.add(d.toISOString().slice(0, 10));
  }
  return out;
}

export function adminSummaryWindow(now: Date, timeZone: string): {
  today: string;
  nowMinutes: number;
  weekStart: string;
} {
  const today = localDateString(now, timeZone);
  return {
    today,
    nowMinutes: localMinutesOfDay(now, timeZone),
    weekStart: sundayOf(today),
  };
}
