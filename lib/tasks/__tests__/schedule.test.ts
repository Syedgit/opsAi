import { describeSchedule, dueInstantsOnDay, dueMinutesOfDay, dueSoFar, TaskTemplateInputSchema } from '../schedule';
import { scoreRuns, type ScoredRun } from '../score';
import { addDaysLocal, formatLocalTime, localDateString, localMinutesOfDay, localToUtc, parseHHMM, weekdayOf } from '../time';

const NY = 'America/New_York';

describe('time helpers', () => {
  it('converts a store-local clock time to the right instant, with and without daylight saving', () => {
    expect(localToUtc('2026-10-26', 10 * 60, NY).toISOString()).toBe('2026-10-26T14:00:00.000Z'); // EDT, UTC-4
    expect(localToUtc('2026-11-02', 10 * 60, NY).toISOString()).toBe('2026-11-02T15:00:00.000Z'); // EST, UTC-5
    expect(localToUtc('2026-10-26', 10 * 60, 'America/Los_Angeles').toISOString()).toBe('2026-10-26T17:00:00.000Z');
    expect(localToUtc('2026-10-26', 10 * 60, 'UTC').toISOString()).toBe('2026-10-26T10:00:00.000Z');
  });

  it('handles the clock change days', () => {
    // 2026-11-01 02:00 EDT -> 01:00 EST. 10:00 that morning is already EST.
    expect(localToUtc('2026-11-01', 10 * 60, NY).toISOString()).toBe('2026-11-01T15:00:00.000Z');
    // 2026-03-08 02:00 EST -> 03:00 EDT. 10:00 that morning is EDT.
    expect(localToUtc('2026-03-08', 10 * 60, NY).toISOString()).toBe('2026-03-08T14:00:00.000Z');
  });

  it('knows which local day it is, which can differ from the UTC day', () => {
    const lateEvening = new Date('2026-10-27T02:30:00Z'); // 10:30pm on the 26th in New York
    expect(localDateString(lateEvening, NY)).toBe('2026-10-26');
    expect(localMinutesOfDay(lateEvening, NY)).toBe(22 * 60 + 30);
    expect(localDateString(lateEvening, 'UTC')).toBe('2026-10-27');
  });

  it('does the calendar arithmetic', () => {
    expect(weekdayOf('2026-10-26')).toBe(1); // Monday
    expect(addDaysLocal('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDaysLocal('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('parses and prints clock times', () => {
    expect(parseHHMM('9:05')).toBe(545);
    expect(parseHHMM('24:00')).toBeNull();
    expect(parseHHMM('10am')).toBeNull();
    expect(formatLocalTime(new Date('2026-10-26T14:05:00Z'), NY)).toBe('10:05am');
    expect(formatLocalTime(new Date('2026-10-26T16:00:00Z'), NY)).toBe('12:00pm');
    expect(formatLocalTime(new Date('2026-10-27T04:00:00Z'), NY)).toBe('12:00am');
  });
});

const daily = { startTime: '10:00', endTime: null, repeatEveryMinutes: null, daysOfWeek: [0, 1, 2, 3, 4, 5, 6] };
const hourly = { startTime: '07:00', endTime: '10:00', repeatEveryMinutes: 60, daysOfWeek: [1, 2, 3, 4, 5] };

describe('recurrence', () => {
  it('a one-time task is due once, at its time', () => {
    expect(dueMinutesOfDay(daily, '2026-10-26')).toEqual([600]);
  });

  it('a repeating task is due at each step up to and including the end time', () => {
    expect(dueMinutesOfDay(hourly, '2026-10-26')).toEqual([420, 480, 540, 600]);
    expect(dueMinutesOfDay({ ...hourly, repeatEveryMinutes: 90 }, '2026-10-26')).toEqual([420, 510, 600]);
  });

  it('skips days it is not scheduled for', () => {
    expect(dueMinutesOfDay(hourly, '2026-10-25')).toEqual([]); // Sunday
    expect(dueMinutesOfDay(hourly, '2026-10-26')).toHaveLength(4); // Monday
  });

  it('turns them into real instants in the store clock', () => {
    expect(dueInstantsOnDay(hourly, '2026-10-26', NY).map((d) => d.toISOString())).toEqual([
      '2026-10-26T11:00:00.000Z',
      '2026-10-26T12:00:00.000Z',
      '2026-10-26T13:00:00.000Z',
      '2026-10-26T14:00:00.000Z',
    ]);
  });

  it('only counts what has come due so far today', () => {
    const now = new Date('2026-10-26T13:30:00Z'); // 9:30am in New York
    expect(dueSoFar(hourly, now, NY).map((d) => d.toISOString())).toEqual([
      '2026-10-26T11:00:00.000Z',
      '2026-10-26T12:00:00.000Z',
      '2026-10-26T13:00:00.000Z',
    ]);
  });

  it('does not count moments before the task existed', () => {
    const now = new Date('2026-10-26T13:30:00Z');
    const createdAt = new Date('2026-10-26T12:30:00Z'); // 8:30am
    expect(dueSoFar(hourly, now, NY, createdAt).map((d) => d.toISOString())).toEqual(['2026-10-26T13:00:00.000Z']);
  });

  it('uses the store day, not the UTC day, late in the evening', () => {
    const night = { ...daily, startTime: '23:00' };
    const now = new Date('2026-10-27T03:30:00Z'); // 11:30pm on the 26th in New York
    expect(dueSoFar(night, now, NY).map((d) => d.toISOString())).toEqual(['2026-10-27T03:00:00.000Z']);
  });

  it('describes a schedule in plain words', () => {
    expect(describeSchedule(daily)).toBe('10:00am, daily');
    expect(describeSchedule(hourly)).toBe('every 60 min 7:00am-10:00am, Mon-Fri');
    expect(describeSchedule({ ...daily, startTime: '23:30', daysOfWeek: [0, 6] })).toBe('11:30pm, weekends');
    expect(describeSchedule({ ...daily, startTime: '00:15', daysOfWeek: [2, 4] })).toBe('12:15am, Tue, Thu');
  });
});

describe('TaskTemplateInputSchema', () => {
  const ok = { title: 'Check coffee', startTime: '10:00' };

  it('fills sensible defaults', () => {
    expect(TaskTemplateInputSchema.parse(ok)).toMatchObject({
      title: 'Check coffee',
      category: 'other',
      startTime: '10:00',
      endTime: null,
      repeatEveryMinutes: null,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      evidence: 'either',
      points: 1,
      remindEveryMinutes: 15,
      lateAfterMinutes: 60,
      active: true,
    });
  });

  it('accepts bills as a category and monthly on the 1st', () => {
    expect(TaskTemplateInputSchema.parse({
      title: 'Utility bills due',
      category: 'bills',
      startTime: '10:00',
      frequency: 'monthly',
      monthDays: [1],
    })).toMatchObject({ category: 'bills', frequency: 'monthly', monthDays: [1] });
  });

  it('pads a single-digit hour, trims, and sorts and de-duplicates days', () => {
    const t = TaskTemplateInputSchema.parse({ ...ok, title: '  Clean  ', startTime: '9:05', daysOfWeek: [5, 1, 1, 3] });
    expect(t).toMatchObject({ title: 'Clean', startTime: '09:05', daysOfWeek: [1, 3, 5] });
  });

  it('rejects things that would break the scheduler', () => {
    expect(TaskTemplateInputSchema.safeParse({ ...ok, title: ' ' }).success).toBe(false);
    expect(TaskTemplateInputSchema.safeParse({ ...ok, startTime: '10am' }).success).toBe(false);
    expect(TaskTemplateInputSchema.safeParse({ ...ok, daysOfWeek: [] }).success).toBe(false);
    expect(TaskTemplateInputSchema.safeParse({ ...ok, daysOfWeek: [7] }).success).toBe(false);
    expect(TaskTemplateInputSchema.safeParse({ ...ok, evidence: 'video' }).success).toBe(false);
    expect(TaskTemplateInputSchema.safeParse({ ...ok, repeatEveryMinutes: 1, endTime: '12:00' }).success).toBe(false);
  });

  it('a repeating task needs an end time after the start', () => {
    expect(TaskTemplateInputSchema.safeParse({ ...ok, repeatEveryMinutes: 60 }).success).toBe(false);
    expect(TaskTemplateInputSchema.safeParse({ ...ok, repeatEveryMinutes: 60, endTime: '09:00' }).success).toBe(false);
    expect(TaskTemplateInputSchema.safeParse({ ...ok, repeatEveryMinutes: 60, endTime: '13:00' }).success).toBe(true);
  });
});

describe('scoreRuns', () => {
  const NOW = new Date('2026-10-26T18:00:00Z');
  const run = (over: Partial<ScoredRun>): ScoredRun => ({
    category: 'cleanliness',
    points: 2,
    status: 'OPEN',
    dueAt: new Date('2026-10-26T12:00:00Z'),
    completedAt: null,
    lateAfterMinutes: 60,
    ...over,
  });

  it('counts finished tasks, and open tasks that are already late', () => {
    const report = scoreRuns(
      [
        run({ status: 'DONE', completedAt: new Date('2026-10-26T12:10:00Z') }),
        run({ status: 'MISSED' }),
        run({ status: 'OPEN' }), // due 6 hours ago, so overdue
      ],
      NOW
    );
    expect(report.total).toMatchObject({ earned: 2, possible: 6, percent: 33, done: 1, missed: 2, pending: 0 });
  });

  it('leaves a task that is open but not yet late out of the score', () => {
    const report = scoreRuns([run({ status: 'DONE', completedAt: new Date('2026-10-26T12:05:00Z') }), run({ status: 'OPEN', dueAt: new Date('2026-10-26T17:30:00Z') })], NOW);
    expect(report.total).toMatchObject({ earned: 2, possible: 2, percent: 100, pending: 1, missed: 0 });
  });

  it('flags tasks finished late but still gives the points', () => {
    const report = scoreRuns([run({ status: 'DONE', completedAt: new Date('2026-10-26T14:00:00Z') })], NOW);
    expect(report.total).toMatchObject({ earned: 2, possible: 2, done: 1, doneLate: 1, percent: 100 });
  });

  it('weights by points and splits by category', () => {
    const report = scoreRuns(
      [
        run({ category: 'food_safety', points: 5, status: 'DONE', completedAt: new Date('2026-10-26T12:05:00Z') }),
        run({ category: 'cleanliness', points: 1, status: 'MISSED' }),
        run({ category: 'cleanliness', points: 1, status: 'DONE', completedAt: new Date('2026-10-26T12:05:00Z') }),
      ],
      NOW
    );
    expect(report.total.percent).toBe(86); // 6 of 7
    expect(report.byCategory.map((c) => [c.label, c.percent])).toEqual([
      ['Food Safety', 100],
      ['Cleanliness', 50],
    ]);
  });

  it('has no percentage until something has counted', () => {
    expect(scoreRuns([], NOW).total.percent).toBeNull();
    expect(scoreRuns([run({ status: 'OPEN', dueAt: new Date('2026-10-26T17:50:00Z') })], NOW).total.percent).toBeNull();
  });

  it('puts an unknown category under "other"', () => {
    expect(scoreRuns([run({ category: 'weird', status: 'MISSED' })], NOW).byCategory[0].label).toBe('Other');
  });
});
