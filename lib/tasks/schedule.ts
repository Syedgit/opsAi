import { z } from 'zod';
import { addDaysLocal, daysBetween, localDateString, localToUtc, monthPosition, parseHHMM, weekdayOf } from './time';

/**
 * Recurrence for store tasks: which moments of a day a task is due. Pure, no database.
 */

/**
 * Inspection categories. The first group is the 7-Eleven 7Clean report's own categories (so the score here
 * lines up with the inspector's report); the rest are generic for any other store.
 */
export const TASK_CATEGORIES = [
  'food_safety',
  'proprietary_fresh',
  'proprietary_beverage',
  'product_availability',
  'interior_cleanliness',
  'exterior_cleanliness',
  'vault',
  'back_of_house',
  'cleanliness',
  'inventory',
  'equipment',
  'customer_service',
  'safety',
  'reports',
  'other',
] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<TaskCategory, string> = {
  food_safety: 'Food Safety',
  proprietary_fresh: 'Proprietary Fresh Food',
  proprietary_beverage: 'Proprietary Beverage',
  product_availability: 'Product Availability',
  interior_cleanliness: 'Interior Cleanliness',
  exterior_cleanliness: 'Exterior Cleanliness',
  vault: 'Vault',
  back_of_house: 'Back of House',
  cleanliness: 'Cleanliness',
  inventory: 'Inventory',
  equipment: 'Equipment',
  customer_service: 'Customer service',
  safety: 'Safety',
  reports: 'Daily reports',
  other: 'Other',
};

/** How serious a miss is. The default points match the 7Clean report: Critical 50, Major 20, Minor 3. */
export const CRITICALITIES = ['critical', 'major', 'minor'] as const;
export type Criticality = (typeof CRITICALITIES)[number];
export const CRITICALITY_POINTS: Record<Criticality, number> = { critical: 50, major: 20, minor: 3 };
export const CRITICALITY_LABEL: Record<Criticality, string> = { critical: 'Critical', major: 'Major', minor: 'Minor' };

/**
 * How often a task comes round:
 *  weekly   on the chosen weekdays (every day, Mon-Fri, only Monday...). The default.
 *  interval every N days, counted from a start date (every 2 days, every 14 days).
 *  monthly  on chosen days of the month; 29, 30 and 31 fall on the last day of a shorter month.
 *  once     on one calendar day (anchorDate). Used for bill/invoice payment reminders.
 */
export const FREQUENCIES = ['weekly', 'interval', 'monthly', 'once'] as const;
export type Frequency = (typeof FREQUENCIES)[number];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export const EVIDENCE_TYPES = ['photo', 'text', 'either', 'none'] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

const hhmm = z
  .string()
  .trim()
  .refine((v) => parseHHMM(v) !== null, 'use a time like 10:00')
  .transform((v) => {
    const m = parseHHMM(v) as number;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  });

