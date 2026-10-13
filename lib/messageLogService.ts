import type { PrismaClient } from '@prisma/client';

export async function isMessageProcessed(prisma: PrismaClient, messageId: string): Promise<boolean> {
  const row = await prisma.messageLog.findUnique({
    where: { messageId },
    select: { processed: true },
  });
  return row?.processed === true;
}

/** A claim older than this is assumed to belong to a crashed worker and may be taken over. */
export const STALE_CLAIM_MS = 3 * 60 * 1000;

/**
 * Atomically claim an inbound message so only one worker processes it. Meta retries deliveries it
 * thinks failed, and two copies can arrive at once; the unique message id makes the insert the lock.
 * Returns true when this caller should process the message.
 */
export async function claimMessage(
  prisma: PrismaClient,
  params: { messageId: string; phoneE164: string; messageType: string; messageText?: string; mediaId?: string },
  now: Date = new Date()
): Promise<boolean> {
  try {
    await prisma.messageLog.create({
      data: {
        messageId: params.messageId,
        phoneE164: params.phoneE164,
        messageType: params.messageType,
        messageText: params.messageText ?? null,
        mediaId: params.mediaId ?? null,
        processed: false,
      },
    });
    return true;
  } catch (error) {
    if ((error as { code?: string })?.code !== 'P2002') throw error;
  }

  // Already seen. Finished: skip. Still being worked on: skip. Abandoned by a crashed run: take over.
  const takenOver = await prisma.messageLog.updateMany({
    where: {
      messageId: params.messageId,
      processed: false,
      createdAt: { lt: new Date(now.getTime() - STALE_CLAIM_MS) },
    },
    data: { createdAt: now },
  });
  return takenOver.count > 0;
}

export async function logMessage(
  prisma: PrismaClient,
  params: {
    messageId: string;
    phoneE164: string;
    storeId?: string | null;
    messageType: string;
    messageText?: string;
    mediaId?: string;
  }
): Promise<void> {
  await prisma.messageLog.upsert({
    where: { messageId: params.messageId },
    create: {
      messageId: params.messageId,
      phoneE164: params.phoneE164,
      storeId: params.storeId ?? null,
      messageType: params.messageType,
      messageText: params.messageText ?? null,
      mediaId: params.mediaId ?? null,
      processed: false,
    },
    update: {},
  });
}

export async function updateMessageLog(
  prisma: PrismaClient,
  messageId: string,
  updates: {
    classification?: string;
    extractedData?: unknown;
    processed?: boolean;
    storeId?: string;
  }
): Promise<void> {
  await prisma.messageLog.update({
    where: { messageId },
    data: {
      ...(updates.classification !== undefined ? { classification: updates.classification } : {}),
      ...(updates.extractedData !== undefined ? { extractedData: updates.extractedData as object } : {}),
      ...(updates.processed !== undefined ? { processed: updates.processed } : {}),
      ...(updates.storeId !== undefined ? { storeId: updates.storeId } : {}),
    },
  });
}
