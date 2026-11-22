/**
 * Code loaders for crew tools — AI never fetches the DB.
 */

import type { PrismaClient } from '@prisma/client';
import { loadStoreReport } from '../../storeReport';
import { loadOpenInvoices } from '../../tasks/invoiceReminder';
import { InvoiceSchema } from '../../understanding/schema';
import { paymentDueOn, remainingOf, paidOf } from '../../understanding/invoiceBalance';
import type { CrewToolId, ToolSlots } from './catalog';

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
        'Books can answer standing/DMR, open invoices, invoice counts (paid/open), or missing closes. What do you want to know?',
    };
  }

  if (toolId === 'help_capabilities') {
    const fallback = [
      `Books for ${storeName} answers from confirmed WhatsApp data only:`,
      '• Standing / DMR for this week or month',
      '• Open vendor invoices (still owed)',
      '• Invoice summary this period (count, paid vs open)',
      '• Missing closes in the period',
    ].join('\n');
    return {
      toolId,
      agentId: 'books',
      storeId,
      storeName,
      question,
      facts: {
        store: storeName,
        capabilities: ['standing_report', 'open_invoices', 'invoice_period_summary', 'missing_closes'],
      },
      fallback,
    };
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
          'open vendor invoices',
          'invoice counts paid vs open',
          'missing closes',
        ],
      },
      fallback: [
        `Books is on for ${storeName}, but that question is not supported from confirmed data yet.`,
        'Try standing/DMR, open invoices, how many invoices this month (paid or open), or missing closes.',
      ].join('\n'),
    };
  }

  if (toolId === 'standing_report' || toolId === 'missing_closes') {
    const period = periodOf(slots);
    const report = await loadStoreReport(prisma, storeId, { period });
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
    const fallback = [
      `${storeName} · ${report.label} (confirmed WhatsApp data only)`,
      `Sales ${money(t.sales)} · cash ${money(t.cash)} · card ${money(t.card)} · gas ${money(t.fuel)}`,
      `Buying (invoices) ${money(t.buying)} · till expenses ${money(t.expenses)}`,
      `Standing (sales − buying − expenses) ${money(t.standing)}`,
      `${t.closes} close(s), ${t.invoices} invoice(s), ${t.missingCloses} day(s) missing a close.`,
      t.standing < 0
        ? 'Standing is negative this period — slow new buying until closes and invoices catch up.'
        : 'Standing is non-negative on the books we have — still not profit (rent/wages not included).',
    ].join('\n');
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
        totals: t,
        topVendors: report.vendors.slice(0, 5),
        note: report.note,
      },
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
