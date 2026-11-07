import { CRITICALITY_POINTS, TASK_CATEGORIES, TaskTemplateInputSchema, dueMinutesOfDay } from '../schedule';
import { TASK_PRESETS, getPreset } from '../presets';
import { scoreRuns } from '../score';
import { describeLimit, hasLimit, needsNumberMessage, outOfRangeMessage, alertMessage } from '../messages';
import { isProblemReport, parseNumber, withinLimits } from '../evidence';

const base = { title: 'Check', startTime: '10:00' };

describe('criticality and points', () => {
  it('uses the 7Clean weights: Critical 50, Major 20, Minor 3', () => {
    expect(CRITICALITY_POINTS).toEqual({ critical: 50, major: 20, minor: 3 });
    expect(TaskTemplateInputSchema.parse({ ...base, criticality: 'critical' }).points).toBe(50);
    expect(TaskTemplateInputSchema.parse({ ...base, criticality: 'major' }).points).toBe(20);
    expect(TaskTemplateInputSchema.parse({ ...base, criticality: 'minor' }).points).toBe(3);
  });

  it('lets the owner set points explicitly, and defaults to 1 without a criticality', () => {
    expect(TaskTemplateInputSchema.parse({ ...base, criticality: 'critical', points: 40 }).points).toBe(40);
    expect(TaskTemplateInputSchema.parse(base).points).toBe(1);
  });

  it('allows up to 100 points and no more', () => {
    expect(TaskTemplateInputSchema.safeParse({ ...base, points: 100 }).success).toBe(true);
    expect(TaskTemplateInputSchema.safeParse({ ...base, points: 101 }).success).toBe(false);
  });

  it('upper-cases a standard id and drops an empty one', () => {
    expect(TaskTemplateInputSchema.parse({ ...base, standardId: ' fs6 ' }).standardId).toBe('FS6');
    expect(TaskTemplateInputSchema.parse({ ...base, standardId: '' }).standardId).toBeNull();
  });
});

describe('answer limits in the task form', () => {
  it('accepts a limit with a text answer', () => {
    expect(TaskTemplateInputSchema.safeParse({ ...base, maxValue: 40, unit: 'F', evidence: 'text' }).success).toBe(true);
  });
  it('refuses a limit on a photo-only or done-only task', () => {
    expect(TaskTemplateInputSchema.safeParse({ ...base, maxValue: 40, evidence: 'photo' }).success).toBe(false);
    expect(TaskTemplateInputSchema.safeParse({ ...base, minValue: 4, evidence: 'none' }).success).toBe(false);
  });
  it('refuses a lowest answer above the highest', () => {
    expect(TaskTemplateInputSchema.safeParse({ ...base, minValue: 5, maxValue: 2, evidence: 'text' }).success).toBe(false);
  });
});

describe('limits', () => {
  it('reads a number out of a reply', () => {
    expect(parseNumber('38')).toBe(38);
    expect(parseNumber('38F')).toBe(38);
    expect(parseNumber('it is 38.5 degrees')).toBe(38.5);
    expect(parseNumber('-5')).toBe(-5);
    expect(parseNumber('none')).toBeNull();
  });

  it('checks a reading against the limits (the limits themselves are allowed)', () => {
    expect(withinLimits({ minValue: null, maxValue: 40 }, 40)).toBe(true);
    expect(withinLimits({ minValue: null, maxValue: 40 }, 41)).toBe(false);
    expect(withinLimits({ minValue: 140, maxValue: null }, 140)).toBe(true);
    expect(withinLimits({ minValue: 140, maxValue: null }, 139)).toBe(false);
    expect(withinLimits({ minValue: 1, maxValue: 3 }, 2)).toBe(true);
    expect(withinLimits({ minValue: 1, maxValue: 3 }, 0)).toBe(false);
  });

  it('describes a limit in plain words', () => {
    expect(describeLimit({ minValue: null, maxValue: 40, unit: 'F' })).toBe('40F or lower');
    expect(describeLimit({ minValue: 140, maxValue: null, unit: 'F' })).toBe('140F or higher');
    expect(describeLimit({ minValue: 4, maxValue: null, unit: 'items' })).toBe('4 items or higher');
    expect(hasLimit({ minValue: null, maxValue: null })).toBe(false);
    expect(hasLimit({ minValue: 0, maxValue: null })).toBe(true);
  });

  it('tells the employee the limit, what to do, and that the task stays open', () => {
    const run = { code: 2, title: 'Cold holding', evidence: 'text', dueAt: new Date(), maxValue: 40, unit: 'F', fallback: 'Use a probe thermometer.' };
    const text = outOfRangeMessage(run, 45, true);
    expect(text).toContain('45F is not 40F or lower');
    expect(text).toContain('stays open');
    expect(text).toContain('Use a probe thermometer.');
    expect(text).toContain('manager has been told');
    expect(needsNumberMessage(run)).toContain('40F or lower');
  });

  it('shows the standard, the limit and a Critical marker in the alert', () => {
    const text = alertMessage(
      'Rockaway',
      [{ code: 1, title: 'Roller grill', evidence: 'text', dueAt: new Date('2026-10-26T14:00:00Z'), standardId: 'PF5', criticality: 'critical', minValue: 140, unit: 'F' }],
      'America/New_York'
    );
    expect(text).toContain('1. ❗[PF5] Roller grill');
    expect(text).toContain('reply with the number (140F or higher)');
  });
});

