/**
 * Entry Supervisor: route owner questions to one tool on one enrolled agent.
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
    'You are the opsAi Supervisor for a convenience / gas store owner chat.',
    'Pick ONE tool from the catalog. Return JSON only matching:',
    '{"agentId":"books","toolId":"standing_report"|"open_invoices"|"invoice_period_summary"|"missing_closes"|"help_capabilities"|"clarify"|"unsupported"|"not_ai_chat","slots":{"period":"week"|"month"|null,"vendor":string|null,"status":"all"|"open"|"paid"|null},"clarity":"ok"|"need_slot"|"clarify"|"unsupported"|"not_ai_chat","ask":string|null}',
    'Use prior turns: short follow-ups like "total", "paid", "open ones" continue the last topic.',
    'standing_report = DMR / standing / sales vs buying.',
    'open_invoices = still owed / unpaid remaining.',
    'invoice_period_summary = how many invoices, paid vs open counts/dollars this period.',
    'missing_closes = days without a close.',
    'help_capabilities = what can you do.',
    'unsupported = forecast, payroll, profit, wages, utility due dates.',
    'not_ai_chat = ONLY posting a close, invoice photo, or OK/FIX with amounts — never a who/what/how question.',
    'Questions like “who was the vendor paid last”, “last paid vendor”, “paid invoices this month” → invoice_period_summary with status paid.',
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

/** Keyword / history fallback when entry AI is off. */
export function routeFromKeywords(question: string, history: ChatTurn[] = []): SupervisorRoute {
  const q = question.toLowerCase().trim();
  const prior = history
    .slice(-6)
    .map((t) => t.text.toLowerCase())
    .join(' ');

  const period: 'week' | 'month' = /\bweek\b/.test(q) || /\bweek\b/.test(prior) ? 'week' : 'month';

  if (/forecast|utility|utilities|payroll|wage|profit|next\s+\d+\s+days/.test(q)) {
    return { agentId: 'books', toolId: 'unsupported', clarity: 'unsupported', slots: {}, ask: null };
  }
  if (/\b(help|what can you)\b/.test(q)) {
    return { agentId: 'books', toolId: 'help_capabilities', clarity: 'ok', slots: {}, ask: null };
  }

  const aboutInvoices =
    /invoice|bill|vendor|owe|owing|owed|pending/.test(q) ||
    /\b(who|which).{0,40}\bpaid\b|\blast\s+paid\b|\bpaid\s+last\b/.test(q) ||
    (/invoice|bill|vendor|owe|pending/.test(prior) &&
      /^(total|paid|open|all|yes|those|them|how many)\b/.test(q));

  if (aboutInvoices) {
    const wantsCount =
      /how many|count|total|summary|so far|paid invoice|invoices we|invoices this|invoices made/.test(q) ||
      (/invoice|bill/.test(prior) && /^(total|paid|open|all|how many)\b/.test(q));
    const wantsLastPaid = /\b(who|which).{0,40}\bpaid\b|\blast\s+paid\b|\bpaid\s+last\b|\blast\s+vendor\b/.test(q);
    const status = /\bpaid\b/.test(q) || wantsLastPaid
      ? 'paid'
      : /\bopen\b|\bstill owe|\bpending\b|\bunpaid\b/.test(q)
        ? 'open'
        : 'all';
    if (wantsCount || status === 'paid' || wantsLastPaid) {
      return {
        agentId: 'books',
        toolId: 'invoice_period_summary',
        clarity: 'ok',
        slots: { period, vendor: null, status },
        ask: null,
      };
    }
    const vendorMatch = q.match(/(?:vendor|pay|owe|bill)\s+([a-z0-9][\w\s&'-]{0,40}?)(?:\s|$|\?)/i);
    return {
      agentId: 'books',
      toolId: 'open_invoices',
      clarity: 'ok',
      slots: { period: null, vendor: vendorMatch?.[1]?.trim() || null, status: null },
      ask: null,
    };
  }

  if (/missing\s+(a\s+)?close|no close|forgot.*close|days?\s+missing/.test(q)) {
    return {
      agentId: 'books',
      toolId: 'missing_closes',
      clarity: 'ok',
      slots: { period, vendor: null, status: null },
      ask: null,
    };
  }

  if (
    /stand|standing|dmr|how (are|is) (we|sales)|\bsales\b/.test(q) ||
    /\b(buying|expenses?|till)\b/.test(q)
  ) {
    return {
      agentId: 'books',
      toolId: 'standing_report',
      clarity: 'ok',
      slots: { period, vendor: null, status: null },
      ask: null,
    };
  }

  // Short follow-up after standing
  if (/standing|dmr|sales/.test(prior) && /^(total|more|and|this month|this week)\b/.test(q)) {
    return {
      agentId: 'books',
      toolId: 'standing_report',
      clarity: 'ok',
      slots: { period, vendor: null, status: null },
      ask: null,
    };
  }

  return {
    agentId: 'books',
    toolId: 'clarify',
    clarity: 'clarify',
    slots: {},
    ask: 'Do you want standing/DMR, open invoices still owed, or invoice counts (paid vs open) for this month?',
  };
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
