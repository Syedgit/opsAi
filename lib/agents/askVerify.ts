/**
 * Supervisor verify loop: after tools load facts, check they answer the ask.
 * Internal agents work stays here — the user only sees a verified/refined reply.
 */

import type { ChatTurn } from './supervisor';
import {
  wantsLastPaidAsk,
  wantsOpenDueAsk,
  wantsTillPaidOutAsk,
  wantsVendorDirectoryAsk,
  wantsVendorPaymentMethodAsk,
} from './supervisor';

export type AskIntentKind =
  | 'standing'
  | 'open_due'
  | 'vendor_directory'
  | 'invoice_period'
  | 'last_paid'
  | 'vendor_payment_method'
  | 'missing_closes'
  | 'help'
  | 'other';

export type FactPart = {
  purpose: string;
  toolId: string;
  facts: Record<string, unknown>;
  fallback: string;
};

export type VerifyOutcome =
  | { status: 'answer'; text: string; /** Light rephrase allowed; no new facts. */ polish: boolean }
  | { status: 'reject'; text: string };

export function inferAskIntent(question: string, history: ChatTurn[] = []): AskIntentKind {
  const q = question.toLowerCase().trim();
  const prior = history
    .slice(-6)
    .map((t) => t.text.toLowerCase())
    .join(' ');

  if (wantsTillPaidOutAsk(q)) return 'other';
  if (wantsVendorDirectoryAsk(q)) return 'vendor_directory';
  if (wantsVendorPaymentMethodAsk(q)) return 'vendor_payment_method';
  if (wantsLastPaidAsk(q)) return 'last_paid';
  if (wantsOpenDueAsk(q)) return 'open_due';
  if (/missing\s+(a\s+)?close|no close|forgot.*close|days?\s+missing/.test(q)) return 'missing_closes';
  if (/\b(help|what can you)\b/.test(q)) return 'help';
  if (
    /stand|standing|dmr|how (are|is) (we|sales?)|\bsales?\b/.test(q) ||
    /\b(buying|expenses?|till)\b/.test(q) ||
    (/standing|dmr|sales?/.test(prior) && /^(total|more|and|this month|this week)\b/.test(q))
  ) {
    return 'standing';
  }
  if (/invoice|bill|vendor/.test(q) || /invoice|bill|vendor/.test(prior)) return 'invoice_period';
  return 'other';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function partHasError(part: FactPart): boolean {
  return typeof part.facts.error === 'string' && part.facts.error.length > 0;
}

function openInvoiceCount(part: FactPart): number {
  const list = part.facts.openInvoices;
  return Array.isArray(list) ? list.length : 0;
}

function invoiceCount(part: FactPart): number {
  const n = part.facts.invoiceCount;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

function topVendors(part: FactPart): Array<{ vendor: string; amount: number }> {
  const raw = part.facts.topVendors;
  if (!Array.isArray(raw)) return [];
  const out: Array<{ vendor: string; amount: number }> = [];
  for (const row of raw) {
    const obj = asRecord(row);
    if (!obj) continue;
    const vendor = typeof obj.vendor === 'string' ? obj.vendor : null;
    const amount = typeof obj.amount === 'number' ? obj.amount : null;
    if (vendor && amount != null) out.push({ vendor, amount });
  }
  return out;
}

function lastPaid(part: FactPart): Record<string, unknown> | null {
  return asRecord(part.facts.lastPaidVendor);
}

function hasPaymentMethod(part: FactPart): boolean {
  const last = lastPaid(part);
  if (last && (typeof last.method === 'string' || typeof last.paymentStatus === 'string')) return true;
  if (typeof part.facts.paymentMethodsNote === 'string' && part.facts.paymentMethodsNote.trim()) return true;
  return false;
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function joinFallbacks(parts: FactPart[]): string {
  return parts
    .map((p) => p.fallback.trim())
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Verify loaded tool facts against the owner's question.
 * Pass → draft answer (usually loader fallback). Fail → honest reject for the user.
 */
export function verifyAndDraftAnswer(input: {
  question: string;
  history?: ChatTurn[];
  parts: FactPart[];
}): VerifyOutcome {
  const { question, parts } = input;
  const history = input.history ?? [];
  const intent = inferAskIntent(question, history);

  if (parts.length === 0) {
    return {
      status: 'reject',
      text: 'I do not have confirmed books data for that yet. Try standing, open invoices, or invoice totals for this month.',
    };
  }

  if (parts.some(partHasError)) {
    return {
      status: 'reject',
      text: 'I could not load that report right now. Try again in a moment.',
    };
  }

  const toolIds = new Set(parts.map((p) => p.toolId));

  // Vendor list / closed history must not be answered from open_invoices alone.
  if (intent === 'vendor_directory') {
    const summary = parts.find((p) => p.toolId === 'invoice_period_summary');
    if (!summary) {
      if (toolIds.has('open_invoices') && !toolIds.has('invoice_period_summary')) {
        return {
          status: 'reject',
          text: 'Open invoices only show unpaid bills. I cannot list all vendors (including closed) from that. Ask “which vendors this month” or “invoice totals this month.”',
        };
      }
      return {
        status: 'reject',
        text: 'I do not have a vendor list for that ask yet.',
      };
    }
    const vendors = topVendors(summary);
    const count = invoiceCount(summary);
    if (count === 0 || vendors.length === 0) {
      return {
        status: 'answer',
        text:
          typeof summary.facts.period === 'string'
            ? `No vendor invoices on the books for ${summary.facts.period} yet.`
            : 'No vendor invoices on the books for this period yet.',
        polish: false,
      };
    }
    const lines = [
      typeof summary.facts.period === 'string'
        ? `Vendors in ${summary.facts.period} (from confirmed invoices):`
        : 'Vendors from confirmed invoices:',
      ...vendors.map((v) => `• ${v.vendor} · ${money(v.amount)}`),
      `Invoices: ${count} · paid ${summary.facts.paidCount ?? '—'} · open ${summary.facts.openCount ?? '—'}`,
    ];
    return { status: 'answer', text: lines.join('\n'), polish: false };
  }

  // Never treat standing cash/card as how a vendor was paid.
  if (intent === 'vendor_payment_method') {
    if (toolIds.has('standing_report') && !toolIds.has('invoice_period_summary')) {
      return {
        status: 'reject',
        text: 'Register cash and card on standing are store sales tender — not how a vendor was paid. I need invoice payment details (cash/check) from confirmed invoices.',
      };
    }
    const summary = parts.find((p) => p.toolId === 'invoice_period_summary');
    if (!summary) {
      return {
        status: 'reject',
        text: 'I do not have vendor payment method details for that.',
      };
    }
    if (!hasPaymentMethod(summary) && invoiceCount(summary) === 0) {
      return {
        status: 'answer',
        text: joinFallbacks(parts),
        polish: false,
      };
    }
    if (!hasPaymentMethod(summary)) {
      const last = lastPaid(summary);
      const base = joinFallbacks(parts);
      const note =
        'Payment method (cash/check/card) is not recorded on these invoice lines in a way I can verify — I will not guess from sales tender.';
      return {
        status: 'answer',
        text: last ? `${base}\n\n${note}` : `${base}\n\n${note}`,
        polish: false,
      };
    }
    return { status: 'answer', text: joinFallbacks(parts), polish: true };
  }

  if (intent === 'open_due') {
    const openPart = parts.find((p) => p.toolId === 'open_invoices');
    if (openPart && openInvoiceCount(openPart) === 0) {
      return {
        status: 'answer',
        text:
          openPart.fallback ||
          'No open invoices on the books. Paid or fully closed bills will not show here.',
        polish: false,
      };
    }
  }

  if (intent === 'last_paid') {
    const summary = parts.find((p) => p.toolId === 'invoice_period_summary');
    if (summary && !lastPaid(summary) && (summary.facts.paidCount === 0 || invoiceCount(summary) === 0)) {
      return {
        status: 'answer',
        text: joinFallbacks(parts),
        polish: false,
      };
    }
  }

  // Default: loader fallback is the source of truth.
  return {
    status: 'answer',
    text: joinFallbacks(parts),
    polish: intent === 'standing' || intent === 'invoice_period' || intent === 'help',
  };
}

/** Dollar amounts and plain number tokens used to block invented figures in polish. */
export function extractAmountTokens(text: string): Set<string> {
  const out = new Set<string>();
  const moneyRe = /\$\s*-?\d{1,3}(?:,\d{3})*(?:\.\d+)?|\$\s*-?\d+(?:\.\d+)?/g;
  for (const m of text.match(moneyRe) || []) {
    out.add(m.replace(/\s+/g, '').toLowerCase());
  }
  return out;
}

export function polishIntroducesNewAmounts(draft: string, polished: string): boolean {
  const allowed = extractAmountTokens(draft);
  const got = extractAmountTokens(polished);
  for (const token of got) {
    if (!allowed.has(token)) return true;
  }
  return false;
}

export function looksLikeFluffCloser(text: string): boolean {
  return /feel free to ask|let me know if you need|happy to help|further assistance/i.test(text);
}

/**
 * Optional light rephrase of an already-verified draft. Falls back if polish adds numbers or fluff.
 */
export function acceptPolishedAnswer(draft: string, polished: string | null | undefined): string {
  const text = polished?.trim();
  if (!text) return draft;
  if (polishIntroducesNewAmounts(draft, text)) return draft;
  if (looksLikeFluffCloser(text)) return draft;
  return text;
}

export const REFINE_SYSTEM = [
  'You refine a Books agent reply that was ALREADY verified against confirmed facts.',
  'Rewrite for clarity only. Keep every dollar amount, date, vendor name, and count exactly as in the draft.',
  'Do not add payment methods, months, or vendors that are not in the draft.',
  'Do not invent data. No markdown fences. No “feel free to ask” closers.',
  '2–8 short sentences or tight bullets. Plain text for WhatsApp or the web chat.',
].join(' ');