/** What an owner can set for a task. Also validates what the dashboard sends. */
export const TaskTemplateInputSchema = z
  .object({
    title: z.string().trim().min(1, 'give the task a name').max(120),
    instructions: z.string().trim().max(500).nullish().transform((v) => v || null),
    category: z.enum(TASK_CATEGORIES).default('other'),
    standardId: z.string().trim().max(20).nullish().transform((v) => (v ? v.toUpperCase() : null)),
    criticality: z.enum(CRITICALITIES).nullish().transform((v) => v ?? null),
    minValue: z.number().finite().nullish().transform((v) => v ?? null),
    maxValue: z.number().finite().nullish().transform((v) => v ?? null),
    unit: z.string().trim().max(10).nullish().transform((v) => v || null),
    fallback: z.string().trim().max(300).nullish().transform((v) => v || null),
    shift: z.string().trim().max(40).nullish().transform((v) => v || null),
    startTime: hhmm,
    endTime: hhmm.nullish().transform((v) => v || null),
    repeatEveryMinutes: z.number().int().min(5).max(720).nullish().transform((v) => v ?? null),
    frequency: z.enum(FREQUENCIES).default('weekly'),
    daysOfWeek: z
      .array(z.number().int().min(0).max(6))
      .default(ALL_DAYS)
      .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
    intervalDays: z.number().int().min(2).max(90).nullish().transform((v) => v ?? null),
    monthDays: z
      .array(z.number().int().min(1).max(31))
      .max(31)
      .default([])
      .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
    /** The first day of an "every N days" cycle ("YYYY-MM-DD", store time). Left out: the day the task is created. */
    anchorDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'use a date like 2026-11-02').nullish().transform((v) => v || null),
    evidence: z.enum(EVIDENCE_TYPES).default('either'),
    /** When set, a photo sent as proof is checked by AI against this ("both milk dispensers show a date label"). */
    photoCheck: z.string().trim().max(200).nullish().transform((v) => v || null),
    // Left out: taken from the criticality (50 / 20 / 3), or 1 when there is none.
    points: z.number().int().min(0).max(100).optional(),
    remindEveryMinutes: z.number().int().min(5).max(240).default(15),
    escalateAfterMinutes: z.number().int().min(10).max(1440).nullish().transform((v) => v ?? null),
    lateAfterMinutes: z.number().int().min(5).max(720).default(60),
    active: z.boolean().default(true),
  })
  .superRefine((t, ctx) => {
    const start = parseHHMM(t.startTime);
    const end = t.endTime ? parseHHMM(t.endTime) : null;
    if (t.frequency === 'weekly' && t.daysOfWeek.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['daysOfWeek'], message: 'pick at least one day' });
    }
    if (t.frequency === 'interval' && !t.intervalDays) {
      ctx.addIssue({ code: 'custom', path: ['intervalDays'], message: 'say every how many days (2 to 90)' });
    }
    if (t.frequency === 'monthly' && t.monthDays.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['monthDays'], message: 'pick at least one day of the month' });
    }
    if (t.frequency === 'once' && !t.anchorDate) {
      ctx.addIssue({ code: 'custom', path: ['anchorDate'], message: 'pick the date this happens' });
    }
    if (t.photoCheck && t.evidence !== 'photo' && t.evidence !== 'either') {
      ctx.addIssue({ code: 'custom', path: ['photoCheck'], message: 'checking a photo needs the proof to be a photo (or photo or text)' });
    }
    if (t.repeatEveryMinutes && (end === null || start === null || end <= start)) {
      ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'a repeating task needs an end time later than the start time (same day)' });
    }
    if (t.minValue !== null && t.maxValue !== null && t.minValue > t.maxValue) {
      ctx.addIssue({ code: 'custom', path: ['minValue'], message: 'the lowest allowed answer is above the highest' });
    }
    if ((t.minValue !== null || t.maxValue !== null) && t.evidence === 'photo') {
      ctx.addIssue({ code: 'custom', path: ['evidence'], message: 'a task with a limit needs a text answer (or photo or text), not photo only' });
    }
    if ((t.minValue !== null || t.maxValue !== null) && t.evidence === 'none') {
      ctx.addIssue({ code: 'custom', path: ['evidence'], message: 'a task with a limit needs an answer, not just "done"' });
    }
  })
  .transform((t) => ({
    ...t,
    // Only a weekly task uses the weekday list; keep the others tidy.
    daysOfWeek: t.frequency === 'weekly' ? t.daysOfWeek : ALL_DAYS,
    intervalDays: t.frequency === 'interval' ? t.intervalDays : null,
    monthDays: t.frequency === 'monthly' ? t.monthDays : [],
    anchorDate: t.frequency === 'interval' || t.frequency === 'once' ? t.anchorDate : null,
    points: t.points ?? (t.criticality ? CRITICALITY_POINTS[t.criticality] : 1),
  }));
export type TaskTemplateInput = z.infer<typeof TaskTemplateInputSchema>;

/** The parts of a stored template the scheduler needs. */
export interface ScheduledTemplate {
  startTime: string;
  endTime: string | null;
  repeatEveryMinutes: number | null;
  daysOfWeek: number[];
  /** Left out or 'weekly': the weekdays. */
  frequency?: string;
  intervalDays?: number | null;
  monthDays?: number[];
  /** "YYYY-MM-DD" the "every N days" count starts from. */
  anchorDate?: string | null;
}

