import type { DailyCloseReport, DepositReceipt, Invoice, Payout } from './schema';
import type { DepositRule, StoreProfile } from './profile';

/**
 * Deterministic checks on extracted data. No AI here: these catch misread numbers
 * (line items vs totals, deposit vs the day's numbers, invoice vs till payout).
 */

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface Check {
  id: string;
  status: CheckStatus;
  message: string;
  expected?: number;
  actual?: number;
  /** actual - expected */
  difference?: number;
}

export function toCents(n: number): number {
  return Math.round(n * 100);
}

export function sameAmount(a: number, b: number, toleranceCents = 0): boolean {
  return Math.abs(toCents(a) - toCents(b)) <= toleranceCents;
}

export function formatMoney(n: number): string {
  const whole = Number.isInteger(n);
  const body = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${n < 0 ? '-' : ''}$${body}`;
}

function diffCheck(
  id: string,
  expected: number,
  actual: number,
  messages: { pass: string; mismatch: string },
  mismatchStatus: CheckStatus
): Check {
  const difference = Math.round((actual - expected) * 100) / 100;
  if (sameAmount(expected, actual)) {
    return { id, status: 'pass', message: messages.pass, expected, actual, difference: 0 };
  }
  return { id, status: mismatchStatus, message: messages.mismatch, expected, actual, difference };
}

/* ------------------------------ daily close ------------------------------ */

function sumPayouts(payouts: Payout[]): number {
  return payouts.reduce((total, p) => total + p.amount, 0);
}

function insideSalesTotal(report: DailyCloseReport): number | null {
  if (report.storeSalesTotal != null) return report.storeSalesTotal;
  if (report.cardSales != null || report.cashSales != null) {
    return (report.cardSales ?? 0) + (report.cashSales ?? 0);
  }
  return null;
}

export function describeDepositRule(rule: DepositRule): string {
  const parts = [rule.includeCardSales ? 'card' : null, 'cash', rule.includeFuelSales ? 'gas' : null].filter(
    Boolean
  );
  let text = parts.join(' + ');
  if (rule.subtractPayouts) text += ' − vendor payouts';
  if (rule.floatLeftInRegister > 0) text += ` − ${formatMoney(rule.floatLeftInRegister)} left in register`;
  return text;
}

/** What the deposit should be under a given rule, or null when the report lacks the needed numbers. */
export function computeExpectedDeposit(report: DailyCloseReport, rule: DepositRule): number | null {
  let inside: number | null;
  if (rule.includeCardSales) {
    inside = insideSalesTotal(report);
  } else if (report.cashSales != null) {
    inside = report.cashSales;
  } else if (report.storeSalesTotal != null && report.cardSales != null) {
    inside = report.storeSalesTotal - report.cardSales;
  } else {
    inside = null;
  }
  if (inside == null) return null;

  const fuel = rule.includeFuelSales ? (report.fuelSales ?? 0) : 0;
  const payouts = rule.subtractPayouts ? sumPayouts(report.payouts) : 0;
  return Math.round((inside + fuel - payouts - rule.floatLeftInRegister) * 100) / 100;
}

/**
 * Which simple deposit rules reproduce the deposit the sender wrote?
 * Used to suggest a store's rule ("learn by asking once") when none is configured yet.
 */
export function inferDepositRules(report: DailyCloseReport): DepositRule[] {
  if (report.reportedDeposit == null) return [];

  const cardMatters = (report.cardSales ?? 0) !== 0;
  const fuelMatters = (report.fuelSales ?? 0) !== 0;
  const payoutsMatter = report.payouts.length > 0;

  const seen = new Set<string>();
  const matches: DepositRule[] = [];

  for (const includeCardSales of [true, false]) {
    for (const includeFuelSales of [true, false]) {
      for (const subtractPayouts of [true, false]) {
        const rule: DepositRule = {
          // Toggles that cannot change the result are normalised so duplicates collapse.
          includeCardSales: cardMatters ? includeCardSales : true,
          includeFuelSales: fuelMatters ? includeFuelSales : true,
          subtractPayouts: payoutsMatter ? subtractPayouts : false,
          floatLeftInRegister: 0,
        };
        const key = `${rule.includeCardSales}|${rule.includeFuelSales}|${rule.subtractPayouts}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const expected = computeExpectedDeposit(report, rule);
        if (expected != null && sameAmount(expected, report.reportedDeposit, 1)) {
          matches.push(rule);
        }
      }
    }
  }
  return matches;
}

