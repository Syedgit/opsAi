import { prisma } from '../config/database';

export interface StoreResolutionResult {
  storeId: string | null;
  userId: string | null;
  isUnlinked: boolean;
}

/**
 * Resolve store ID from phone number or message content
 */
export async function resolveStore(
  phoneE164: string,
  messageText?: string
): Promise<StoreResolutionResult> {
  // First, check UserDirectory
  const user = await prisma.userDirectory.findUnique({
    where: { phoneE164 },
  });

  if (user && user.storeId) {
    return {
      storeId: user.storeId,
      userId: user.id,
      isUnlinked: false,
    };
  }

  // Check message prefix for store ID (S001, S002, etc.)
  if (messageText) {
    const storeMatch = messageText.match(/\b(S\d{3})\b/i);
    if (storeMatch) {
      const storeId = storeMatch[1].toUpperCase();
      const store = await prisma.storeConfig.findUnique({
        where: { storeId },
      });

      if (store) {
        return {
          storeId: store.storeId,
          userId: user?.id || null,
          isUnlinked: false,
        };
      }
    }
  }

  // User is unlinked
  return {
    storeId: null,
    userId: user?.id || null,
    isUnlinked: true,
  };
}

