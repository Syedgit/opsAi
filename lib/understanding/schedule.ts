import type { Check } from './checks';
import type { EmployeeSchedule, Shift, WorkSchedule } from './schema';

/**
 * Hours worked per employee from a staff schedule. Pure: no database, no AI.
 *
 * Privacy: this module only ever deals in hours. There is no pay rate anywhere in the data and
 * nothing here calculates pay.
 */

export const DEFAULT_HOURS_LIMIT = 40;
const LONG_SHIFT_MINUTES = 16 * 60;
const STATED_TOLERANCE_HOURS = 0.25;

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "17:00", "5pm", "5:30 PM", "9a" -> minutes after midnight. Null when it cannot be read. */
export function parseClock(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.trim().toLowerCase().replace(/\./g, '').match(/^(\d{1,2})(?::(\d{2}))?\s*(a|p|am|pm)?$/);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3];
  if (minutes > 59) return null;
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem.startsWith('p') && hours < 12) hours += 12;
    if (meridiem.startsWith('a') && hours === 12) hours = 0;
  } else if (hours > 23 || !match[2]) {
    // A bare "9" or "17" is ambiguous; "9:00" or "17:00" is a time.
    return null;
  }
  return hours * 60 + minutes;
}

export function formatClock(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const suffix = h24 >= 12 ? 'p' : 'a';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, '0')}${suffix}`;
}

function minutesToHHMM(minutes: number): string {
  const wrapped = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Bare "9" or "17": morning start 7–11 is AM, 1–6 is PM; an end time 1–11 is PM. */
function parseBareHour(raw: string, role: 'start' | 'end'): number | null {
  if (!/^\d{1,2}$/.test(raw)) return null;
  const n = Number(raw);
  if (n > 23) return null;
  if (n > 12) return n * 60;
  if (role === 'start') {
    if (n >= 1 && n <= 6) return (n + 12) * 60;
    if (n === 12) return 12 * 60;
    return n * 60;
  }
  if (n === 12) return 12 * 60;
  return (n + 12) * 60;
}

/**
 * One cell of a roster: "9-5", "9a-5p", "2-10", "09:00-17:00". Empty / off is null.
 * Does not invent overnight times when both sides are missing.
 */
export function parseShiftRange(value: string | null | undefined): { start: string; end: string } | null {
  const text = (value ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!text || text === 'off' || text === '-' || text === 'x') return null;
  const match = text.match(/^(.+?)(?:-|–|to)(.+)$/);
  if (!match) return null;
  const startMins = parseClock(match[1]) ?? parseBareHour(match[1], 'start');
  const endMins = parseClock(match[2]) ?? parseBareHour(match[2], 'end');
  if (startMins == null || endMins == null) return null;
  return { start: minutesToHHMM(startMins), end: minutesToHHMM(endMins) };
}

export function formatShiftRange(start: string | null | undefined, end: string | null | undefined): string {
  const startMins = parseClock(start ?? '');
  const endMins = parseClock(end ?? '');
  if (startMins == null || endMins == null) return '';
  return `${formatClock(startMins)}–${formatClock(endMins)}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatHours(hours: number): string {
  const rounded = round2(hours);
  return `${Number.isInteger(rounded) ? rounded : rounded.toString()}h`;
}

