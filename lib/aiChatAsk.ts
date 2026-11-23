import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { isBooksChatAllowed, withBooksAlignedToPlan } from './aiChatAccess';
import { planBoardPayload } from './billing/plans';
import { loadStoreReport } from './storeReport';
import { loadOpenInvoices } from './tasks/invoiceReminder';
import { paymentDueOn, remainingOf } from './understanding/invoiceBalance';
import type { AgentId, StoreAgentId } from './agents/crew';
import { AGENT_DISPLAY, resolveAgentPack, syncAgentsBooksFromAiChat } from './agents/crew';
import { lastAskFromPlan, parseLastAsk, type LastAskState } from './agents/lastAsk';
import { runAskPlan, type ChatTurn, type SupervisorRouter } from './agents/supervisor';
import {
  EXIT_LEAD_SYSTEM,
  acceptPolishedAnswer,
  parseExitLeadJson,
  verifyAndDraftAnswer,
  type ExitLeadResult,
} from './agents/askVerify';
import { loadToolFacts, type ToolFactsResult } from './agents/tools/loaders';
import { matchStoreFromText } from './understanding/checks';
import { loadStoreProfiles } from './understanding/storeProfiles';
import { readStoredSetup } from './tasks/storeSetup';
import { logApp, logAppError, serializeError } from './requestLog';

/** Short-lived WhatsApp 1:1 thread memory (best-effort on serverless). */
const waThreads = new Map<string, ChatTurn[]>();
const waLastAsk = new Map<string, LastAskState>();

export function waThreadKey(storeId: string, phoneE164: string): string {
  return `${storeId}:${phoneE164}`;
}

export function getWaThread(storeId: string, phoneE164: string): ChatTurn[] {
  return waThreads.get(waThreadKey(storeId, phoneE164)) || [];
}

export function pushWaThread(storeId: string, phoneE164: string, turn: ChatTurn): void {
  const key = waThreadKey(storeId, phoneE164);
  const prev = waThreads.get(key) || [];
  const next = [...prev, turn].slice(-10);
  waThreads.set(key, next);
}

const QUESTION_HINT =
  /\b(how|what|when|where|why|who|which|standing|dmr|owe|owing|owed|pending|due|forecast|vendor|bill|invoice|sales|buying|selling|utility|utilities|paid|pay|status|looking|stand)\b|\?/i;

/** Connector / Gmail automation asks (WhatsApp 1:1) — may include emails with digits. */
const CONNECTOR_HINT =
  /\b(gmail|connectors?|connected apps?|integrations?|email alert|alert me|gmail rules?|show gmail|add (a )?gmail)\b/i;

/** Ops entries (amounts, closes, orders) must never be stolen by AI chat. */
const ENTRY_HINT =
  /\b(cash|card|gas|fuel|gallon|deposit|payout|paid\s*out|restock|order|cases?\b|broken|out of order)\b/i;

export const AiChatTopicSchema = z.enum([
  'standing',
  'open_invoices',
  'clarify',
  'unsupported',
  'not_ai_chat',
]);

export const AiChatIntentSchema = z.object({
  topic: AiChatTopicSchema,
  period: z.enum(['week', 'month']).nullable().optional(),
  vendor: z.string().trim().min(1).max(60).nullable().optional(),
  /** When topic is clarify — a short prompt asking the admin to rephrase. */
  clarifyPrompt: z.string().trim().min(1).max(280).nullable().optional(),
});

export type AiChatIntent = z.infer<typeof AiChatIntentSchema>;
export type AiChatTopic = z.infer<typeof AiChatTopicSchema>;

export type AiChatFacts = {
  topic: Exclude<AiChatTopic, 'not_ai_chat' | 'clarify'>;
  storeId: string;
  storeName: string;
  question: string;
  /** Numbers and labels the exit model may use — nothing else. */
  facts: Record<string, unknown>;
  /** Plain reply if the exit model is off or fails. */
  fallback: string;
};

export type AiChatClassifier = (question: string) => Promise<AiChatIntent | null>;
export type AiChatSummarizer = (input: {
  question: string;
  facts: Record<string, unknown>;
  fallback: string;
}) => Promise<string | null>;

const CLARIFY_DEFAULT =
  'Books can answer from confirmed WhatsApp data. Try: “How is standing / DMR this month?” or “What vendor invoices are still open?” (optionally name a vendor).';

