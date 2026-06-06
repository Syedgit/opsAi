import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient, UserRole } from '@prisma/client';
import { requireAuthUser } from '../../utils/auth';

const prisma = new PrismaClient();

const ALLOWED_SELF_LINK_ROLES: UserRole[] = [UserRole.STAFF, UserRole.MANAGER];

/**
 * Join an existing store with invite code (staff/manager only).
 * Owners must complete onboarding to create a new store.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const authUser = requireAuthUser(req, res);
  if (!authUser) return;

  const storeId = ((req.query.storeId as string) || '').toUpperCase();
  if (!storeId) {
    res.status(400).json({ error: 'storeId required' });
    return;
  }

  const body = (req.body || {}) as { role?: string; inviteCode?: string };
  const inviteCode = typeof body.inviteCode === 'string' ? body.inviteCode.trim() : '';
  const expectedInvite = process.env.STORE_LINK_INVITE_CODE?.trim();

  if (!expectedInvite) {
    res.status(503).json({ error: 'Store linking is not configured. Contact your store owner.' });
    return;
  }

  if (!inviteCode || inviteCode !== expectedInvite) {
    res.status(403).json({ error: 'Invalid invite code' });
    return;
  }

  const roleInput = typeof body.role === 'string' ? body.role.toUpperCase() : UserRole.STAFF;
  const role = ALLOWED_SELF_LINK_ROLES.includes(roleInput as UserRole)
    ? (roleInput as UserRole)
    : UserRole.STAFF;

  try {
    const store = await prisma.storeConfig.findUnique({ where: { storeId } });
    if (!store?.active) {
      res.status(404).json({ error: 'Store not found' });
      return;
    }

    const existing = await prisma.userStore.findFirst({
      where: { userId: authUser.userId, storeId },
    });
    if (existing) {
      res.status(409).json({ error: 'You are already a member of this store' });
      return;
    }

    await prisma.userStore.create({
      data: { userId: authUser.userId, storeId, role },
    });

    res.json({
      success: true,
      storeId,
      role,
      message: `Joined store ${storeId} as ${role}`,
    });
  } catch (e: unknown) {
    res.status(500).json({
      error: 'Failed to link store',
      details: e instanceof Error ? e.message : 'Unknown error',
    });
  }
}
