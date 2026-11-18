import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireStoreAccess } from '../../lib/storeAccess';
import { isAiChatEnrolled, AI_CHAT_USD_PER_STORE_PER_MONTH } from '../../lib/aiChatAccess';
import { answerAiChatQuestion } from '../../lib/aiChatAsk';
import { AGENT_DISPLAY, resolveAgentPack } from '../../lib/agents/crew';
import { readStoredSetup } from '../../lib/tasks/storeSetup';
import { logApp, logAppError, loggedHandler, serializeError } from '../../lib/requestLog';

const prisma = new PrismaClient();

const TurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().trim().min(1).max(2000),
});

const BodySchema = z.object({
  storeId: z.string().min(1).max(20),
  question: z.string().trim().min(1).max(500),
  history: z.array(TurnSchema).max(12).optional(),
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
  const enrolled = isAiChatEnrolled(store.profileJson);
  if (!enrolled) {
    res.status(402).json({
      error: `Books agent is not enrolled for this store. Add-on is $${AI_CHAT_USD_PER_STORE_PER_MONTH}/store/mo — enable Books from Store admin → Crew.`,
      enrolled: false,
      agentId: 'books',
    });
    return;
  }

  try {
    logApp('ask.data', {
      storeId,
      role: access.role,
      qLen: question.length,
      history: history.length,
      channel: 'web',
      agentFilter,
    });
    const pack = resolveAgentPack(store.profileJson, readStoredSetup(store.setupJson)?.storeType ?? null);
    const result = await answerAiChatQuestion(prisma, storeId, store.storeName, question, {
      history,
      agentFilter,
      booksEnrolled: true,
      pack,
      channel: 'web',
    });
    // Soft-fail: always return a usable reply on web — never a dead-end 400 for routing.
    const answer =
      result.answer ||
      'What do you want to know — standing/DMR, open invoices, who was paid last, or invoice counts?';
    if (result.skipped && !result.answer) {
      logApp('ask.soft_clarify', { storeId, agentFilter, toolId: result.toolId || null });
    }
    const agentId = result.agentId;
    res.status(200).json({
      success: true,
      enrolled: true,
      answer,
      agentId,
      agent: result.agent || AGENT_DISPLAY[agentId] || 'Books',
      toolId: result.toolId || (result.skipped ? 'clarify' : null),
    });
  } catch (error) {
    logAppError('ask.data', serializeError(error));
    res.status(500).json({ error: 'Could not answer that right now' });
  }
}

export default loggedHandler('stores.ask', handler);
