import { invoiceIsUnpaid, paymentDueReminderDate } from '../tasks/invoiceReminder';
import {
  applyPayments,
  describeBalance,
  looksLikePaymentUpdate,
  matchOpenInvoice,
  paidOf,
  remainingOf,
  settleInvoice,
} from './invoiceBalance';
import { localDateString } from '../tasks/time';
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
import { formatHours, hoursLines, sheetLines, summarizeSchedule, type ScheduleSummary } from './schedule';
import { WorkScheduleSchema } from './schema';
import type { DailyCloseReport, DepositReceipt, EquipmentIssue, FuelPrices, Invoice, Order, OrderItem, Understanding, WorkSchedule } from './schema';
import { extraTillForDay, type TillCashItem } from './daySummary';
import { applyStoreCredit, matchOpenClose, mergeDailyCloseReports, type OpenClose } from './closeMerge';
import { describeVendorCatalog, matchOrderVendor, matchVendorName, VENDOR_CATEGORY_LABEL, type StoreVendor } from './vendors';
import {
  applyFuelPriceFix,
  checkFuelPrices,
  fuelPriceLines,
  fuelPricesPayload,
  resolveFuelSource,
} from './fuelPrices';

/**
 * Turns a reading (Understanding) into saved-after-confirmation entries and a WhatsApp reply.
 * Pure: no database, no network. The service layer does the saving and sending.
 *
 * Entries reuse the existing pending-action storage, so no schema change is needed:
 * daily close -> STORE_SALES, invoice -> INVOICE_EXPENSE, deposit slip -> UNKNOWN (hidden from
 * the current dashboard lists until it gets its own view), staff schedule -> UNKNOWN tagged work_schedule
 * (shown on the dashboard's Schedule tab), fuel_prices -> UNKNOWN tagged fuel_prices (Gas prices tab).
 * Legacy field names (cash, card, ...) are kept in every payload so the dashboard keeps working.
 */

export type PlannedActionType = 'STORE_SALES' | 'INVOICE_EXPENSE' | 'ORDER_REQUEST' | 'UNKNOWN';
export type EntryKind = 'daily_close' | 'invoice' | 'deposit_receipt' | 'work_schedule' | 'order' | 'fuel_prices';

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
  /** True for owners and managers. Only they can post a schedule (it tells the whole group everyone's hours). */
  canManageSchedules?: boolean;
  /** Confirmed bills still owed, so a later "paid cash 500 remaining 400" updates the same invoice. */
  openInvoices?: Array<{ actionId: string; storeId: string; invoice: Invoice }>;
  /** Same-day till cash already confirmed (invoice cash, typed paid-outs). Close payouts stay on the report. */
  tillCash?: TillCashItem[];
  /** Original caption / typed text, used to tell competitor poles from our own board. */
  messageText?: string;
  /** Recent daily closes, so a later POS page (fuel then cash) updates the same day. */
  openCloses?: OpenClose[];
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
  if (report.cardSales != null || report.cashSales != null) {
    return round2((report.cardSales ?? 0) + (report.cashSales ?? 0));
  }
  return report.storeSalesTotal ?? 0;
}

