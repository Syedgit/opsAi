import type { PrismaClient } from '@prisma/client';

export async function isMessageProcessed(prisma: PrismaClient, messageId: string): Promise<boolean> {
  const row = await prisma.messageLog.findUnique({
    where: { messageId },
    select: { processed: true },
  });
  return row?.processed === true;
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
