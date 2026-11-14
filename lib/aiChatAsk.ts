import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { isAiChatEnrolled } from './aiChatAccess';
import { loadStoreReport } from './storeReport';
import { loadOpenInvoices } from './tasks/invoiceReminder';
import { paymentDueOn, remainingOf } from './understanding/invoiceBalance';

const QUESTION_HINT =
  /\b(how|what|when|where|why|who|which|standing|dmr|owe|owing|owed|pending|due|forecast|vendor|bill|invoice|sales|buying|selling|utility|utilities|paid|pay|status|looking|stand)\b|\?/i;

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
  'I can help with store books from confirmed WhatsApp data. Try: “How is standing / DMR this month?” or “What vendor invoices are still open?” (optionally name a vendor).';

const INTENT_SYSTEM = [
  'You classify ONE admin question about a convenience store’s confirmed books.',
  'Return JSON only matching: {"topic":"standing"|"open_invoices"|"clarify"|"unsupported"|"not_ai_chat","period":"week"|"month"|null,"vendor":string|null,"clarifyPrompt":string|null}.',
  'standing = DMR, standing, sales vs buying vs expenses, how the month/week looks.',
  'open_invoices = vendor bills still owed, pending invoices, who we still need to pay.',
  'unsupported = forecast, utility due dates, payroll, profit, wages, or anything we do not have tools for yet.',
  'not_ai_chat = staff ops (posting a close, invoice photo, order, OK/FIX) — not a books question.',
  'clarify = too vague to pick standing vs open_invoices; set clarifyPrompt to one short ask-better question.',
  'Never invent dollar amounts, dates, or vendor balances. You do not fetch data. You only classify.',
  'If a vendor name appears, put it in vendor (short). Default period to month when standing and unspecified.',
].join(' ');

const SUMMARY_SYSTEM = [
  'You summarize confirmed convenience-store bookkeeping for an owner or manager.',
  'Use ONLY the JSON facts provided. Do not invent, estimate, or fetch more data.',
  'Never mention wages, payroll, hourly rates, or claim net profit.',
  'Write a clear, professional WhatsApp-ready reply in plain text (no markdown fences).',
  'Keep every dollar amount exactly as given. 2–6 short sentences or tight bullets.',
  'If facts are empty or an error is present, say you do not have that data yet.',
].join(' ');

export function looksLikeAiChatQuestion(text: string): boolean {
  const t = text.trim();
  if (t.length < 3 || t.length > 500) return false;
  if (/\d/.test(t) || /\$/.test(t)) return false;
  if (ENTRY_HINT.test(t)) return false;
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
  const model = env.OPENAI_TEXT_MODEL?.trim() || env.OPENAI_MODEL?.trim();
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
      },
      fallback: [
        `AI chat is on for ${storeName}, but that question is not supported from confirmed data yet.`,
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

/** Exit AI: polish grounded facts only. */
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
    return (polished && polished.trim()) || collected.fallback;
  }

  const apiKey = env.OPENAI_API_KEY?.trim();
  const model = env.OPENAI_TEXT_MODEL?.trim() || env.OPENAI_MODEL?.trim();
  if (!apiKey || !model) return collected.fallback;

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
          }),
        },
      ],
    });
    const text = response.choices[0]?.message?.content?.trim();
    return text || collected.fallback;
  } catch {
    return collected.fallback;
  }
}

/**
 * Full path: entry AI (intent) → code/DB facts → exit AI (summary).
 * Clarify / skip never hit the DB or the summarizer with invented numbers.
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
  } = {}
): Promise<{ answer: string; skipped?: boolean }> {
  const intent = await classifyAiChatIntent(question, {
    env: options.env,
    classify: options.classify,
  });
  const loaded = await loadAiChatFactsFromIntent(prisma, storeId, storeName, question, intent);
  if ('kind' in loaded) {
    if (loaded.kind === 'skip') return { answer: '', skipped: true };
    return { answer: loaded.message };
  }
  const answer = await summarizeAiChatFacts(loaded, options.env ?? process.env, options.summarize);
  return { answer };
}

/**
 * Admin 1:1 WhatsApp: if enrolled OWNER/MANAGER asks a data question, answer and return true.
 * Groups and staff stay on the normal ops path.
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
): Promise<{ handled: true; answer: string } | { handled: false }> {
  if (input.groupId) return { handled: false };
  if (input.hasMedia) return { handled: false };
  if (!looksLikeAiChatQuestion(input.text)) return { handled: false };

  const member = await prisma.userDirectory.findUnique({
    where: { phoneE164: input.phoneE164 },
    select: { role: true, isActive: true, storeId: true },
  });
  if (!member?.isActive || (member.role !== 'OWNER' && member.role !== 'MANAGER')) {
    return { handled: false };
  }

  const store = await prisma.storeConfig.findUnique({
    where: { storeId: input.storeId },
    select: { storeName: true, profileJson: true },
  });
  if (!store || !isAiChatEnrolled(store.profileJson)) {
    return { handled: false };
  }

  const result = await answerAiChatQuestion(prisma, input.storeId, store.storeName, input.text.trim(), {
    env: input.env,
    classify: input.classify,
    summarize: input.summarize,
  });
  if (result.skipped) return { handled: false };
  return { handled: true, answer: result.answer };
}