describe('problem reports', () => {
  it.each(['problem label printer broken', 'broken', 'not working', "can't find the thermometer", 'cannot reach the shelf', 'Issue: no power'])('%j is a problem', (text) => {
    expect(isProblemReport(text)).toBe(true);
  });
  it.each(['done', '38F', 'all good', 'no problem', 'cooler is fine'])('%j is not', (text) => {
    expect(isProblemReport(text)).toBe(false);
  });
});

describe('critical misses in the score', () => {
  it('counts Critical tasks that were missed', () => {
    const now = new Date('2026-10-26T20:00:00Z');
    const run = (over: Record<string, unknown>) => ({ category: 'food_safety', points: 50, status: 'MISSED', dueAt: new Date('2026-10-26T14:00:00Z'), completedAt: null, lateAfterMinutes: 60, criticality: 'critical', ...over });
    const report = scoreRuns([run({}), run({ criticality: 'minor', points: 3 }), run({ status: 'DONE', completedAt: new Date('2026-10-26T14:05:00Z') })], now);
    expect(report.total.criticalMissed).toBe(1);
    expect(report.total).toMatchObject({ earned: 50, possible: 103, done: 1, missed: 2 });
  });
});

describe('the 7-Eleven starter library', () => {
  it('has unique ids and every task is valid', () => {
    const ids = TASK_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of TASK_PRESETS) {
      expect(TaskTemplateInputSchema.safeParse(p.template).success).toBe(true);
      expect((TASK_CATEGORIES as readonly string[]).includes(p.template.category)).toBe(true);
    }
  });

  it('uses the report\'s points for the standards it shows', () => {
    const points = (id: string) => getPreset(id)?.template.points;
    expect(points('fs6-milk-labels')).toBe(50); // FS6 Critical
    expect(points('fs1-condiments')).toBe(50); // FS1 Critical
    expect(points('pf5-roller-grill')).toBe(50); // PF5 Critical
    expect(points('pb1-fountain')).toBe(50); // PB1 Critical
    expect(points('fs5-cold-holding')).toBe(20); // FS5 Major
    expect(points('fs14-handwashing')).toBe(20); // FS14 Major
    expect(points('pf6-buns')).toBe(20); // PF6 Major
    expect(points('pf7-chili-cheese')).toBe(20); // PF7 Major
    expect(points('v2-vault-racks')).toBe(20); // V2 Major
    expect(points('pa1-vault-doors')).toBe(3); // PA1 Minor
    expect(points('pa6-fountain-flavors')).toBe(3); // PA6 Minor
  });

  it('carries the limits the report states', () => {
    expect(getPreset('fs5-cold-holding')?.template).toMatchObject({ maxValue: 40, minValue: null, unit: 'F' });
    expect(getPreset('pf5-roller-grill')?.template).toMatchObject({ minValue: 140, maxValue: null });
    expect(getPreset('pa2-hot-case')?.template.minValue).toBe(4);
    expect(getPreset('pa6-fountain-flavors')?.template.maxValue).toBe(1);
  });

  it('gives every label task a fallback for a broken printer', () => {
    for (const id of ['fs6-milk-labels', 'fs1-condiments', 'pf7-chili-cheese']) {
      expect(getPreset(id)?.template.fallback).toMatch(/marker|hand/i);
    }
  });

  it('asks about milk and creamer labels every hour from 7am', () => {
    const t = getPreset('fs6-milk-labels')!.template;
    const times = dueMinutesOfDay(t, '2026-10-26');
    expect(times[0]).toBe(7 * 60);
    expect(times[1] - times[0]).toBe(60);
  });

  it('only offers fuel-island tasks to stores with fuel pumps', () => {
    expect(getPreset('ec2-fuel-islands')?.requires).toBe('fuel');
    expect(TASK_PRESETS.filter((p) => p.requires && p.source === 'report').map((p) => p.id)).toEqual(['ec2-fuel-islands']);
    expect(TASK_PRESETS.filter((p) => p.requires).map((p) => p.id)).toEqual(expect.arrayContaining(['ec2-fuel-islands', 'own-fuel-islands', 'own-pump-check', 'own-spill-kit']));
  });

  it('tells apart what comes from the report and what we added', () => {
    expect(getPreset('fs6-milk-labels')?.source).toBe('report');
    expect(getPreset('own-coffee-station')?.source).toBe('suggested');
    expect(TASK_PRESETS.filter((p) => p.source === 'report').every((p) => p.template.standardId)).toBe(true);
  });
});
