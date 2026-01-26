import { ClassificationType, PendingStatus } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { ExtractionResult } from '../types';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';

/**
 * Create a pending action for user confirmation
 */
export async function createPendingAction(
  phoneE164: string,
  storeId: string,
  type: ClassificationType,
  extraction: ExtractionResult,
  messageIdInbound: string
): Promise<string> {
  const actionId = uuidv4();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 24); // 24 hour expiry

  await prisma.pendingActions.create({
    data: {
      actionId,
      phoneE164,
      storeId,
      type,
      payloadJson: extraction.fields as any,
      confidence: extraction.confidence,
      status: PendingStatus.PENDING,
      messageIdInbound,
      expiresAt,
    },
  });

  logger.info('Created pending action', { actionId, phoneE164, storeId, type });
  return actionId;
}

/**
 * Get latest pending action for a phone number
 */
export async function getLatestPendingAction(phoneE164: string) {
  return await prisma.pendingActions.findFirst({
    where: {
      phoneE164,
      status: PendingStatus.PENDING,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Confirm a pending action
 */
export async function confirmPendingAction(actionId: string): Promise<boolean> {
  const result = await prisma.pendingActions.updateMany({
    where: {
      actionId,
      status: PendingStatus.PENDING,
    },
    data: {
      status: PendingStatus.CONFIRMED,
    },
  });

  return result.count > 0;
}

/**
 * Cancel a pending action
 */
export async function cancelPendingAction(actionId: string): Promise<boolean> {
  const result = await prisma.pendingActions.updateMany({
    where: {
      actionId,
      status: PendingStatus.PENDING,
    },
    data: {
      status: PendingStatus.CANCELLED,
    },
  });

  return result.count > 0;
}

