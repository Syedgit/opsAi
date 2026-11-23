/**
 * Code loaders for crew tools — AI never fetches the DB.
 */

import type { PrismaClient } from '@prisma/client';
import { ClassificationType, PendingStatus } from '@prisma/client';
import { loadStoreReport } from '../../storeReport';
import { loadOpenInvoices } from '../../tasks/invoiceReminder';
import { InvoiceSchema, WorkScheduleSchema } from '../../understanding/schema';
import { paymentDueOn, remainingOf, paidOf } from '../../understanding/invoiceBalance';
import {
  formatHours,
  formatShiftRange,
  hoursLines,
  summarizeSchedule,
  weekContainsDate,
} from '../../understanding/schedule';
import { localDateString } from '../../tasks/time';
import { addGmailOwnerRule, getGmailPublicStatus } from '../../gmail/connection';
import { parseGmailAlertRoute } from '../../gmail/rules';
import { taskAlertsEnabled } from '../../notify/channels';
import type { CrewToolId, GmailRuleRouteSlot, ToolSlots } from './catalog';

export type ToolFactsResult = {
  toolId: CrewToolId;
  agentId: 'books';
  storeId: string;
  storeName: string;
  question: string;
  facts: Record<string, unknown>;
  fallback: string;
};

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function periodOf(slots: ToolSlots | undefined): 'week' | 'month' {
  return slots?.period === 'week' ? 'week' : 'month';
}