/** Whether the task comes due at all on that store-local day. */
export function occursOn(t: ScheduledTemplate, localDate: string): boolean {
  if (t.frequency === 'once') return t.anchorDate === localDate;
  if (t.frequency === 'interval') {
    if (!t.intervalDays || !t.anchorDate) return false;
    const gone = daysBetween(t.anchorDate, localDate);
    return gone >= 0 && gone % t.intervalDays === 0;
  }
  if (t.frequency === 'monthly') {
    const { day, daysInMonth } = monthPosition(localDate);
    return (t.monthDays ?? []).some((d) => Math.min(d, daysInMonth) === day);
  }
  return t.daysOfWeek.includes(weekdayOf(localDate));
}

const MAX_PER_DAY = 48;

/** Minutes after midnight at which the task is due on the given weekday, in order. */
export function dueMinutesOfDay(t: ScheduledTemplate, localDate: string): number[] {
  if (!occursOn(t, localDate)) return [];
  const start = parseHHMM(t.startTime);
  if (start === null) return [];
  if (!t.repeatEveryMinutes || !t.endTime) return [start];
  const end = parseHHMM(t.endTime);
  if (end === null || end <= start) return [start];
  const out: number[] = [];
  for (let m = start; m <= end && out.length < MAX_PER_DAY; m += t.repeatEveryMinutes) out.push(m);
  return out;
}

/** Every instant the task is due on that store-local day. */
export function dueInstantsOnDay(t: ScheduledTemplate, localDate: string, timeZone: string): Date[] {
  return dueMinutesOfDay(t, localDate).map((m) => localToUtc(localDate, m, timeZone));
}

/**
 * Instants the task has come due up to `now` on the store's current local day, never before
 * `notBefore` (the moment the task was created, so a task added at 3pm is not "missed" at 10am).
 */
export function dueSoFar(t: ScheduledTemplate, now: Date, timeZone: string, notBefore?: Date): Date[] {
  const today = localDateString(now, timeZone);
  return dueInstantsOnDay(t, today, timeZone).filter((d) => d.getTime() <= now.getTime() && (!notBefore || d.getTime() >= notBefore.getTime()));
}

/** Human summary like "10:00am daily", "every 60 min 7:00am-1:00pm, Mon-Fri". */
export function describeSchedule(t: ScheduledTemplate): string {
  const clock = (value: string) => {
    const m = parseHHMM(value) ?? 0;
    const h = Math.floor(m / 60);
    return `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, '0')}${h >= 12 ? 'pm' : 'am'}`;
  };
  const when = t.repeatEveryMinutes && t.endTime
    ? `every ${t.repeatEveryMinutes} min ${clock(t.startTime)}-${clock(t.endTime)}`
    : clock(t.startTime);
  if (t.frequency === 'interval' && t.intervalDays) {
    const n = t.intervalDays;
    return `${when}, ${n === 7 ? 'every week' : n % 7 === 0 ? `every ${n / 7} weeks` : `every ${n} days`}`;
  }
  if (t.frequency === 'once') {
    return t.anchorDate ? `${when}, once on ${t.anchorDate}` : `${when}, once`;
  }
  if (t.frequency === 'monthly') {
    const ordinal = (d: number) => (d === 31 ? 'the last day' : `the ${d}${d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th'}`);
    const list = [...(t.monthDays ?? [])].sort((a, b) => a - b).map(ordinal);
    return `${when}, monthly on ${list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0] ?? '?'}`;
  }
  const days = [...t.daysOfWeek].sort((a, b) => a - b);
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let dayText: string;
  if (days.length === 7) dayText = 'daily';
  else if (days.join() === '1,2,3,4,5') dayText = 'Mon-Fri';
  else if (days.join() === '0,6') dayText = 'weekends';
  else dayText = days.map((d) => names[d]).join(', ');
  return `${when}, ${dayText}`;
}

export { addDaysLocal };
