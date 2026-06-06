import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient, UserRole } from '@prisma/client';
import { getAuthUser } from '../../utils/auth';
import { getGroupSetupMode, isGroupAutoProvisionEnabled } from '../../../lib/whatsappGroupConfig';
import { startWhatsAppGroupProvision } from '../../lib/whatsappGroupProvision';

const prisma = new PrismaClient();

const MANAGE_GROUP_ROLES: UserRole[] = [UserRole.OWNER, UserRole.MANAGER];

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const storeId = ((req.query.storeId as string) || '').toUpperCase();
  if (!storeId) {
    res.status(400).json({ error: 'storeId required' });
    return;
  }

  const authUser = getAuthUser(req);
  if (!authUser) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  if (req.method === 'GET') {
    const member = await prisma.userStore.findFirst({
      where: { userId: authUser.userId, storeId },
    });
    if (!member) {
      res.status(403).json({ error: 'Not a member of this store' });
      return;
    }
    try {
      const provision = await prisma.whatsAppGroupProvision.findFirst({
        where: { storeId },
        orderBy: { updatedAt: 'desc' },
      });
      const groups = await prisma.storeWhatsAppGroup.findMany({
        where: { storeId, active: true },
        select: { id: true, whatsappGroupId: true, createdAt: true },
      });
      res.json({
        success: true,
        groupSetupMode: getGroupSetupMode(),
        autoProvisionEnabled: isGroupAutoProvisionEnabled(),
        provision: provision
          ? {
              id: provision.id,
              status: provision.status,
              subject: provision.subject,
              description: provision.description,
              metaRequestId: provision.metaRequestId,
              whatsappGroupId: provision.whatsappGroupId,
              inviteLink: provision.inviteLink,
              lastError: provision.lastError,
              updatedAt: provision.updatedAt,
            }
          : null,
        activeGroups: groups,
      });
    } catch (e: unknown) {
      res.status(500).json({
        error: 'Failed to load provision',
        details: e instanceof Error ? e.message : 'Unknown error',
      });
    }
    return;
  }

  if (req.method === 'POST') {
    if (!isGroupAutoProvisionEnabled()) {
      res.status(400).json({
        error: 'Automatic group creation is disabled. Create a WhatsApp group manually and message from your registered phone to connect it.',
        groupSetupMode: 'manual',
      });
      return;
    }

    const membership = await prisma.userStore.findFirst({
      where: { userId: authUser.userId, storeId, role: { in: MANAGE_GROUP_ROLES } },
    });
    if (!membership) {
      res.status(403).json({ error: 'Only owners or managers can provision a WhatsApp group' });
      return;
    }
    try {
      const body = req.body as {
        subject?: string;
        description?: string;
        joinApprovalMode?: 'auto_approve' | 'approval_required';
      };
      const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
      if (!subject || subject.length > 128) {
        res.status(400).json({ error: 'subject is required (max 128 characters)' });
        return;
      }

      const store = await prisma.storeConfig.findUnique({ where: { storeId } });
      if (!store) {
        res.status(404).json({ error: 'Store not found' });
        return;
      }

      const existingGroup = await prisma.storeWhatsAppGroup.findFirst({
        where: { storeId, active: true },
      });
      if (existingGroup) {
        res.status(409).json({
          error: 'Store already has an active WhatsApp group mapping',
          whatsappGroupId: existingGroup.whatsappGroupId,
        });
        return;
      }

      const prov = await startWhatsAppGroupProvision(prisma, {
        storeId,
        userId: authUser.userId,
        subject,
        description: typeof body.description === 'string' ? body.description : undefined,
        joinApprovalMode: body.joinApprovalMode,
      });

      if (!prov.ok) {
        res.status(prov.status).json({
          error: prov.error,
          ...(prov.details !== undefined ? { details: prov.details } : {}),
        });
        return;
      }

      const provision = prov.provision;

      res.status(202).json({
        success: true,
        message:
          'Group creation started. Ensure Meta webhooks include group_lifecycle_update.',
        provision: {
          id: provision.id,
          storeId: provision.storeId,
          status: provision.status,
          subject: provision.subject,
          metaRequestId: provision.metaRequestId,
        },
      });
    } catch (e: unknown) {
      res.status(500).json({
        error: 'Failed to start provisioning',
        details: e instanceof Error ? e.message : 'Unknown error',
      });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
