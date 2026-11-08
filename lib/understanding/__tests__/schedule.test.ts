import type { z } from 'zod';
import { WorkScheduleSchema, type WorkSchedule } from '../schema';
import { formatHours, formatShiftRange, hoursLines, parseClock, parseShiftRange, resolveShiftDate, scheduleWeekStartOf, sheetLines, summarizeSchedule, weekContainsDate } from '../schedule';

type SheetInput = z.input<typeof WorkScheduleSchema>;

function sheet(partial: Partial<SheetInput> & Pick<SheetInput, 'employees'>): WorkSchedule {
  return WorkScheduleSchema.parse({ storeHint: null, weekStart: '2026-10-26', ...partial });
}

const shift = (day: string, start: string | null, end: string | null, extra: Record<string, unknown> = {}) => ({
  day,
  start,
  end,
  ...extra,
});

describe('parseClock', () => {
  it.each([
    ['17:00', 17 * 60],
    ['9:30', 9 * 60 + 30],
    ['5pm', 17 * 60],
    ['5:30 PM', 17 * 60 + 30],
    ['9a', 9 * 60],
    ['12am', 0],
    ['12pm', 12 * 60],
    ['6 a.m.', 6 * 60],
  ])('reads %s', (text, minutes) => {
    expect(parseClock(text)).toBe(minutes);
  });

  it.each([null, '', 'off', '25:00', '9:75', '13pm', '9', '17'])('refuses %s', (text) => {
    expect(parseClock(text as string | null)).toBeNull();
  });
});

describe('parseShiftRange', () => {
  it('reads the short forms people type on a roster', () => {
    expect(parseShiftRange('9-5')).toEqual({ start: '09:00', end: '17:00' });
    expect(parseShiftRange('9a-5p')).toEqual({ start: '09:00', end: '17:00' });
    expect(parseShiftRange('2-10')).toEqual({ start: '14:00', end: '22:00' });
    expect(parseShiftRange('10-6')).toEqual({ start: '10:00', end: '18:00' });
    expect(parseShiftRange('09:00-17:00')).toEqual({ start: '09:00', end: '17:00' });
  });

  it('treats off / blank as no shift', () => {
    expect(parseShiftRange('off')).toBeNull();
    expect(parseShiftRange('')).toBeNull();
    expect(parseShiftRange('  ')).toBeNull();
  });

  it('prints a compact cell', () => {
    expect(formatShiftRange('09:00', '17:00')).toBe('9a–5p');
    expect(formatShiftRange('14:00', '22:00')).toBe('2p–10p');
  });
});

describe('resolveShiftDate', () => {
  it('uses a printed date first', () => {
    expect(resolveShiftDate({ date: '2026-10-28', day: 'Mon' }, '2026-10-26')).toBe('2026-10-28');
  });

  it('finds the weekday on or after the week start', () => {
    expect(resolveShiftDate({ date: null, day: 'Mon' }, '2026-10-26')).toBe('2026-10-26'); // 10/26/2026 is a Monday
    expect(resolveShiftDate({ date: null, day: 'Wednesday' }, '2026-10-26')).toBe('2026-10-28');
    expect(resolveShiftDate({ date: null, day: 'Sun' }, '2026-10-26')).toBe('2026-11-01');
  });

  it('handles a week that starts on Sunday', () => {
    expect(resolveShiftDate({ date: null, day: 'Sat' }, '2026-10-25')).toBe('2026-10-31');
  });

  it('handles a 7-Eleven week that starts on Friday', () => {
    expect(resolveShiftDate({ date: null, day: 'Fri' }, '2026-10-30')).toBe('2026-10-30');
    expect(resolveShiftDate({ date: null, day: 'Thu' }, '2026-10-30')).toBe('2026-11-05');
    expect(scheduleWeekStartOf('2026-11-08', 5)).toBe('2026-11-06');
    expect(scheduleWeekStartOf('2026-11-12', 5)).toBe('2026-11-06');
    expect(scheduleWeekStartOf('2026-11-12', 0)).toBe('2026-11-08');
    expect(weekContainsDate('2026-11-06', '2026-11-12')).toBe(true);
    expect(weekContainsDate('2026-11-06', '2026-11-13')).toBe(false);
  });

  it('is null without enough information', () => {
    expect(resolveShiftDate({ date: null, day: 'Mon' }, null)).toBeNull();
    expect(resolveShiftDate({ date: null, day: null }, '2026-10-26')).toBeNull();
  });
});

