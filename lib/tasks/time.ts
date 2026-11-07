/**
 * Store-local time helpers built on Intl (no extra dependency). A store's tasks are written in its
 * own clock ("coffee check at 10:00"), so everything is converted through the store's time zone.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsOf(date: Date, timeZone: string): Parts {
  const out: Record<string, number> = {};
  for (const p of formatterFor(timeZone).formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return { year: out.year, month: out.month, day: out.day, hour: out.hour % 24, minute: out.minute, second: out.second };
}

/** Minutes the zone is ahead of UTC at that instant (negative for the US). */
function offsetMinutes(date: Date, timeZone: string): number {
  const p = partsOf(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "YYYY-MM-DD" on the store's wall calendar at that instant. */
export function localDateString(date: Date, timeZone: string): string {
  const p = partsOf(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Minutes after local midnight at that instant. */
export function localMinutesOfDay(date: Date, timeZone: string): number {
  const p = partsOf(date, timeZone);
  return p.hour * 60 + p.minute;
}

/** 0 = Sunday ... 6 = Saturday for a "YYYY-MM-DD" calendar day. */
export function weekdayOf(localDate: string): number {
  return new Date(`${localDate}T12:00:00Z`).getUTCDay();
}

export function addDaysLocal(localDate: string, days: number): string {
  const d = new Date(`${localDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole calendar days from one "YYYY-MM-DD" to another (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
}

/** Day of the month (1-31) and how many days that month has, for a "YYYY-MM-DD" calendar day. */
export function monthPosition(localDate: string): { day: number; daysInMonth: number } {
  const [y, m, d] = localDate.split('-').map(Number);
  return { day: d, daysInMonth: new Date(Date.UTC(y, m, 0)).getUTCDate() };
}

export function parseHHMM(value: string): number | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** The instant a local calendar day and clock time happen in the given zone (daylight saving aware). */
export function localToUtc(localDate: string, minutesOfDay: number, timeZone: string): Date {
  const [y, mo, d] = localDate.split('-').map(Number);
  const wall = Date.UTC(y, mo - 1, d, Math.floor(minutesOfDay / 60), minutesOfDay % 60, 0);
  // The offset depends on the instant, which depends on the offset: settle it in two passes.
  let guess = wall - offsetMinutes(new Date(wall), timeZone) * 60000;
  guess = wall - offsetMinutes(new Date(guess), timeZone) * 60000;
  return new Date(guess);
}

/** "10:00am", "2:05pm" in the store's clock. */
export function formatLocalTime(date: Date, timeZone: string): string {
  const minutes = localMinutesOfDay(date, timeZone);
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${pad(m)}${h24 >= 12 ? 'pm' : 'am'}`;
}
