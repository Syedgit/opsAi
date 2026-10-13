import type { ClassificationType, PrismaClient } from '@prisma/client';
import { PendingStatus } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

export async function createPendingAction(
  prisma: PrismaClient,
  phoneE164: string,
  storeId: string,
  type: ClassificationType,
  fields: Record<string, unknown>,
  confidence: number,
  messageIdInbound: string
): Promise<string> {
  const actionId = uuidv4();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 24);

  await prisma.pendingActions.create({
    data: {
      actionId,
      phoneE164,
      storeId,
      type,
      payloadJson: fields as object,
      confidence,
      status: PendingStatus.PENDING,
      messageIdInbound,
      expiresAt,
    },
  });

  return actionId;
}

export async function getLatestPendingAction(prisma: PrismaClient, phoneE164: string) {
  return prisma.pendingActions.findFirst({
    where: {
      phoneE164,
      status: PendingStatus.PENDING,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * All pending entries that came from the same inbound message as the latest one.
 * One message can produce several entries (e.g. two stores), and OK / CANCEL apply to all of them.
 */
export async function getLatestPendingBatch(prisma: PrismaClient, phoneE164: string) {
  const latest = await getLatestPendingAction(prisma, phoneE164);
  if (!latest) return [];
  return prisma.pendingActions.findMany({
    where: {
      phoneE164,
      status: PendingStatus.PENDING,
      expiresAt: { gt: new Date() },
      messageIdInbound: latest.messageIdInbound,
    },
    orderBy: { createdAt: 'asc' },
  });
}

export async function confirmPendingAction(prisma: PrismaClient, actionId: string): Promise<boolean> {
  const result = await prisma.pendingActions.updateMany({
    where: { actionId, status: PendingStatus.PENDING },
    data: { status: PendingStatus.CONFIRMED },
  });
  return result.count > 0;
}

export async function cancelPendingAction(prisma: PrismaClient, actionId: string): Promise<boolean> {
  const result = await prisma.pendingActions.updateMany({
    where: { actionId, status: PendingStatus.PENDING },
    data: { status: PendingStatus.CANCELLED },
  });
  return result.count > 0;
}