export async function loadToolFacts(
  prisma: PrismaClient,
  storeId: string,
  storeName: string,
  question: string,
  toolId: CrewToolId,
  slots: ToolSlots = {},
  clarifyAsk?: string | null
): Promise<ToolFactsResult | { kind: 'clarify'; message: string } | { kind: 'skip' }> {
  if (toolId === 'not_ai_chat') return { kind: 'skip' };

  if (toolId === 'clarify') {
    return {
      kind: 'clarify',
      message:
        (clarifyAsk && clarifyAsk.trim()) ||
        `I can pull today’s follow-ups for ${storeName}, or dig into standing, invoices, or the schedule — what do you need?`,
    };
  }

  if (toolId === 'help_capabilities') {
    const fallback = [
      `I look up confirmed WhatsApp data for ${storeName} and answer in plain language.`,
      'Ask naturally — for example what’s due today, how standing looks this month, open vendor bills, who worked yesterday, or missing closes.',
      'I can also show connectors (Gmail, WhatsApp group) and add Gmail alert rules — or do the same under Business admin → Tools.',
    ].join('\n');
    return {
      toolId,
      agentId: 'books',
      storeId,
      storeName,
      question,
      facts: {
        store: storeName,
        capabilities: [
          'ops_today',
          'standing_report',
          'staff_schedule',
          'open_invoices',
          'invoice_period_summary',
          'missing_closes',
          'list_connectors',
          'list_gmail_rules',
          'create_gmail_rule',
        ],
      },
      fallback,
    };
  }

  if (toolId === 'list_connectors') {
    return loadListConnectors(prisma, storeId, storeName, question);
  }
  if (toolId === 'list_gmail_rules') {
    return loadListGmailRules(prisma, storeId, storeName, question);
  }
  if (toolId === 'create_gmail_rule') {
    return loadCreateGmailRule(prisma, storeId, storeName, question, slots);
  }

  if (toolId === 'unsupported') {
    return {
      toolId,
      agentId: 'books',
      storeId,
      storeName,
      question,
      facts: {
        store: storeName,
        supportedTopics: [
          'standing / DMR',
          'who worked / schedule hours',
          'open vendor invoices',
          'invoice counts paid vs open',
          'missing closes',
        ],
      },
      fallback: [
        `Books is on for ${storeName}, but I do not have confirmed data for that yet.`,
        'I can cover today’s follow-ups, standing/DMR, schedule hours, open invoices, or missing closes.',
      ].join('\n'),
    };
  }

  if (toolId === 'staff_schedule') {
    return loadStaffScheduleFacts(prisma, storeId, storeName, question);
  }

  if (toolId === 'ops_today') {
    return loadOpsTodayFacts(prisma, storeId, storeName, question);
  }

  if (toolId === 'standing_report' || toolId === 'missing_closes') {
    const customFrom = typeof slots.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(slots.from) ? slots.from : null;
    const customTo = typeof slots.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(slots.to) ? slots.to : null;
    const useCustom = slots.period === 'custom' && customFrom && customTo;
    const report = await loadStoreReport(prisma, storeId, {
      period: useCustom ? 'custom' : periodOf(slots),
      from: useCustom ? customFrom : null,
      to: useCustom ? customTo : null,
    });
    if ('error' in report) {
      return {
        toolId,
        agentId: 'books',
        storeId,
        storeName,
        question,
        facts: { error: report.error },
        fallback: `I could not load ${storeName}'s report.`,
      };
    }
    const t = report.totals;
    if (toolId === 'missing_closes') {
      const fallback = `${storeName} · ${report.label}: ${t.missingCloses} day(s) missing a confirmed close (${t.closes} close(s) on file).`;
      return {
        toolId,
        agentId: 'books',
        storeId,
        storeName,
        question,
        facts: {
          store: storeName,
          period: report.label,
          from: report.from,
          to: report.to,
          missingCloses: t.missingCloses,
          closes: t.closes,
        },
        fallback,
      };
    }
    const singleDay = report.from === report.to;
    const dayRow = singleDay ? report.days.find((d) => d.day === report.from) : null;
    const fallback = singleDay
      ? [
          `${storeName} · sales for ${report.from} (confirmed WhatsApp data only)`,
          dayRow && dayRow.closes > 0
            ? `Sales ${money(dayRow.sales)} · cash ${money(dayRow.cash)} · card ${money(dayRow.card)} · gas ${money(dayRow.fuel)}`
            : `No confirmed close on file for ${report.from} yet — sales for that day are not on the books.`,
          dayRow && dayRow.closes > 0
            ? `Buying ${money(dayRow.buying)} · till expenses ${money(dayRow.expenses)} · ${dayRow.closes} close(s).`
            : '',
        ]
          .filter(Boolean)
          .join('\n')
      : [
          `${storeName} · ${report.label} (confirmed WhatsApp data only)`,
          `Sales ${money(t.sales)} · cash ${money(t.cash)} · card ${money(t.card)} · gas ${money(t.fuel)}`,
          `Buying (invoices) ${money(t.buying)} · till expenses ${money(t.expenses)}`,
          `Standing (sales − buying − expenses) ${money(t.standing)}`,
          `${t.closes} close(s), ${t.invoices} invoice(s), ${t.missingCloses} day(s) missing a close.`,
          t.standing < 0
            ? 'Standing is negative this period — slow new buying until closes and invoices catch up.'
            : 'Standing is non-negative on the books we have — still not profit (rent/wages not included).',
        ].join('\n');
    // Single-day: only expose that day's numbers so exit AI cannot invent month "missing closes".
    const facts = singleDay
      ? {
          store: storeName,
          period: report.from,
          from: report.from,
          to: report.to,
          singleDay: true,
          day: dayRow
            ? {
                day: dayRow.day,
                sales: dayRow.sales,
                cash: dayRow.cash,
                card: dayRow.card,
                fuel: dayRow.fuel,
                buying: dayRow.buying,
                expenses: dayRow.expenses,
                closes: dayRow.closes,
              }
            : null,
          note: report.note,
        }
      : {
          store: storeName,
          period: report.label,
          from: report.from,
          to: report.to,
          singleDay: false,
          totals: t,
          topVendors: report.vendors.slice(0, 5),
          note: report.note,
        };
    return {
      toolId,
      agentId: 'books',
      storeId,
      storeName,
      question,
      facts,
      fallback,
    };
  }

  if (toolId === 'open_invoices') {
    const open = await loadOpenInvoices(prisma, [storeId]);
    const mine = open.filter((row) => row.storeId === storeId);
    const nameHint = slots.vendor?.trim().toLowerCase() || null;
    if (mine.length === 0) {
      return {
        toolId,
        agentId: 'books',
        storeId,
        storeName,
        question,
        facts: { store: storeName, openInvoices: [], vendorFilter: nameHint },
        fallback: `No open invoices on the books for ${storeName}. Paid or fully closed bills will not show here.`,
      };
    }
    const filtered = nameHint
      ? mine.filter((row) => (row.invoice.vendorName || '').toLowerCase().includes(nameHint))
      : mine;
    // Never widen a named-vendor miss into all vendors — that misleads.
    if (nameHint && filtered.length === 0) {
      return {
        toolId,
        agentId: 'books',
        storeId,
        storeName,
        question,
        facts: {
          store: storeName,
          openInvoices: [],
          vendorFilter: nameHint,
          matchedVendorFilter: false,
        },
        fallback: `No open / due invoices on the books for vendor “${nameHint}” at ${storeName}.`,
      };
    }
    const list = filtered.slice(0, 8).map((row) => {
      const inv = row.invoice;
      return {
        vendor: inv.vendorName || 'Vendor',
        remaining: remainingOf(inv),
        due: paymentDueOn(inv) || null,
        invoiceNumber: inv.invoiceNumber || null,
      };
    });
    const lines = list.map(
      (inv) =>
        `• ${inv.vendor} · ${money(inv.remaining)} left · due ${inv.due || 'no due date'}${
          inv.invoiceNumber ? ` · #${inv.invoiceNumber}` : ''
        }`
    );
    return {
      toolId,
      agentId: 'books',
      storeId,
      storeName,
      question,
      facts: {
        store: storeName,
        openInvoices: list,
        vendorFilter: nameHint,
        matchedVendorFilter: Boolean(nameHint),
      },
      fallback: [
        nameHint
          ? `Open / due invoices for “${nameHint}” at ${storeName}:`
          : `Open invoices for ${storeName}:`,
        ...lines,
      ].join('\n'),
    };
  }

  // invoice_period_summary
  const period = periodOf(slots);
  const status = slots.status === 'paid' || slots.status === 'open' ? slots.status : 'all';
  const report = await loadStoreReport(prisma, storeId, { period });
  if ('error' in report) {
    return {
      toolId: 'invoice_period_summary',
      agentId: 'books',
      storeId,
      storeName,
      question,
      facts: { error: report.error },
      fallback: `I could not load ${storeName}'s invoices.`,
    };
  }

  const store = await prisma.storeConfig.findUnique({
    where: { storeId },
    select: { timezone: true },
  });
  const timeZone = store?.timezone || 'America/New_York';

  const fromMs = Date.parse(`${report.from}T00:00:00.000Z`) - 14 * 24 * 60 * 60 * 1000;
  const toMs = Date.parse(`${report.to}T23:59:59.999Z`) + 2 * 24 * 60 * 60 * 1000;
  const rows = await prisma.pendingActions.findMany({
    where: {
      storeId,
      type: 'INVOICE_EXPENSE',
      status: 'CONFIRMED',
      createdAt: {
        gte: new Date(Number.isFinite(fromMs) ? fromMs : Date.now() - 45 * 86400000),
        lt: new Date(Number.isFinite(toMs) ? toMs : Date.now() + 86400000),
      },
    },
    select: { payloadJson: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
    take: 2000,
  });

  const nameHint = slots.vendor?.trim().toLowerCase() || null;
  let openCount = 0;
  let paidCount = 0;
  let openDollars = 0;
  let paidDollars = 0;
  let totalDollars = 0;
  let counted = 0;
  const vendors: Record<string, number> = {};
  let lastPaid: { vendor: string; amount: number; date: string; method: string | null } | null = null;

  for (const row of rows) {
    const raw = row.payloadJson;
    const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
    if (!obj || obj._kind === 'invoice_payment') continue;
    const parsed = InvoiceSchema.safeParse(obj);
    if (!parsed.success) continue;
    const inv = parsed.data;
    const vendor = inv.vendorName || 'Vendor';
    if (nameHint && !vendor.toLowerCase().includes(nameHint)) continue;

    const d = inv.invoiceDate || null;
    if (d) {
      if (d < report.from || d > report.to) continue;
    } else {
      const day = row.createdAt.toISOString().slice(0, 10);
      if (day < report.from || day > report.to) continue;
    }

    counted += 1;
    const total = inv.total || 0;
    const remaining = remainingOf(inv);
    const paid = paidOf(inv);
    totalDollars += total;
    vendors[vendor] = (vendors[vendor] || 0) + total;

    if (remaining > 0.005) {
      openCount += 1;
      openDollars += remaining;
    } else {
      const paidAmt = paid > 0 ? paid : total;
      paidCount += 1;
      paidDollars += paidAmt;
      const methods = (inv.payments || []).map((p) => p.method).filter(Boolean);
      const method =
        methods.length > 0
          ? [...new Set(methods)].join('/')
          : inv.paymentStatus === 'paid_cash'
            ? 'cash'
            : inv.paymentStatus === 'paid_other'
              ? 'other'
              : null;
      // rows ascend by createdAt — last fully-paid invoice wins as most recent.
      lastPaid = {
        vendor,
        amount: Math.round(paidAmt * 100) / 100,
        date: d || row.createdAt.toISOString().slice(0, 10),
        method,
      };
    }
  }

  const topVendors = Object.entries(vendors)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([vendor, amount]) => ({ vendor, amount: Math.round(amount * 100) / 100 }));

  const vendorLabel = nameHint ? ` for “${nameHint}”` : '';
  const focus =
    status === 'paid'
      ? `${paidCount} paid invoice(s)${vendorLabel} · ${money(Math.round(paidDollars * 100) / 100)} recorded paid`
      : status === 'open'
        ? `${openCount} open invoice(s)${vendorLabel} · ${money(Math.round(openDollars * 100) / 100)} still owed`
        : `${counted} invoice(s)${vendorLabel} · ${money(Math.round(totalDollars * 100) / 100)} billed · ${paidCount} paid · ${openCount} open (${money(Math.round(openDollars * 100) / 100)} owed)`;

  const lastPaidLine = lastPaid
    ? `Last paid${vendorLabel}: ${lastPaid.vendor} · ${money(lastPaid.amount)} · ${lastPaid.date}${
        lastPaid.method ? ` · ${lastPaid.method}` : ''
      }`
    : nameHint && status === 'paid'
      ? `No fully paid invoice on the books for “${nameHint}” in ${report.label}.`
      : null;

  const fallback = [
    `${storeName} · ${report.label} invoices (confirmed WhatsApp data)`,
    focus,
    status === 'paid' && lastPaidLine ? lastPaidLine : null,
    !nameHint && topVendors.length
      ? `Top vendors: ${topVendors.map((v) => `${v.vendor} ${money(v.amount)}`).join(', ')}`
      : null,
    counted === 0
      ? nameHint
        ? `No vendor invoices matching “${nameHint}” in this window.`
        : 'No vendor invoices in this window.'
      : null,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    toolId: 'invoice_period_summary',
    agentId: 'books',
    storeId,
    storeName,
    question,
    facts: {
      store: storeName,
      period: report.label,
      from: report.from,
      to: report.to,
      timezone: timeZone,
      statusFilter: status,
      vendorFilter: nameHint,
      invoiceCount: counted,
      paidCount,
      openCount,
      totalBilled: Math.round(totalDollars * 100) / 100,
      paidDollars: Math.round(paidDollars * 100) / 100,
      openDollars: Math.round(openDollars * 100) / 100,
      topVendors,
      lastPaidVendor: lastPaid,
      standingBuying: report.totals.buying,
      standingInvoiceLines: report.totals.invoices,
    },
    fallback,
  };
}

function addUtcDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function scheduleDayTarget(
  question: string,
  today: string
): { kind: 'date'; date: string; label: string } | { kind: 'week'; label: string } {
  const q = question.toLowerCase();
  if (/\byesterday\b/.test(q)) {
    const date = addUtcDays(today, -1);
    return { kind: 'date', date, label: 'yesterday' };
  }
  if (/\btoday\b/.test(q)) return { kind: 'date', date: today, label: 'today' };
  if (/\btomorrow\b/.test(q)) {
    const date = addUtcDays(today, 1);
    return { kind: 'date', date, label: 'tomorrow' };
  }
  const weekday = q.match(/\b(mon|tue|wed|thu|fri|sat|sun)(?:day)?\b/);
  if (weekday) {
    const map: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
    const want = map[weekday[1].slice(0, 3)];
    const todayIdx = new Date(`${today}T12:00:00Z`).getUTCDay();
    // Prefer the most recent occurrence of that weekday (including today).
    const back = (todayIdx - want + 7) % 7;
    const date = addUtcDays(today, -back);
    return { kind: 'date', date, label: weekday[0] };
  }
  return { kind: 'week', label: 'this week' };
}

async function loadOpsTodayFacts(
  prisma: PrismaClient,
  storeId: string,
  storeName: string,
  question: string
): Promise<ToolFactsResult> {
  const store = await prisma.storeConfig.findUnique({
    where: { storeId },
    select: { timezone: true },
  });
  const timeZone = store?.timezone?.trim() || 'America/New_York';
  const today = localDateString(new Date(), timeZone);
  const yesterday = addUtcDays(today, -1);
  const now = new Date();

  const openRuns = (
    await prisma.taskRun.findMany({
      where: { storeId, status: 'OPEN' },
      orderBy: { dueAt: 'asc' },
      take: 20,
    })
  ).filter((r) => r.alertedAt);

  const overdueTasks = openRuns.filter((r) => r.dueAt.getTime() < now.getTime());
  const dueTodayTasks = openRuns.filter((r) => {
    const dueDay = localDateString(r.dueAt, timeZone);
    return dueDay === today && r.dueAt.getTime() >= now.getTime();
  });

  const openBills = (await loadOpenInvoices(prisma, [storeId])).filter((row) => row.storeId === storeId);
  const soon = addUtcDays(today, 7);
  const billsDueSoon = openBills
    .map((row) => {
      const due = paymentDueOn(row.invoice);
      const left = remainingOf(row.invoice);
      return {
        vendor: row.invoice.vendorName || 'Vendor',
        remaining: left,
        due,
      };
    })
    .filter((b) => b.due && b.due <= soon)
    .sort((a, b) => String(a.due).localeCompare(String(b.due)))
    .slice(0, 6);

  const onToday = await whoWorkedOnDate(prisma, storeId, today);
  const weekReport = await loadStoreReport(prisma, storeId, { period: 'week' });
  let yesterdayCloseMissing = false;
  if (!('error' in weekReport)) {
    const day = weekReport.days.find((d) => d.day === yesterday);
    yesterdayCloseMissing = !day || day.closes === 0;
  }

  const lines: string[] = [`📋 ${storeName} · what to follow (${today})`];
  if (overdueTasks.length) {
    lines.push(`Overdue tasks (${overdueTasks.length}):`);
    for (const t of overdueTasks.slice(0, 5)) {
      lines.push(`• ${t.title}`);
    }
  }
  if (dueTodayTasks.length) {
    lines.push(`Due today (${dueTodayTasks.length}):`);
    for (const t of dueTodayTasks.slice(0, 5)) {
      lines.push(`• ${t.title}`);
    }
  }
  if (!overdueTasks.length && !dueTodayTasks.length) {
    lines.push('No open WhatsApp tasks due right now.');
  }
  if (billsDueSoon.length) {
    lines.push('Bills due within 7 days:');
    for (const b of billsDueSoon) {
      lines.push(`• ${b.vendor} · ${money(b.remaining)} · due ${b.due}`);
    }
  } else {
    lines.push('No open bills due in the next 7 days.');
  }
  if (onToday.people.length) {
    lines.push(`On the schedule today: ${onToday.people.map((p) => p.name).join(', ')}.`);
  } else if (onToday.hasSchedule) {
    lines.push('Nobody listed on the confirmed schedule for today.');
  } else {
    lines.push('No confirmed shift schedule on file yet.');
  }
  if (yesterdayCloseMissing) {
    lines.push(`Yesterday’s close (${yesterday}) is not on the books yet.`);
  }
  if (
    !overdueTasks.length &&
    !dueTodayTasks.length &&
    !billsDueSoon.length &&
    !yesterdayCloseMissing
  ) {
    lines.push('Nothing urgent flagged from confirmed data right now.');
  }

  return {
    toolId: 'ops_today',
    agentId: 'books',
    storeId,
    storeName,
    question,
    facts: {
      store: storeName,
      today,
      yesterday,
      overdueTasks: overdueTasks.map((t) => t.title),
      dueTodayTasks: dueTodayTasks.map((t) => t.title),
      billsDueSoon,
      onToday: onToday.people,
      yesterdayCloseMissing,
    },
    fallback: lines.join('\n'),
  };
}

