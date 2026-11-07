import { describeSchedule, dueMinutesOfDay, occursOn, TaskTemplateInputSchema, type ScheduledTemplate } from '../schedule';
import { daysBetween, monthPosition } from '../time';
import { runTaskTick } from '../tick';
import { getPreset, TASK_PRESETS } from '../presets';

const base = { startTime: '10:00', endTime: null, repeatEveryMinutes: null, daysOfWeek: [0, 1, 2, 3, 4, 5, 6] };
const t = (extra: Partial<ScheduledTemplate>): ScheduledTemplate => ({ ...base, ...extra });

const days = (template: ScheduledTemplate, from: string, count: number): string[] => {
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(`${from}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    const day = d.toISOString().slice(0, 10);
    if (occursOn(template, day)) out.push(day);
  }
  return out;
};

describe('date helpers', () => {
  it('counts days across months and years', () => {
    expect(daysBetween('2026-10-26', '2026-11-02')).toBe(7);
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3);
    expect(daysBetween('2026-11-02', '2026-10-26')).toBe(-7);
  });

  it('knows how long a month is, including leap years', () => {
    expect(monthPosition('2026-02-10')).toEqual({ day: 10, daysInMonth: 28 });
    expect(monthPosition('2028-02-10')).toEqual({ day: 10, daysInMonth: 29 });
    expect(monthPosition('2026-10-31')).toEqual({ day: 31, daysInMonth: 31 });
  });
});

describe('every N days', () => {
  const every3 = t({ frequency: 'interval', intervalDays: 3, anchorDate: '2026-10-26' });

  it('falls on the start day and every 3rd day after it', () => {
    expect(days(every3, '2026-10-26', 10)).toEqual(['2026-10-26', '2026-10-29', '2026-11-01', '2026-11-04']);
  });

  it('never falls before the start date', () => {
    expect(days(every3, '2026-10-20', 6)).toEqual([]);
  });

  it('counts across the clock change without drifting', () => {
    const every14 = t({ frequency: 'interval', intervalDays: 14, anchorDate: '2026-10-26' });
    expect(days(every14, '2026-10-26', 60)).toEqual(['2026-10-26', '2026-11-09', '2026-11-23', '2026-12-07', '2026-12-21']);
  });

  it('is never due when the count or start date is missing', () => {
    expect(occursOn(t({ frequency: 'interval', intervalDays: null, anchorDate: '2026-10-26' }), '2026-10-26')).toBe(false);
    expect(occursOn(t({ frequency: 'interval', intervalDays: 3, anchorDate: null }), '2026-10-26')).toBe(false);
  });

  it('still honors the time of day', () => {
    expect(dueMinutesOfDay(every3, '2026-10-29')).toEqual([600]);
    expect(dueMinutesOfDay(every3, '2026-10-30')).toEqual([]);
  });
});

describe('monthly', () => {
  it('falls on the chosen days of the month', () => {
    const m = t({ frequency: 'monthly', monthDays: [1, 15] });
    expect(days(m, '2026-10-01', 62)).toEqual(['2026-10-01', '2026-10-15', '2026-11-01', '2026-11-15', '2026-12-01']);
  });

  it('puts the 31st on the last day of a shorter month, once', () => {
    const m = t({ frequency: 'monthly', monthDays: [31] });
    expect(days(m, '2027-02-01', 28)).toEqual(['2027-02-28']);
    expect(days(m, '2026-11-01', 30)).toEqual(['2026-11-30']);
    expect(days(m, '2026-10-01', 31)).toEqual(['2026-10-31']);
  });

  it('does not double up when 30 and 31 both land on the last day', () => {
    const m = t({ frequency: 'monthly', monthDays: [30, 31] });
    expect(days(m, '2026-11-01', 30)).toEqual(['2026-11-30']);
    expect(dueMinutesOfDay(m, '2026-11-30')).toEqual([600]);
  });

  it('ignores the weekday list', () => {
    const m = t({ frequency: 'monthly', monthDays: [1], daysOfWeek: [3] });
    expect(occursOn(m, '2026-11-01')).toBe(true); // a Sunday
  });
});

describe('once, on one date', () => {
  it('falls only on the chosen day', () => {
    const once = t({ frequency: 'once', anchorDate: '2026-10-25' });
    expect(days(once, '2026-10-20', 14)).toEqual(['2026-10-25']);
  });

  it('is never due without a date', () => {
    expect(occursOn(t({ frequency: 'once', anchorDate: null }), '2026-10-25')).toBe(false);
  });
});

describe('weekly is unchanged', () => {
  it('uses the weekdays, and a template with no frequency still works', () => {
    const mon = t({ daysOfWeek: [1] });
    expect(days(mon, '2026-10-26', 15)).toEqual(['2026-10-26', '2026-11-02', '2026-11-09']);
    expect(days(t({ frequency: 'weekly', daysOfWeek: [1] }), '2026-10-26', 8)).toEqual(['2026-10-26', '2026-11-02']);
  });
});

describe('describeSchedule', () => {
  it('reads naturally', () => {
    expect(describeSchedule(t({ frequency: 'interval', intervalDays: 3 }))).toBe('10:00am, every 3 days');
    expect(describeSchedule(t({ frequency: 'interval', intervalDays: 7 }))).toBe('10:00am, every week');
    expect(describeSchedule(t({ frequency: 'interval', intervalDays: 14 }))).toBe('10:00am, every 2 weeks');
    expect(describeSchedule(t({ frequency: 'monthly', monthDays: [1] }))).toBe('10:00am, monthly on the 1st');
    expect(describeSchedule(t({ frequency: 'monthly', monthDays: [2, 15, 31] }))).toBe('10:00am, monthly on the 2nd, the 15th and the last day');
    expect(describeSchedule(t({ frequency: 'monthly', monthDays: [11, 12, 13, 21, 22, 23] }))).toContain('the 11th, the 12th, the 13th, the 21st, the 22nd and the 23rd');
    expect(describeSchedule(t({ daysOfWeek: [1, 2, 3, 4, 5] }))).toBe('10:00am, Mon-Fri');
    expect(describeSchedule(t({ frequency: 'once', anchorDate: '2026-10-25' }))).toBe('10:00am, once on 2026-10-25');
  });
});

describe('the task form input', () => {
  const ok = { title: 'Deep clean', startTime: '14:00' };

  it('defaults to weekly, every day', () => {
    const r = TaskTemplateInputSchema.parse(ok);
    expect(r).toMatchObject({ frequency: 'weekly', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], intervalDays: null, monthDays: [], anchorDate: null });
  });

  it('needs the right detail for each kind', () => {
    expect(TaskTemplateInputSchema.safeParse({ ...ok, frequency: 'interval' }).success).toBe(false);
    expect(TaskTemplateInputSchema.safeParse({ ...ok, frequency: 'monthly' }).success).toBe(false);
    expect(TaskTemplateInputSchema.safeParse({ ...ok, daysOfWeek: [] }).success).toBe(false);
    expect(TaskTemplateInputSchema.safeParse({ ...ok, frequency: 'interval', intervalDays: 1 }).success).toBe(false);
    expect(TaskTemplateInputSchema.safeParse({ ...ok, frequency: 'interval', intervalDays: 91 }).success).toBe(false);
    expect(TaskTemplateInputSchema.safeParse({ ...ok, frequency: 'monthly', monthDays: [32] }).success).toBe(false);
    expect(TaskTemplateInputSchema.safeParse({ ...ok, frequency: 'interval', intervalDays: 3, anchorDate: 'tomorrow' }).success).toBe(false);
    expect(TaskTemplateInputSchema.safeParse({ ...ok, frequency: 'once' }).success).toBe(false);
  });

  it('lets a monthly or every-N-days task leave the weekday list empty, and tidies what does not apply', () => {
    const monthly = TaskTemplateInputSchema.parse({ ...ok, frequency: 'monthly', monthDays: [15, 1, 15], daysOfWeek: [], intervalDays: 5, anchorDate: '2026-10-26' });
    expect(monthly).toMatchObject({ monthDays: [1, 15], daysOfWeek: [0, 1, 2, 3, 4, 5, 6], intervalDays: null, anchorDate: null });
    const every = TaskTemplateInputSchema.parse({ ...ok, frequency: 'interval', intervalDays: 4, anchorDate: '2026-10-26', monthDays: [3] });
    expect(every).toMatchObject({ intervalDays: 4, anchorDate: '2026-10-26', monthDays: [] });
    const once = TaskTemplateInputSchema.parse({ ...ok, frequency: 'once', anchorDate: '2026-10-25', daysOfWeek: [], intervalDays: 5 });
    expect(once).toMatchObject({ frequency: 'once', anchorDate: '2026-10-25', intervalDays: null, monthDays: [] });
  });

  it('keeps a weekly task weekly, with only its own fields', () => {
    const weekly = TaskTemplateInputSchema.parse({ ...ok, daysOfWeek: [3, 1], intervalDays: 4, monthDays: [3] });
    expect(weekly).toMatchObject({ daysOfWeek: [1, 3], intervalDays: null, monthDays: [] });
  });
});

describe('the starter library', () => {
  it('has a monthly pest check and an every-2-weeks deep clean that read right', () => {
    expect(getPreset('boh2-pest-report')?.template).toMatchObject({ frequency: 'monthly', monthDays: [1] });
    expect(getPreset('own-cooler-deep-clean')?.template).toMatchObject({ frequency: 'interval', intervalDays: 14 });
    expect(TASK_PRESETS.filter((p) => p.template.frequency !== 'weekly').length).toBeGreaterThanOrEqual(3);
  });
});

/* ------------------------------ the scheduler, with a tiny fake database ------------------------------ */

interface Row { [key: string]: unknown }

function fakePrisma(templates: Row[]) {
  const runs: Row[] = [];
  let nextId = 1;
  const matches = (row: Row, where: Row = {}): boolean =>
    Object.entries(where).every(([k, v]) => (v && typeof v === 'object' && 'in' in (v as Row) ? ((v as { in: unknown[] }).in).includes(row[k]) : row[k] === v));
  return {
    runs,
    taskTemplate: { findMany: async () => templates },
    taskRun: {
      findMany: async ({ where }: { where?: Row } = {}) => runs.filter((r) => matches(r, where)),
      create: async ({ data }: { data: Row }) => {
        if (runs.some((r) => r.templateId === data.templateId && (r.dueAt as Date).getTime() === (data.dueAt as Date).getTime())) throw Object.assign(new Error('dup'), { code: 'P2002' });
        const row = { id: `r${nextId++}`, alertedAt: null, lastReminderAt: null, reminderCount: 0, escalatedAt: null, ...data };
        runs.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => Object.assign(runs.find((r) => r.id === where.id) as Row, data),
      updateMany: async ({ where, data }: { where: { id: { in: string[] } }; data: Row }) => {
        runs.filter((r) => where.id.in.includes(r.id as string)).forEach((r) => Object.assign(r, data));
      },
    },
    storeConfig: {
      findUnique: async () => ({ storeName: 'Rockaway', timezone: 'America/New_York', active: true }),
      findMany: async () => [],
    },
    userDirectory: { findMany: async () => [] },
    storeWhatsAppGroup: { findMany: async () => [] },
  };
}

jest.mock('../../whatsappMessaging', () => ({
  postToStoreGroups: async () => 1,
  sendWhatsAppMessage: async () => true,
  sendWhatsAppGroupMessage: async () => true,
}));

const template = (extra: Row): Row => ({
  id: 't1', storeId: 'S001', title: 'Deep clean', instructions: null, category: 'other', standardId: null, criticality: null,
  minValue: null, maxValue: null, unit: null, fallback: null, startTime: '10:00', endTime: null, repeatEveryMinutes: null,
  frequency: 'weekly', intervalDays: null, monthDays: [], anchorDate: null, daysOfWeek: [0, 1, 2, 3, 4, 5, 6], evidence: 'either', photoCheck: null,
  points: 3, remindEveryMinutes: 15, escalateAfterMinutes: 60, lateAfterMinutes: 60, active: true, createdAt: new Date('2026-10-01T00:00:00Z'), ...extra,
});

const at = (iso: string) => new Date(iso);

describe('the scheduler with the new recurrence', () => {
  it('creates a run only on the days an every-3-days task comes round', async () => {
    const db = fakePrisma([template({ frequency: 'interval', intervalDays: 3, anchorDate: '2026-10-26' })]);
    for (const iso of ['2026-10-26T15:00:00Z', '2026-10-27T15:00:00Z', '2026-10-28T15:00:00Z', '2026-10-29T15:00:00Z']) {
      await runTaskTick(db as never, at(iso));
    }
    expect(db.runs.map((r) => r.localDate)).toEqual(['2026-10-26', '2026-10-29']);
  });

  it('counts an every-N-days task from the day it was made when no start date is stored', async () => {
    const db = fakePrisma([template({ frequency: 'interval', intervalDays: 2, anchorDate: null, createdAt: at('2026-10-26T01:00:00Z') })]);
    for (const iso of ['2026-10-26T15:00:00Z', '2026-10-27T15:00:00Z', '2026-10-28T15:00:00Z']) await runTaskTick(db as never, at(iso));
    // Created on the evening of the 25th in New York, so day 0 is the 25th and the next is the 27th.
    expect(db.runs.map((r) => r.localDate)).toEqual(['2026-10-27']);
  });

  it('creates a monthly task once a month, on the last day for the 31st', async () => {
    const db = fakePrisma([template({ frequency: 'monthly', monthDays: [31] })]);
    for (const iso of ['2026-10-31T15:00:00Z', '2026-11-29T15:00:00Z', '2026-11-30T15:00:00Z', '2026-12-01T15:00:00Z']) await runTaskTick(db as never, at(iso));
    expect(db.runs.map((r) => r.localDate)).toEqual(['2026-10-31', '2026-11-30']);
  });

  it('creates a one-off task only on its date', async () => {
    const db = fakePrisma([template({ frequency: 'once', anchorDate: '2026-10-25', startTime: '10:00' })]);
    for (const iso of ['2026-10-24T15:00:00Z', '2026-10-25T15:00:00Z', '2026-10-26T15:00:00Z']) {
      await runTaskTick(db as never, at(iso));
    }
    expect(db.runs.map((r) => r.localDate)).toEqual(['2026-10-25']);
  });

  it('gives a weekly-recurrence task one day, but a monthly or every-N-days task three, before it counts as missed', async () => {
    const weekly = template({ id: 'w', daysOfWeek: [1] });
    const monthly = template({ id: 'm', frequency: 'monthly', monthDays: [26], startTime: '10:00' });
    const db = fakePrisma([weekly, monthly]);
    await runTaskTick(db as never, at('2026-10-26T15:00:00Z')); // Monday the 26th, both due
    await runTaskTick(db as never, at('2026-10-27T16:00:00Z')); // 26 hours later
    const status = (id: string) => db.runs.find((r) => r.templateId === id)?.status;
    expect(status('w')).toBe('MISSED');
    expect(status('m')).toBe('OPEN');
    await runTaskTick(db as never, at('2026-10-29T16:00:00Z')); // 3 days and 2 hours later
    expect(status('m')).toBe('MISSED');
  });
});
