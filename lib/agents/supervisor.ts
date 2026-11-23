/**
 * Entry Supervisor: plan owner questions into one or more Books tools.
 * Zar is the face; tools load confirmed facts; exit AI never invents numbers.
 */

import { z } from 'zod';
import type { StoreAgentId } from './crew';
import { parseStandingDayHint, parseYtdRange } from './dayHint';
export { parseYtdRange } from './dayHint';
import { applyLastAskToPlan, type LastAskState } from './lastAsk';
import {
  isCrewToolId,
  toolsForSupervisor,
  type CrewToolId,
  type ToolSlots,
} from './tools/catalog';

export { parseStandingDayHint } from './dayHint';
export type { LastAskState } from './lastAsk';

export type ChatTurn = { role: 'user' | 'assistant'; text: string };

/** One loader call in an ask plan (compound questions get multiple steps). */
export type AskPlanStep = {
  toolId: CrewToolId;
  slots: ToolSlots;
  /** Why this step exists — used in merged replies. */
  purpose: string;
};

export type AskPlan = {
  clarity: 'ok' | 'need_slot' | 'clarify' | 'unsupported' | 'not_ai_chat';
  ask: string | null;
  steps: AskPlanStep[];
};

const VENDOR_STOP = new Set([
  'last',
  'time',
  'the',
  'a',
  'an',
  'any',
  'due',
  'open',
  'paid',
  'pay',
  'invoice',
  'invoices',
  'bill',
  'bills',
  'vendor',
  'vendors',
  'still',
  'owe',
  'owing',
  'owed',
  'pending',
  'and',
  'or',
  'to',
  'for',
  'with',
  'from',
  'this',
  'that',
  'month',
  'week',
  'when',
  'did',
  'we',
  'was',
  'were',
  'is',
  'there',
  'our',
  'my',
]);

