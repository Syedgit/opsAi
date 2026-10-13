import {
  checkDailyClose,
  checkDepositReceipt,
  checkInvoice,
  checkReportDate,
  describeDepositRule,
  formatMoney,
  inferDepositRules,
  matchStore,
  worstStatus,
  type Check,
} from './checks';
import type { DepositRule, StoreProfile } from './profile';
import type { DailyCloseReport, DepositReceipt, EquipmentIssue, Invoice, Understanding } from './schema';

/**
 * Turns a reading (Understanding) into saved-after-confirmation entries and a WhatsApp reply.
 * Pure: no database, no network. The service layer does the saving and sending.
 *
 * Entries reuse the existing pending-action storage, so no schema change is needed:
 * daily close -> STORE_SALES, invoice -> INVOICE_EXPENSE, deposit slip -> UNKNOWN (hidden from
 * the current dashboard lists until it gets its own view). Legacy field names (cash, card, ...)
 * are kept in every payload so the dashboard keeps working.
 */

export type PlannedActionType = 'STORE_SALES' | 'INVOICE_EXPENSE' | 'UNKNOWN';
export type EntryKind = 'daily_close' | 'invoice' | 'deposit_receipt';

export interface PlannedEntry {
  kind: EntryKind;
  storeId: string;
  storeName: string;
  actionType: PlannedActionType;
  payload: Record<string, unknown>;
  confidence: number;
  /** Lines shown to the sender, without the footer. */
  lines: string[];
  checks: Check[];
}

export interface UnderstandingPlan {
  entries: PlannedEntry[];
  /** Reply that needs no confirmation (equipment problem, or "could not read that"). */
  notice: string | null;
  equipment: EquipmentIssue | null;
}

export interface PlanContext {
  profiles: StoreProfile[];
  primaryStoreId: string;
  now: Date;
  /**
   * True when the sender runs several stores. A message that names no store is then still saved
   * under the sender's own store, but with a warning, so money never lands on a guessed store.
   */
  multiStoreSender?: boolean;
  /**
   * True for owners and managers. Only they can teach a store its deposit rule; a staff
   * member's confirmation never changes how the owner's money is checked.
   */
  canTeachRules?: boolean;
}

/* --------------------------------- helpers -------------------------------- */

