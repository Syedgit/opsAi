import type { PrismaClient } from '@prisma/client';

/**
 * Cheap abuse and cost guards, built on message_log so they need no new storage.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function maxMessagesPerHour(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number.parseInt(env.MAX_MESSAGES_PER_HOUR ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
}

export interface HourlyLimit {
  allowed: boolean;
  /** True only for the first message over the limit, so the sender is told once and not on every message. */
  notify: boolean;
}

/** Limit how many messages one phone can send per hour (protects the AI bill and the reply bill). */
export async function checkHourlyLimit(
  prisma: PrismaClient,
  phoneE164: string,
  now: Date = new Date(),
  limit: number = maxMessagesPerHour()
): Promise<HourlyLimit> {
  // The current message is already logged, so it is included in the count.
  const count = await prisma.messageLog.count({
    where: { phoneE164, createdAt: { gte: new Date(now.getTime() - HOUR_MS) } },
  });
  return { allowed: count <= limit, notify: count === limit + 1 };
}

/** Strangers who message the shared number get one "not linked" reply per day, not one per message. */
export async function shouldReplyNotLinked(prisma: PrismaClient, phoneE164: string, now: Date = new Date()): Promise<boolean> {
  const recent = await prisma.messageLog.count({
    where: { phoneE164, classification: 'NOT_LINKED', createdAt: { gte: new Date(now.getTime() - DAY_MS) } },
  });
  return recent === 0;
}