/** Weekday index (0 = Sunday) for "Mon", "monday", "TUES"; null when it is not a weekday. */
function weekdayIndex(day: string | null | undefined): number | null {
  if (!day) return null;
  const key = day.trim().toLowerCase().slice(0, 3);
  const index = WEEKDAYS.indexOf(key);
  return index >= 0 ? index : null;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * First day of the schedule week containing `isoDate`.
 * 0 = Sunday (dashboard default). 5 = Friday (7-Eleven printed Shift Schedule).
 */
export function scheduleWeekStartOf(isoDate: string, weekStartsOn = 0): string {
  const startIndex = ((weekStartsOn % 7) + 7) % 7;
  const dayIndex = new Date(`${isoDate}T12:00:00Z`).getUTCDay();
  return addDays(isoDate, -((dayIndex - startIndex + 7) % 7));
}

export function weekContainsDate(weekStart: string, isoDate: string): boolean {
  return isoDate >= weekStart && isoDate <= addDays(weekStart, 6);
}

/** The shift's calendar date: the printed date, else the first matching weekday on or after the week start. */
export function resolveShiftDate(shift: Pick<Shift, 'date' | 'day'>, weekStart: string | null): string | null {
  if (shift.date) return shift.date;
  const wanted = weekdayIndex(shift.day);
  if (wanted == null || !weekStart) return null;
  const startIndex = new Date(`${weekStart}T12:00:00Z`).getUTCDay();
  return addDays(weekStart, (wanted - startIndex + 7) % 7);
}

function dayLabel(date: string | null, fallback: string | null): string {
  if (date) return WEEKDAY_LABELS[new Date(`${date}T12:00:00Z`).getUTCDay()];
  const index = weekdayIndex(fallback);
  return index != null ? WEEKDAY_LABELS[index] : 'day not shown';
}

export interface WorkedShift {
  date: string | null;
  day: string;
  start: string;
  end: string;
  minutes: number;
  overnight: boolean;
}

export interface EmployeeHours {
  name: string;
  shifts: WorkedShift[];
  /** From the shifts, before any manual adjustment. */
  computedHours: number;
  /** What is reported: the manager's adjustment when there is one, else the computed hours. */
  hours: number;
  adjusted: boolean;
}

export interface ScheduleSummary {
  weekStart: string | null;
  employees: EmployeeHours[];
  totalHours: number;
  checks: Check[];
}

interface RawShift {
  startMin: number;
  endMin: number;
  date: string | null;
}

export function summarizeSchedule(schedule: WorkSchedule, options: { hoursLimit?: number } = {}): ScheduleSummary {
  const limit = options.hoursLimit ?? DEFAULT_HOURS_LIMIT;
  const checks: Check[] = [];
  const unclear: string[] = [];
  const zero: string[] = [];
  const long: string[] = [];
  const overlapping: string[] = [];
  let anyDated = false;

  // The same person listed twice on a sheet is one person.
  const merged = new Map<string, EmployeeSchedule>();
  for (const employee of schedule.employees) {
    const name = employee.name.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const existing = merged.get(key);
    if (existing) {
      existing.shifts = [...existing.shifts, ...employee.shifts];
      existing.statedTotalHours = existing.statedTotalHours ?? employee.statedTotalHours;
      existing.adjustedHours = existing.adjustedHours ?? employee.adjustedHours;
    } else {
      merged.set(key, { ...employee, name, shifts: [...employee.shifts] });
    }
  }

  const employees: EmployeeHours[] = [];
  for (const employee of merged.values()) {
    const worked: WorkedShift[] = [];
    const raw: RawShift[] = [];

    for (const shift of employee.shifts) {
      const date = resolveShiftDate(shift, schedule.weekStart);
      const label = dayLabel(date, shift.day);
      const startMin = parseClock(shift.start);
      const endMin = parseClock(shift.end);
      if (startMin == null || endMin == null) {
        unclear.push(`${employee.name} ${label}`);
        continue;
      }
      if (startMin === endMin) {
        zero.push(`${employee.name} ${label}`);
        continue;
      }
      const overnight = endMin < startMin;
      const gross = overnight ? endMin + 24 * 60 - startMin : endMin - startMin;
      const minutes = Math.max(0, gross - (shift.breakMinutes ?? 0));
      if (gross > LONG_SHIFT_MINUTES) long.push(`${employee.name} ${label} (${formatHours(gross / 60)})`);
      if (date) anyDated = true;
      raw.push({ startMin, endMin: overnight ? endMin + 24 * 60 : endMin, date });
      worked.push({ date, day: label, start: formatClock(startMin), end: formatClock(endMin), minutes, overnight });
    }

    // Two shifts for one person that overlap on the same day are almost always a misread.
    const byDate = new Map<string, RawShift[]>();
    for (const r of raw) {
      if (!r.date) continue;
      byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]);
    }
    for (const [date, list] of byDate) {
      const sorted = [...list].sort((a, b) => a.startMin - b.startMin);
      for (let i = 1; i < sorted.length; i += 1) {
        if (sorted[i].startMin < sorted[i - 1].endMin) {
          overlapping.push(`${employee.name} ${dayLabel(date, null)}`);
          break;
        }
      }
    }

    const computedHours = round2(worked.reduce((sum, w) => sum + w.minutes, 0) / 60);
    const adjusted = employee.adjustedHours != null;
    const hours = adjusted ? round2(employee.adjustedHours as number) : computedHours;
    employees.push({ name: employee.name, shifts: worked, computedHours, hours, adjusted });

    if (employee.statedTotalHours != null && !adjusted) {
      const diff = Math.abs(employee.statedTotalHours - computedHours);
      if (diff > STATED_TOLERANCE_HOURS) {
        checks.push({
          id: `stated_hours_${employee.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
          status: 'warn',
          message: `${employee.name}: the sheet says ${formatHours(employee.statedTotalHours)} but the shifts add up to ${formatHours(computedHours)}.`,
          expected: employee.statedTotalHours,
          actual: computedHours,
          difference: round2(computedHours - employee.statedTotalHours),
        });
      }
    }
  }

  const totalHours = round2(employees.reduce((sum, e) => sum + e.hours, 0));
  const counted = employees.some((e) => e.shifts.length > 0 || e.adjusted);

  if (!counted) {
    checks.unshift({ id: 'schedule_empty', status: 'fail', message: 'I could not read any shift times from that sheet.' });
  }
  if (unclear.length > 0) {
    checks.push({
      id: 'shift_unclear',
      status: 'warn',
      message: `Left out because the start or end time was not readable: ${unclear.join(', ')}.`,
    });
  }
  if (zero.length > 0) {
    checks.push({ id: 'shift_zero', status: 'warn', message: `Start and end are the same time (counted as 0h): ${zero.join(', ')}.` });
  }
  if (long.length > 0) {
    checks.push({ id: 'shift_long', status: 'warn', message: `Very long shift, please check: ${long.join(', ')}.` });
  }
  if (overlapping.length > 0) {
    checks.push({ id: 'shift_overlap', status: 'warn', message: `Two shifts overlap for: ${overlapping.join(', ')}.` });
  }
  const over = employees.filter((e) => e.hours > limit);
  if (over.length > 0) {
    checks.push({
      id: 'hours_over_limit',
      status: 'warn',
      message: `Over ${limit}h this week: ${over.map((e) => `${e.name} ${formatHours(e.hours)}`).join(', ')}.`,
    });
  }
  if (counted && !schedule.weekStart && !anyDated) {
    checks.push({ id: 'schedule_week_missing', status: 'warn', message: 'I could not find which week this covers. Hours are counted, but the dates are blank.' });
  }

  return { weekStart: schedule.weekStart, employees, totalHours, checks };
}

/** "Maria 32h" lines, one per employee (adjusted totals are marked). */
export function hoursLines(summary: ScheduleSummary): string[] {
  return summary.employees.map((e) => `${e.name} ${formatHours(e.hours)}${e.adjusted ? ' (adjusted)' : ''}`);
}

function weekDayOrder(weekStart: string | null): string[] {
  const startIndex = weekStart ? new Date(`${weekStart}T12:00:00Z`).getUTCDay() : 0;
  if (Number.isNaN(startIndex)) return [...WEEKDAY_LABELS];
  return Array.from({ length: 7 }, (_, i) => WEEKDAY_LABELS[(startIndex + i) % 7]);
}

function shiftCell(shift: WorkedShift): string {
  return `${shift.start}–${shift.end}`;
}

function wrapJoin(parts: string[], size: number): string[] {
  const lines: string[] = [];
  for (let i = 0; i < parts.length; i += size) {
    lines.push(parts.slice(i, i + size).join(' · '));
  }
  return lines;
}

/**
 * The roster the group needs: each person, the days they work, and their hours.
 * Off days are left off so the message stays short. Hours only — never pay.
 */
export function sheetLines(summary: ScheduleSummary): string[] {
  const order = weekDayOrder(summary.weekStart);
  const rank = new Map(order.map((day, i) => [day, i]));
  const lines: string[] = [];
  for (const employee of summary.employees) {
    if (lines.length > 0) lines.push('');
    lines.push(employee.name);
    const byDay = new Map<string, string[]>();
    for (const shift of employee.shifts) {
      byDay.set(shift.day, [...(byDay.get(shift.day) ?? []), shiftCell(shift)]);
    }
    const roster = [...byDay.entries()]
      .sort((a, b) => (rank.get(a[0]) ?? 99) - (rank.get(b[0]) ?? 99))
      .map(([day, cells]) => `${day} ${cells.join(' & ')}`);
    if (roster.length > 0) lines.push(...wrapJoin(roster, 4));
    lines.push(`${formatHours(employee.hours)}${employee.adjusted ? ' (adjusted)' : ''}`);
  }
  return lines;
}
