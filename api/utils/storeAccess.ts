import type { PrismaClient, UserRole } from '@prisma/client';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuthUser, type AuthUser } from './auth';

export type StoreAccessResult =
  | { ok: true; role: UserRole }
  | { ok: false; status: number; error: string };

export async function assertStoreMember(
  prisma: PrismaClient,
  userId: string,
  storeId: string
): Promise<StoreAccessResult> {
  const membership = await prisma.userStore.findFirst({
    where: { userId, storeId },
    select: { role: true },
  });

  if (!membership) {
    return { ok: false, status: 403, error: 'You do not have access to this store' };
  }

  return { ok: true, role: membership.role };
}

/** Require auth + store membership unless mock mode (demo data only). */
export async function requireStoreAccess(
  req: VercelRequest,
  res: VercelResponse,
  prisma: PrismaClient,
  storeId: string,
  useMock: boolean
): Promise<{ user: AuthUser; role: UserRole } | null> {
  if (useMock) return null;

  const user = requireAuthUser(req, res);
  if (!user) return null;

  const access = await assertStoreMember(prisma, user.userId, storeId);
  if (!access.ok) {
    res.status(access.status).json({ error: access.error });
    return null;
  }

  return { user, role: access.role };
}
