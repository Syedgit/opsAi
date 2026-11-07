import type { EntryExpect, EntryView, StepActual, StepExpect } from './types';

export interface Verdict {
  failures: string[];
  /** How many individual things were compared (for the accuracy score). */
  checked: number;
}

const MONEY_TOLERANCE = 0.01;

function newVerdict(): Verdict {
  return { failures: [], checked: 0 };
}

function show(value: unknown): string {
  return value === undefined ? 'nothing' : JSON.stringify(value);
}

function compareNumber(v: Verdict, label: string, expected: number | null, actual: number | null | undefined): void {
  v.checked += 1;
  if (expected === null) {
    if (actual !== null && actual !== undefined) v.failures.push(`${label}: expected nothing, got ${show(actual)}`);
    return;
  }
  if (actual === null || actual === undefined || Math.abs(Number(actual) - expected) > MONEY_TOLERANCE) {
    v.failures.push(`${label}: expected ${expected}, got ${show(actual)}`);
  }
}

function compareContains(v: Verdict, label: string, expected: string, actual: string | null | undefined): void {
  v.checked += 1;
  if (!actual || !actual.toLowerCase().includes(expected.toLowerCase())) {
    v.failures.push(`${label}: expected something like "${expected}", got ${show(actual)}`);
  }
}

function compareExact(v: Verdict, label: string, expected: string | null, actual: string | null | undefined): void {
  v.checked += 1;
  const a = actual === undefined ? null : actual;
  if ((a === null ? null : String(a).trim()) !== (expected === null ? null : expected.trim())) {
    v.failures.push(`${label}: expected ${show(expected)}, got ${show(actual)}`);
  }
}

