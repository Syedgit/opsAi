import { CATEGORY_LABEL, TASK_CATEGORIES, type TaskCategory } from './schedule';

/**
 * "If the inspector walked in right now": a predicted 7Clean-style result from what the store has actually
 * proven through its tasks. Pure, no database.
 *
 * It only knows the standards in the starter library (what the 7Clean report shows). So the percentage is
 * "of the standards you track", not the inspector's whole list, and standards the store does not track are
 * listed separately as risk instead of being guessed.
 */

export interface CatalogStandard {
  standardId: string;
  presetId: string;
  title: string;
  category: string;
  criticality: string | null;
  points: number;
  /** Only applies to stores that have this (for example fuel pumps). */
  requires?: string;
}

export interface InspectionTemplate {
  id: string;
  standardId: string | null;
  points: number;
  active: boolean;
  /** Used to show a standard the store added itself (for example from an inspector's report) that is not in the starter list. */
  title?: string;
  category?: string;
  criticality?: string | null;
}

export interface InspectionRun {
  templateId: string;
  status: string;
  outcome: string | null;
  dueAt: Date;
  localDate: string;
  lateAfterMinutes: number;
}

export type StandardState = 'pass' | 'fail' | 'pending' | 'not_tracked';

export interface StandardResult {
  standardId: string;
  presetId: string;
  title: string;
  category: string;
  criticality: string | null;
  points: number;
  state: StandardState;
  /** Why it would lose points: "not done", "missed", "reading out of range", "problem reported". */
  reason: string | null;
  /** Went wrong on two or more different days in the last two weeks, or failed last inspection and is failing now. */
  repeat: boolean;
  /** The inspector found this at the last imported inspection. */
  lastFinding: boolean;
}

export interface InspectionPrediction {
  /** 0-100 over the tracked standards that have a result, or null when nothing has a result yet. */
  percent: number | null;
  earned: number;
  possible: number;
  /** Points that would be lost right now. */
  atRisk: number;
  /** Points in standards nobody tracks yet, which an inspector would still check. */
  untracked: number;
  fails: StandardResult[];
  pending: StandardResult[];
  passes: StandardResult[];
  notTracked: StandardResult[];
  /** Auto-fail standards (sanitizer, pests) that are failing: the whole inspection can fail on these. */
  autoFail: StandardResult[];
  byCategory: Array<{ category: TaskCategory; label: string; earned: number; possible: number; percent: number | null }>;
}

const AUTO_FAIL_IDS = new Set(['AF1', 'AF2']);
const BAD_OUTCOMES = new Set(['fail', 'problem', 'fixed', 'photo_fail']);

interface TemplateState {
  state: 'pass' | 'fail' | 'pending';
  reason: string | null;
}

/** The store's current standing on one task, from its most recent runs. */
function templateState(runs: InspectionRun[], now: Date): TemplateState {
  const due = runs
    .filter((r) => r.status !== 'CANCELLED' && r.dueAt.getTime() <= now.getTime())
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  // Newest first. An open task that is not late yet says nothing, so look at the one before it.
  for (let i = due.length - 1; i >= 0; i -= 1) {
    const run = due[i];
    if (run.status === 'DONE') return { state: 'pass', reason: null };
    if (run.status === 'MISSED') return { state: 'fail', reason: 'missed' };
    if (run.outcome === 'fail') return { state: 'fail', reason: 'reading out of range' };
    if (run.outcome === 'problem') return { state: 'fail', reason: 'problem reported' };
    if (run.outcome === 'photo_fail') return { state: 'fail', reason: 'photo did not pass the check' };
    if (now.getTime() - run.dueAt.getTime() > run.lateAfterMinutes * 60000) return { state: 'fail', reason: 'not done' };
  }
  return { state: 'pending', reason: null };
}