/** Pull a vendor name hint from free text without grabbing stop-words. */
export function extractVendorHint(question: string): string | null {
  const q = question.trim();
  const patterns = [
    /\bvendor\s+([a-z0-9][\w&'.-]{0,40})/i,
    /\b(?:to|for)\s+([a-z0-9][\w&'.-]{0,40})(?:\s|$|\?|,|and)/i,
    /\b(?:owe|owing|owed|pay|paid)\s+([a-z0-9][\w&'.-]{0,40})/i,
  ];
  for (const re of patterns) {
    const m = q.match(re);
    const raw = m?.[1]?.trim();
    if (!raw) continue;
    const token = raw.replace(/[?.!,]+$/g, '').trim();
    if (!token || VENDOR_STOP.has(token.toLowerCase())) continue;
    if (token.length < 2 || token.length > 40) continue;
    return token;
  }
  return null;
}

export function wantsLastPaidAsk(q: string): boolean {
  // Till "paid out" / payout is not a vendor invoice payment.
  if (/\bpaid[-\s]?outs?\b|\bpayouts?\b/.test(q)) return false;
  return (
    /\bwhen\s+did\s+we\s+pay\b/.test(q) ||
    /\blast\s+(paid\s+)?invoice\b/.test(q) ||
    /\bpaid\s+last\b/.test(q) ||
    /\blast\s+paid\b/.test(q) ||
    /\b(who|which).{0,40}\bpaid\b/.test(q) ||
    /\blast\s+vendor\b/.test(q)
  );
}

export function wantsOpenDueAsk(q: string): boolean {
  return /\b(open|due|unpaid|pending|still\s+owe|owing|owed)\b/.test(q);
}

/** Vendor directory / history — not “open only”. */
export function wantsVendorDirectoryAsk(q: string): boolean {
  if (/\bhow many vendors?\b/.test(q) || /\bvendors?\s+we\s+have\b/.test(q) || /\bnumber of vendors?\b/.test(q)) {
    return true;
  }
  // “which vendor was paid last” is last-paid, not a directory list.
  if (wantsLastPaidAsk(q) || (wantsOpenDueAsk(q) && !/\bclosed\b/.test(q) && !/\ball\b/.test(q))) {
    return false;
  }
  return (
    /\b(all|every|list).{0,40}\bvendors?\b/.test(q) ||
    /\bwhat\s+(are\s+)?(all\s+)?(the\s+)?vendors?\b/.test(q) ||
    /\bwhich\s+vendors?\b/.test(q) ||
    /\bvendors?\s+(names?|list|we\s+have|we\s+use|using|used)\b/.test(q) ||
    /\bclosed\s+invoices?\b/.test(q) ||
    /\binvoices?\s+(closed|history|all)\b/.test(q) ||
    /\beven\s+(for\s+)?closed\b/.test(q) ||
    /\bin\s+general.{0,40}\bvendors?\b/.test(q)
  );
}

export function wantsTillPaidOutAsk(q: string): boolean {
  return /\bpaid[-\s]?outs?\b|\bpayouts?\b|\blast\s+paid\s+out\b/.test(q);
}

/** Named calendar month other than “this month” — loaders only do current week/month windows. */
export function wantsNamedPastMonthAsk(q: string): boolean {
  return (
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/.test(q) &&
    !/\bthis\s+month\b/.test(q) &&
    !/\bso\s+far\b/.test(q)
  );
}

/** Owner asking how a vendor was paid (cash/card) — standing tender is NOT the answer. */
export function wantsVendorPaymentMethodAsk(q: string): boolean {
  return (
    (/\b(cash|card|check|cheque)\b/.test(q) &&
      /\b(vendor|invoice|bill|paid|payment|buying|standing)\b/.test(q)) ||
    /\bhow\s+(did|do|was|were).{0,40}\b(pay|paid|payment)\b/.test(q)
  );
}

export const SupervisorRouteSchema = z.object({
  agentId: z.enum(['books', 'close', 'finance', 'staff', 'followup']).default('books'),
  toolId: z.enum([
    'standing_report',
    'open_invoices',
    'invoice_period_summary',
    'missing_closes',
    'staff_schedule',
    'ops_today',
    'help_capabilities',
    'list_connectors',
    'list_gmail_rules',
    'create_gmail_rule',
    'clarify',
    'unsupported',
    'not_ai_chat',
  ]),
  slots: z
    .object({
      period: z.enum(['week', 'month', 'custom']).nullable().optional(),
      from: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      to: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      vendor: z.string().trim().min(1).max(60).nullable().optional(),
      status: z.enum(['all', 'open', 'paid']).nullable().optional(),
      ruleLabel: z.string().trim().min(1).max(40).nullable().optional(),
      ruleFrom: z.string().trim().min(1).max(120).nullable().optional(),
      ruleContains: z.string().trim().min(1).max(120).nullable().optional(),
      route: z.enum(['dm', 'group', 'both']).nullable().optional(),
    })
    .optional(),
  clarity: z.enum(['ok', 'need_slot', 'clarify', 'unsupported', 'not_ai_chat']).default('ok'),
  ask: z.string().trim().min(1).max(280).nullable().optional(),
});

export type SupervisorRoute = z.infer<typeof SupervisorRouteSchema>;

export type SupervisorRouter = (input: {
  question: string;
  history: ChatTurn[];
  toolDigest: string;
}) => Promise<SupervisorRoute | null>;

function historyBlock(history: ChatTurn[]): string {
  if (!history.length) return '(no prior turns)';
  return history
    .slice(-8)
    .map((t) => `${t.role}: ${t.text.slice(0, 400)}`)
    .join('\n');
}

export function buildSupervisorSystem(toolDigest: string): string {
  return [
    'You are the opsAi Supervisor for a small-business owner chat (any vertical).',
    'Pick ONE primary tool from the catalog. Return JSON only matching:',
    '{"agentId":"books","toolId":"standing_report"|"open_invoices"|"invoice_period_summary"|"missing_closes"|"staff_schedule"|"ops_today"|"help_capabilities"|"list_connectors"|"list_gmail_rules"|"create_gmail_rule"|"clarify"|"unsupported"|"not_ai_chat","slots":{"period":"week"|"month"|"custom"|null,"from":"YYYY-MM-DD"|null,"to":"YYYY-MM-DD"|null,"vendor":string|null,"status":"all"|"open"|"paid"|null,"ruleLabel":string|null,"ruleFrom":string|null,"ruleContains":string|null,"route":"dm"|"group"|"both"|null},"clarity":"ok"|"need_slot"|"clarify"|"unsupported"|"not_ai_chat","ask":string|null}',
    'Use prior turns + lastAsk: short follow-ups ("total", "paid", bare date 11/21, “it was about sale”) continue the last tool — never restart on ops_today.',
    'Prefer answering with a data tool over clarify. Never ask for a date when the user already said yesterday, today, or a calendar date.',
    'For a single day (yesterday / today / 11/21): toolId standing_report, slots.period=custom, slots.from=slots.to=ISO day.',
    'For YTD / year to date / this year: standing_report with period=custom from Jan 1 to today — never reuse a prior single-day lastAsk.',
    'Use ops_today for greetings / “anything to follow?” only — not for sales, standing, or invoice questions.',
    'standing_report = DMR / standing / sale / sales (including yesterday or a specific day). Cash/card there are REGISTER sales tender — never vendor payment method.',
    'open_invoices = still owed / unpaid remaining / due invoices ONLY. Never use for “all vendors” or closed invoices.',
    'invoice_period_summary = vendor list, paid/open/all invoices in the period, last paid invoice. status all for “which vendors / closed invoices”; status paid for “when did we pay / last paid”. Put vendor in slots.vendor when named.',
    'missing_closes = days without a close.',
    'staff_schedule = who worked / who is working / shift roster / hours from the confirmed schedule sheet (never pay or wages).',
    'ops_today = today’s follow-ups: open tasks, bills due soon, who is on, missing yesterday close.',
    'help_capabilities = explicit “what can you do / help” only — not for hi or vague follow-ups (use ops_today).',
    'list_connectors = what’s connected (Gmail, WhatsApp group, task alerts) / set up apps / connector status.',
    'list_gmail_rules = show existing Gmail alert rules.',
    'create_gmail_rule = add a Gmail alert. Fill slots.ruleFrom and/or ruleContains, optional ruleLabel, route dm|group|both (default dm). OAuth connect is in the app, not chat.',
    'unsupported = forecast, payroll, profit, wages, utility due dates, named past months beyond this week/month window.',
    'not_ai_chat = ONLY posting a close, invoice photo, or OK/FIX with amounts — never a who/what/how question.',
    'If the message asks BOTH last-paid AND open/due, prefer invoice_period_summary with status paid and vendor set; code may also load open invoices.',
    'Till paid-out / payout ≠ vendor invoice — clarify.',
    'clarify / need_slot = rare; only when two money tools conflict. Prefer ops_today over clarify for vague business questions.',
    'Default period to month when unspecified (week if they say week). Default status to all for invoice_period_summary unless they say paid or open.',
    'Catalog:',
    toolDigest,
  ].join('\n');
}

function standingSlotsFromAsk(
  question: string,
  history: ChatTurn[],
  defaultPeriod: 'week' | 'month'
): ToolSlots {
  const ytd = parseYtdRange(question);
  if (ytd) return { period: 'custom', from: ytd.from, to: ytd.to, vendor: null, status: null };
  const day = parseStandingDayHint(question);
  if (day) return { period: 'custom', from: day, to: day, vendor: null, status: null };
  const prior = history
    .slice(-6)
    .map((t) => t.text.toLowerCase())
    .join(' ');
  // Bare date / “it was about sale” after a sales thread.
  if (/sale|sales|standing|dmr/.test(prior)) {
    const fromPrior = parseStandingDayHint(question);
    if (fromPrior) return { period: 'custom', from: fromPrior, to: fromPrior, vendor: null, status: null };
  }
  return { period: defaultPeriod, from: null, to: null, vendor: null, status: null };
}

const CONFIDENT_BOOKS_TOOLS = new Set([
  'standing_report',
  'open_invoices',
  'invoice_period_summary',
  'missing_closes',
  'staff_schedule',
  'ops_today',
  'help_capabilities',
  'list_connectors',
  'list_gmail_rules',
  'create_gmail_rule',
]);

/** High-confidence keyword hit — safe to skip the LLM router. */
export function isConfidentBooksRoute(route: SupervisorRoute): boolean {
  return route.clarity === 'ok' && CONFIDENT_BOOKS_TOOLS.has(route.toolId);
}

/**
 * AI sometimes marks paid-vendor questions as ops capture; prefer keywords when clearly a question.
 * Kept as a safety net when the LLM still runs (ambiguous keyword path).
 */
export function shouldPreferKeywordRoute(
  question: string,
  fromAi: SupervisorRoute,
  keyword: SupervisorRoute
): boolean {
  if (fromAi.toolId !== 'not_ai_chat' && fromAi.clarity !== 'not_ai_chat') return false;
  if (!isConfidentBooksRoute(keyword)) return false;
  // Amounts / $ mean staff is posting an entry, not asking.
  if (/\d/.test(question) || /\$/.test(question)) return false;
  return true;
}

/** Web/crew chat is always an ask — never silent-skip as ops capture. */
export function demoteNotAiChatForAskChannel(
  route: SupervisorRoute,
  question: string,
  channel: 'web' | 'whatsapp' = 'web'
): SupervisorRoute {
  if (route.toolId !== 'not_ai_chat' && route.clarity !== 'not_ai_chat') return route;
  const looksLikeCapture =
    /\d/.test(question) || /\$/.test(question) || /^(ok|fix|done)\b/i.test(question.trim());
  if (channel === 'whatsapp' && looksLikeCapture) return route;
  return {
    agentId: 'books',
    toolId: 'ops_today',
    clarity: 'ok',
    slots: {},
    ask: null,
  };
}

export function toolDigestForPrompt(
  booksEnrolled: boolean,
  agentFilter?: StoreAgentId | 'supervisor' | null,
  pack?: import('./packs').VerticalPack | null
): string {
  return toolsForSupervisor({ booksEnrolled, agentFilter, pack })
    .filter((t) => !['clarify', 'unsupported', 'not_ai_chat'].includes(t.id) || t.id === 'help_capabilities')
    .map((t) => `- ${t.id} (${t.agentId}): ${t.description} Examples: ${t.examples.slice(0, 2).join(' | ') || '—'}`)
    .join('\n');
}

/** Build a 1–N step plan from keywords (compound asks get multiple tools). */
export function planFromKeywords(question: string, history: ChatTurn[] = []): AskPlan {
  const q = question.toLowerCase().trim();
  const prior = history
    .slice(-6)
    .map((t) => t.text.toLowerCase())
    .join(' ');

  const period: 'week' | 'month' = /\bweek\b/.test(q) || /\bweek\b/.test(prior) ? 'week' : 'month';
  const vendor = extractVendorHint(question);

  if (/forecast|utility|utilities|payroll|wage|profit|next\s+\d+\s+days/.test(q)) {
    return {
      clarity: 'unsupported',
      ask: null,
      steps: [{ toolId: 'unsupported', slots: {}, purpose: 'unsupported' }],
    };
  }
  // Explicit capability ask only — not "hi" or vague follow-ups.
  if (
    /^(help|what can you( do| help with)?|what do you (do|support)|capabilities)\b/.test(q) ||
    /\bwhat can you (do|help)\b/.test(q)
  ) {
    return {
      clarity: 'ok',
      ask: null,
      steps: [{ toolId: 'help_capabilities', slots: {}, purpose: 'help' }],
    };
  }

  // Connector / Gmail automation setup (chat + app dual path).
  const priorGmailThread =
    /\b(gmail|email|alert rules?|custom alert|connectors?|from\s+\S+@\S+)\b/i.test(prior) ||
    /\b(past due|overdue|action termite|test-sza)\b/i.test(prior);
  if (
    /\b(add|create|set\s*up|make)\b.{0,40}\b(gmail|email)\b.{0,40}\b(rule|alert|automation)\b/.test(q) ||
    /\b(alert|notify|ping)\s+me\b.{0,60}\b(mail|email|gmail)\b/.test(q) ||
    /\bwhen\b.{0,40}\b(mail|email)\b.{0,40}\b(from|contains)\b/.test(q) ||
    /\b(post|send).{0,40}\b(mail|email).{0,40}\bgroup\b/.test(q) ||
    /\bcan (we|i)\s+add\b.{0,40}\b(alert|rule|automation)s?\b/.test(q) ||
    /\b(add|create)\b.{0,24}\banother\b.{0,16}\b(alert|rule)s?\b/.test(q) ||
    /\banother\s+(gmail\s+)?(alert|rule)s?\b/.test(q) ||
    (priorGmailThread &&
      (/\b(add|create|new|another)\b.{0,24}\b(alert|rule)s?\b/.test(q) ||
        /^(yes|yeah|yep|sure|ok|please)\b/.test(q)))
  ) {
    return {
      clarity: 'ok',
      ask: null,
      steps: [{ toolId: 'create_gmail_rule', slots: {}, purpose: 'create_gmail_rule' }],
    };
  }
  if (
    /\b(gmail|email)\b.{0,20}\b(rules?|alerts?|automations?)\b/.test(q) ||
    /\b(show|list|what).{0,24}\b(gmail|email)\b.{0,20}\b(rules?|alerts?)\b/.test(q) ||
    /\bwhat (are|is) the (alerts?|rules?)\b/.test(q) ||
    (priorGmailThread && /\b(the )?(alerts?|rules?)\b/.test(q) && !/\btask\b/.test(q))
  ) {
    return {
      clarity: 'ok',
      ask: null,
      steps: [{ toolId: 'list_gmail_rules', slots: {}, purpose: 'list_gmail_rules' }],
    };
  }
  if (
    /\b(connectors?|connected apps?|integrations?)\b/.test(q) ||
    /\b(is|are)\s+gmail\b/.test(q) ||
    /\bgmail\s+(connected|set\s*up|status)\b/.test(q) ||
    /\bwhat('?s| is) connected\b/.test(q) ||
    /\bwhatsapp group\b.{0,20}\b(linked|connected|set\s*up)\b/.test(q)
  ) {
    return {
      clarity: 'ok',
      ask: null,
      steps: [{ toolId: 'list_connectors', slots: {}, purpose: 'list_connectors' }],
    };
  }

  // Greetings / “anything to follow?” → today’s briefing (not a menu).
  if (
    /^(hi|hii+|hello|hey|yo|good (morning|afternoon|evening))\b/.test(q) ||
    /\b(anything|what).{0,24}(follow|due|need|check|attention|todo|to-?do|priority|priorities)\b/.test(q) ||
    /\b(what('?s| is) (due|open|left|next)|what should i (do|check|follow))\b/.test(q) ||
    /\bfollow\s*up\b/.test(q) ||
    /\bneeds?\s+attention\b/.test(q)
  ) {
    return {
      clarity: 'ok',
      ask: null,
      steps: [{ toolId: 'ops_today', slots: {}, purpose: 'ops_today' }],
    };
  }

  if (wantsTillPaidOutAsk(q)) {
    return {
      clarity: 'clarify',
      ask: 'Do you mean a till paid-out from a close, or the last vendor invoice we paid?',
      steps: [{ toolId: 'clarify', slots: {}, purpose: 'clarify' }],
    };
  }

  if (wantsNamedPastMonthAsk(q) && !/this\s+(week|month)/.test(q)) {
    return {
      clarity: 'clarify',
      ask: 'I can show this week or this calendar month so far. Which one do you want?',
      steps: [{ toolId: 'clarify', slots: {}, purpose: 'clarify' }],
    };
  }

  const aboutInvoices =
    /invoice|bill|vendor|owe|owing|owed|pending/.test(q) ||
    wantsLastPaidAsk(q) ||
    wantsVendorDirectoryAsk(q) ||
    wantsVendorPaymentMethodAsk(q) ||
    (/invoice|bill|vendor|owe|pending/.test(prior) &&
      /^(total|paid|open|all|yes|those|them|how many)\b/.test(q));

  if (aboutInvoices) {
    if (wantsVendorDirectoryAsk(q)) {
      const steps: AskPlanStep[] = [
        {
          toolId: 'invoice_period_summary',
          slots: { period, vendor: null, status: 'all' },
          purpose: 'vendor_directory',
        },
      ];
      // “how many vendors and any pending payment?” → directory + open invoices.
      if (wantsOpenDueAsk(q) || /\bpending\b/.test(q)) {
        steps.push({
          toolId: 'open_invoices',
          slots: { period: null, vendor: null, status: null },
          purpose: 'open_due',
        });
      }
      return { clarity: 'ok', ask: null, steps };
    }

    if (wantsVendorPaymentMethodAsk(q) && !wantsOpenDueAsk(q)) {
      return {
        clarity: 'ok',
        ask: null,
        steps: [
          {
            toolId: 'invoice_period_summary',
            slots: {
              period,
              vendor,
              status: /\bopen\b/.test(q) ? 'open' : /\bpaid\b/.test(q) ? 'paid' : 'all',
            },
            purpose: vendor ? `vendor_payment:${vendor}` : 'vendor_payment',
          },
        ],
      };
    }

    const lastPaid = wantsLastPaidAsk(q) || (/\bpaid\b/.test(q) && !wantsOpenDueAsk(q) && !/\bcash|card\b/.test(q));
    const openDue = wantsOpenDueAsk(q);
    const wantsCount =
      /how many|count|total|summary|so far|paid invoice|invoices we|invoices this|invoices made/.test(q) ||
      (/invoice|bill/.test(prior) && /^(total|paid|open|all|how many)\b/.test(q));

    // Compound: last paid + anything still due → two tools, same vendor.
    if ((wantsLastPaidAsk(q) || (/\bpaid\b/.test(q) && openDue)) && openDue) {
      return {
        clarity: 'ok',
        ask: null,
        steps: [
          {
            toolId: 'invoice_period_summary',
            slots: { period, vendor, status: 'paid' },
            purpose: vendor ? `last_paid:${vendor}` : 'last_paid',
          },
          {
            toolId: 'open_invoices',
            slots: { period: null, vendor, status: null },
            purpose: vendor ? `open_due:${vendor}` : 'open_due',
          },
        ],
      };
    }

    if (wantsCount || lastPaid) {
      return {
        clarity: 'ok',
        ask: null,
        steps: [
          {
            toolId: 'invoice_period_summary',
            slots: {
              period,
              vendor,
              status: /\bpaid\b/.test(q) || wantsLastPaidAsk(q) ? 'paid' : openDue ? 'open' : 'all',
            },
            purpose: wantsLastPaidAsk(q) ? 'last_paid' : 'invoice_summary',
          },
        ],
      };
    }

    return {
      clarity: 'ok',
      ask: null,
      steps: [
        {
          toolId: 'open_invoices',
          slots: { period: null, vendor, status: null },
          purpose: vendor ? `open_due:${vendor}` : 'open_due',
        },
      ],
    };
  }

  if (/missing\s+(a\s+)?close|no close|forgot.*close|days?\s+missing/.test(q)) {
    return {
      clarity: 'ok',
      ask: null,
      steps: [{ toolId: 'missing_closes', slots: { period, vendor: null, status: null }, purpose: 'missing_closes' }],
    };
  }

  if (
    /stand|standing|dmr|how (are|is) (we|sales?)|\bsales?\b/.test(q) ||
    /\b(buying|expenses?|till)\b/.test(q) ||
    /\bwhat was (the )?sale\b/.test(q)
  ) {
    return {
      clarity: 'ok',
      ask: null,
      steps: [
        {
          toolId: 'standing_report',
          slots: standingSlotsFromAsk(question, history, period),
          purpose: 'standing',
        },
      ],
    };
  }

  // Follow-ups after a sales/standing thread: bare date, "it was about sale", week/month tweak.
  if (/sale|sales|standing|dmr/.test(prior)) {
    if (
      /^(total|more|and|this month|this week)\b/.test(q) ||
      /\bit was about sale/.test(q) ||
      parseStandingDayHint(q)
    ) {
      return {
        clarity: 'ok',
        ask: null,
        steps: [
          {
            toolId: 'standing_report',
            slots: standingSlotsFromAsk(question, history, period),
            purpose: 'standing',
          },
        ],
      };
    }
  }

  // Who worked / roster — hours from confirmed schedule (never pay). Not “who was the vendor paid”.
  if (
    /\bwho\s+worked\b/.test(q) ||
    /\bwho\s+was\s+on\b/.test(q) ||
    /\bwho\s+is\s+on\b/.test(q) ||
    /\bwho\s+is\s+working\b/.test(q) ||
    /\bwho\s+was\s+working\b/.test(q) ||
    /\bwho'?s\s+(on|working)\b/.test(q) ||
    /\bstaff\s+schedule\b/.test(q) ||
    /\bshift\s+schedule\b/.test(q) ||
    /\bschedule\s+hours\b/.test(q) ||
    (/\b(schedule|roster|shifts?)\b/.test(q) && /\b(yesterday|today|week|who)\b/.test(q))
  ) {
    return {
      clarity: 'ok',
      ask: null,
      steps: [{ toolId: 'staff_schedule', slots: { period: null, vendor: null, status: null }, purpose: 'staff_schedule' }],
    };
  }

  // Do NOT add a new keyword branch for every novel phrasing.
  // Unknown business ask → today’s ops briefing; LLM polish makes it relative.
  // Grow capability by improving tools + tool descriptions, not this regex list.
  return {
    clarity: 'ok',
    ask: null,
    steps: [{ toolId: 'ops_today', slots: {}, purpose: 'ops_today' }],
  };
}

/** Single-tool view of the plan (tests + LLM fallback path). */
export function routeFromKeywords(question: string, history: ChatTurn[] = []): SupervisorRoute {
  const plan = planFromKeywords(question, history);
  const step = plan.steps[0] || { toolId: 'clarify' as const, slots: {}, purpose: 'clarify' };
  return {
    agentId: 'books',
    toolId: step.toolId,
    clarity: plan.clarity,
    slots: step.slots,
    ask: plan.ask,
  };
}

export function isConfidentAskPlan(plan: AskPlan): boolean {
  return (
    plan.clarity === 'ok' &&
    plan.steps.length > 0 &&
    plan.steps.every((s) => CONFIDENT_BOOKS_TOOLS.has(s.toolId))
  );
}

export function parseSupervisorRoute(raw: string | null | undefined): SupervisorRoute | null {
  if (!raw?.trim()) return null;
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      json = JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
  const parsed = SupervisorRouteSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

export function normalizeRoute(
  route: SupervisorRoute,
  booksEnrolled: boolean,
  agentFilter?: StoreAgentId | 'supervisor' | null,
  pack?: import('./packs').VerticalPack | null
): SupervisorRoute {
  let toolId = route.toolId as CrewToolId;
  if (!isCrewToolId(toolId)) toolId = 'clarify';

  if (route.clarity === 'not_ai_chat' || toolId === 'not_ai_chat') {
    return { ...route, toolId: 'not_ai_chat', clarity: 'not_ai_chat' };
  }
  if (route.clarity === 'unsupported' || toolId === 'unsupported') {
    return { ...route, toolId: 'unsupported', clarity: 'unsupported' };
  }
  if (route.clarity === 'clarify' || route.clarity === 'need_slot' || toolId === 'clarify') {
    return {
      ...route,
      toolId: 'clarify',
      clarity: 'clarify',
      ask:
        route.ask ||
        'I can pull today’s follow-ups, or dig into standing, invoices, or the schedule — what do you need?',
    };
  }

  const allowed = new Set(
    toolsForSupervisor({ booksEnrolled, agentFilter, pack }).map((t) => t.id)
  );
  const alwaysOkWithoutBooks = [
    'help_capabilities',
    'list_connectors',
    'list_gmail_rules',
    'create_gmail_rule',
    'clarify',
    'unsupported',
    'not_ai_chat',
    'ops_today',
  ];
  if (!booksEnrolled && !alwaysOkWithoutBooks.includes(toolId)) {
    return {
      agentId: 'books',
      toolId: 'clarify',
      clarity: 'clarify',
      ask: 'Books is not enrolled for this store. Enable Books under Store admin → Crew.',
      slots: {},
    };
  }
  if (!allowed.has(toolId)) {
    return {
      agentId: 'books',
      toolId: 'clarify',
      clarity: 'clarify',
      ask:
        route.ask ||
        'That isn’t available for this store pack. Try today’s follow-ups, standing, invoices, or the schedule.',
      slots: {},
    };
  }

  const slots: ToolSlots = {
    period: route.slots?.period ?? 'month',
    vendor: route.slots?.vendor ?? null,
    status: route.slots?.status ?? (toolId === 'invoice_period_summary' ? 'all' : null),
    ruleLabel: route.slots?.ruleLabel ?? null,
    ruleFrom: route.slots?.ruleFrom ?? null,
    ruleContains: route.slots?.ruleContains ?? null,
    route: route.slots?.route ?? null,
  };
  return { ...route, agentId: 'books', toolId, clarity: 'ok', slots };
}

async function defaultSupervisorRoute(
  question: string,
  history: ChatTurn[],
  toolDigest: string,
  env: NodeJS.ProcessEnv
): Promise<SupervisorRoute | null> {
  const apiKey = env.OPENAI_API_KEY?.trim();
  const model =
    env.OPENAI_TEXT_MODEL?.trim() ||
    env.OPENAI_MODEL?.trim() ||
    env.OPENAI_EXTRACTION_MODEL?.trim();
  if (!apiKey || !model) return null;

  try {
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey });
    const response = await openai.chat.completions.create({
      model,
      temperature: 0,
      max_tokens: 220,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildSupervisorSystem(toolDigest) },
        {
          role: 'user',
          content: `Prior turns:\n${historyBlock(history)}\n\nCurrent message:\n${question}`,
        },
      ],
    });
    return parseSupervisorRoute(response.choices[0]?.message?.content);
  } catch {
    return null;
  }
}

function normalizePlan(
  plan: AskPlan,
  booksEnrolled: boolean,
  agentFilter?: StoreAgentId | 'supervisor' | null,
  pack?: import('./packs').VerticalPack | null
): AskPlan {
  const steps = plan.steps
    .map((step) => {
      const route = normalizeRoute(
        {
          agentId: 'books',
          toolId: step.toolId,
          clarity: plan.clarity,
          slots: step.slots,
          ask: plan.ask,
        },
        booksEnrolled,
        agentFilter,
        pack
      );
      return {
        toolId: route.toolId,
        slots: route.slots || {},
        purpose: step.purpose,
      };
    })
    .filter((s, i, arr) => arr.findIndex((x) => x.toolId === s.toolId && JSON.stringify(x.slots) === JSON.stringify(s.slots)) === i);

  const clarity =
    steps[0]?.toolId === 'clarify'
      ? 'clarify'
      : steps[0]?.toolId === 'unsupported'
        ? 'unsupported'
        : steps[0]?.toolId === 'not_ai_chat'
          ? 'not_ai_chat'
          : 'ok';

  return {
    clarity,
    ask: plan.ask,
    steps: steps.length
      ? steps
      : [{ toolId: 'clarify', slots: {}, purpose: 'clarify' }],
  };
}

/** Multi-step ask plan — preferred entry for web/WhatsApp Books answers. */
/** Money / schedule tools — keywords win if AI drifts to menu/ops_today. Soft tools trust AI. */
const HARD_KEYWORD_TOOLS = new Set([
  'standing_report',
  'open_invoices',
  'invoice_period_summary',
  'missing_closes',
  'staff_schedule',
]);

export async function runAskPlan(
  question: string,
  options: {
    history?: ChatTurn[];
    booksEnrolled: boolean;
    agentFilter?: StoreAgentId | 'supervisor' | null;
    pack?: import('./packs').VerticalPack | null;
    env?: NodeJS.ProcessEnv;
    route?: SupervisorRouter;
    channel?: 'web' | 'whatsapp';
    lastAsk?: LastAskState | null;
  }
): Promise<AskPlan> {
  const history = options.history ?? [];
  const keywordPlan = planFromKeywords(question, history);

  // Compound paid+open plans stay keyword — multi-tool JSON from the LLM is flaky.
  if (keywordPlan.steps.length > 1 && isConfidentAskPlan(keywordPlan) && !options.route) {
    return applyLastAskToPlan(
      question,
      normalizePlan(keywordPlan, options.booksEnrolled, options.agentFilter, options.pack),
      options.lastAsk
    );
  }

  // Entry AI (with keyword safety net inside runSupervisor).
  const route = await runSupervisor(question, options);

  if (keywordPlan.steps.length > 1 && isConfidentAskPlan(keywordPlan)) {
    return applyLastAskToPlan(
      question,
      normalizePlan(keywordPlan, options.booksEnrolled, options.agentFilter, options.pack),
      options.lastAsk
    );
  }

  const slots = enrichToolSlots(question, route.toolId, route.slots || {});
  const planned = normalizePlan(
    {
      clarity: route.clarity,
      ask: route.ask ?? null,
      steps: [
        {
          toolId: route.toolId,
          slots,
          purpose: route.toolId,
        },
      ],
    },
    options.booksEnrolled,
    options.agentFilter,
    options.pack
  );
  return applyLastAskToPlan(question, planned, options.lastAsk);
}

/** Fill from/to when the question names a day but the router omitted slots. */
export function enrichToolSlots(question: string, toolId: CrewToolId, slots: ToolSlots): ToolSlots {
  if (toolId !== 'standing_report' && toolId !== 'missing_closes') return slots;
  if (slots.from && slots.to) return slots;
  const ytd = parseYtdRange(question);
  if (ytd) return { ...slots, period: 'custom', from: ytd.from, to: ytd.to };
  const day = parseStandingDayHint(question);
  if (!day) return slots;
  return { ...slots, period: 'custom', from: day, to: day };
}

export async function runSupervisor(
  question: string,
  options: {
    history?: ChatTurn[];
    booksEnrolled: boolean;
    agentFilter?: StoreAgentId | 'supervisor' | null;
    pack?: import('./packs').VerticalPack | null;
    env?: NodeJS.ProcessEnv;
    route?: SupervisorRouter;
    /** web/crew = never silent-skip; whatsapp may skip real ops capture. */
    channel?: 'web' | 'whatsapp';
  }
): Promise<SupervisorRoute> {
  const history = options.history ?? [];
  const channel = options.channel ?? 'web';
  const keyword = routeFromKeywords(question, history);
  const digest = toolDigestForPrompt(options.booksEnrolled, options.agentFilter, options.pack);
  const env = options.env ?? process.env;

  // Entry AI first when possible; keywords are fallback + hard-tool safety net.
  const fromAi = options.route
    ? await options.route({ question, history, toolDigest: digest })
    : await defaultSupervisorRoute(question, history, digest, env);

  let raw: SupervisorRoute = fromAi || keyword;

  if (fromAi && shouldPreferKeywordRoute(question, fromAi, keyword)) {
    raw = keyword;
  } else if (
    fromAi &&
    isConfidentBooksRoute(keyword) &&
    HARD_KEYWORD_TOOLS.has(keyword.toolId) &&
    (fromAi.toolId !== keyword.toolId ||
      (keyword.slots?.status && fromAi.slots?.status !== keyword.slots.status))
  ) {
    // AI drifted off a clear money/schedule ask → keep keyword tool + slots.
    raw = keyword;
  } else if (!fromAi && isConfidentBooksRoute(keyword)) {
    raw = keyword;
  }

  raw = demoteNotAiChatForAskChannel(raw, question, channel);
  return normalizeRoute(raw, options.booksEnrolled, options.agentFilter, options.pack);
}