export function checkEntry(expected: EntryExpect, actual: EntryView, label: string): Verdict {
  const v = newVerdict();

  if (expected.kind !== undefined) compareExact(v, `${label} kind`, expected.kind, actual.kind);
  if (expected.store !== undefined) compareContains(v, `${label} store`, expected.store, actual.store);
  if (expected.date !== undefined) compareExact(v, `${label} date`, expected.date, actual.date);

  const numbers: Array<[keyof EntryExpect & keyof EntryView, string]> = [
    ['cash', 'cash'],
    ['card', 'card'],
    ['insideTotal', 'inside total'],
    ['fuel', 'gas'],
    ['gallons', 'gallons'],
    ['deposit', 'deposit'],
    ['dayTotal', 'day total'],
    ['total', 'total'],
  ];
  for (const [key, name] of numbers) {
    const want = expected[key] as number | null | undefined;
    if (want !== undefined) compareNumber(v, `${label} ${name}`, want, actual[key] as number | null | undefined);
  }

  if (expected.vendor !== undefined) compareContains(v, `${label} vendor`, expected.vendor, actual.vendor);
  if (expected.bank !== undefined) compareContains(v, `${label} bank`, expected.bank, actual.bank);
  if (expected.invoiceNumber !== undefined) compareExact(v, `${label} invoice number`, expected.invoiceNumber, actual.invoiceNumber);
  if (expected.accountLast4 !== undefined) compareExact(v, `${label} account last 4`, expected.accountLast4, actual.accountLast4);
  if (expected.paymentStatus !== undefined) compareExact(v, `${label} payment status`, expected.paymentStatus, actual.paymentStatus);
  if (expected.lineCount !== undefined) {
    v.checked += 1;
    if (actual.lineCount !== expected.lineCount) v.failures.push(`${label} line items: expected ${expected.lineCount}, got ${show(actual.lineCount)}`);
  }

  if (expected.payouts !== undefined) {
    const got = actual.payouts ?? [];
    v.checked += 1;
    if (got.length !== expected.payouts.length) {
      v.failures.push(`${label} payouts: expected ${expected.payouts.length}, got ${got.length} (${show(got)})`);
    }
    for (const want of expected.payouts) {
      v.checked += 1;
      const hit = got.find((p) => p.label.toLowerCase().includes(want.label.toLowerCase()) && Math.abs(p.amount - want.amount) <= MONEY_TOLERANCE);
      if (!hit) v.failures.push(`${label} payout "${want.label}" ${want.amount}: not found in ${show(got)}`);
    }
  }

  if (expected.checks) {
    for (const [id, status] of Object.entries(expected.checks)) {
      v.checked += 1;
      if (actual.checks[id] !== status) v.failures.push(`${label} check ${id}: expected ${status}, got ${show(actual.checks[id])}`);
    }
  }
  const raised = Object.entries(actual.checks).filter(([, s]) => s === 'warn' || s === 'fail').map(([id]) => id);
  if (expected.warnings) {
    for (const id of expected.warnings) {
      v.checked += 1;
      if (!raised.includes(id)) v.failures.push(`${label}: expected a warning "${id}", warnings were ${show(raised)}`);
    }
  }
  if (expected.clean !== undefined) {
    v.checked += 1;
    if (expected.clean && raised.length > 0) v.failures.push(`${label}: expected no warnings, got ${show(raised)}`);
    if (!expected.clean && raised.length === 0) v.failures.push(`${label}: expected at least one warning, got none`);
  }
  if (expected.employees !== undefined) {
    v.checked += 1;
    const got = actual.employees ?? [];
    if (got.length !== expected.employees.length) {
      v.failures.push(`${label}: expected ${expected.employees.length} employees, got ${got.length} (${show(got.map((e) => e.name))})`);
    }
    expected.employees.forEach((want, i) => {
      const g = got[i];
      v.checked += 1;
      if (!g || g.name.trim().toLowerCase() !== want.name.trim().toLowerCase()) {
        v.failures.push(`${label} employee ${i + 1}: expected ${want.name}, got ${show(g?.name)}`);
        return;
      }
      compareNumber(v, `${label} ${want.name} hours`, want.hours, g.hours);
    });
  }
  if (expected.totalHours !== undefined) compareNumber(v, `${label} total hours`, expected.totalHours, actual.totalHours);
  if (expected.suggestsDepositRule !== undefined) {
    v.checked += 1;
    if (actual.suggestsDepositRule !== expected.suggestsDepositRule) {
      v.failures.push(`${label}: expected suggestsDepositRule=${expected.suggestsDepositRule}, got ${actual.suggestsDepositRule}`);
    }
  }
  return v;
}

