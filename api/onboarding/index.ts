import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { getAuthUser } from '../utils/auth';
import { getGroupSetupMode } from '../../lib/whatsappGroupConfig';
import { completeOwnerStoreOnboarding } from '../lib/storeOwnerOnboarding';

const prisma = new PrismaClient();

/**
 * GET /api/onboarding/status
 * POST /api/onboarding/complete-store
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const path = req.url?.split('?')[0] || '';

  if (path.endsWith('/status') && req.method === 'GET') {
    const authUser = getAuthUser(req);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    try {
      const membership = await prisma.userStore.findFirst({
        where: { userId: authUser.userId },
        select: { storeId: true, role: true },
      });
      res.json({
        success: true,
        needsOnboarding: !membership,
        storeId: membership?.storeId ?? null,
        role: membership?.role ?? null,
        groupSetupMode: getGroupSetupMode(),
        opsWhatsAppDisplayNumber: process.env.OPS_WHATSAPP_DISPLAY_NUMBER?.trim() || null,
      });
    } catch (e: unknown) {
      res.status(500).json({
        error: 'Failed to load onboarding status',
        details: e instanceof Error ? e.message : 'Unknown error',
      });
    }
    return;
  }

  if (path.endsWith('/complete-store') && req.method === 'POST') {
    const authUser = getAuthUser(req);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    try {
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
            : 'Your store is ready. WhatsApp group request failed — you can retry from store settings when auto-provision is enabled.';

      res.status(201).json({
        success: true,
        message,
        storeId: result.storeId,
        provision: result.provision,
        groupSetupMode: getGroupSetupMode(),
        opsWhatsAppDisplayNumber: process.env.OPS_WHATSAPP_DISPLAY_NUMBER?.trim() || null,
      });
    } catch (e: unknown) {
      console.error('Onboarding failed', e);
      res.status(500).json({
        error: 'Onboarding failed',
        details: e instanceof Error ? e.message : 'Unknown error',
      });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