const INTENT_SYSTEM = [
  'You classify ONE admin question for the Books agent about a convenience store’s confirmed books.',
  'Return JSON only matching: {"topic":"standing"|"open_invoices"|"clarify"|"unsupported"|"not_ai_chat","period":"week"|"month"|null,"vendor":string|null,"clarifyPrompt":string|null}.',
  'standing = DMR, standing, sales vs buying vs expenses, how the month/week looks.',
  'open_invoices = vendor bills still owed, pending invoices, who we still need to pay.',
  'unsupported = forecast, utility due dates, payroll, profit, wages, or anything we do not have tools for yet.',
  'not_ai_chat = staff ops (posting a close, invoice photo, order, OK/FIX) — not a Books question.',
  'clarify = too vague to pick standing vs open_invoices; set clarifyPrompt to one short ask-better question.',
  'Never invent dollar amounts, dates, or vendor balances. You do not fetch data. You only classify.',
  'If a vendor name appears, put it in vendor (short). Default period to month when standing and unspecified.',
].join(' ');

const SUMMARY_SYSTEM = [
  'You are the Books agent summarizing confirmed bookkeeping for a small-business owner or manager.',
  'Use ONLY the JSON facts provided. Do not invent, estimate, or fetch more data.',
  'Never mention wages, payroll, hourly rates, or claim net profit.',
  'Standing cash/card are REGISTER sales tender — never describe them as vendor payment method.',
  'Write a clear, professional WhatsApp-ready reply in plain text (no markdown fences).',
  'Keep every dollar amount exactly as given. 2–8 short sentences or tight bullets.',
  'If facts.parts has multiple sections, answer each part the owner asked — do not drop a part.',
  'If a part has no matching data, say so plainly for that part. Never borrow another vendor’s numbers.',
  'If facts are empty or an error is present, say you do not have that data yet.',
  'No “feel free to ask” or similar fluff closers.',
].join(' ');

export function looksLikeAiChatQuestion(text: string): boolean {
  const t = text.trim();
  if (t.length < 3 || t.length > 500) return false;
  if (ENTRY_HINT.test(t)) return false;
  // Connector setup before the digit gate — From addresses / rule text often include numbers.
  if (CONNECTOR_HINT.test(t)) return true;
  if (/\d/.test(t) || /\$/.test(t)) return false;
  return QUESTION_HINT.test(t);
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** Keyword safety net when entry AI is off or returns garbage. */
export function intentFromKeywords(question: string): AiChatIntent {
  const q = question.toLowerCase();
  if (/stand|standing|dmr|how (are|is) (we|sales)|this month|\bsales\b/.test(q)) {
    return {
      topic: 'standing',
      period: /week/.test(q) ? 'week' : 'month',
      vendor: null,
      clarifyPrompt: null,
    };
  }
  if (/vendor|invoice|pending|owe|due|bill|pay/.test(q)) {
    const vendorMatch = q.match(/(?:vendor|pay|owe|bill)\s+([a-z0-9][\w\s&'-]{0,40}?)(?:\s|$|\?)/i);
    return {
      topic: 'open_invoices',
      period: null,
      vendor: vendorMatch?.[1]?.trim() || null,
      clarifyPrompt: null,
    };
  }
  if (/forecast|utility|utilities|payroll|wage|profit|next\s+\d+\s+days/.test(q)) {
    return { topic: 'unsupported', period: null, vendor: null, clarifyPrompt: null };
  }
  return {
    topic: 'clarify',
    period: null,
    vendor: null,
    clarifyPrompt: CLARIFY_DEFAULT,
  };
}

export function parseAiChatIntent(raw: string | null | undefined): AiChatIntent | null {
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
  const parsed = AiChatIntentSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

async function defaultClassifyIntent(
  question: string,
  env: NodeJS.ProcessEnv
): Promise<AiChatIntent | null> {
  const apiKey = env.OPENAI_API_KEY?.trim();
  // Prefer a cheap text model; fall back to dashboard / photo models already on Vercel.
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
      max_tokens: 200,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: INTENT_SYSTEM },
        { role: 'user', content: question },
      ],
    });
    return parseAiChatIntent(response.choices[0]?.message?.content);
  } catch {
    return null;
  }
}

/**
 * Entry AI: understand the ask → structured intent only.
 * Never loads DB. Falls back to keywords if the model is off/fails.
 */
export async function classifyAiChatIntent(
  question: string,
  options: { env?: NodeJS.ProcessEnv; classify?: AiChatClassifier } = {}
): Promise<AiChatIntent> {
  const env = options.env ?? process.env;
  const fromAi = options.classify
    ? await options.classify(question)
    : await defaultClassifyIntent(question, env);
  if (fromAi) return fromAi;
  return intentFromKeywords(question);
}