export function checkDailyClose(report: DailyCloseReport, profile?: StoreProfile | null): Check[] {
  const checks: Check[] = [];

  if (report.cardSales != null && report.cashSales != null && report.storeSalesTotal != null) {
    checks.push(
      diffCheck(
        'store_sales_sum',
        report.cardSales + report.cashSales,
        report.storeSalesTotal,
        {
          pass: 'Card + cash match the store sales total.',
          mismatch: 'Card + cash do not add up to the store sales total.',
        },
        'fail'
      )
    );
  }

  const inside = insideSalesTotal(report);
  if (report.reportedDayTotal != null && inside != null && report.fuelSales != null) {
    const expected = inside + report.fuelSales - Math.abs(report.fuelDiscounts ?? 0);
    checks.push(
      diffCheck(
        'day_total_sum',
        expected,
        report.reportedDayTotal,
        {
          pass: 'Store sales + fuel match the day total.',
          mismatch: 'Store sales + fuel do not add up to the day total.',
        },
        'fail'
      )
    );
  }

  if (report.reportedDeposit != null) {
    const rule = profile?.depositRule ?? null;
    if (rule) {
      const expected = computeExpectedDeposit(report, rule);
      if (expected != null) {
        checks.push(
          diffCheck(
            'deposit_rule',
            expected,
            report.reportedDeposit,
            {
              pass: `Deposit matches this store's rule (${describeDepositRule(rule)}).`,
              mismatch: `Deposit differs from this store's rule (${describeDepositRule(rule)}).`,
            },
            'warn'
          )
        );
      }
    } else {
      const matches = inferDepositRules(report);
      if (matches.length > 0) {
        checks.push({
          id: 'deposit_explained',
          status: 'pass',
          message: `Deposit matches: ${describeDepositRule(matches[0])}.`,
          actual: report.reportedDeposit,
        });
      } else {
        checks.push({
          id: 'deposit_unexplained',
          status: 'warn',
          message: "Deposit does not match the day's numbers under any usual rule. Worth a look.",
          actual: report.reportedDeposit,
        });
      }
    }
  }

  if (report.periodClosed === false) {
    checks.push({
      id: 'period_open',
      status: 'warn',
      message: 'This looks like a partial day (the register period is still open).',
    });
  }

  return checks;
}

/** Flag dates that are missing, in the future, or stale. */
export function checkReportDate(date: string | null, now: Date = new Date()): Check | null {
  if (!date) {
    return { id: 'date_missing', status: 'warn', message: 'No date found. Which day is this for?' };
  }
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return { id: 'date_invalid', status: 'fail', message: `Could not read the date "${date}".` };
  }
  const dayMs = 24 * 60 * 60 * 1000;
  const ageDays = (now.getTime() - parsed.getTime()) / dayMs;
  if (ageDays < -1.5) {
    return { id: 'date_future', status: 'fail', message: `The date ${date} is in the future.` };
  }
  if (ageDays > 45) {
    return { id: 'date_old', status: 'warn', message: `The date ${date} is more than 45 days ago.` };
  }
  return null;
}

/* -------------------------------- invoices -------------------------------- */

export function checkInvoice(invoice: Invoice): Check[] {
  const checks: Check[] = [];

  const mismatchedLines: number[] = [];
  invoice.lineItems.forEach((line, index) => {
    if (line.quantity != null && line.unitPrice != null) {
      if (!sameAmount(line.quantity * line.unitPrice, line.amount, 1)) mismatchedLines.push(index + 1);
    }
  });
  if (invoice.lineItems.some((l) => l.quantity != null && l.unitPrice != null)) {
    checks.push(
      mismatchedLines.length === 0
        ? { id: 'line_math', status: 'pass', message: 'Quantity × price matches each line amount.' }
        : {
            id: 'line_math',
            status: 'fail',
            message: `Quantity × price does not match the amount on line ${mismatchedLines.join(', ')}.`,
          }
    );
  }

  if (invoice.lineItems.length > 0) {
    const linesTotal = invoice.lineItems.reduce((sum, l) => sum + l.amount, 0) + (invoice.tax ?? 0);
    checks.push(
      diffCheck(
        'lines_sum_total',
        linesTotal,
        invoice.total,
        {
          pass: 'Line items add up to the invoice total.',
          mismatch: 'Line items do not add up to the invoice total.',
        },
        'fail'
      )
    );
  }

  return checks;
}

/* ----------------------------- deposit receipts ---------------------------- */

export function checkDepositReceipt(receipt: DepositReceipt): Check[] {
  if (receipt.cashCounts.length === 0) return [];

  const counted = receipt.cashCounts.reduce((sum, c) => sum + c.denomination * c.count, 0);
  return [
    diffCheck(
      'cash_counts_sum',
      counted,
      receipt.totalDeposit,
      {
        pass: 'Bill counts add up to the deposit total.',
        // A slip can include checks, or a digit may be unclear in the photo, so this is a warning.
        mismatch: 'Bill counts do not add up to the deposit total (checks included, or a count is unclear?).',
      },
      'warn'
    ),
  ];
}

