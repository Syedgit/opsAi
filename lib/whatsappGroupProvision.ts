import type { PrismaClient, WhatsAppGroupProvision } from '@prisma/client';
import { createWhatsAppGroup } from './metaWhatsAppGroups';

export type StartProvisionParams = {
  storeId: string;
  userId: string;
  subject: string;
  description?: string | null;
  joinApprovalMode?: 'auto_approve' | 'approval_required';
};

export type StartProvisionResult =
  | { ok: true; provision: WhatsAppGroupProvision }
  | { ok: false; status: number; error: string; details?: unknown };

/**
 * Starts Meta async group create + DB provision row. Caller must enforce auth / membership / duplicates.
 */
export async function startWhatsAppGroupProvision(
  prisma: PrismaClient,
  params: StartProvisionParams
): Promise<StartProvisionResult> {
  const subject = params.subject.trim();
  if (!subject || subject.length > 128) {
    return { ok: false, status: 400, error: 'subject is required (max 128 characters)' };
  }

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  if (!phoneNumberId || !accessToken) {
    return {
      ok: false,
      status: 503,
      error: 'Server missing WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN',
    };
  }

  await prisma.whatsAppGroupProvision.deleteMany({
    where: { storeId: params.storeId, status: 'PENDING_WEBHOOK' },
  });

  let requestId: string | null = null;
  try {
    const created = await createWhatsAppGroup({
      phoneNumberId,
      accessToken,
      subject,
      description: typeof params.description === 'string' ? params.description : undefined,
      joinApprovalMode: params.joinApprovalMode,
    });
    requestId = created.requestId;
  } catch (apiErr: unknown) {
    const err = apiErr as { response?: { data?: unknown }; message?: string };
    return {
      ok: false,
      status: 502,
      error: 'Meta group create request failed',
      details: err.response?.data ?? err.message ?? 'Meta API error',
    };
  }

  const provision = await prisma.whatsAppGroupProvision.create({
    data: {
      storeId: params.storeId,
      createdByUserId: params.userId,
      status: 'PENDING_WEBHOOK',
      subject,
      description: typeof params.description === 'string' ? params.description.trim() || null : null,
      joinApprovalMode: params.joinApprovalMode === 'approval_required' ? 'approval_required' : 'auto_approve',
      metaRequestId: requestId,
    },
  });

  return { ok: true, provision };
}