export function checkStep(expected: StepExpect | undefined, actual: StepActual): Verdict {
  const v = newVerdict();
  if (!expected) return v;

  v.checked += 1;
  const wantStatus = expected.httpStatus ?? 200;
  if (actual.httpStatus !== wantStatus) v.failures.push(`webhook answered ${actual.httpStatus}, expected ${wantStatus}`);

  const allReplies = actual.replies.join('\n---\n').toLowerCase();
  if (expected.noReply) {
    v.checked += 1;
    if (actual.replies.length > 0) v.failures.push(`expected no reply, got ${actual.replies.length}`);
  }
  if (expected.replyCount !== undefined) {
    v.checked += 1;
    if (actual.replies.length !== expected.replyCount) v.failures.push(`expected ${expected.replyCount} replies, got ${actual.replies.length}`);
  }
  for (const text of expected.replyContains ?? []) {
    v.checked += 1;
    if (!allReplies.includes(text.toLowerCase())) v.failures.push(`reply should contain "${text}"`);
  }
  for (const text of expected.replyNotContains ?? []) {
    v.checked += 1;
    if (allReplies.includes(text.toLowerCase())) v.failures.push(`reply should NOT contain "${text}"`);
  }

  const groupText = actual.groupPosts.join('\n---\n').toLowerCase();
  if (expected.groupPosts !== undefined) {
    v.checked += 1;
    if (actual.groupPosts.length !== expected.groupPosts) v.failures.push(`expected ${expected.groupPosts} group posts, got ${actual.groupPosts.length}`);
  }
  for (const text of expected.groupPostContains ?? []) {
    v.checked += 1;
    if (!groupText.includes(text.toLowerCase())) v.failures.push(`group post should contain "${text}"`);
  }
  for (const text of expected.groupPostNotContains ?? []) {
    v.checked += 1;
    if (groupText.includes(text.toLowerCase())) v.failures.push(`group post should NOT contain "${text}"`);
  }

  if (expected.entries) {
    v.checked += 1;
    if (actual.entries.length !== expected.entries.length) {
      v.failures.push(`expected ${expected.entries.length} entries, got ${actual.entries.length}`);
    }
    expected.entries.forEach((want, i) => {
      const got = actual.entries[i];
      if (!got) {
        v.failures.push(`entry ${i + 1}: missing`);
        v.checked += 1;
        return;
      }
      const entry = checkEntry(want, got, `entry ${i + 1}`);
      v.failures.push(...entry.failures);
      v.checked += entry.checked;
    });
  }

  if (expected.status) {
    for (const [state, count] of Object.entries(expected.status)) {
      v.checked += 1;
      const got = actual.status[state as keyof StepActual['status']];
      if (got !== count) v.failures.push(`entries ${state}: expected ${count}, got ${got}`);
    }
  }

  if (expected.savedRule) {
    for (const [store, want] of Object.entries(expected.savedRule)) {
      v.checked += 1;
      if (actual.savedRule[store] !== want) v.failures.push(`${store} saved deposit rule: expected ${want}, got ${actual.savedRule[store]}`);
    }
  }

  for (const want of expected.tasks ?? []) {
    v.checked += 1;
    const hit = actual.tasks.find(
      (t) =>
        t.title.toLowerCase().includes(want.title.toLowerCase()) &&
        t.status === want.status &&
        (want.code === undefined || t.code === want.code) &&
        (want.evidenceType === undefined || t.evidenceType === want.evidenceType) &&
        (want.outcome === undefined || t.outcome === want.outcome) &&
        (want.photoVerdict === undefined || t.photoVerdict === want.photoVerdict) &&
        (want.evidenceText === undefined || (t.evidenceText ?? '').toLowerCase().includes(want.evidenceText.toLowerCase()))
    );
    if (!hit) {
      const same = actual.tasks.filter((t) => t.title.toLowerCase().includes(want.title.toLowerCase()));
      v.failures.push(`task "${want.title}" as ${want.status}${want.code !== undefined ? ` #${want.code}` : ''}: not found (matching tasks: ${show(same)})`);
    }
  }
  if (expected.taskCounts) {
    for (const [state, count] of Object.entries(expected.taskCounts)) {
      v.checked += 1;
      const got = actual.taskCounts[state as keyof StepActual['taskCounts']];
      if (got !== count) v.failures.push(`tasks ${state}: expected ${count}, got ${got}`);
    }
  }

  if (expected.dashboard) {
    for (const [store, tabs] of Object.entries(expected.dashboard)) {
      for (const [tab, spec] of Object.entries(tabs)) {
        const want = typeof spec === 'number' ? { count: spec } : spec;
        const got = actual.dashboard[store]?.[tab];
        v.checked += 1;
        if (!got || got.count !== want.count) {
          v.failures.push(`dashboard ${store}/${tab}: expected ${want.count} rows, got ${got ? got.count : 'none'}`);
          continue;
        }
        for (const [key, value] of Object.entries(want.first ?? {})) {
          v.checked += 1;
          const seen = got.first?.[key];
          const same =
            typeof value === 'number' && typeof seen === 'number'
              ? Math.abs(seen - value) <= MONEY_TOLERANCE
              : String(seen) === String(value);
          if (!same) v.failures.push(`dashboard ${store}/${tab} first row ${key}: expected ${show(value)}, got ${show(seen)}`);
        }
      }
    }
  }

  return v;
}