/**
 * Middle layer: code + DB only. AI must never call this with guessed numbers.
 */
export async function loadAiChatFactsFromIntent(
  prisma: PrismaClient,
  storeId: string,
  storeName: string,
  question: string,
  intent: AiChatIntent
): Promise<AiChatFacts | { kind: 'clarify'; message: string } | { kind: 'skip' }> {
  if (intent.topic === 'not_ai_chat') return { kind: 'skip' };

  if (intent.topic === 'clarify') {
    return {
      kind: 'clarify',
      message: (intent.clarifyPrompt && intent.clarifyPrompt.trim()) || CLARIFY_DEFAULT,
    };
  }

  if (intent.topic === 'unsupported') {
    return {
      topic: 'unsupported',
      storeId,
      storeName,
      question,
      facts: {
        store: storeName,
        supportedTopics: ['standing / DMR / period sales', 'open vendor invoices / bills still owed'],
        agent: 'Books',
      },
      fallback: [
        `Books is on for ${storeName}, but that question is not supported from confirmed data yet.`,
        'Try: “How is the DMR / standing this month?” or “What vendor invoices are still open?”',
      ].join('\n'),
    };
  }

  if (intent.topic === 'standing') {
    const period = intent.period === 'week' ? 'week' : 'month';
    const report = await loadStoreReport(prisma, storeId, { period });
    if ('error' in report) {
      return {
        topic: 'standing',
        storeId,
        storeName,
        question,
        facts: { error: report.error },
        fallback: `I could not load ${storeName}'s report.`,
      };
    }
    const t = report.totals;
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
      topic: 'standing',
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

  // open_invoices
  const open = await loadOpenInvoices(prisma, [storeId]);
  const mine = open.filter((row) => row.storeId === storeId);
  const nameHint = intent.vendor?.trim().toLowerCase() || null;
  if (mine.length === 0) {
    return {
      topic: 'open_invoices',
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
  const list = (filtered.length ? filtered : mine).slice(0, 8).map((row) => {
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
    topic: 'open_invoices',
    storeId,
    storeName,
    question,
    facts: {
      store: storeName,
      openInvoices: list,
      vendorFilter: nameHint,
      matchedVendorFilter: Boolean(nameHint && filtered.length > 0),
    },
    fallback: [`Open invoices for ${storeName}:`, ...lines].join('\n'),
  };
}

/** Exit AI: polish grounded facts only (legacy path / tests). */
export async function summarizeAiChatFacts(
  collected: AiChatFacts,
  env: NodeJS.ProcessEnv = process.env,
  summarize?: AiChatSummarizer
): Promise<string> {
  if (summarize) {
    const polished = await summarize({
      question: collected.question,
      facts: collected.facts,
      fallback: collected.fallback,
    });
    return acceptPolishedAnswer(collected.fallback, polished);
  }

  const apiKey = env.OPENAI_API_KEY?.trim();
  const model =
    env.OPENAI_TEXT_MODEL?.trim() ||
    env.OPENAI_MODEL?.trim() ||
    env.OPENAI_EXTRACTION_MODEL?.trim();
  if (!apiKey || !model) {
    logApp('books.exit.skip', { reason: !apiKey ? 'no_api_key' : 'no_model' });
    return collected.fallback;
  }

  try {
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey });
    const response = await openai.chat.completions.create({
      model,
      temperature: 0.2,
      max_tokens: 450,
      messages: [
        { role: 'system', content: SUMMARY_SYSTEM },
        {
          role: 'user',
          content: JSON.stringify({
            question: collected.question,
            topic: collected.topic,
            facts: collected.facts,
            verifiedDraft: collected.fallback,
          }),
        },
      ],
    });
    const text = response.choices[0]?.message?.content?.trim();
    if (!text) {
      logApp('books.exit.empty', { model });
      return collected.fallback;
    }
    const accepted = acceptPolishedAnswer(collected.fallback, text);
    logApp('books.exit.ok', {
      model,
      chars: accepted.length,
      usedDraft: accepted === collected.fallback,
    });
    return accepted;
  } catch (error) {
    logAppError('books.exit.fail', { model, ...serializeError(error) });
    return collected.fallback;
  }
}

/**
 * Exit lead after tools: refine the verified draft for THIS question,
 * or ask one clarifying question when the draft is not enough.
 */
export async function exitLeadAfterTools(
  question: string,
  draft: string,
  env: NodeJS.ProcessEnv = process.env,
  summarize?: AiChatSummarizer
): Promise<ExitLeadResult> {
  if (summarize) {
    const polished = await summarize({
      question,
      facts: { verifiedDraft: draft, exitLead: true },
      fallback: draft,
    });
    // Test summarizers return plain text answers unless they return clarify JSON.
    return parseExitLeadJson(polished, draft);
  }

  const apiKey = env.OPENAI_API_KEY?.trim();
  const model =
    env.OPENAI_TEXT_MODEL?.trim() ||
    env.OPENAI_MODEL?.trim() ||
    env.OPENAI_EXTRACTION_MODEL?.trim();
  if (!apiKey || !model) return { kind: 'answer', text: draft };

  try {
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey });
    const response = await openai.chat.completions.create({
      model,
      temperature: 0.1,
      max_tokens: 420,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: EXIT_LEAD_SYSTEM },
        {
          role: 'user',
          content: JSON.stringify({ question, verifiedDraft: draft }),
        },
      ],
    });
    const text = response.choices[0]?.message?.content?.trim();
    const decided = parseExitLeadJson(text, draft);
    logApp('books.exit_lead.ok', {
      model,
      action: 'answer',
      chars: decided.text.length,
    });
    return decided;
  } catch (error) {
    logAppError('books.exit_lead.fail', { model, ...serializeError(error) });
    return { kind: 'answer', text: draft };
  }
}

