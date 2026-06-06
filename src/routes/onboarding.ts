import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { getAuthUser } from '../../api/utils/auth';
import { completeOwnerStoreOnboarding } from '../../lib/storeOwnerOnboarding';

const router = Router();
const prisma = new PrismaClient();

/**
 * Whether this account still needs first-time store onboarding (no store membership yet).
 * GET /api/onboarding/status
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req as any);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const membership = await prisma.userStore.findFirst({
      where: { userId: authUser.userId },
      select: { storeId: true, role: true },
    });

    res.json({
      success: true,
      needsOnboarding: !membership,
      storeId: membership?.storeId ?? null,
      role: membership?.role ?? null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to load onboarding status', details: message });
  }
});

/**
 * First-time owner: create store, link as OWNER, save WhatsApp number, start Meta group creation.
 * POST /api/onboarding/complete-store
 * Body: { storeName, ownerPhoneE164, whatsappGroupSubject?, groupDescription?, timezone?, joinApprovalMode? }
 */
router.post('/complete-store', async (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req as any);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const body = req.body as {
      storeName?: string;
      ownerPhoneE164?: string;
      whatsappGroupSubject?: string;
      groupDescription?: string;
      timezone?: string;
      joinApprovalMode?: 'auto_approve' | 'approval_required';
    };

    const result = await completeOwnerStoreOnboarding(prisma, {
      userId: authUser.userId,
      storeName: typeof body.storeName === 'string' ? body.storeName : '',
      ownerPhoneE164: typeof body.ownerPhoneE164 === 'string' ? body.ownerPhoneE164 : '',
      whatsappGroupSubject: typeof body.whatsappGroupSubject === 'string' ? body.whatsappGroupSubject : undefined,
      groupDescription: typeof body.groupDescription === 'string' ? body.groupDescription : undefined,
      timezone: typeof body.timezone === 'string' ? body.timezone : undefined,
      joinApprovalMode: body.joinApprovalMode,
    });

    if (!result.ok) {
      res.status(result.status).json({
        error: result.error,
        ...(result.details !== undefined ? { details: result.details } : {}),
      });
      return;
    }

    const message =
      result.provision.status === 'started'
        ? 'Your store is ready. WhatsApp group creation started — open the dashboard for the invite link when Meta finishes.'
        : result.provision.status === 'skipped'
          ? `Store created. ${result.provision.reason}`
          : 'Your store is ready. WhatsApp group request failed — you can retry from store settings.';

    res.status(201).json({
      success: true,
      message,
      storeId: result.storeId,
      provision: result.provision,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Onboarding failed', message);
    res.status(500).json({ error: 'Onboarding failed', details: message });
  }
});

export default router;