function dateLabel(date: string | null | undefined): string {
  if (!date) return 'date not found';
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * A deposit rule worth proposing: the store has none yet, the sender may teach, nothing looks
 * broken, and exactly one usual rule explains the deposit. Several matches would be a guess.
 */
function suggestDepositRule(
  report: DailyCloseReport,
  profile: StoreProfile | null,
  checks: Check[],
  canTeach: boolean | undefined
): DepositRule | null {
  if (!canTeach || !profile || profile.depositRule) return null;
  if (report.reportedDeposit == null || worstStatus(checks) === 'fail') return null;
  const matches = inferDepositRules(report);
  return matches.length === 1 ? matches[0] : null;
}

function insideTotal(report: DailyCloseReport): number {
  if (report.storeSalesTotal != null) return report.storeSalesTotal;
  return round2((report.cardSales ?? 0) + (report.cashSales ?? 0));
}

function checkLine(check: Check): string | null {
  if (check.status === 'pass') {
    return ['deposit_explained', 'deposit_rule', 'day_total_sum', 'lines_sum_total', 'invoice_matches_payout'].includes(
      check.id
    )
      ? `✅ ${check.message}`
      : null;
  }
  let text = `⚠️ ${check.message}`;
  if (check.expected != null && check.actual != null && check.difference != null) {
    text += ` Expected ${formatMoney(check.expected)}, found ${formatMoney(check.actual)}.`;
  }
  return text;
}

const CATEGORY_LABEL: Record<EquipmentIssue['category'], string> = {
  fuel_dispenser: 'Pump / dispenser hardware',
  payment_network: 'Card reader / network (not pump hardware)',
  refrigeration: 'Cooler / refrigeration',
  pos_terminal: 'POS terminal',
  other: 'Other equipment',
  unknown: 'Not sure yet',
};

/* ---------------------------- payload builders ---------------------------- */

export function dailyClosePayload(
  report: DailyCloseReport,
  checks: Check[],
  needsReview: string[] = [],
  suggestedDepositRule: DepositRule | null = null
): Record<string, unknown> {
  return {
    _kind: 'daily_close',
    report,
    checks,
    needs_review: needsReview,
    /** Saved as the store's deposit rule when the owner confirms with OK. */
    suggested_deposit_rule: suggestedDepositRule,
    report_date: report.reportDate,
    // Legacy keys read by the dashboard.
    cash: report.cashSales ?? 0,
    card: report.cardSales ?? 0,
    total_inside: insideTotal(report),
    fuel_sales: report.fuelSales ?? 0,
    gallons: report.fuelGallons ?? 0,
    deposit: report.reportedDeposit ?? null,
  };
}

export function invoicePayload(invoice: Invoice, checks: Check[], needsReview: string[] = []): Record<string, unknown> {
  return {
    _kind: 'invoice',
    invoice,
    checks,
    needs_review: needsReview,
    vendor: invoice.vendorName ?? 'Unknown',
    amount: invoice.total,
    tax: invoice.tax ?? 0,
    invoice_number: invoice.invoiceNumber,
    invoice_date: invoice.invoiceDate,
  };
}

export function depositPayload(receipt: DepositReceipt, checks: Check[], needsReview: string[] = []): Record<string, unknown> {
  return {
    _kind: 'deposit_receipt',
    receipt,
    checks,
    needs_review: needsReview,
    amount: receipt.totalDeposit,
    deposit_date: receipt.depositDate,
  };
}

/* ---------------------------------- lines --------------------------------- */

function dailyCloseLines(report: DailyCloseReport, storeName: string, checks: Check[]): string[] {
  const lines = [`🧾 ${storeName} · ${dateLabel(report.reportDate)}`];

  const sales: string[] = [];
  if (report.cardSales != null) sales.push(`Card ${formatMoney(report.cardSales)}`);
  if (report.cashSales != null) sales.push(`Cash ${formatMoney(report.cashSales)}`);
  if (report.storeSalesTotal != null) sales.push(`Store total ${formatMoney(report.storeSalesTotal)}`);
  if (sales.length > 0) lines.push(sales.join(' · '));

  const fuel: string[] = [];
  if (report.fuelSales != null) fuel.push(`Gas ${formatMoney(report.fuelSales)}`);
  if (report.fuelGallons != null) fuel.push(`${report.fuelGallons} gal`);
  if (report.fuelDiscounts != null) fuel.push(`discounts ${formatMoney(Math.abs(report.fuelDiscounts))}`);
  if (fuel.length > 0) lines.push(fuel.join(' · '));

  if (report.payouts.length > 0) {
    lines.push(`Paid out: ${report.payouts.map((p) => `${p.label} ${formatMoney(p.amount)}`).join(', ')}`);
  }
  if (report.reportedDayTotal != null) lines.push(`Day total ${formatMoney(report.reportedDayTotal)}`);
  if (report.reportedDeposit != null) lines.push(`Deposit ${formatMoney(report.reportedDeposit)}`);

  for (const check of checks) {
    const line = checkLine(check);
    if (line) lines.push(line);
  }
  return lines;
}

function invoiceLines(invoice: Invoice, storeName: string, checks: Check[]): string[] {
  const lines = [`🧾 Invoice · ${invoice.vendorName ?? 'Unknown vendor'} · ${storeName}`];
  const facts = [`Total ${formatMoney(invoice.total)}`];
  if (invoice.lineItems.length > 0) {
    facts.push(`${invoice.lineItems.length} line${invoice.lineItems.length === 1 ? '' : 's'}`);
  }
  if (invoice.invoiceDate) facts.push(dateLabel(invoice.invoiceDate));
  if (invoice.paymentStatus === 'paid_cash') facts.push('paid cash');
  else if (invoice.paymentStatus === 'paid_other') facts.push('paid');
  else if (invoice.paymentStatus === 'unpaid') facts.push('unpaid');
  lines.push(facts.join(' · '));
  if (invoice.invoiceNumber) lines.push(`Invoice # ${invoice.invoiceNumber}`);

  for (const check of checks) {
    const line = checkLine(check);
    if (line) lines.push(line);
  }
  return lines;
}

function depositLines(receipt: DepositReceipt, storeName: string, checks: Check[]): string[] {
  const lines = [`🏦 Deposit · ${storeName}`];
  const facts = [`Total ${formatMoney(receipt.totalDeposit)}`];
  if (receipt.bank) facts.push(receipt.bank);
  if (receipt.accountLast4) facts.push(`account …${receipt.accountLast4}`);
  lines.push(facts.join(' · '));
  if (receipt.depositDate) {
    lines.push(
      receipt.postsOn
        ? `Made ${dateLabel(receipt.depositDate)} · posts ${dateLabel(receipt.postsOn)}`
        : `Made ${dateLabel(receipt.depositDate)}`
    );
  }
  for (const check of checks) {
    const line = checkLine(check);
    if (line) lines.push(line);
  }
  return lines;
}

/* ----------------------------------- plan ---------------------------------- */

interface ResolvedStore {
  storeId: string;
  storeName: string;
  profile: StoreProfile | null;
  warning: Check | null;
}

function resolveStore(hint: string | null | undefined, ctx: PlanContext): ResolvedStore {
  const primary = ctx.profiles.find((p) => p.storeId === ctx.primaryStoreId) ?? null;
  const primaryName = primary?.storeName ?? ctx.primaryStoreId;

  const trimmed = hint?.trim();
  if (!trimmed) {
    return {
      storeId: ctx.primaryStoreId,
      storeName: primaryName,
      profile: primary,
      warning: ctx.multiStoreSender
        ? {
            id: 'store_not_named',
            status: 'warn',
            message: `No store name found, so this is under ${primaryName}. CANCEL and resend with the store name if that is wrong.`,
          }
        : null,
    };
  }

  const match = matchStore(trimmed, ctx.profiles);
  if (match.profile) {
    return { storeId: match.profile.storeId, storeName: match.profile.storeName, profile: match.profile, warning: null };
  }

  // Money must not land on the wrong store silently: keep it on the sender's store, say so, and
  // the sender confirms (or cancels) before anything is saved.
  return {
    storeId: ctx.primaryStoreId,
    storeName: primaryName,
    profile: primary,
    warning: {
      id: 'store_unmatched',
      status: 'warn',
      message: match.ambiguous
        ? `"${trimmed}" could be more than one of your stores, so this is under ${primaryName}. CANCEL if that is wrong.`
        : `I could not match "${trimmed}" to your stores, so this is under ${primaryName}. CANCEL if that is wrong.`,
    },
  };
}

function reviewLine(needsReview: string[]): string[] {
  return needsReview.length > 0 ? [`❓ Please check: ${needsReview.join(', ')}`] : [];
}

export function planUnderstanding(understanding: Understanding, ctx: PlanContext): UnderstandingPlan {
  switch (understanding.kind) {
    case 'daily_close': {
      const entries = understanding.reports.map((report): PlannedEntry => {
        const store = resolveStore(report.storeHint, ctx);
        const dateCheck = checkReportDate(report.reportDate, ctx.now);
        const checks = [
          ...(store.warning ? [store.warning] : []),
          ...(dateCheck ? [dateCheck] : []),
          ...checkDailyClose(report, store.profile),
        ];
        const suggestedRule = suggestDepositRule(report, store.profile, checks, ctx.canTeachRules);
        return {
          kind: 'daily_close',
          storeId: store.storeId,
          storeName: store.storeName,
          actionType: 'STORE_SALES',
          payload: dailyClosePayload(report, checks, understanding.needsReview, suggestedRule),
          confidence: understanding.confidence,
          lines: [
            ...dailyCloseLines(report, store.storeName, checks),
            ...reviewLine(understanding.needsReview),
            ...(suggestedRule
              ? [
                  `💡 OK also teaches me ${store.storeName}'s deposit rule (${describeDepositRule(suggestedRule)}). I'll warn you if a deposit ever differs.`,
                ]
              : []),
          ],
          checks,
        };
      });
      return { entries, notice: null, equipment: null };
    }

    case 'invoice': {
      const store = resolveStore(understanding.invoice.storeHint, ctx);
      const dateCheck = checkReportDate(understanding.invoice.invoiceDate, ctx.now);
      const checks = [
        ...(store.warning ? [store.warning] : []),
        // A missing invoice date is common and not worth interrupting for; only bad dates are flagged.
        ...(dateCheck && dateCheck.id !== 'date_missing' ? [dateCheck] : []),
        ...checkInvoice(understanding.invoice),
      ];
      return {
        entries: [
          {
            kind: 'invoice',
            storeId: store.storeId,
            storeName: store.storeName,
            actionType: 'INVOICE_EXPENSE',
            payload: invoicePayload(understanding.invoice, checks, understanding.needsReview),
            confidence: understanding.confidence,
            lines: [...invoiceLines(understanding.invoice, store.storeName, checks), ...reviewLine(understanding.needsReview)],
            checks,
          },
        ],
        notice: null,
        equipment: null,
      };
    }

    case 'deposit_receipt': {
      const entries = understanding.receipts.map((receipt): PlannedEntry => {
        // A slip rarely names the store; the location it prints is used when it matches one of the owner's stores.
        const store = resolveStore(receipt.storeHint, ctx);
        const checks = [...(store.warning ? [store.warning] : []), ...checkDepositReceipt(receipt)];
        return {
          kind: 'deposit_receipt',
          storeId: store.storeId,
          storeName: store.storeName,
          actionType: 'UNKNOWN',
          payload: depositPayload(receipt, checks, understanding.needsReview),
          confidence: understanding.confidence,
          lines: [...depositLines(receipt, store.storeName, checks), ...reviewLine(understanding.needsReview)],
          checks,
        };
      });
      return { entries, notice: null, equipment: null };
    }

    case 'equipment_issue': {
      const issue = understanding.issue;
      const lines = [issue.equipment ? `🔧 Problem noted: ${issue.equipment}` : '🔧 Problem noted', issue.description];
      if (issue.screenText) lines.push(`Screen says: "${issue.screenText}"`);
      lines.push(`Type: ${CATEGORY_LABEL[issue.category]}`);
      if (issue.questions.length > 0) {
        lines.push('', 'Quick questions so we can get this fixed:');
        issue.questions.forEach((q, i) => lines.push(`${i + 1}. ${q}`));
      }
      return { entries: [], notice: lines.join('\n'), equipment: issue };
    }

    case 'unknown':
    default:
      return {
        entries: [],
        notice:
          "❓ I couldn't read that as sales, an invoice, a deposit slip, or an equipment problem.\n\nTry a clearer photo, or type it like: Rockaway cash 298 card 1355 gas 1440. Reply HELP for commands.",
        equipment: null,
      };
  }
}

export function formatEntriesReply(entries: PlannedEntry[]): string {
  const body = entries.map((e) => e.lines.join('\n')).join('\n\n');
  const footer =
    entries.length > 1
      ? 'Reply OK to save all, or CANCEL to discard all.'
      : 'Reply OK to save, FIX <field> <value> to correct, or CANCEL.';
  return `${body}\n\n${footer}`;
}

/* ----------------------------------- FIX ----------------------------------- */

export type FixResult = { ok: true; payload: Record<string, unknown> } | { ok: false; message: string };

const DAILY_CLOSE_FIELDS: Record<string, keyof DailyCloseReport> = {
  cash: 'cashSales',
  card: 'cardSales',
  credit: 'cardSales',
  gas: 'fuelSales',
  fuel: 'fuelSales',
  fuel_sales: 'fuelSales',
  gallons: 'fuelGallons',
  deposit: 'reportedDeposit',
  total: 'reportedDayTotal',
  total_inside: 'storeSalesTotal',
};

function parseMoney(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

function parseIsoDate(value: string): string | null {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const us = trimmed.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (!us) return null;
  const year = us[3] ? (us[3].length === 2 ? 2000 + Number(us[3]) : Number(us[3])) : new Date().getUTCFullYear();
  return `${year}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
}

/** Apply "FIX <field> <value>" to an entry created by understanding, then re-run its checks. */
export function applyFixToPayload(
  payload: Record<string, unknown>,
  field: string,
  value: string,
  now: Date = new Date()
): FixResult {
  const key = field.toLowerCase();
  const kind = payload._kind;
  const review = Array.isArray(payload.needs_review) ? (payload.needs_review as string[]) : [];

  if (kind === 'daily_close') {
    const report = { ...(payload.report as DailyCloseReport) };
    if (key === 'date') {
      const date = parseIsoDate(value);
      if (!date) return { ok: false, message: 'Date format: FIX date 10/12 (month/day).' };
      report.reportDate = date;
    } else if (key in DAILY_CLOSE_FIELDS) {
      const amount = parseMoney(value);
      if (amount == null) return { ok: false, message: `"${value}" is not a number. Example: FIX ${key} 1260` };
      (report as Record<string, unknown>)[DAILY_CLOSE_FIELDS[key]] = amount;
    } else {
      return { ok: false, message: 'You can fix: cash, card, gas, gallons, deposit, total, date.' };
    }
    const dateCheck = checkReportDate(report.reportDate, now);
    const checks = [...(dateCheck ? [dateCheck] : []), ...checkDailyClose(report, null)];
    // A corrected report may no longer fit the rule that was proposed, so it is re-derived, never kept blindly.
    const hadSuggestion = payload.suggested_deposit_rule != null;
    const inferred = hadSuggestion && worstStatus(checks) !== 'fail' ? inferDepositRules(report) : [];
    return { ok: true, payload: dailyClosePayload(report, checks, review, inferred.length === 1 ? inferred[0] : null) };
  }

  if (kind === 'invoice') {
    const invoice = { ...(payload.invoice as Invoice) };
    if (key === 'amount' || key === 'total') {
      const amount = parseMoney(value);
      if (amount == null) return { ok: false, message: `"${value}" is not a number. Example: FIX total 136.08` };
      invoice.total = amount;
    } else if (key === 'vendor') {
      invoice.vendorName = value.trim();
    } else if (key === 'date') {
      const date = parseIsoDate(value);
      if (!date) return { ok: false, message: 'Date format: FIX date 10/12 (month/day).' };
      invoice.invoiceDate = date;
    } else {
      return { ok: false, message: 'You can fix: total, vendor, date.' };
    }
    return { ok: true, payload: invoicePayload(invoice, checkInvoice(invoice), review) };
  }

  if (kind === 'deposit_receipt') {
    const receipt = { ...(payload.receipt as DepositReceipt) };
    if (key === 'amount' || key === 'total') {
      const amount = parseMoney(value);
      if (amount == null) return { ok: false, message: `"${value}" is not a number. Example: FIX total 2183` };
      receipt.totalDeposit = amount;
    } else if (key === 'date') {
      const date = parseIsoDate(value);
      if (!date) return { ok: false, message: 'Date format: FIX date 10/12 (month/day).' };
      receipt.depositDate = date;
    } else {
      return { ok: false, message: 'You can fix: total, date.' };
    }
    return { ok: true, payload: depositPayload(receipt, checkDepositReceipt(receipt), review) };
  }

  return { ok: false, message: 'This entry cannot be corrected with FIX.' };
}