export function predictInspection(
  catalog: CatalogStandard[],
  templates: InspectionTemplate[],
  runs: InspectionRun[],
  now: Date,
  /** Standards the inspector found at the last imported inspection. */
  lastFindings: ReadonlySet<string> = new Set(),
): InspectionPrediction {
  const active = templates.filter((t) => t.active && t.standardId);
  // Standards the store tracks that are not in the starter list (added from a report, or by hand) still count.
  const known = new Set(catalog.map((c) => c.standardId));
  const extra: CatalogStandard[] = [];
  for (const t of active) {
    const id = t.standardId as string;
    if (known.has(id)) continue;
    known.add(id);
    extra.push({ standardId: id, presetId: '', title: t.title ?? id, category: t.category ?? 'other', criticality: t.criticality ?? null, points: t.points });
  }
  catalog = [...catalog, ...extra];
  const byStandard = new Map<string, InspectionTemplate[]>();
  for (const t of active) byStandard.set(t.standardId as string, [...(byStandard.get(t.standardId as string) ?? []), t]);
  const runsByTemplate = new Map<string, InspectionRun[]>();
  for (const r of runs) runsByTemplate.set(r.templateId, [...(runsByTemplate.get(r.templateId) ?? []), r]);

  const results: StandardResult[] = [];
  for (const standard of catalog) {
    const mine = byStandard.get(standard.standardId) ?? [];
    // A standard that needs something the store does not seem to have (fuel pumps) is left out unless it is tracked.
    if (mine.length === 0 && standard.requires) continue;

    const base = { standardId: standard.standardId, presetId: standard.presetId, title: standard.title, category: standard.category, criticality: standard.criticality };
    if (mine.length === 0) {
      results.push({ ...base, points: standard.points, state: 'not_tracked', reason: null, repeat: false, lastFinding: lastFindings.has(standard.standardId) });
      continue;
    }
    const states = mine.map((t) => templateState(runsByTemplate.get(t.id) ?? [], now));
    const failed = states.find((s) => s.state === 'fail');
    const state: StandardState = failed ? 'fail' : states.every((s) => s.state === 'pass') ? 'pass' : 'pending';

    const badDays = new Set<string>();
    for (const t of mine) {
      for (const r of runsByTemplate.get(t.id) ?? []) {
        if (r.status === 'MISSED' || (r.outcome && BAD_OUTCOMES.has(r.outcome))) badDays.add(r.localDate);
      }
    }
    results.push({
      ...base,
      points: Math.max(...mine.map((t) => t.points)),
      state,
      reason: failed?.reason ?? null,
      repeat: badDays.size >= 2 || (state === 'fail' && lastFindings.has(standard.standardId)),
      lastFinding: lastFindings.has(standard.standardId),
    });
  }

  const of = (state: StandardState) => results.filter((r) => r.state === state);
  const sum = (list: StandardResult[]) => list.reduce((n, r) => n + r.points, 0);
  const passes = of('pass');
  const fails = of('fail').sort((a, b) => b.points - a.points);
  const earned = sum(passes);
  const possible = earned + sum(fails);

  const byCategory = TASK_CATEGORIES.flatMap((category) => {
    const inCategory = results.filter((r) => r.category === category && (r.state === 'pass' || r.state === 'fail'));
    if (inCategory.length === 0) return [];
    const e = sum(inCategory.filter((r) => r.state === 'pass'));
    const p = sum(inCategory);
    return [{ category, label: CATEGORY_LABEL[category], earned: e, possible: p, percent: p > 0 ? Math.round((e / p) * 100) : null }];
  });

  return {
    percent: possible > 0 ? Math.round((earned / possible) * 100) : null,
    earned,
    possible,
    atRisk: sum(fails),
    untracked: sum(of('not_tracked')),
    fails,
    pending: of('pending'),
    passes,
    notTracked: of('not_tracked').sort((a, b) => Number(b.lastFinding) - Number(a.lastFinding) || b.points - a.points),
    autoFail: fails.filter((r) => AUTO_FAIL_IDS.has(r.standardId)),
    byCategory,
  };
}