/** Shared: who is listed on a calendar date from confirmed schedules. */
async function whoWorkedOnDate(
  prisma: PrismaClient,
  storeId: string,
  date: string
): Promise<{ hasSchedule: boolean; people: Array<{ name: string; times: string }> }> {
  const rows = await prisma.pendingActions.findMany({
    where: { storeId, type: ClassificationType.UNKNOWN, status: PendingStatus.CONFIRMED },
    orderBy: { createdAt: 'desc' },
    take: 80,
  });
  const schedules = rows
    .map((row) => {
      const data = row.payloadJson as { _kind?: string; week_start?: string; schedule?: unknown } | null;
      if (data?._kind !== 'work_schedule') return null;
      const parsed = WorkScheduleSchema.safeParse(data.schedule);
      if (!parsed.success) return null;
      return {
        weekStart: typeof data.week_start === 'string' ? data.week_start : parsed.data.weekStart,
        schedule: parsed.data,
      };
    })
    .filter(Boolean) as Array<{ weekStart: string | null; schedule: import('../../understanding/schema').WorkSchedule }>;

  if (!schedules.length) return { hasSchedule: false, people: [] };

  const match =
    schedules.find((s) => s.weekStart && weekContainsDate(s.weekStart, date)) ||
    schedules.find((s) =>
      summarizeSchedule(s.schedule).employees.some((e) => e.shifts.some((sh) => sh.date === date))
    );
  if (!match) return { hasSchedule: true, people: [] };

  const summary = summarizeSchedule(match.schedule);
  const people = summary.employees
    .map((e) => {
      const shifts = e.shifts.filter((sh) => sh.date === date);
      if (!shifts.length) return null;
      const times = shifts
        .map((sh) => formatShiftRange(sh.start, sh.end) || `${sh.start || '?'}-${sh.end || '?'}`)
        .filter(Boolean)
        .join(', ');
      return { name: e.name, times };
    })
    .filter(Boolean) as Array<{ name: string; times: string }>;
  return { hasSchedule: true, people };
}

