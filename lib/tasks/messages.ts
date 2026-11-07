import { formatLocalTime } from './time';

/** Wording for task alerts and replies. Short on purpose: these land in a busy shift group. */

export interface MessageRun {
  code: number;
  title: string;
  evidence: string;
  dueAt: Date;
  instructions?: string | null;
  standardId?: string | null;
  criticality?: string | null;
  minValue?: number | null;
  maxValue?: number | null;
  unit?: string | null;
  fallback?: string | null;
}

type Limits = Pick<MessageRun, 'minValue' | 'maxValue' | 'unit'>;

export function hasLimit(run: Limits): boolean {
  return (run.minValue ?? null) !== null || (run.maxValue ?? null) !== null;
}

/** "40F or lower", "140F or higher", "between 1 and 3 rows". */
export function describeLimit(run: Limits): string {
  const unit = run.unit ?? '';
  const num = (n: number) => `${n}${/^[A-Za-z]{1,2}$/.test(unit) || unit === '' ? '' : ' '}${unit}`;
  const min = run.minValue ?? null;
  const max = run.maxValue ?? null;
  if (min !== null && max !== null) return `between ${min} and ${num(max)}`;
  if (max !== null) return `${num(max)} or lower`;
  if (min !== null) return `${num(min)} or higher`;
  return '';
}

function proof(evidence: string, run?: Limits): string {
  if (run && hasLimit(run)) return `reply with the number (${describeLimit(run)})`;
  switch (evidence) {
    case 'photo':
      return 'send a photo';
    case 'text':
      return 'reply with text';
    case 'none':
      return 'reply done';
    default:
      return 'send a photo or text';
  }
}

/** "3. [FS6] Title" with a marker on Critical tasks, the ones an inspector penalises most. */
function label(run: MessageRun): string {
  const id = run.standardId ? `[${run.standardId}] ` : '';
  return `${run.code}. ${run.criticality === 'critical' ? '❗' : ''}${id}${run.title}`;
}

function line(run: MessageRun, timeZone: string): string {
  const base = `${label(run)} (due ${formatLocalTime(run.dueAt, timeZone)}) — ${proof(run.evidence, run)}`;
  return run.instructions ? `${base}\n   ${run.instructions}` : base;
}

const HOW_TO = 'Answer with the task number and your proof, for example send a photo with the caption 1, or type "1 done". I will keep reminding until it is done.';

export function alertMessage(storeName: string, runs: MessageRun[], timeZone: string): string {
  return [`⏰ ${storeName} · tasks due now`, ...runs.map((r) => line(r, timeZone)), '', HOW_TO].join('\n');
}

export function reminderMessage(storeName: string, runs: MessageRun[], timeZone: string, now: Date): string {
  const lines = runs.map((r) => {
    const minutes = Math.max(0, Math.round((now.getTime() - r.dueAt.getTime()) / 60000));
    return `${label(r)} (due ${formatLocalTime(r.dueAt, timeZone)}, ${minutes} min ago) — ${proof(r.evidence, r)}`;
  });
  return [`🔔 ${storeName} · still open`, ...lines, '', 'Reply with the number and your proof.'].join('\n');
}

export function escalationMessage(storeName: string, runs: MessageRun[], timeZone: string, now: Date): string {
  const lines = runs.map((r) => {
    const minutes = Math.max(0, Math.round((now.getTime() - r.dueAt.getTime()) / 60000));
    return `${label(r)} (due ${formatLocalTime(r.dueAt, timeZone)}, ${minutes} min ago)`;
  });
  return [`🚨 ${storeName} · not done yet`, ...lines, '', 'The team has been reminded. Reply TASKS to see everything open.'].join('\n');
}

export function doneMessage(run: MessageRun, completedAt: Date, timeZone: string, lateMinutes: number, stillOpen: number, reading?: string): string {
  const when = formatLocalTime(completedAt, timeZone);
  const late = lateMinutes > 0 ? ` (${lateMinutes} min late)` : '';
  const rest = stillOpen > 0 ? `\n${stillOpen} more open. Reply TASKS to see them.` : '\nAll tasks done for now. 👍';
  return `✅ Task ${run.code} · ${run.title} done at ${when}${late}${reading ? ` · ${reading}` : ''}.${rest}`;
}