/** Refine a supervisor-verified draft for the end user (no new facts). */
export async function refineVerifiedAnswer(
  question: string,
  draft: string,
  env: NodeJS.ProcessEnv = process.env,
  summarize?: AiChatSummarizer
): Promise<string> {
  const exit = await exitLeadAfterTools(question, draft, env, summarize);
  return exit.text;
}

export type CrewAnswer = {
  answer: string;
  skipped?: boolean;
  agentId: AgentId;
  agent: string;
  toolId?: string;
  /** Pass back to the next ask so follow-ups keep the same tool+slots. */
  lastAsk?: LastAskState | null;
};

/**
 * Supervisor → tool loader → verify facts vs ask → refine for user.
 * Optional agentFilter pins a subagent (Books shortcut). history enables follow-ups.
 * Legacy `classify` option still maps old topic intents when provided (tests).
 */
export async function answerAiChatQuestion(
  prisma: PrismaClient,
  storeId: string,
  storeName: string,
  question: string,
  options: {
    env?: NodeJS.ProcessEnv;
    classify?: AiChatClassifier;
    summarize?: AiChatSummarizer;
    history?: ChatTurn[];
    agentFilter?: StoreAgentId | 'supervisor' | null;
    booksEnrolled?: boolean;
    pack?: import('./agents/packs').VerticalPack | null;
    route?: SupervisorRouter;
    /** web = crew UI (never silent-skip); whatsapp = may skip ops capture. */
    channel?: 'web' | 'whatsapp';
    /** Previous successful tool+slots for follow-up binding. */
    lastAsk?: LastAskState | null;
  } = {}
): Promise<CrewAnswer> {
  // Legacy test hook: topic classifier → same loaders via tool id mapping.
  if (options.classify) {
    const intent = await classifyAiChatIntent(question, {
      env: options.env,
      classify: options.classify,
    });
    const toolId =
      intent.topic === 'standing'
        ? 'standing_report'
        : intent.topic === 'open_invoices'
          ? 'open_invoices'
          : intent.topic === 'unsupported'
            ? 'unsupported'
            : intent.topic === 'not_ai_chat'
              ? 'not_ai_chat'
              : 'clarify';
    const loaded = await loadToolFacts(
      prisma,
      storeId,
      storeName,
      question,
      toolId,
      { period: intent.period, vendor: intent.vendor, status: null },
      intent.clarifyPrompt
    );
    if ('kind' in loaded) {
      if (loaded.kind === 'skip') {
        return { answer: '', skipped: true, agentId: 'books', agent: AGENT_DISPLAY.books, toolId };
      }
      return { answer: loaded.message, agentId: 'books', agent: AGENT_DISPLAY.books, toolId: 'clarify' };
    }
    const answer = await summarizeAiChatFacts(
      {
        topic: toolId === 'standing_report' ? 'standing' : toolId === 'open_invoices' ? 'open_invoices' : 'unsupported',
        storeId,
        storeName,
        question,
        facts: loaded.facts,
        fallback: loaded.fallback,
      },
      options.env ?? process.env,
      options.summarize
    );
    return { answer, agentId: 'books', agent: AGENT_DISPLAY.books, toolId };
  }

  const booksEnrolled = options.booksEnrolled !== false;
  const history = options.history ?? [];
  const channel = options.channel ?? 'web';
  const lastAskIn = options.lastAsk ? parseLastAsk(options.lastAsk) : null;
  const plan = await runAskPlan(question, {
    history,
    booksEnrolled,
    agentFilter: options.agentFilter ?? 'supervisor',
    pack: options.pack,
    env: options.env,
    route: options.route,
    channel,
    lastAsk: lastAskIn,
  });
  const nextLastAsk = lastAskFromPlan(plan);

  const primaryTool = plan.steps[0]?.toolId || 'clarify';
  if (primaryTool === 'not_ai_chat') {
    if (channel === 'web') {
      return {
        answer: `I can pull today’s follow-ups for ${storeName}, or dig into standing, invoices, or the schedule — what do you need?`,
        agentId: 'books',
        agent: AGENT_DISPLAY.books,
        toolId: 'ops_today',
        lastAsk: lastAskIn,
      };
    }
    return {
      answer: '',
      skipped: true,
      agentId: 'supervisor',
      agent: AGENT_DISPLAY.supervisor,
      toolId: 'not_ai_chat',
      lastAsk: lastAskIn,
    };
  }

  const parts: Array<{ purpose: string; toolId: string; facts: Record<string, unknown>; fallback: string }> = [];

  for (const step of plan.steps) {
    const loaded = await loadToolFacts(
      prisma,
      storeId,
      storeName,
      question,
      step.toolId,
      step.slots || {},
      plan.ask
    );
    if ('kind' in loaded) {
      if (loaded.kind === 'skip') continue;
      return {
        answer: loaded.message,
        agentId: 'books',
        agent: AGENT_DISPLAY.books,
        toolId: 'clarify',
        lastAsk: lastAskIn,
      };
    }
    const factsLoaded = loaded as ToolFactsResult;
    parts.push({
      purpose: step.purpose,
      toolId: step.toolId,
      facts: factsLoaded.facts,
      fallback: factsLoaded.fallback,
    });
  }

  if (parts.length === 0) {
    if (channel === 'web') {
      return {
        answer: `I can pull today’s follow-ups for ${storeName}, or dig into standing, invoices, or the schedule — what do you need?`,
        agentId: 'books',
        agent: AGENT_DISPLAY.books,
        toolId: 'ops_today',
        lastAsk: lastAskIn,
      };
    }
    return {
      answer: '',
      skipped: true,
      agentId: 'supervisor',
      agent: AGENT_DISPLAY.supervisor,
      toolId: primaryTool,
      lastAsk: lastAskIn,
    };
  }

  const toolId =
    parts.length === 1 ? parts[0].toolId : parts.map((p) => p.toolId).join('+');

  const verified = verifyAndDraftAnswer({
    question,
    history,
    parts: parts.map((p) => ({
      purpose: p.purpose,
      toolId: p.toolId,
      facts: p.facts,
      fallback: p.fallback,
    })),
  });

  if (verified.status === 'reject') {
    logApp('books.verify.reject', { toolId, chars: verified.text.length });
    return {
      answer: verified.text,
      agentId: 'supervisor',
      agent: AGENT_DISPLAY.supervisor,
      toolId,
      lastAsk: nextLastAsk || lastAskIn,
    };
  }

  logApp('books.verify.ok', {
    toolId,
    polish: verified.polish,
    chars: verified.text.length,
  });

  // Exit = answer only (no clarify). Facts already loaded.
  const exit = await exitLeadAfterTools(
    question,
    verified.text,
    options.env ?? process.env,
    options.summarize
  );

  return {
    answer: exit.text,
    agentId: 'books',
    agent: AGENT_DISPLAY.books,
    toolId,
    lastAsk: nextLastAsk || lastAskIn,
  };
}