async function loadStaffScheduleFacts(
  prisma: PrismaClient,
  storeId: string,
  storeName: string,
  question: string
): Promise<ToolFactsResult> {
  const store = await prisma.storeConfig.findUnique({
    where: { storeId },
    select: { timezone: true },
  });
  const timeZone = store?.timezone?.trim() || 'America/New_York';
  const today = localDateString(new Date(), timeZone);
  const target = scheduleDayTarget(question, today);

  if (target.kind === 'week') {
    const rows = await prisma.pendingActions.findMany({
      where: { storeId, type: ClassificationType.UNKNOWN, status: PendingStatus.CONFIRMED },
      orderBy: { createdAt: 'desc' },
      take: 80,
    });
    const schedules = rows
      .map((row) => {
        const data = row.payloadJson as { _kind?: string; week_start?: string; schedule?: unknown } | null;
        if (data?._kind !== 'work_schedule') return null;
        const parsed = WorkScheduleSchema.safeParse(data.schedule);
        if (!parsed.success) return null;
        return {
          weekStart: typeof data.week_start === 'string' ? data.week_start : parsed.data.weekStart,
          schedule: parsed.data,
        };
      })
      .filter(Boolean) as Array<{
      weekStart: string | null;
      schedule: import('../../understanding/schema').WorkSchedule;
    }>;

    if (!schedules.length) {
      return {
        toolId: 'staff_schedule',
        agentId: 'books',
        storeId,
        storeName,
        question,
        facts: { store: storeName, people: [], target },
        fallback: [
          `No confirmed shift schedule on file for ${storeName} yet.`,
          'Send a schedule photo or typed roster on WhatsApp and reply OK — then I can say who worked.',
        ].join('\n'),
      };
    }

    const match =
      schedules.find((s) => s.weekStart && weekContainsDate(s.weekStart, today)) || schedules[0];
    const summary = summarizeSchedule(match.schedule);
    const fallback = [
      `📅 ${storeName} · hours for ${target.label}`,
      ...hoursLines(summary),
      `Total ${formatHours(summary.totalHours)}`,
      '',
      'From the confirmed schedule sheet. Hours only — not pay.',
    ].join('\n');
    return {
      toolId: 'staff_schedule',
      agentId: 'books',
      storeId,
      storeName,
      question,
      facts: {
        store: storeName,
        target,
        weekStart: summary.weekStart,
        people: summary.employees.map((e) => ({ name: e.name, hours: e.hours })),
        totalHours: summary.totalHours,
      },
      fallback,
    };
  }

  const onShift = await whoWorkedOnDate(prisma, storeId, target.date);
  if (!onShift.hasSchedule) {
    return {
      toolId: 'staff_schedule',
      agentId: 'books',
      storeId,
      storeName,
      question,
      facts: { store: storeName, people: [], target },
      fallback: [
        `No confirmed shift schedule on file for ${storeName} yet.`,
        'Send a schedule photo or typed roster on WhatsApp and reply OK — then I can say who worked.',
      ].join('\n'),
    };
  }
  if (!onShift.people.length) {
    return {
      toolId: 'staff_schedule',
      agentId: 'books',
      storeId,
      storeName,
      question,
      facts: { store: storeName, people: [], target },
      fallback: `Nobody is listed as working ${target.label} (${target.date}) on the confirmed schedule for ${storeName}.`,
    };
  }

  const lines = onShift.people.map((p) => `• ${p.name}${p.times ? ` · ${p.times}` : ''}`);
  const fallback = [
    `📅 ${storeName} · who worked ${target.label} (${target.date})`,
    ...lines,
    '',
    'From the confirmed schedule sheet. Hours only — not pay.',
  ].join('\n');

  return {
    toolId: 'staff_schedule',
    agentId: 'books',
    storeId,
    storeName,
    question,
    facts: {
      store: storeName,
      target,
      people: onShift.people,
    },
    fallback,
  };
}

