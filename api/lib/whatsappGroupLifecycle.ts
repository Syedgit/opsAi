/**
 * SYNC: keep in sync with /lib/whatsappGroupLifecycle.ts
 */
import type { PrismaClient } from '@prisma/client';

type GroupEvent = Record<string, unknown>;

export async function applyGroupLifecycleEvent(prisma: PrismaClient, g: GroupEvent): Promise<void> {
  const type = typeof g.type === 'string' ? g.type : '';
  if (type !== 'group_create') {
    return;
  }

  const requestId = typeof g.request_id === 'string' ? g.request_id : null;
  const groupId = typeof g.group_id === 'string' ? g.group_id : null;
  const inviteLink = typeof g.invite_link === 'string' ? g.invite_link : null;
  const subject = typeof g.subject === 'string' ? g.subject.trim() : '';
  const errors = Array.isArray(g.errors) ? (g.errors as { message?: string }[]) : [];

  if (errors.length > 0) {
    const msg = errors.map((e) => e.message || 'unknown').join('; ').slice(0, 2000);
    if (requestId) {
      await prisma.whatsAppGroupProvision.updateMany({
        where: { metaRequestId: requestId },
        data: { status: 'FAILED', lastError: msg },
      });
    }
    return;
  }

  if (!groupId || !inviteLink) {
    if (requestId) {
      await prisma.whatsAppGroupProvision.updateMany({
        where: { metaRequestId: requestId },
        data: {
          status: 'FAILED',
          lastError: 'group_create webhook missing group_id or invite_link',
        },
      });
    }
    return;
  }

  let prov = requestId
    ? await prisma.whatsAppGroupProvision.findUnique({ where: { metaRequestId: requestId } })
    : null;

  if (!prov && subject) {
    prov = await prisma.whatsAppGroupProvision.findFirst({
      where: {
        status: 'PENDING_WEBHOOK',
        subject,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  if (!prov) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.whatsAppGroupProvision.update({
      where: { id: prov!.id },
      data: {
        status: 'LINKED',
        metaRequestId: requestId ?? prov!.metaRequestId,
        whatsappGroupId: groupId,
        inviteLink,
        lastError: null,
      },
    });

    await tx.storeWhatsAppGroup.upsert({
      where: { whatsappGroupId: groupId },
      create: {
        whatsappGroupId: groupId,
        storeId: prov!.storeId,
        active: true,
      },
      update: {
        storeId: prov!.storeId,
        active: true,
      },
    });
  });
}
