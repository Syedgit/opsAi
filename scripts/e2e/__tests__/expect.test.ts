import { checkEntry, checkStep } from '../expect';
import type { EntryView, StepActual } from '../types';

const entry: EntryView = {
  kind: 'daily_close',
  store: 'Rockaway',
  date: '2026-10-12',
  cash: 106,
  card: 334,
  fuel: 1355,
  deposit: 1653,
  payouts: [{ label: 'Lays', amount: 142 }],
  checks: { deposit_explained: 'pass', period_open: 'warn' },
  suggestsDepositRule: true,
};

const actual = (over: Partial<StepActual> = {}): StepActual => ({
  httpStatus: 200,
  replies: ['🧾 Rockaway · Reply OK to save'],
  groupPosts: [],
  entries: [entry],
  status: { PENDING: 1, CONFIRMED: 0, CANCELLED: 0 },
  savedRule: { Rockaway: false },
  tasks: [],
  taskCounts: { OPEN: 0, DONE: 0, MISSED: 0, CANCELLED: 0 },
  dashboard: { Rockaway: { sales: { count: 1, first: { cash: 106 } } } },
  ...over,
});

describe('checkEntry', () => {
  it('passes when everything matches, counting each comparison', () => {
    const v = checkEntry({ store: 'rock', cash: 106, fuel: 1355, date: '2026-10-12', payouts: [{ label: 'lays', amount: 142 }] }, entry, 'entry 1');
    expect(v.failures).toEqual([]);
    expect(v.checked).toBe(6);
  });

  it('accepts a one-cent difference but not more', () => {
    expect(checkEntry({ cash: 106.009 }, entry, 'e').failures).toEqual([]);
    expect(checkEntry({ cash: 106.5 }, entry, 'e').failures).toHaveLength(1);
  });

  it('reports a wrong number clearly', () => {
    const v = checkEntry({ card: 33 }, entry, 'entry 1');
    expect(v.failures).toEqual(['entry 1 card: expected 33, got 334']);
  });

  it('treats null as "must be empty"', () => {
    expect(checkEntry({ gallons: null }, entry, 'e').failures).toEqual([]);
    expect(checkEntry({ cash: null }, entry, 'e').failures).toHaveLength(1);
  });

  it('checks warnings, clean, and payouts', () => {
    expect(checkEntry({ warnings: ['period_open'] }, entry, 'e').failures).toEqual([]);
    expect(checkEntry({ warnings: ['deposit_rule'] }, entry, 'e').failures).toHaveLength(1);
    expect(checkEntry({ clean: true }, entry, 'e').failures).toHaveLength(1);
    expect(checkEntry({ payouts: [] }, entry, 'e').failures.length).toBeGreaterThan(0);
    expect(checkEntry({ payouts: [{ label: 'Frito', amount: 142 }] }, entry, 'e').failures.length).toBeGreaterThan(0);
  });
});

describe('checkStep', () => {
  it('passes a matching step', () => {
    const v = checkStep(
      {
        replyContains: ['reply ok'],
        replyCount: 1,
        entries: [{ store: 'Rockaway' }],
        status: { PENDING: 1 },
        savedRule: { Rockaway: false },
        dashboard: { Rockaway: { sales: { count: 1, first: { cash: 106 } } } },
      },
      actual()
    );
    expect(v.failures).toEqual([]);
  });

  it('fails on the wrong entry count, missing text, and wrong http status', () => {
    const v = checkStep({ entries: [], replyContains: ['Saved'], httpStatus: 401 }, actual());
    expect(v.failures).toEqual(expect.arrayContaining(['expected 0 entries, got 1', 'reply should contain "Saved"', 'webhook answered 200, expected 401']));
  });

  it('fails when the dashboard shows the wrong number of rows', () => {
    const v = checkStep({ dashboard: { Rockaway: { sales: 3 } } }, actual());
    expect(v.failures).toEqual(['dashboard Rockaway/sales: expected 3 rows, got 1']);
  });

  it('does nothing without expectations', () => {
    expect(checkStep(undefined, actual())).toEqual({ failures: [], checked: 0 });
  });
});

