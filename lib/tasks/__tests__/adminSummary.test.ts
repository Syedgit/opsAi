import {
  filterRunsForCadence,
  formatAdminTaskSummary,
  shouldSendDailyAdminSummary,
  shouldSendWeeklyAdminSummary,
  templateCadence,
  weekDatesInclusive,
} from '../adminSummary';

describe('admin task summaries', () => {
  it('treats every-day templates as daily and the rest as weekly', () => {
    expect(templateCadence({ id: 'a', frequency: 'weekly', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] })).toBe('daily');
    expect(templateCadence({ id: 'b', frequency: 'weekly', daysOfWeek: [1, 3, 5] })).toBe('weekly');
    expect(templateCadence({ id: 'c', frequency: 'monthly', daysOfWeek: [] })).toBe('weekly');
    expect(templateCadence({ id: 'd', frequency: 'interval', daysOfWeek: [] })).toBe('weekly');
  });

  it('sends daily after 8pm and weekly on Sunday after 8pm', () => {
    expect(shouldSendDailyAdminSummary('2026-11-17', 19 * 60 + 59)).toBe(false);
    expect(shouldSendDailyAdminSummary('2026-11-17', 20 * 60)).toBe(true);
    expect(shouldSendWeeklyAdminSummary('2026-11-15', 20 * 60)).toBe(true); // Sunday
    expect(shouldSendWeeklyAdminSummary('2026-11-16', 20 * 60)).toBe(false); // Monday
  });

  it('builds a brief summary with open and missed titles', () => {
    const text = formatAdminTaskSummary({
      storeName: 'Rockaway',
      cadence: 'daily',
      label: '2026-11-17',
      runs: [
        { title: 'Lock up', status: 'OPEN', localDate: '2026-11-17', templateId: 't1' },
        { title: 'Milk labels', status: 'DONE', localDate: '2026-11-17', templateId: 't2' },
        { title: 'Sanitizer', status: 'MISSED', localDate: '2026-11-17', templateId: 't3' },
      ],
    });
    expect(text).toContain('Rockaway · daily tasks · 2026-11-17');
    expect(text).toContain('1 done · 1 open · 1 missed');
    expect(text).toContain('Open: Lock up');
    expect(text).toContain('Missed: Sanitizer');
  });

  it('returns null when there is nothing to report', () => {
    expect(
      formatAdminTaskSummary({
        storeName: 'Rockaway',
        cadence: 'weekly',
        label: 'week of 2026-11-16',
        runs: [],
      })
    ).toBeNull();
  });

  it('filters runs by cadence and local dates', () => {
    const templates = [
      { id: 'daily', frequency: 'weekly', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] },
      { id: 'weekly', frequency: 'weekly', daysOfWeek: [1] },
    ];
    const runs = [
      { title: 'A', status: 'DONE', localDate: '2026-11-17', templateId: 'daily' },
      { title: 'B', status: 'OPEN', localDate: '2026-11-17', templateId: 'weekly' },
      { title: 'C', status: 'DONE', localDate: '2026-11-16', templateId: 'weekly' },
    ];
    expect(filterRunsForCadence(runs, templates, 'daily', new Set(['2026-11-17']))).toHaveLength(1);
    expect(filterRunsForCadence(runs, templates, 'weekly', weekDatesInclusive('2026-11-16', '2026-11-17'))).toHaveLength(2);
  });
});