/* -------------------------- invoice vs till payout ------------------------- */

const COMPANY_SUFFIXES = /\b(llc|inc|corp|co|ltd|company|distributors?|distribution)\b/g;

function normalizeVendor(name: string): string {
  return name.toLowerCase().replace(COMPANY_SUFFIXES, '').replace(/[^a-z0-9]/g, '');
}

export function resolveVendor(label: string, vendorAliases: Record<string, string>): string {
  return vendorAliases[label.trim().toLowerCase()] ?? label;
}

/** Compare an invoice with the till payout recorded for the same vendor, if there is one. */
export function matchInvoiceToPayout(
  invoice: Invoice,
  payouts: Payout[],
  vendorAliases: Record<string, string> = {}
): Check | null {
  if (!invoice.vendorName) return null;
  const target = normalizeVendor(invoice.vendorName);
  if (!target) return null;

  const payout = payouts.find((p) => {
    const candidate = normalizeVendor(resolveVendor(p.vendorHint ?? p.label, vendorAliases));
    if (!candidate) return false;
    return candidate === target || (candidate.length >= 4 && (target.includes(candidate) || candidate.includes(target)));
  });
  if (!payout) return null;

  const difference = Math.round((payout.amount - invoice.total) * 100) / 100;
  if (sameAmount(payout.amount, invoice.total)) {
    return {
      id: 'invoice_matches_payout',
      status: 'pass',
      message: `Invoice matches the "${payout.label}" payout.`,
      expected: invoice.total,
      actual: payout.amount,
      difference: 0,
    };
  }
  return {
    id: 'invoice_matches_payout',
    status: 'warn',
    message: `Invoice is ${formatMoney(invoice.total)} but the "${payout.label}" payout was ${formatMoney(payout.amount)}.`,
    expected: invoice.total,
    actual: payout.amount,
    difference,
  };
}

/* ------------------------------ store matching ----------------------------- */

const STORE_STOPWORDS = new Set([
  'store',
  'stores',
  'mart',
  'gas',
  'station',
  'food',
  'shop',
  'the',
  'exxon',
  'mobil',
  'shell',
  'bp',
  'sunoco',
  'citgo',
  'valero',
  'chevron',
  'marathon',
  'speedway',
  'wawa',
]);

function normalizeStoreName(name: string): string {
  const raw = name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const words = raw.split(/\s+/).filter(Boolean);
  const kept = words.filter((w) => !STORE_STOPWORDS.has(w));
  // A store named only with brand words ("Exxon Mart") keeps them rather than becoming empty.
  return (kept.length > 0 ? kept : words).join('');
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[b.length];
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  let score = 1 - levenshtein(a, b) / longest;
  // "denville" inside "denvillenj" is a strong match.
  if (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a))) {
    score = Math.max(score, 0.9);
  }
  return score;
}

export interface StoreMatch {
  profile: StoreProfile | null;
  score: number;
  /** True when a second store scored almost as well, so the sender should be asked. */
  ambiguous: boolean;
}

export const STORE_MATCH_THRESHOLD = 0.75;

/** Match a store name as written (typos allowed) to the stores this sender can report for. */
export function matchStore(hint: string | null | undefined, profiles: StoreProfile[]): StoreMatch {
  const normalizedHint = hint ? normalizeStoreName(hint) : '';
  if (!normalizedHint || profiles.length === 0) {
    return { profile: null, score: 0, ambiguous: false };
  }

  const scored = profiles
    .map((profile) => {
      const names = [profile.storeName, ...profile.aliases];
      const score = Math.max(...names.map((n) => similarity(normalizedHint, normalizeStoreName(n))));
      return { profile, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (best.score < STORE_MATCH_THRESHOLD) {
    return { profile: null, score: best.score, ambiguous: false };
  }
  const runnerUp = scored[1];
  const ambiguous = Boolean(runnerUp && runnerUp.score >= STORE_MATCH_THRESHOLD && best.score - runnerUp.score < 0.08);
  return { profile: ambiguous ? null : best.profile, score: best.score, ambiguous };
}

/* --------------------------------- summary -------------------------------- */

export function worstStatus(checks: Check[]): CheckStatus {
  if (checks.some((c) => c.status === 'fail')) return 'fail';
  if (checks.some((c) => c.status === 'warn')) return 'warn';
  return 'pass';
}
