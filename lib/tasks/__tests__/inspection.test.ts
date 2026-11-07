import { predictInspection, type CatalogStandard, type InspectionRun, type InspectionTemplate } from '../inspection';
import { TASK_PRESETS } from '../presets';

const NOW = new Date('2026-10-26T15:00:00Z');
const std = (standardId: string, points: number, over: Partial<CatalogStandard> = {}): CatalogStandard => ({
  standardId, presetId: `p-${standardId}`, title: `Standard ${standardId}`, category: 'food_safety', criticality: null, points, ...over,
});
const tpl = (id: string, standardId: string, points: number, over: Partial<InspectionTemplate> = {}): InspectionTemplate => ({ id, standardId, points, active: true, ...over });
const run = (templateId: string, over: Partial<InspectionRun> = {}): InspectionRun => ({
  templateId, status: 'DONE', outcome: 'pass', dueAt: new Date('2026-10-26T14:00:00Z'), localDate: '2026-10-26', lateAfterMinutes: 60, ...over,
});

describe('predictInspection', () => {
  const catalog = [std('FS6', 50), std('FS5', 20), std('PA1', 3)];

  it('scores passing and failing standards by their points', () => {
    const p = predictInspection(catalog, [tpl('a', 'FS6', 50), tpl('b', 'FS5', 20), tpl('c', 'PA1', 3)], [run('a'), run('b', { status: 'MISSED', outcome: null }), run('c')], NOW);
    expect(p).toMatchObject({ earned: 53, possible: 73, percent: 73, atRisk: 20 });
    expect(p.fails.map((f) => [f.standardId, f.reason])).toEqual([['FS5', 'missed']]);
  });

  it('lists the most expensive failures first', () => {
    const p = predictInspection(catalog, [tpl('a', 'FS6', 50), tpl('b', 'FS5', 20), tpl('c', 'PA1', 3)], [run('c', { status: 'MISSED' }), run('b', { status: 'MISSED' }), run('a', { status: 'MISSED' })], NOW);
    expect(p.fails.map((f) => f.standardId)).toEqual(['FS6', 'FS5', 'PA1']);
    expect(p.percent).toBe(0);
  });

  it('does not guess about standards nobody tracks: they are listed as risk and left out of the percentage', () => {
    const p = predictInspection(catalog, [tpl('a', 'FS6', 50)], [run('a')], NOW);
    expect(p.percent).toBe(100);
    expect(p.notTracked.map((n) => n.standardId)).toEqual(['FS5', 'PA1']);
    expect(p.untracked).toBe(23);
  });

  it('has no percentage until something has a result', () => {
    expect(predictInspection(catalog, [tpl('a', 'FS6', 50)], [], NOW).percent).toBeNull();
  });

  it('treats an open task that is not late yet as pending, and a late one as a failure', () => {
    const open = (over: Partial<InspectionRun>) => run('a', { status: 'OPEN', outcome: null, ...over });
    expect(predictInspection(catalog, [tpl('a', 'FS6', 50)], [open({ dueAt: new Date('2026-10-26T14:30:00Z') })], NOW).pending).toHaveLength(1);
    const late = predictInspection(catalog, [tpl('a', 'FS6', 50)], [open({ dueAt: new Date('2026-10-26T13:00:00Z') })], NOW);
    expect(late.fails.map((f) => f.reason)).toEqual(['not done']);
  });

  it('looks at the run before when the newest is only pending', () => {
    const runs = [
      run('a', { status: 'MISSED', outcome: null, dueAt: new Date('2026-10-26T13:00:00Z') }),
      run('a', { status: 'OPEN', outcome: null, dueAt: new Date('2026-10-26T14:50:00Z') }),
    ];
    expect(predictInspection(catalog, [tpl('a', 'FS6', 50)], runs, NOW).fails.map((f) => f.reason)).toEqual(['missed']);
    const doneBefore = [run('a', { dueAt: new Date('2026-10-26T13:00:00Z') }), runs[1]];
    expect(predictInspection(catalog, [tpl('a', 'FS6', 50)], doneBefore, NOW).percent).toBe(100);
  });

  it('fails a standard while a reading is out of range or a problem is reported', () => {
    const base = { status: 'OPEN', dueAt: new Date('2026-10-26T14:50:00Z') };
    expect(predictInspection(catalog, [tpl('a', 'FS6', 50)], [run('a', { ...base, outcome: 'fail' })], NOW).fails[0].reason).toBe('reading out of range');
    expect(predictInspection(catalog, [tpl('a', 'FS6', 50)], [run('a', { ...base, outcome: 'problem' })], NOW).fails[0].reason).toBe('problem reported');
  });

  it('ignores removed (cancelled) runs and switched-off tasks', () => {
    expect(predictInspection(catalog, [tpl('a', 'FS6', 50)], [run('a', { status: 'CANCELLED', outcome: null })], NOW).percent).toBeNull();
    const off = predictInspection(catalog, [tpl('a', 'FS6', 50, { active: false })], [run('a')], NOW);
    expect(off.notTracked.map((n) => n.standardId)).toContain('FS6');
  });

  it('fails a standard if any of its tasks fails, and passes only if all pass', () => {
    const templates = [tpl('a', 'FS6', 50), tpl('b', 'FS6', 50)];
    expect(predictInspection(catalog, templates, [run('a'), run('b', { status: 'MISSED' })], NOW).fails).toHaveLength(1);
    expect(predictInspection(catalog, templates, [run('a'), run('b')], NOW).passes).toHaveLength(1);
    expect(predictInspection(catalog, templates, [run('a')], NOW).pending).toHaveLength(1);
  });

  it('uses the store\'s own points when it changed them', () => {
    expect(predictInspection(catalog, [tpl('a', 'FS6', 30)], [run('a', { status: 'MISSED' })], NOW).atRisk).toBe(30);
  });

  it('flags a repeat finding when it went wrong on two different days', () => {
    const runs = [run('a', { status: 'MISSED', localDate: '2026-10-20' }), run('a', { status: 'MISSED', localDate: '2026-10-22' }), run('a')];
    expect(predictInspection(catalog, [tpl('a', 'FS6', 50)], runs, NOW).passes[0].repeat).toBe(true);
    expect(predictInspection(catalog, [tpl('a', 'FS6', 50)], [run('a', { status: 'MISSED', localDate: '2026-10-20' }), run('a')], NOW).passes[0].repeat).toBe(false);
  });

  it('raises an auto-fail warning for sanitizer and pests', () => {
    const c = [std('AF1', 50), std('FS6', 50)];
    const p = predictInspection(c, [tpl('a', 'AF1', 50), tpl('b', 'FS6', 50)], [run('a', { status: 'MISSED' }), run('b', { status: 'MISSED' })], NOW);
    expect(p.autoFail.map((r) => r.standardId)).toEqual(['AF1']);
  });

  it('leaves out fuel-island standards for a store that does not track them, and keeps them when it does', () => {
    const c = [std('FS6', 50), std('EC2', 3, { requires: 'fuel', category: 'exterior_cleanliness' })];
    expect(predictInspection(c, [tpl('a', 'FS6', 50)], [run('a')], NOW).notTracked.map((r) => r.standardId)).toEqual([]);
    expect(predictInspection(c, [tpl('a', 'FS6', 50), tpl('b', 'EC2', 3)], [run('a'), run('b')], NOW).passes).toHaveLength(2);
  });

  it('adds up by category', () => {
    const c = [std('FS6', 50), std('PB1', 50, { category: 'proprietary_beverage' })];
    const p = predictInspection(c, [tpl('a', 'FS6', 50), tpl('b', 'PB1', 50)], [run('a'), run('b', { status: 'MISSED' })], NOW);
    expect(p.byCategory.map((x) => [x.label, x.percent])).toEqual([['Food Safety', 100], ['Proprietary Beverage', 0]]);
  });

  it('works with the real starter library', () => {
    const catalog2 = TASK_PRESETS.filter((p) => p.source === 'report' && p.template.standardId).map((p) => ({
      standardId: p.template.standardId as string, presetId: p.id, title: p.template.title, category: p.template.category,
      criticality: p.template.criticality, points: p.template.points, requires: p.requires,
    }));
    expect(new Set(catalog2.map((s) => s.standardId)).size).toBe(catalog2.length); // one task per standard id
    const p = predictInspection(catalog2, [], [], NOW);
    expect(p.percent).toBeNull();
    expect(p.notTracked.length).toBe(catalog2.filter((s) => !s.requires).length);
  });

  it('counts a photo the AI would not pass as failing, and a manager-accepted one as passing', () => {
    const now = new Date('2026-10-26T15:00:00Z');
    const catalog = [{ standardId: 'FS6', presetId: 'a', title: 'Labels', category: 'food_safety', criticality: 'critical', points: 50 }];
    const templates = [{ id: 't1', standardId: 'FS6', points: 50, active: true }];
    const open = { templateId: 't1', status: 'OPEN', outcome: 'photo_fail', dueAt: new Date('2026-10-26T14:00:00Z'), localDate: '2026-10-26', lateAfterMinutes: 600 };
    const failing = predictInspection(catalog, templates, [open], now);
    expect(failing.fails[0]).toMatchObject({ standardId: 'FS6', reason: 'photo did not pass the check' });
    const accepted = predictInspection(catalog, templates, [{ ...open, status: 'DONE', outcome: 'fixed' }], now);
    expect(accepted.passes.map((r) => r.standardId)).toEqual(['FS6']);
  });
});