export function needsPhotoMessage(run: MessageRun): string {
  return `📸 Task ${run.code} · ${run.title} needs a photo. Send a photo with ${run.code} as the caption.`;
}

export function needsTextMessage(run: MessageRun): string {
  return `✍️ Task ${run.code} · ${run.title} needs a short answer. Type it like: ${run.code} 190F`;
}

export function askWhichMessage(runs: MessageRun[], timeZone: string): string {
  return [
    '📎 Got your photo. Which task is it for? Reply with the number:',
    ...runs.map((r) => `${r.code}. ${r.title} (due ${formatLocalTime(r.dueAt, timeZone)})`),
  ].join('\n');
}

export function noSuchTaskMessage(code: number, runs: MessageRun[], timeZone: string): string {
  if (runs.length === 0) return `There is no open task ${code}. Nothing is waiting on you right now. 👍`;
  return [`There is no open task ${code}. Open tasks:`, ...runs.map((r) => `${r.code}. ${r.title} (due ${formatLocalTime(r.dueAt, timeZone)})`)].join('\n');
}

export function openTasksMessage(storeName: string, runs: MessageRun[], timeZone: string): string {
  if (runs.length === 0) return `✅ ${storeName} · no open tasks right now.`;
  return [`📋 ${storeName} · open tasks`, ...runs.map((r) => line(r, timeZone)), '', 'Reply with the number and your proof.'].join('\n');
}

/** Reply to the employee when a number is needed and none was found. */
export function needsNumberMessage(run: MessageRun): string {
  return `🔢 Task ${run.code} · ${run.title} needs the number (${describeLimit(run)}). Type it like: ${run.code} ${run.maxValue ?? run.minValue ?? 0}`;
}

/** The reading is outside the limit: the task stays open. */
export function outOfRangeMessage(run: MessageRun, value: number, managersTold: boolean): string {
  const unit = run.unit ? (/^[A-Za-z]{1,2}$/.test(run.unit) ? run.unit : ` ${run.unit}`) : '';
  const fix = run.fallback ? `\nWhat to do: ${run.fallback}` : '';
  return [
    `⚠️ Task ${run.code} · ${run.title}: ${value}${unit} is not ${describeLimit(run)}.`,
    `Fix it, then send the new number like: ${run.code} ${run.maxValue ?? run.minValue ?? 0}. The task stays open until it is in range.${fix}`,
    managersTold ? 'Your manager has been told.' : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Employee reported that something is broken or wrong. */
export function problemMessage(run: MessageRun, issue: string, managersTold: boolean): string {
  const fix = run.fallback ? `\nWhile it is broken: ${run.fallback}` : '';
  return [
    `🛠️ Noted for task ${run.code} · ${run.title}: ${issue}.${fix}`,
    `Do the task another way if you can and send the proof like: ${run.code} done. The task stays open until you do.`,
    managersTold ? 'Your manager has been told.' : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** To owners and managers when a reading is out of range or a problem was reported. */
export function managerAlertMessage(storeName: string, run: MessageRun, detail: string): string {
  return `🚨 ${storeName} · ${label(run)}\n${detail}`;
}

/** The AI looked at the photo and it does not show what the task needs. The task stays open. */
export function photoRejectedMessage(run: MessageRun, reason: string, managersTold: boolean): string {
  const fix = run.fallback ? `\nIf something is broken: ${run.fallback}` : '';
  return [
    `❌ Task ${run.code} · ${run.title} is not done yet. The photo does not show it: ${reason}`,
    `Fix it and send a new photo with ${run.code} as the caption.${fix}`,
    managersTold ? 'Your manager has been told.' : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** The AI could not tell. Not the employee's fault: ask for a better photo. */
export function photoUnclearMessage(run: MessageRun, reason: string): string {
  return `🔍 Task ${run.code} · ${run.title}: I can't tell from that photo (${reason}). Send a clearer one with ${run.code} as the caption.`;
}

export function photoStuckMessage(storeName: string, run: MessageRun, misses: number): string {
  return `🚨 ${storeName} · ${label(run)}\n${misses} photos did not pass the check. Look at the latest photo in Tasks. If it is fine, tap "Accept photo" there.`;
}