/**
 * Pick which business a multi-store owner means on WhatsApp 1:1.
 * Name (“Rockaway”) or code (S009); otherwise keep the phone’s home store.
 */
export async function resolveWhatsAppAskStore(
  prisma: PrismaClient,
  fallbackStoreId: string,
  text: string
): Promise<{ storeId: string; clarify: string | null }> {
  let profiles: Awaited<ReturnType<typeof loadStoreProfiles>> = [];
  try {
    profiles = await loadStoreProfiles(prisma, fallbackStoreId, { includeOwnerSiblings: true });
  } catch {
    return { storeId: fallbackStoreId, clarify: null };
  }
  if (profiles.length <= 1) return { storeId: fallbackStoreId, clarify: null };

  const code = text.toUpperCase().match(/\b(S\d{3})\b/)?.[1];
  if (code) {
    const hit = profiles.find((p) => p.storeId === code);
    if (hit) return { storeId: hit.storeId, clarify: null };
  }

  const named = matchStoreFromText(text, profiles);
  if (named.ambiguous) {
    const list = profiles.map((p) => `• ${p.storeName} (${p.storeId})`).join('\n');
    return {
      storeId: fallbackStoreId,
      clarify: `Which business?\n${list}\n\nSay the store name or code (e.g. Rockaway or S009).`,
    };
  }
  if (named.profile) return { storeId: named.profile.storeId, clarify: null };
  return { storeId: fallbackStoreId, clarify: null };
}

