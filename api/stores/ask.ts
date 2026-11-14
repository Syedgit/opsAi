import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireStoreAccess } from '../../lib/storeAccess';
import { isAiChatEnrolled, AI_CHAT_USD_PER_STORE_PER_MONTH } from '../../lib/aiChatAccess';
import { answerAiChatQuestion } from '../../lib/aiChatAsk';
import { logApp, logAppError, loggedHandler, serializeError } from '../../lib/requestLog';

const prisma = new PrismaClient();

const BodySchema = z.object({
  storeId: z.string().min(1).max(20),
  question: z.string().trim().min(3).max(500),
});

/**
 * Admin AI chat (enrolled stores only).
 * Phase 0: enrollment gate + grounded answers from confirmed report/invoice data.
 * Same answerer as WhatsApp 1:1 for enrolled owners/managers.
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
  const access = await requireStoreAccess(req, res, prisma, storeId, false);
  if (!access) return;
  if (access.role !== 'OWNER' && access.role !== 'MANAGER') {
    res.status(403).json({ error: 'AI chat is for owners and managers only' });
    return;
  }

  const store = await prisma.storeConfig.findUnique({
    where: { storeId },
    select: { storeName: true, profileJson: true },
  });
  if (!store) {
    res.status(404).json({ error: 'Store not found' });
    return;
  }
  if (!isAiChatEnrolled(store.profileJson)) {
    res.status(402).json({
      error: `AI chat is not enrolled for this store. Add-on is $${AI_CHAT_USD_PER_STORE_PER_MONTH}/store/mo — enroll from Store admin when enabled.`,
      enrolled: false,
    });
    return;
  }

  try {
    logApp('ask.data', { storeId, role: access.role, qLen: question.length, channel: 'web' });
    const result = await answerAiChatQuestion(prisma, storeId, store.storeName, question);
    if (result.skipped || !result.answer) {
      res.status(400).json({
        error:
          'That does not look like an AI chat books question. Try standing/DMR or open vendor invoices.',
      });
      return;
    }
    res.status(200).json({ success: true, enrolled: true, answer: result.answer });
  } catch (error) {
    logAppError('ask.data', serializeError(error));
    res.status(500).json({ error: 'Could not answer that right now' });
  }
}

export default loggedHandler('stores.ask', handler);
