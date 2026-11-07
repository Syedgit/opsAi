import { CATEGORY_LABEL, TASK_CATEGORIES, type TaskCategory } from './schedule';

/**
 * Inspection-style compliance score from task runs. Points come from each task.
 *
 * What counts: tasks that are finished, plus tasks still open after their "late" time.
 * A task that is open but not yet late is "pending" and neither helps nor hurts yet.
 */

export interface ScoredRun {
  category: string;
  points: number;
  status: string;
  dueAt: Date;
  completedAt: Date | null;
  lateAfterMinutes: number;
  criticality?: string | null;
}

export interface ScoreLine {
  earned: number;
  possible: number;
  /** 0-100, or null when nothing has counted yet. */
  percent: number | null;
  done: number;
  doneLate: number;
  missed: number;
  pending: number;
  /** Missed or late tasks that are Critical (worth 50): the ones an inspector penalises most. */
  criticalMissed: number;
}

export interface ScoreReport {
  total: ScoreLine;
  byCategory: Array<ScoreLine & { category: TaskCategory; label: string }>;
}

function emptyLine(): ScoreLine {
  return { earned: 0, possible: 0, percent: null, done: 0, doneLate: 0, missed: 0, pending: 0, criticalMissed: 0 };
}

function finish(line: ScoreLine): ScoreLine {
  return { ...line, percent: line.possible > 0 ? Math.round((line.earned / line.possible) * 100) : null };
}

export function isLate(run: Pick<ScoredRun, 'dueAt' | 'completedAt' | 'lateAfterMinutes'>): boolean {
  return Boolean(run.completedAt) && (run.completedAt as Date).getTime() - run.dueAt.getTime() > run.lateAfterMinutes * 60000;
}

function addRun(line: ScoreLine, run: ScoredRun, now: Date): void {
  // A task the owner switched off or removed is not held against the store.
  if (run.status === 'CANCELLED') return;
  if (run.status === 'DONE') {
    line.done += 1;
    line.possible += run.points;
    line.earned += run.points;
    if (isLate(run)) line.doneLate += 1;
    return;
  }
  const overdue = now.getTime() - run.dueAt.getTime() > run.lateAfterMinutes * 60000;
  if (run.status === 'MISSED' || overdue) {
    line.missed += 1;
    if (run.criticality === 'critical') line.criticalMissed += 1;
    line.possible += run.points;
  } else {
    line.pending += 1;
  }
}

export function scoreRuns(runs: ScoredRun[], now: Date): ScoreReport {
  const total = emptyLine();
  const buckets = new Map<TaskCategory, ScoreLine>();
  for (const run of runs) {
    addRun(total, run, now);
    const category = (TASK_CATEGORIES as readonly string[]).includes(run.category) ? (run.category as TaskCategory) : 'other';
    if (!buckets.has(category)) buckets.set(category, emptyLine());
    addRun(buckets.get(category) as ScoreLine, run, now);
  }
  return {
    total: finish(total),
    byCategory: TASK_CATEGORIES.filter((c) => buckets.has(c)).map((category) => ({
      category,
      label: CATEGORY_LABEL[category],
      ...finish(buckets.get(category) as ScoreLine),
    })),
  };
}