/**
 * Admin 1:1 WhatsApp: OWNER/MANAGER data + connector questions (same tools as Crew chat).
 * Groups and staff stay on the normal ops path. Name a store when you own several.
 */
export async function tryWhatsAppAiChat(
  prisma: PrismaClient,
  input: {
    phoneE164: string;
    storeId: string;
    text: string;
    groupId?: string | null;
    hasMedia?: boolean;
    env?: NodeJS.ProcessEnv;
    classify?: AiChatClassifier;
    summarize?: AiChatSummarizer;
  }
): Promise<
  | { handled: true; answer: string; agentId: AgentId; toolId?: string; storeId: string }
  | { handled: false }
> {
  if (input.groupId) return { handled: false };
  if (input.hasMedia) return { handled: false };

  const text = input.text.trim();
  // Allow short follow-ups when we already have a Books thread on the home store.
  const homeHistory = getWaThread(input.storeId, input.phoneE164);
  const followUp =
    homeHistory.length > 0 && text.length >= 2 && text.length <= 80 && !ENTRY_HINT.test(text);
  if (!looksLikeAiChatQuestion(text) && !followUp) return { handled: false };

  const member = await prisma.userDirectory.findUnique({
    where: { phoneE164: input.phoneE164 },
    select: { role: true, isActive: true, storeId: true },
  });
  if (!member?.isActive || (member.role !== 'OWNER' && member.role !== 'MANAGER')) {
    return { handled: false };
  }

  const picked = await resolveWhatsAppAskStore(prisma, input.storeId, text);
  if (picked.clarify) {
    return {
      handled: true,
      answer: picked.clarify,
      agentId: 'supervisor',
      toolId: 'list_connectors',
      storeId: input.storeId,
    };
  }
  const storeId = picked.storeId;

  const store = await prisma.storeConfig.findUnique({
    where: { storeId },
    select: { storeName: true, profileJson: true, setupJson: true },
  });
  if (!store) return { handled: false };

  const ownerLink = await prisma.userStore.findFirst({
    where: { storeId, role: 'OWNER' },
    select: { user: { select: { plan: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const planIncludesBooks = planBoardPayload(ownerLink?.user?.plan).features.booksLookups;
  let profileJson: unknown = store.profileJson;
  const aligned = withBooksAlignedToPlan(profileJson, planIncludesBooks);
  if (aligned) {
    profileJson = syncAgentsBooksFromAiChat(aligned);
    await prisma.storeConfig.update({
      where: { storeId },
      data: { profileJson: profileJson as object },
    });
  }
  const booksEnrolled = isBooksChatAllowed(profileJson, planIncludesBooks);

  const setup = readStoredSetup(store.setupJson);
  const pack = resolveAgentPack(profileJson, setup?.storeType ?? null);

  const key = waThreadKey(storeId, input.phoneE164);
  const history = getWaThread(storeId, input.phoneE164);
  const result = await answerAiChatQuestion(prisma, storeId, store.storeName, text, {
    env: input.env,
    classify: input.classify,
    summarize: input.summarize,
    history,
    agentFilter: 'supervisor',
    booksEnrolled,
    pack,
    channel: 'whatsapp',
    lastAsk: waLastAsk.get(key) || null,
  });
  if (result.skipped) return { handled: false };
  if (result.lastAsk) waLastAsk.set(key, result.lastAsk);
  pushWaThread(storeId, input.phoneE164, { role: 'user', text });
  pushWaThread(storeId, input.phoneE164, { role: 'assistant', text: result.answer });
  return {
    handled: true,
    answer: result.answer,
    agentId: result.agentId,
    toolId: result.toolId,
    storeId,
  };
}