describe('schedule and group-post checks', () => {
  const schedule: EntryView = {
    kind: 'work_schedule',
    store: 'Rockaway',
    date: '2026-10-26',
    employees: [
      { name: 'Maria', hours: 24 },
      { name: 'Sam', hours: 8 },
    ],
    totalHours: 32,
    checks: {},
    suggestsDepositRule: false,
  };

  it('passes when the employees and hours match (names are case-insensitive)', () => {
    const v = checkEntry({ employees: [{ name: 'maria', hours: 24 }, { name: 'SAM', hours: 8 }], totalHours: 32 }, schedule, 'entry 1');
    expect(v.failures).toEqual([]);
  });

  it('reports a wrong number of hours, a wrong name, and a wrong head count', () => {
    expect(checkEntry({ employees: [{ name: 'Maria', hours: 20 }, { name: 'Sam', hours: 8 }] }, schedule, 'e').failures).toEqual([
      'e Maria hours: expected 20, got 24',
    ]);
    expect(checkEntry({ employees: [{ name: 'Maria', hours: 24 }, { name: 'Ali', hours: 8 }] }, schedule, 'e').failures[0]).toContain('expected Ali, got "Sam"');
    expect(checkEntry({ employees: [{ name: 'Maria', hours: 24 }] }, schedule, 'e').failures[0]).toContain('expected 1 employees, got 2');
    expect(checkEntry({ totalHours: 40 }, schedule, 'e').failures).toEqual(['e total hours: expected 40, got 32']);
  });

  it('checks what was posted to the group', () => {
    const posted = actual({ groupPosts: ['📅 Rockaway Maria 24h'] });
    expect(checkStep({ groupPosts: 1, groupPostContains: ['maria 24h'], groupPostNotContains: ['$'] }, posted).failures).toEqual([]);
    expect(checkStep({ groupPosts: 0 }, posted).failures).toEqual(['expected 0 group posts, got 1']);
    expect(checkStep({ groupPostContains: ['Sam'] }, posted).failures).toEqual(['group post should contain "Sam"']);
    expect(checkStep({ groupPostNotContains: ['Maria'] }, posted).failures).toEqual(['group post should NOT contain "Maria"']);
  });

  it('a quiet step has no group posts', () => {
    expect(checkStep({ groupPosts: 0 }, actual()).failures).toEqual([]);
  });
});

describe('task expectations', () => {
  const withTasks = actual({
    tasks: [
      { title: 'Check the coffee station', status: 'DONE', code: 1, evidenceType: 'photo', evidenceText: null, outcome: 'pass' },
      { title: 'Record fridge temperature', status: 'OPEN', code: 2, evidenceType: null, evidenceText: null, outcome: null },
    ],
    taskCounts: { OPEN: 1, DONE: 1, MISSED: 0, CANCELLED: 0 },
  });

  it('finds a task by part of its title, state, number and proof', () => {
    expect(checkStep({ tasks: [{ title: 'coffee', status: 'DONE', code: 1, evidenceType: 'photo' }, { title: 'fridge', status: 'OPEN' }] }, withTasks).failures).toEqual([]);
  });

  it('fails when a task is in the wrong state or has the wrong proof', () => {
    expect(checkStep({ tasks: [{ title: 'coffee', status: 'OPEN' }] }, withTasks).failures[0]).toContain('task "coffee" as OPEN');
    expect(checkStep({ tasks: [{ title: 'coffee', status: 'DONE', evidenceType: 'text' }] }, withTasks).failures).toHaveLength(1);
    expect(checkStep({ tasks: [{ title: 'fridge', status: 'OPEN', code: 9 }] }, withTasks).failures).toHaveLength(1);
  });

  it('counts tasks by state', () => {
    expect(checkStep({ taskCounts: { OPEN: 1, DONE: 1 } }, withTasks).failures).toEqual([]);
    expect(checkStep({ taskCounts: { MISSED: 2 } }, withTasks).failures).toEqual(['tasks MISSED: expected 2, got 0']);
  });
});