function routeLabel(route: string): string {
  if (route === 'group') return 'store WhatsApp group';
  if (route === 'both') return 'owner DM + store group';
  return 'owner WhatsApp DM';
}

function parseRuleHintsFromQuestion(question: string): {
  ruleFrom: string | null;
  ruleContains: string | null;
  ruleLabel: string | null;
  route: GmailRuleRouteSlot;
} {
  const q = question.trim();
  let route: GmailRuleRouteSlot = 'dm';
  if (/\b(both|dm (me )?and (the )?group|group and dm)\b/i.test(q)) route = 'both';
  else if (/\b(post|send|alert).{0,40}\bgroup\b|\bin the group\b|\bto the group\b/i.test(q)) route = 'group';

  const email =
    q.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0] ||
    q.match(/@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0] ||
    null;
  const contains =
    q.match(/contains?\s+[“"]([^”"]+)[”"]/i)?.[1] ||
    q.match(/contains?\s+[‘']([^’']+)[’']/i)?.[1] ||
    q.match(/\bcontains?\s+([A-Za-z0-9][\w ._-]{1,60})/i)?.[1] ||
    null;
  const label =
    q.match(/\blabel(?:ed)?\s+[“"]([^”"]+)[”"]/i)?.[1] ||
    q.match(/\bcalled\s+[“"]([^”"]+)[”"]/i)?.[1] ||
    null;

  // “from X” without a clear email — keep null; slots or clarify fill it.
  let ruleFrom = email;
  if (!ruleFrom) {
    const fromWord = q.match(/\bfrom\s+([^\s,]+@[^\s,]+|\@[^\s,]+)/i)?.[1];
    if (fromWord) ruleFrom = fromWord;
  }

  return {
    ruleFrom: ruleFrom?.trim() || null,
    ruleContains: contains?.trim().slice(0, 120) || null,
    ruleLabel: label?.trim().slice(0, 40) || null,
    route,
  };
}

async function loadListConnectors(
  prisma: PrismaClient,
  storeId: string,
  storeName: string,
  question: string
): Promise<ToolFactsResult> {
  const [gmail, groupCount, peopleCount, store] = await Promise.all([
    getGmailPublicStatus(prisma, storeId),
    prisma.storeWhatsAppGroup.count({ where: { storeId, active: true } }),
    prisma.userDirectory.count({ where: { storeId, isActive: true } }),
    prisma.storeConfig.findUnique({ where: { storeId }, select: { profileJson: true } }),
  ]);
  const alertsOn = store ? taskAlertsEnabled(store.profileJson) : true;
  const setupUrl = `/tasks?storeId=${encodeURIComponent(storeId)}&view=setup`;
  const lines: string[] = [`🔌 ${storeName} · connectors`, ''];

  if (gmail.connected) {
    lines.push(`• Gmail — connected (${gmail.email || 'inbox'})`);
    lines.push(
      gmail.rules.length
        ? `  ${gmail.rules.length} custom alert rule(s). Ask “show Gmail rules” or add one in chat.`
        : '  No custom rules yet — built-in past-due style rules still run. Ask me to add one.'
    );
  } else if (gmail.configured) {
    lines.push('• Gmail — not connected');
    lines.push(`  Connect in the app: ${setupUrl} (Tools → Connect with Google).`);
  } else {
    lines.push('• Gmail — not available on this server yet.');
  }

  lines.push(
    groupCount > 0
      ? `• WhatsApp group — linked (${groupCount})`
      : '• WhatsApp group — not linked (task/Gmail group posts need a store group)'
  );
  lines.push(
    peopleCount > 0
      ? `• WhatsApp people — ${peopleCount} listed`
      : '• WhatsApp people — none on this business (owner alerts may still use a linked number from another store)'
  );
  lines.push(`• Task WhatsApp alerts — ${alertsOn ? 'on' : 'off'}`);
  lines.push('', `App setup: ${setupUrl}`);

  return {
    toolId: 'list_connectors',
    agentId: 'books',
    storeId,
    storeName,
    question,
    facts: {
      store: storeName,
      gmail: {
        connected: gmail.connected,
        email: gmail.email,
        status: gmail.status,
        ruleCount: gmail.rules.length,
        configured: gmail.configured,
      },
      whatsappGroupCount: groupCount,
      whatsappPeopleCount: peopleCount,
      taskAlertsEnabled: alertsOn,
      setupUrl,
    },
    fallback: lines.join('\n'),
  };
}

async function loadListGmailRules(
  prisma: PrismaClient,
  storeId: string,
  storeName: string,
  question: string
): Promise<ToolFactsResult> {
  const gmail = await getGmailPublicStatus(prisma, storeId);
  const setupUrl = `/tasks?storeId=${encodeURIComponent(storeId)}&view=setup`;
  if (!gmail.connected) {
    return {
      toolId: 'list_gmail_rules',
      agentId: 'books',
      storeId,
      storeName,
      question,
      facts: { store: storeName, connected: false, setupUrl },
      fallback: gmail.configured
        ? `Gmail is not connected for ${storeName}. Connect under Tools in the app (${setupUrl}), then I can list or add rules.`
        : `Gmail is not available on this server for ${storeName}.`,
    };
  }
  const lines = [`📧 ${storeName} · Gmail rules (${gmail.email})`, ''];
  if (gmail.builtinRules.length) {
    lines.push('Built-in: ' + gmail.builtinRules.map((b) => b.label).join(', ') + '.');
  }
  if (!gmail.rules.length) {
    lines.push('No custom rules yet. Say e.g. “Alert me when mail from billing@x.com contains overdue”.');
  } else {
    for (const r of gmail.rules) {
      const bits = [];
      if (r.from) bits.push(`From ${r.from}`);
      if (r.contains) bits.push(`contains “${r.contains}”`);
      bits.push(`→ ${routeLabel(r.route)}`);
      lines.push(`• ${r.label} — ${bits.join(' · ')}`);
    }
  }
  lines.push('', `Edit in app: ${setupUrl}`);
  return {
    toolId: 'list_gmail_rules',
    agentId: 'books',
    storeId,
    storeName,
    question,
    facts: {
      store: storeName,
      email: gmail.email,
      rules: gmail.rules,
      builtinRules: gmail.builtinRules,
      setupUrl,
    },
    fallback: lines.join('\n'),
  };
}

async function loadCreateGmailRule(
  prisma: PrismaClient,
  storeId: string,
  storeName: string,
  question: string,
  slots: ToolSlots
): Promise<ToolFactsResult | { kind: 'clarify'; message: string }> {
  const gmail = await getGmailPublicStatus(prisma, storeId);
  const setupUrl = `/tasks?storeId=${encodeURIComponent(storeId)}&view=setup`;
  if (!gmail.connected) {
    return {
      toolId: 'create_gmail_rule',
      agentId: 'books',
      storeId,
      storeName,
      question,
      facts: { store: storeName, connected: false, setupUrl },
      fallback: gmail.configured
        ? `Connect Gmail first for ${storeName} in the app (${setupUrl} → Tools → Connect with Google). Then ask me again to add the rule.`
        : `Gmail is not available on this server for ${storeName}.`,
    };
  }

  const hinted = parseRuleHintsFromQuestion(question);
  const ruleFrom = (slots.ruleFrom || hinted.ruleFrom || '').trim() || null;
  const ruleContains = (slots.ruleContains || hinted.ruleContains || '').trim() || null;
  const ruleLabel = (slots.ruleLabel || hinted.ruleLabel || '').trim() || null;
  const route = parseGmailAlertRoute(slots.route || hinted.route) as GmailRuleRouteSlot;

  if (!ruleFrom && !ruleContains) {
    return {
      kind: 'clarify',
      message:
        'What should match? Give a From address (or @domain) and/or text the subject contains — and say DM, group, or both.',
    };
  }

  if (route === 'group' || route === 'both') {
    const groups = await prisma.storeWhatsAppGroup.count({ where: { storeId, active: true } });
    if (groups === 0) {
      return {
        kind: 'clarify',
        message: `No WhatsApp group is linked for ${storeName} yet. Link a group in the app, or say “DM me” instead.`,
      };
    }
  }

  const added = await addGmailOwnerRule(prisma, storeId, {
    label: ruleLabel,
    from: ruleFrom,
    contains: ruleContains,
    mode: 'alert',
    route,
  });
  if (!added.ok) {
    return {
      toolId: 'create_gmail_rule',
      agentId: 'books',
      storeId,
      storeName,
      question,
      facts: { store: storeName, error: added.error },
      fallback: added.error,
    };
  }

  const rule = added.gmail.rules[added.gmail.rules.length - 1];
  const bits = [];
  if (rule?.from) bits.push(`From ${rule.from}`);
  if (rule?.contains) bits.push(`contains “${rule.contains}”`);
  bits.push(`→ ${routeLabel(rule?.route || route)}`);
  const fallback = [
    `✅ Gmail rule saved for ${storeName}`,
    `${rule?.label || 'Alert'} — ${bits.join(' · ')}`,
    '',
    'Mail is scanned on a schedule (not instantly). You can also manage rules under Tools in the app.',
  ].join('\n');

  return {
    toolId: 'create_gmail_rule',
    agentId: 'books',
    storeId,
    storeName,
    question,
    facts: {
      store: storeName,
      created: rule,
      route,
      setupUrl,
    },
    fallback,
  };
}