function checkLine(check: Check): string | null {
  if (check.status === 'pass') {
    return ['deposit_explained', 'deposit_rule', 'day_total_sum', 'lines_sum_total', 'invoice_matches_payout', 'cash_after_payouts'].includes(
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
  suggestedDepositRule: DepositRule | null = null,
  extra: { updatesActionId?: string } = {}
): Record<string, unknown> {
  const credited = applyStoreCredit(report);
  return {
    _kind: 'daily_close',
    report: credited,
    checks,
    needs_review: needsReview,
    /** Saved as the store's deposit rule when the owner confirms with OK. */
    suggested_deposit_rule: suggestedDepositRule,
    report_date: credited.reportDate,
    // Legacy keys read by the dashboard.
    cash: credited.cashSales ?? 0,
    card: credited.cardSales ?? 0,
    total_inside: insideTotal(credited),
    fuel_sales: credited.fuelSales ?? 0,
    gallons: credited.fuelGallons ?? 0,
    deposit: credited.reportedDeposit ?? null,
    ...(extra.updatesActionId ? { updates_action_id: extra.updatesActionId } : {}),
  };
}

export function invoicePayload(
  invoice: Invoice,
  checks: Check[],
  needsReview: string[] = [],
  extra: { updatesActionId?: string } = {},
): Record<string, unknown> {
  const remaining = remainingOf(invoice);
  return {
    _kind: extra.updatesActionId ? 'invoice_payment' : 'invoice',
    invoice,
    checks,
    needs_review: needsReview,
    vendor: invoice.vendorName ?? 'Unknown',
    amount: invoice.total,
    tax: invoice.tax ?? 0,
    invoice_number: invoice.invoiceNumber,
    invoice_date: invoice.invoiceDate,
    due_date: invoice.payBy || invoice.dueDate,
    paid: remaining <= 0.005 ? 'Y' : 'N',
    remaining,
    amount_paid: invoice.payments?.reduce((sum, p) => sum + p.amount, 0) ?? 0,
    remaining_method: invoice.remainingMethod ?? null,
    ...(extra.updatesActionId ? { updates_action_id: extra.updatesActionId } : {}),
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

function itemQty(item: OrderItem): number {
  return item.quantity != null && Number.isFinite(item.quantity) ? item.quantity : 1;
}

export function orderPayload(
  order: Order,
  vendor: { name: string; category: string | null } | null,
  catalog: StoreVendor[],
  needsReview: string[] = [],
  checks: Check[] = []
): Record<string, unknown> {
  const vendorName = vendor?.name ?? order.vendorHint?.trim() ?? 'Unknown';
  return {
    _kind: 'order',
    order,
    checks,
    needs_review: needsReview,
    vendor: vendorName,
    vendor_category: vendor?.category ?? null,
    vendors_catalog: catalog,
    order_batch_id: vendorName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'order',
    vendor_groups: [
      {
        vendor: vendorName,
        items: order.items.map((i) => ({
          name: i.description,
          qty: itemQty(i),
          unit: i.unit?.trim() || 'each',
        })),
      },
    ],
  };
}

export function schedulePayload(
  schedule: WorkSchedule,
  summary: ScheduleSummary,
  needsReview: string[] = []
): Record<string, unknown> {
  return {
    _kind: 'work_schedule',
    // Re-parsed so that nothing outside the hours-only shape (a stray pay rate, say) can ever be saved.
    schedule: WorkScheduleSchema.parse(schedule),
    checks: summary.checks,
    needs_review: needsReview,
    week_start: summary.weekStart,
    total_hours: summary.totalHours,
    // Hours only, ready for the dashboard. There is no pay anywhere in this record.
    employees: summary.employees.map((e) => ({
      name: e.name,
      hours: e.hours,
      computed_hours: e.computedHours,
      adjusted: e.adjusted,
      shifts: e.shifts,
    })),
  };
}

/* ---------------------------------- lines --------------------------------- */

function weekLabel(weekStart: string | null): string {
  return weekStart ? `week of ${dateLabel(weekStart)}` : 'week not shown';
}

function scheduleLines(summary: ScheduleSummary, storeName: string): string[] {
  const lines = [`📅 ${storeName} · ${weekLabel(summary.weekStart)}`, ...hoursLines(summary), `Total ${formatHours(summary.totalHours)}`];
  for (const check of summary.checks) {
    const line = checkLine(check);
    if (line) lines.push(line);
  }
  return lines;
}

function asScheduleSummary(payload: Record<string, unknown>): ScheduleSummary | null {
  if (payload._kind !== 'work_schedule') return null;
  return summarizeSchedule(payload.schedule as WorkSchedule);
}

/** Admin 1:1: totals only, so the owner can check the week added up. */
export function scheduleHoursMessage(payload: Record<string, unknown>, storeName: string): string | null {
  const summary = asScheduleSummary(payload);
  if (!summary) return null;
  return [`📅 ${storeName} · hours for ${weekLabel(summary.weekStart)}`, ...hoursLines(summary), `Total ${formatHours(summary.totalHours)}`, '', 'Hours come from the posted sheet.'].join('\n');
}

/** Store group: the roster itself, so people can see the days they work. */
export function scheduleSheetMessage(payload: Record<string, unknown>, storeName: string): string | null {
  const summary = asScheduleSummary(payload);
  if (!summary) return null;
  return [`📅 ${storeName} · ${weekLabel(summary.weekStart)}`, ...sheetLines(summary), '', 'Your hours for the week. Check your days.'].join('\n');
}

export function scheduleGroupMessage(payload: Record<string, unknown>, storeName: string): string | null {
  return scheduleSheetMessage(payload, storeName);
}

function dailyCloseLines(
  report: DailyCloseReport,
  storeName: string,
  checks: Check[],
  extraTill: Array<{ label: string; amount: number }> = []
): string[] {
  const lines = [`🧾 ${storeName} · ${dateLabel(report.reportDate)}`];

  const sales: string[] = [];
  const inside = report.fuelSales != null;
  if (report.cardSales != null) sales.push(`${inside ? 'Inside card' : 'Card'} ${formatMoney(report.cardSales)}`);
  if (report.cashSales != null) sales.push(`${inside ? 'Inside cash' : 'Cash'} ${formatMoney(report.cashSales)}`);
  if (report.storeSalesTotal != null) sales.push(`${inside ? 'Inside total' : 'Store total'} ${formatMoney(report.storeSalesTotal)}`);
  if (sales.length > 0) lines.push(sales.join(' · '));

  const fuel: string[] = [];
  if (report.fuelSales != null) fuel.push(`Gas ${formatMoney(report.fuelSales)}`);
  if (report.fuelGallons != null) fuel.push(`${report.fuelGallons} gal`);
  if (report.fuelDiscounts != null) fuel.push(`discounts ${formatMoney(Math.abs(report.fuelDiscounts))}`);
  if (fuel.length > 0) lines.push(fuel.join(' · '));

  if (report.payouts.length > 0) {
    lines.push(`Paid out: ${report.payouts.map((p) => `${p.label} ${formatMoney(p.amount)}`).join(', ')}`);
  }
  if (extraTill.length > 0) {
    lines.push(`Till cash already out: ${extraTill.map((p) => `${p.label} ${formatMoney(p.amount)}`).join(', ')}`);
  }
  if (report.reportedDayTotal != null) lines.push(`Day total ${formatMoney(report.reportedDayTotal)}`);
  if (report.reportedDeposit != null) lines.push(`Deposit ${formatMoney(report.reportedDeposit)}`);

  for (const check of checks) {
    const line = checkLine(check);
    if (line) lines.push(line);
  }
  return lines;
}

function invoiceLines(invoice: Invoice, storeName: string, checks: Check[], today?: string): string[] {
  const lines = [`🧾 Invoice · ${invoice.vendorName ?? 'Unknown vendor'} · ${storeName}`];
  const facts = [`Total ${formatMoney(invoice.total)}`];
  if (invoice.lineItems.length > 0) {
    facts.push(`${invoice.lineItems.length} line${invoice.lineItems.length === 1 ? '' : 's'}`);
  }
  if (invoice.invoiceDate) facts.push(dateLabel(invoice.invoiceDate));
  if (invoice.dueDate) facts.push(`due ${dateLabel(invoice.dueDate)}`);
  if (invoice.payBy && invoice.payBy !== invoice.dueDate) facts.push(`pay remaining ${dateLabel(invoice.payBy)}`);
  facts.push(describeBalance(invoice));
  lines.push(facts.join(' · '));
  if (invoice.invoiceNumber) lines.push(`Invoice # ${invoice.invoiceNumber}`);

  for (const check of checks) {
    const line = checkLine(check);
    if (line) lines.push(line);
  }

  const reminder = invoiceReminderLine(invoice, today);
  if (reminder) lines.push(reminder);
  return lines;
}

function invoiceReminderLine(invoice: Invoice, today?: string): string | null {
  const due = invoice.payBy || invoice.dueDate;
  if (!invoiceIsUnpaid(invoice) || !due) return null;
  const when = paymentDueReminderDate(due, today ?? due);
  if (!when) return null;
  const left = remainingOf(invoice);
  const how = invoice.remainingMethod ? ` (${invoice.remainingMethod})` : '';
  if (today && when === today) {
    return `⏰ Reply OK and I'll remind today to pay ${formatMoney(left)}${how}.`;
  }
  return `⏰ Reply OK and I'll remind 3 days before, on ${dateLabel(when)}, to pay ${formatMoney(left)}${how}.`;
}

function qtyText(item: OrderItem): string {
  const q = item.quantity != null ? String(item.quantity) : '';
  const u = item.unit?.trim() || '';
  const prefix = [q, u].filter(Boolean).join(' ');
  return prefix ? `${prefix} ${item.description}` : item.description;
}

function vendorLabel(vendor: { name: string; category: string | null }): string {
  if (!vendor.category) return vendor.name;
  return `${vendor.name} (${VENDOR_CATEGORY_LABEL[vendor.category as keyof typeof VENDOR_CATEGORY_LABEL] ?? vendor.category})`;
}

function catalogHasVendor(vendor: { name: string } | null, catalog: StoreVendor[]): boolean {
  if (!vendor) return false;
  return catalog.some((v) => v.name.toLowerCase() === vendor.name.toLowerCase());
}

function orderConfirmAsk(vendor: { name: string } | null, matched: boolean): string {
  const name = vendor?.name.trim();
  if (matched && name && name.toLowerCase() !== 'unknown') {
    return `Please confirm this list so we can send this order to ${name}.`;
  }
  return 'Please confirm this list. Reply FIX vendor HLA if that is who this order goes to.';
}

function orderLines(
  order: Order,
  storeName: string,
  vendor: { name: string; category: string | null } | null,
  catalog: StoreVendor[]
): string[] {
  const matched = catalogHasVendor(vendor, catalog);
  const lines = [`📦 Order · ${storeName}`];
  if (matched && vendor) {
    lines.push(`Vendor: ${vendorLabel(vendor)}`);
  } else if (catalog.length > 0) {
    lines.push(`Vendor: not matched — reply FIX vendor HLA. Your vendors: ${describeVendorCatalog(catalog)}`);
    if (order.vendorHint?.trim()) lines.push(`Sheet said: ${order.vendorHint.trim()}`);
  } else {
    lines.push('Vendor: unknown — add HLA / ABC / RPS at signup, or reply FIX vendor HLA');
    if (order.vendorHint?.trim()) lines.push(`Sheet said: ${order.vendorHint.trim()}`);
  }
  for (const item of order.items) lines.push(`• ${qtyText(item)}`);
  lines.push('', orderConfirmAsk(vendor, matched));
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

/** Drop payment-amount review when "paid cash" already means the full total was taken. */
function invoiceReviewFields(needsReview: string[], invoice: Invoice): string[] {
  return needsReview.filter((field) => {
    const key = field.trim().toLowerCase();
    if (key === 'payments.amount' || key === 'payments' || key === 'payment.amount') {
      const paid = paidOf(invoice);
      if (
        paid > 0 &&
        (invoice.paymentStatus === 'paid_cash' || invoice.paymentStatus === 'paid_other') &&
        remainingOf(invoice) <= 0.005
      ) {
        return false;
      }
    }
    return true;
  });
}

export function planUnderstanding(understanding: Understanding, ctx: PlanContext): UnderstandingPlan {
  switch (understanding.kind) {
    case 'daily_close': {
      const entries = understanding.reports.map((report): PlannedEntry => {
        const store = resolveStore(report.storeHint, ctx);
        const credited = applyStoreCredit(report);
        const existing = matchOpenClose(store.storeId, credited.reportDate, ctx.openCloses);
        const merged = existing ? mergeDailyCloseReports(existing.report, credited) : credited;
        const extraTill = extraTillForDay(
          ctx.tillCash,
          store.storeId,
          merged.reportDate ?? localDateString(ctx.now, store.profile?.timezone || 'America/New_York')
        );
        const dateCheck = checkReportDate(merged.reportDate, ctx.now);
        const checks = [
          ...(store.warning ? [store.warning] : []),
          ...(dateCheck ? [dateCheck] : []),
          ...checkDailyClose(merged, store.profile, extraTill),
        ];
        const suggestedRule = suggestDepositRule(merged, store.profile, checks, ctx.canTeachRules);
        const lines = dailyCloseLines(merged, store.storeName, checks, extraTill);
        if (existing) {
          lines[0] = `🧾 ${store.storeName} · ${dateLabel(merged.reportDate)} · adding to this close`;
        }
        return {
          kind: 'daily_close',
          storeId: store.storeId,
          storeName: store.storeName,
          actionType: 'STORE_SALES',
          payload: dailyClosePayload(merged, checks, understanding.needsReview, suggestedRule, {
            updatesActionId: existing?.actionId,
          }),
          confidence: understanding.confidence,
          lines: [
            ...lines,
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
      const today = localDateString(ctx.now, store.profile?.timezone || 'America/New_York');
      let invoice = settleInvoice(understanding.invoice);
      let updatesActionId: string | undefined;
      if (looksLikePaymentUpdate(invoice)) {
        const hit = matchOpenInvoice(invoice, ctx.openInvoices ?? [], store.storeId);
        if (hit) {
          invoice = applyPayments(hit.invoice, invoice);
          updatesActionId = hit.actionId;
        }
      }
      const dateCheck = checkReportDate(invoice.invoiceDate, ctx.now);
      const checks = [
        ...(store.warning ? [store.warning] : []),
        // A missing invoice date is common and not worth interrupting for; only bad dates are flagged.
        ...(dateCheck && dateCheck.id !== 'date_missing' ? [dateCheck] : []),
        ...checkInvoice(invoice),
      ];
      const header = updatesActionId
        ? `🧾 Payment on ${invoice.vendorName ?? 'vendor'} · ${store.storeName}`
        : `🧾 Invoice · ${invoice.vendorName ?? 'Unknown vendor'} · ${store.storeName}`;
      const lines = invoiceLines(invoice, store.storeName, checks, today);
      if (updatesActionId) lines[0] = header;
      const review = invoiceReviewFields(understanding.needsReview, invoice);
      return {
        entries: [
          {
            kind: 'invoice',
            storeId: store.storeId,
            storeName: store.storeName,
            actionType: 'INVOICE_EXPENSE',
            payload: invoicePayload(invoice, checks, review, { updatesActionId }),
            confidence: understanding.confidence,
            lines: [...lines, ...reviewLine(review)],
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

    case 'work_schedule': {
      const store = resolveStore(understanding.schedule.storeHint, ctx);
      const summary = summarizeSchedule(understanding.schedule);
      if (summary.checks.some((c) => c.id === 'schedule_empty')) {
        return {
          entries: [],
          notice: "📅 I couldn't read any shift times from that sheet. Try a clearer photo of the roster taken straight on, or type it like: Maria Mon 9am-5pm, Tue 9am-5pm.",
          equipment: null,
        };
      }
      if (!ctx.canManageSchedules) {
        return {
          entries: [],
          notice: [
            `📅 I read this ${store.storeName} sheet (hours only).`,
            ...hoursLines(summary),
            `Total ${formatHours(summary.totalHours)}`,
            '',
            'Only the owner or a manager can save and post it. Ask them to send the same sheet in the group.',
          ].join('\n'),
          equipment: null,
        };
      }
      const checks = [...(store.warning ? [store.warning] : []), ...summary.checks];
      const withStoreCheck = { ...summary, checks };
      return {
        entries: [
          {
            kind: 'work_schedule',
            storeId: store.storeId,
            storeName: store.storeName,
            actionType: 'UNKNOWN',
            payload: schedulePayload(understanding.schedule, withStoreCheck, understanding.needsReview),
            confidence: understanding.confidence,
            lines: [...scheduleLines(withStoreCheck, store.storeName), ...reviewLine(understanding.needsReview)],
            checks,
          },
        ],
        notice: null,
        equipment: null,
      };
    }

    case 'order': {
      const store = resolveStore(understanding.order.storeHint, ctx);
      const catalog = store.profile?.vendors ?? [];
      const match = matchOrderVendor(understanding.order, catalog);
      const vendor = match.matched
        ?? (understanding.order.vendorHint?.trim()
          ? { name: understanding.order.vendorHint.trim(), category: null }
          : null);
      const checks = [...(store.warning ? [store.warning] : [])];
      if (!match.matched) {
        checks.push({
          id: 'vendor_unmatched',
          status: 'warn',
          message: catalog.length > 0
            ? `Could not match a vendor from your list (${describeVendorCatalog(catalog)}).`
            : 'No vendors set for this store yet. Add HLA / ABC / RPS at signup, or reply FIX vendor HLA.',
        });
      }
      return {
        entries: [
          {
            kind: 'order',
            storeId: store.storeId,
            storeName: store.storeName,
            actionType: 'ORDER_REQUEST',
            payload: orderPayload(understanding.order, vendor, catalog, understanding.needsReview, checks),
            confidence: understanding.confidence,
            lines: [
              ...orderLines(understanding.order, store.storeName, vendor, catalog),
              ...reviewLine(understanding.needsReview),
            ],
            checks,
          },
        ],
        notice: null,
        equipment: null,
      };
    }

    case 'fuel_prices': {
      const reading = understanding.prices;
      const store = resolveStore(reading.storeHint, ctx);
      const decided = resolveFuelSource(reading, ctx.profiles, ctx.messageText);
      const station = reading.stationHint?.trim() || null;
      const observed =
        reading.observedDate ?? localDateString(ctx.now, store.profile?.timezone || 'America/New_York');
      const checks = [...(store.warning ? [store.warning] : []), ...checkFuelPrices(reading)];
      if (decided.reason.startsWith('could not tell')) {
        checks.push({ id: 'fuel_source_unclear', status: 'warn', message: decided.reason });
      }
      const payload = fuelPricesPayload(reading, decided.source, station, observed, checks, understanding.needsReview);
      return {
        entries: [
          {
            kind: 'fuel_prices',
            storeId: store.storeId,
            storeName: store.storeName,
            actionType: 'UNKNOWN',
            payload,
            confidence: understanding.confidence,
            lines: [
              ...fuelPriceLines(reading, decided.source, store.storeName, station, checks),
              ...reviewLine(understanding.needsReview),
            ],
            checks,
          },
        ],
        notice: null,
        equipment: null,
      };
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
          "❓ I couldn't read that as sales, an invoice, a deposit slip, a schedule sheet, an order list, a gas-price board, or an equipment problem.\n\nTry a clearer photo, or type it like: Rockaway cash 298 card 1355 gas 1440. Reply HELP for commands.",
        equipment: null,
      };
  }
}

/**
 * The same summary lines the sender saw for a saved entry, rebuilt from its stored payload
 * (used to show the corrected entry after FIX). Null for entries that predate structured payloads.
 */
export function describeEntryPayload(payload: Record<string, unknown>, storeName: string): string[] | null {
  const checks = (Array.isArray(payload.checks) ? payload.checks : []) as Check[];
  switch (payload._kind) {
    case 'daily_close':
      return dailyCloseLines(payload.report as DailyCloseReport, storeName, checks);
    case 'invoice':
      return invoiceLines(payload.invoice as Invoice, storeName, checks, new Date().toISOString().slice(0, 10));
    case 'deposit_receipt':
      return depositLines(payload.receipt as DepositReceipt, storeName, checks);
    case 'work_schedule': {
      const summary = summarizeSchedule(payload.schedule as WorkSchedule);
      // Keep the store-level warning (if any) that was raised when the entry was created.
      const kept = checks.filter((c) => c.id.startsWith('store_'));
      return scheduleLines({ ...summary, checks: [...kept, ...summary.checks] }, storeName);
    }
    case 'order': {
      const order = payload.order as Order;
      const catalog = Array.isArray(payload.vendors_catalog) ? (payload.vendors_catalog as StoreVendor[]) : [];
      const vendor = payload.vendor
        ? { name: String(payload.vendor), category: (payload.vendor_category as string | null) ?? null }
        : null;
      return orderLines(order, storeName, vendor, catalog);
    }
    case 'fuel_prices': {
      const prices = payload.prices as FuelPrices;
      const source = payload.source === 'own' ? 'own' : 'competitor';
      return fuelPriceLines(prices, source, storeName, typeof payload.station === 'string' ? payload.station : null, checks);
    }
    default:
      return null;
  }
}

function orderReplyFooter(entry: PlannedEntry): string {
  const name = String(entry.payload.vendor ?? '').trim();
  const catalog = Array.isArray(entry.payload.vendors_catalog) ? (entry.payload.vendors_catalog as StoreVendor[]) : [];
  const example = catalogHasVendor({ name }, catalog) ? name : 'HLA';
  return `Reply OK if this is right, FIX vendor ${example}, or CANCEL.`;
}

export function formatEntriesReply(entries: PlannedEntry[]): string {
  const body = entries.map((e) => e.lines.join('\n')).join('\n\n');
  const footer =
    entries.length === 1 && entries[0].kind === 'work_schedule'
      ? "Reply OK to save and post the hours from this sheet, FIX <name> <hours> to correct someone's total (like FIX maria 30), or CANCEL."
      : entries.length === 1 && entries[0].kind === 'order'
      ? orderReplyFooter(entries[0])
      : entries.length === 1 && entries[0].kind === 'fuel_prices'
      ? 'Reply OK to save, FIX regular 4.099, FIX source own, or CANCEL.'
      : entries.length > 1
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
    return {
      ok: true,
      payload: dailyClosePayload(report, checks, review, inferred.length === 1 ? inferred[0] : null, {
        updatesActionId: typeof payload.updates_action_id === 'string' ? payload.updates_action_id : undefined,
      }),
    };
  }

  if (kind === 'invoice' || kind === 'invoice_payment') {
    const invoice = { ...(payload.invoice as Invoice), payments: [...((payload.invoice as Invoice).payments ?? [])] };
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
    } else if (key === 'due' || key === 'due_date' || key === 'duedate' || key === 'payby' || key === 'pay_by') {
      const date = parseIsoDate(value);
      if (!date) return { ok: false, message: 'Date format: FIX due 11/10 (month/day).' };
      if (key === 'payby' || key === 'pay_by') invoice.payBy = date;
      else invoice.dueDate = date;
    } else if (key === 'remaining') {
      const amount = parseMoney(value);
      if (amount == null) return { ok: false, message: `"${value}" is not a number. Example: FIX remaining 400` };
      invoice.remainingDue = amount;
    } else if (key === 'paid') {
      const amount = parseMoney(value);
      if (amount == null) return { ok: false, message: `"${value}" is not a number. Example: FIX paid 500` };
      invoice.payments = [{ amount, method: 'cash' }];
    } else if (key === 'method' || key === 'how') {
      const how = value.trim().toLowerCase();
      if (how === 'cash' || how === 'check' || how === 'other') invoice.remainingMethod = how;
      else return { ok: false, message: 'FIX method cash, check, or other.' };
    } else {
      return { ok: false, message: 'You can fix: total, vendor, date, due, remaining, paid, method.' };
    }
    const settled = settleInvoice(invoice);
    const extra = typeof payload.updates_action_id === 'string' ? { updatesActionId: payload.updates_action_id } : {};
    return { ok: true, payload: invoicePayload(settled, checkInvoice(settled), review, extra) };
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

  if (kind === 'order') {
    if (key !== 'vendor') return { ok: false, message: 'You can fix: vendor. Example: FIX vendor HLA' };
    const catalog = Array.isArray(payload.vendors_catalog) ? (payload.vendors_catalog as StoreVendor[]) : [];
    const order = { ...(payload.order as Order), vendorHint: value.trim() || null };
    const matched = matchVendorName(value, catalog);
    const vendor = matched ?? (value.trim() ? { name: value.trim(), category: 'other' as const } : null);
    const checks: Check[] = matched
      ? []
      : [{ id: 'vendor_unmatched', status: 'warn', message: catalog.length > 0
          ? `Could not match a vendor from your list (${describeVendorCatalog(catalog)}).`
          : 'No vendors set for this store yet. Add HLA / ABC / RPS at signup, or reply FIX vendor HLA.' }];
    return { ok: true, payload: orderPayload(order, vendor, catalog, review, checks) };
  }

  if (kind === 'work_schedule') {
    const parts = `${field} ${value}`.trim().split(/\s+/);
    const hoursText = (parts.pop() ?? '').replace(/h(ours?)?$/i, '');
    const wanted = parts.join(' ').toLowerCase();
    if (!wanted || !/^\d+(\.\d+)?$/.test(hoursText)) {
      return { ok: false, message: 'Usage: FIX <name> <hours>. Example: FIX maria 30' };
    }
    const hours = Number(hoursText);
    if (hours > 200) return { ok: false, message: `${hours} hours is more than a week has room for. Example: FIX maria 30` };

    const schedule = payload.schedule as WorkSchedule;
    const exact = schedule.employees.filter((e) => e.name.trim().toLowerCase() === wanted);
    const matches = exact.length > 0 ? exact : schedule.employees.filter((e) => e.name.trim().toLowerCase().startsWith(wanted));
    if (matches.length === 0) {
      return { ok: false, message: `I don't see "${parts.join(' ')}" on this schedule. Names: ${schedule.employees.map((e) => e.name).join(', ')}.` };
    }
    if (matches.length > 1) {
      return { ok: false, message: `"${parts.join(' ')}" matches ${matches.map((e) => e.name).join(' and ')}. Type more of the name.` };
    }
    const updated: WorkSchedule = {
      ...schedule,
      employees: schedule.employees.map((e) => (e === matches[0] ? { ...e, adjustedHours: hours } : e)),
    };
    const summary = summarizeSchedule(updated);
    const kept = (Array.isArray(payload.checks) ? (payload.checks as Check[]) : []).filter((c) => c.id.startsWith('store_'));
    return { ok: true, payload: schedulePayload(updated, { ...summary, checks: [...kept, ...summary.checks] }, review) };
  }

  if (kind === 'fuel_prices') {
    const current = payload.prices as FuelPrices;
    const currentSource = payload.source === 'own' ? 'own' : 'competitor';
    const fixed = applyFuelPriceFix(current, currentSource, key, value);
    if (!fixed.ok) return { ok: false, message: fixed.message };
    const kept = (Array.isArray(payload.checks) ? (payload.checks as Check[]) : []).filter((c) => c.id.startsWith('store_'));
    const checks = [...kept, ...checkFuelPrices(fixed.reading)];
    const station = fixed.reading.stationHint?.trim() || (typeof payload.station === 'string' ? payload.station : null);
    const observed = typeof payload.observed_date === 'string' ? payload.observed_date : new Date().toISOString().slice(0, 10);
    return { ok: true, payload: fuelPricesPayload(fixed.reading, fixed.source, station, observed, checks, review) };
  }

  return { ok: false, message: 'This entry cannot be corrected with FIX.' };
}
