import type { z } from 'zod';
import { WorkScheduleSchema, type WorkSchedule } from '../schema';
import { formatHours, hoursLines, parseClock, resolveShiftDate, summarizeSchedule } from '../schedule';

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