describe('summarizeSchedule', () => {
  it('adds up each employee and the total', () => {
    const summary = summarizeSchedule(
      sheet({
        employees: [
          { name: 'Maria', shifts: [shift('Mon', '09:00', '17:00'), shift('Tue', '09:00', '17:00'), shift('Wed', '9:00', '13:30')] },
          { name: 'Sam', shifts: [shift('Thu', '14:00', '22:00')] },
        ],
      })
    );
    expect(summary.employees.map((e) => [e.name, e.hours])).toEqual([
      ['Maria', 20.5],
      ['Sam', 8],
    ]);
    expect(summary.totalHours).toBe(28.5);
    expect(hoursLines(summary)).toEqual(['Maria 20.5h', 'Sam 8h']);
    expect(sheetLines(summary)).toEqual([
      'Maria',
      'Mon 9a–5p · Tue 9a–5p · Wed 9a–1:30p',
      '20.5h',
      '',
      'Sam',
      'Thu 2p–10p',
      '8h',
    ]);
    expect(summary.checks).toEqual([]);
  });

  it('counts a night shift across midnight', () => {
    const summary = summarizeSchedule(sheet({ employees: [{ name: 'Ali', shifts: [shift('Fri', '22:00', '06:00')] }] }));
    expect(summary.employees[0].hours).toBe(8);
    expect(summary.employees[0].shifts[0].overnight).toBe(true);
  });

  it('subtracts a written break only', () => {
    const summary = summarizeSchedule(
      sheet({
        employees: [{ name: 'Maria', shifts: [shift('Mon', '09:00', '17:00', { breakMinutes: 30 }), shift('Tue', '09:00', '17:00')] }],
      })
    );
    expect(summary.employees[0].hours).toBe(15.5);
  });

  it('leaves out a shift it cannot read and says so', () => {
    const summary = summarizeSchedule(
      sheet({ employees: [{ name: 'Maria', shifts: [shift('Mon', '09:00', '17:00'), shift('Tue', '9', null)] }] })
    );
    expect(summary.employees[0].hours).toBe(8);
    expect(summary.checks.find((c) => c.id === 'shift_unclear')?.message).toContain('Maria Tue');
  });

  it('fails when nothing can be read', () => {
    const summary = summarizeSchedule(sheet({ employees: [{ name: 'Maria', shifts: [shift('Mon', null, null)] }] }));
    expect(summary.checks[0]).toMatchObject({ id: 'schedule_empty', status: 'fail' });
  });

  it('warns about a very long shift and an identical start and end', () => {
    const summary = summarizeSchedule(
      sheet({ employees: [{ name: 'Ali', shifts: [shift('Mon', '06:00', '23:30'), shift('Tue', '09:00', '09:00')] }] })
    );
    const ids = summary.checks.map((c) => c.id);
    expect(ids).toContain('shift_long');
    expect(ids).toContain('shift_zero');
  });

  it('warns about overlapping shifts for one person on one day', () => {
    const summary = summarizeSchedule(
      sheet({ employees: [{ name: 'Sam', shifts: [shift('Mon', '08:00', '14:00'), shift('Mon', '13:00', '18:00')] }] })
    );
    expect(summary.checks.map((c) => c.id)).toContain('shift_overlap');
  });

  it('does not call back-to-back shifts an overlap', () => {
    const summary = summarizeSchedule(
      sheet({ employees: [{ name: 'Sam', shifts: [shift('Mon', '08:00', '14:00'), shift('Mon', '14:00', '18:00')] }] })
    );
    expect(summary.checks.map((c) => c.id)).not.toContain('shift_overlap');
  });

  it('warns when someone is over the weekly limit (hours only)', () => {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => shift(d, '07:00', '15:00'));
    const summary = summarizeSchedule(sheet({ employees: [{ name: 'Ali', shifts: days }] }));
    expect(summary.employees[0].hours).toBe(48);
    expect(summary.checks.find((c) => c.id === 'hours_over_limit')?.message).toBe('Over 40h this week: Ali 48h.');
    expect(summarizeSchedule(sheet({ employees: [{ name: 'Ali', shifts: days }] }), { hoursLimit: 50 }).checks).toEqual([]);
  });

  it('cross-checks against the total printed on the sheet', () => {
    const ok = summarizeSchedule(
      sheet({ employees: [{ name: 'Maria', statedTotalHours: 8, shifts: [shift('Mon', '09:00', '17:00')] }] })
    );
    expect(ok.checks).toEqual([]);
    const bad = summarizeSchedule(
      sheet({ employees: [{ name: 'Maria', statedTotalHours: 40, shifts: [shift('Mon', '09:00', '17:00')] }] })
    );
    expect(bad.checks[0]).toMatchObject({ status: 'warn', expected: 40, actual: 8, difference: -32 });
  });

  it('merges the same name written twice', () => {
    const summary = summarizeSchedule(
      sheet({
        employees: [
          { name: 'Maria', shifts: [shift('Mon', '09:00', '17:00')] },
          { name: ' maria ', shifts: [shift('Tue', '09:00', '17:00')] },
        ],
      })
    );
    expect(summary.employees).toHaveLength(1);
    expect(summary.employees[0].hours).toBe(16);
  });

  it('uses a manager adjustment instead of the computed hours', () => {
    const summary = summarizeSchedule(
      sheet({ employees: [{ name: 'Maria', adjustedHours: 30, statedTotalHours: 99, shifts: [shift('Mon', '09:00', '17:00')] }] })
    );
    expect(summary.employees[0]).toMatchObject({ hours: 30, computedHours: 8, adjusted: true });
    expect(hoursLines(summary)).toEqual(['Maria 30h (adjusted)']);
    expect(summary.checks).toEqual([]);
  });

  it('warns when the week cannot be placed on a calendar but still counts the hours', () => {
    const summary = summarizeSchedule(
      sheet({ weekStart: null, employees: [{ name: 'Maria', shifts: [shift('Mon', '09:00', '17:00')] }] })
    );
    expect(summary.employees[0].hours).toBe(8);
    expect(summary.checks.map((c) => c.id)).toEqual(['schedule_week_missing']);
  });

  it('adds hours from a 7-Eleven Shift Schedule (Friday week, overnight, X is off, stated hours, never pay)', () => {
    const summary = summarizeSchedule(
      sheet({
        weekStart: '2026-10-30',
        employees: [
          {
            name: 'Umar',
            statedTotalHours: 72,
            shifts: [
              shift('Fri', '05:45', '16:06'),
              shift('Sat', '05:53', '16:10'),
              shift('Sun', '08:00', '20:08'),
              shift('Tue', '05:50', '16:10'),
              shift('Wed', '05:56', '16:15'),
              shift('Thu', '06:48', '16:08'),
            ],
          },
          {
            name: 'Furkan',
            shifts: [shift('Fri', '11:15', '21:15'), shift('Sat', '11:07', '21:10'), shift('Mon', '10:14', '21:12')],
          },
          {
            name: 'Raeen',
            shifts: [shift('Fri', '21:00', '07:00'), shift('Sat', '21:00', '06:00')],
          },
        ],
      })
    );
    expect(summary.employees.find((e) => e.name === 'Raeen')?.shifts[0]).toMatchObject({ overnight: true, minutes: 10 * 60 });
    expect(summary.employees.find((e) => e.name === 'Furkan')?.shifts).toHaveLength(3);
    expect(summary.employees.find((e) => e.name === 'Umar')?.hours).toBeGreaterThan(60);
    expect(summary.checks.some((c) => c.message.includes('Umar') && c.message.includes('72h'))).toBe(true);
    expect(JSON.stringify(summary)).not.toMatch(/wage|salary|payroll|hourly/i);
  });

  it('has no place to keep a pay rate', () => {
    const parsed = WorkScheduleSchema.parse({
      employees: [{ name: 'Maria', hourlyRate: 18.5, wage: 1200, shifts: [{ day: 'Mon', start: '09:00', end: '17:00', pay: 150 }] }],
    });
    expect(JSON.stringify(parsed)).not.toMatch(/hourlyRate|wage|pay|1200|18\.5|150/);
  });
});

describe('formatHours', () => {
  it('drops trailing zeros', () => {
    expect(formatHours(32)).toBe('32h');
    expect(formatHours(7.5)).toBe('7.5h');
    expect(formatHours(7.25)).toBe('7.25h');
    expect(formatHours(0)).toBe('0h');
  });
});
