/**
 * Entry Supervisor: plan owner questions into one or more Books tools.
 * Zar is the face; tools load confirmed facts; exit AI never invents numbers.
 */

import { z } from 'zod';
import type { StoreAgentId } from './crew';
import {
  isCrewToolId,
  toolsForSupervisor,
  type CrewToolId,
  type ToolSlots,
} from './tools/catalog';

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
    'help_capabilities',
    'clarify',
    'unsupported',
    'not_ai_chat',
  ]),
  slots: z
    .object({
      period: z.enum(['week', 'month']).nullable().optional(),
      vendor: z.string().trim().min(1).max(60).nullable().optional(),
      status: z.enum(['all', 'open', 'paid']).nullable().optional(),
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
    '{"agentId":"books","toolId":"standing_report"|"open_invoices"|"invoice_period_summary"|"missing_closes"|"help_capabilities"|"clarify"|"unsupported"|"not_ai_chat","slots":{"period":"week"|"month"|null,"vendor":string|null,"status":"all"|"open"|"paid"|null},"clarity":"ok"|"need_slot"|"clarify"|"unsupported"|"not_ai_chat","ask":string|null}',
    'Use prior turns: short follow-ups like "total", "paid", "open ones" continue the last topic.',
    'standing_report = DMR / standing / sales vs buying. Cash/card there are REGISTER sales tender — never vendor payment method.',
    'open_invoices = still owed / unpaid remaining / due invoices ONLY. Never use for “all vendors” or closed invoices.',
    'invoice_period_summary = vendor list, paid/open/all invoices in the period, last paid invoice. status all for “which vendors / closed invoices”; status paid for “when did we pay / last paid”. Put vendor in slots.vendor when named.',
    'missing_closes = days without a close.',
    'help_capabilities = what can you do.',
    'unsupported = forecast, payroll, profit, wages, utility due dates, named past months beyond this week/month window.',
    'not_ai_chat = ONLY posting a close, invoice photo, or OK/FIX with amounts — never a who/what/how question.',
    'If the message asks BOTH last-paid AND open/due, prefer invoice_period_summary with status paid and vendor set; code may also load open invoices.',
    'Till paid-out / payout ≠ vendor invoice — clarify.',
    'clarify / need_slot = set ask to one short question; do not invent numbers.',
    'Default period to month when unspecified. Default status to all for invoice_period_summary unless they say paid or open.',
    'Catalog:',
    toolDigest,
  ].join('\n');
}

const CONFIDENT_BOOKS_TOOLS = new Set([
  'standing_report',
  'open_invoices',
  'invoice_period_summary',
  'missing_closes',
  'help_capabilities',
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
    toolId: 'clarify',
    clarity: 'clarify',
    slots: {},
    ask: 'What do you want to know — standing/DMR, open invoices, who was paid last, or invoice counts?',
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
  if (/\b(help|what can you)\b/.test(q)) {
    return {
      clarity: 'ok',
      ask: null,
      steps: [{ toolId: 'help_capabilities', slots: {}, purpose: 'help' }],
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
      return {
        clarity: 'ok',
        ask: null,
        steps: [
          {
            toolId: 'invoice_period_summary',
            slots: { period, vendor: null, status: 'all' },
            purpose: 'vendor_directory',
          },
        ],
      };
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
    /stand|standing|dmr|how (are|is) (we|sales)|\bsales\b/.test(q) ||
    /\b(buying|expenses?|till)\b/.test(q)
  ) {
    return {
      clarity: 'ok',
      ask: null,
      steps: [{ toolId: 'standing_report', slots: { period, vendor: null, status: null }, purpose: 'standing' }],
    };
  }

  if (/standing|dmr|sales/.test(prior) && /^(total|more|and|this month|this week)\b/.test(q)) {
    return {
      clarity: 'ok',
      ask: null,
      steps: [{ toolId: 'standing_report', slots: { period, vendor: null, status: null }, purpose: 'standing' }],
    };
  }

  return {
    clarity: 'clarify',
    ask: 'Do you want standing/DMR, open invoices still owed, or invoice counts (paid vs open) for this month?',
    steps: [{ toolId: 'clarify', slots: {}, purpose: 'clarify' }],
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
      ask: route.ask || 'What do you want to know — standing, open invoices, or invoice counts?',
    };
  }

  const allowed = new Set(
    toolsForSupervisor({ booksEnrolled, agentFilter, pack }).map((t) => t.id)
  );
  if (!booksEnrolled && !['help_capabilities', 'clarify', 'unsupported', 'not_ai_chat'].includes(toolId)) {
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
      ask: route.ask || 'That tool is not available. Try standing, open invoices, or invoice counts.',
      slots: {},
    };
  }

  const slots: ToolSlots = {
    period: route.slots?.period ?? 'month',
    vendor: route.slots?.vendor ?? null,
    status: route.slots?.status ?? (toolId === 'invoice_period_summary' ? 'all' : null),
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
  }
): Promise<AskPlan> {
  const history = options.history ?? [];
  const keywordPlan = planFromKeywords(question, history);

  // Deterministic multi- or single-step plans skip the LLM.
  if (isConfidentAskPlan(keywordPlan) && !options.route) {
    return normalizePlan(keywordPlan, options.booksEnrolled, options.agentFilter, options.pack);
  }

  const route = await runSupervisor(question, options);
  // If keywords already planned multiple tools, keep them even when LLM ran.
  if (keywordPlan.steps.length > 1 && isConfidentAskPlan(keywordPlan)) {
    return normalizePlan(keywordPlan, options.booksEnrolled, options.agentFilter, options.pack);
  }

  return normalizePlan(
    {
      clarity: route.clarity,
      ask: route.ask ?? null,
      steps: [
        {
          toolId: route.toolId,
          slots: route.slots || {},
          purpose: route.toolId,
        },
      ],
    },
    options.booksEnrolled,
    options.agentFilter,
    options.pack
  );
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

  // Production default: known intents are deterministic — no LLM roulette.
  if (isConfidentBooksRoute(keyword) && !options.route) {
    return normalizeRoute(keyword, options.booksEnrolled, options.agentFilter, options.pack);
  }

  const digest = toolDigestForPrompt(options.booksEnrolled, options.agentFilter, options.pack);
  const env = options.env ?? process.env;
  const fromAi = options.route
    ? await options.route({ question, history, toolDigest: digest })
    : await defaultSupervisorRoute(question, history, digest, env);

  let raw =
    fromAi && shouldPreferKeywordRoute(question, fromAi, keyword)
      ? keyword
      : fromAi || keyword;
  raw = demoteNotAiChatForAskChannel(raw, question, channel);
  return normalizeRoute(raw, options.booksEnrolled, options.agentFilter, options.pack);
}
