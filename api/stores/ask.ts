import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireStoreAccess } from '../../lib/storeAccess';
import { isBooksChatAllowed, withBooksAlignedToPlan } from '../../lib/aiChatAccess';
import { planBoardPayload } from '../../lib/billing/plans';
import { syncAgentsBooksFromAiChat } from '../../lib/agents/crew';
import { answerAiChatQuestion } from '../../lib/aiChatAsk';
import { AGENT_DISPLAY, resolveAgentPack } from '../../lib/agents/crew';
import { parseLastAsk } from '../../lib/agents/lastAsk';
import { readStoredSetup } from '../../lib/tasks/storeSetup';
import { logApp, logAppError, loggedHandler, serializeError } from '../../lib/requestLog';

const prisma = new PrismaClient();

const TurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().trim().min(1).max(2000),
});

const LastAskSchema = z
  .object({
    toolId: z.string().min(1).max(64),
    slots: z
      .object({
        period: z.enum(['week', 'month', 'custom']).nullable().optional(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        vendor: z.string().trim().max(60).nullable().optional(),
        status: z.enum(['all', 'open', 'paid']).nullable().optional(),
      })
      .optional(),
  })
  .optional()
  .nullable();

const BodySchema = z.object({
  storeId: z.string().min(1).max(20),
  question: z.string().trim().min(1).max(500),
  history: z.array(TurnSchema).max(12).optional(),
  /** Previous tool+slots so short follow-ups stay on topic. */
  lastAsk: LastAskSchema,
  /** supervisor = open main chat; books = direct Books shortcut */
  agentId: z.enum(['supervisor', 'books', 'close', 'finance', 'staff', 'followup']).optional(),
});

/**
 * Supervisor / Books ask (enrolled stores only).
 * Entry Supervisor → tool loader → exit AI. Same answerer as WhatsApp 1:1.
 */
async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Send storeId and a short question' });
    return;
  }
  const storeId = parsed.data.storeId.toUpperCase();
  const question = parsed.data.question;
  const history = parsed.data.history || [];
  const agentFilter = parsed.data.agentId || 'supervisor';
  const access = await requireStoreAccess(req, res, prisma, storeId, false);
  if (!access) return;
  if (access.role !== 'OWNER' && access.role !== 'MANAGER') {
    res.status(403).json({ error: 'Crew chat is for owners and managers only' });
    return;
  }

  const store = await prisma.storeConfig.findUnique({
    where: { storeId },
    select: { storeName: true, profileJson: true, setupJson: true },
  });
  if (!store) {
    res.status(404).json({ error: 'Store not found' });
    return;
  }
  const billingUser = await prisma.user.findUnique({
    where: { id: access.user.userId },
    select: { plan: true },
  });
  const planFeatures = planBoardPayload(billingUser?.plan).features;
  const planIncludesBooks = planFeatures.booksLookups;
  let profileJson: unknown = store.profileJson;
  const aligned = withBooksAlignedToPlan(profileJson, planIncludesBooks);
  if (aligned) {
    profileJson = syncAgentsBooksFromAiChat(aligned);
    await prisma.storeConfig.update({
      where: { storeId },
      data: { profileJson: profileJson as object },
    });
  }
  // Chat agent is on every plan; books look-ups are Pro+ (or opted out).
  const booksEnrolled = isBooksChatAllowed(profileJson, planIncludesBooks);

  try {
    logApp('ask.data', {
      storeId,
      role: access.role,
      qLen: question.length,
      history: history.length,
      channel: 'web',
      agentFilter,
      booksEnrolled,
    });
    const pack = resolveAgentPack(profileJson, readStoredSetup(store.setupJson)?.storeType ?? null);
    const result = await answerAiChatQuestion(prisma, storeId, store.storeName, question, {
      history,
      agentFilter,
      booksEnrolled,
      pack,
      channel: 'web',
      lastAsk: parseLastAsk(parsed.data.lastAsk),
    });
    // Soft-fail: always return a usable reply on web — never a dead-end 400 for routing.
    const answer =
      result.answer ||
      (booksEnrolled
        ? 'What do you want to know — standing/DMR, open invoices, who was paid last, or invoice counts?'
        : 'I can help with today’s ops. Books look-ups (sales, invoices) need Pro or Premium.');
    if (result.skipped && !result.answer) {
      logApp('ask.soft_clarify', { storeId, agentFilter, toolId: result.toolId || null });
    }
    const agentId = result.agentId;
    res.status(200).json({
      success: true,
      enrolled: booksEnrolled,
      answer,
      agentId,
      agent: result.agent || AGENT_DISPLAY[agentId] || 'Books',
      toolId: result.toolId || (result.skipped ? 'clarify' : null),
      lastAsk: result.lastAsk ?? null,
    });
  } catch (error) {
    logAppError('ask.data', serializeError(error));
    res.status(500).json({ error: 'Could not answer that right now' });
  }
}

export default loggedHandler('stores.ask', handler);
