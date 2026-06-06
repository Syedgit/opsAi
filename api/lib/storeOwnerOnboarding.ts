import type { PrismaClient } from '@prisma/client';
import { UserRole } from '@prisma/client';
import { allocateSequentialStoreId } from './allocateStoreId';
import { isGroupAutoProvisionEnabled } from '../../lib/whatsappGroupConfig';
import { startWhatsAppGroupProvision } from './whatsappGroupProvision';

export function normalizeOwnerPhoneE164(input: string): string | null {
  const s = input.trim().replace(/[\s-]/g, '');
  if (/^\+[1-9]\d{6,14}$/.test(s)) return s;
  return null;
}

export type CompleteOwnerOnboardingInput = {
  userId: string;
  storeName: string;
  ownerPhoneE164: string;
  whatsappGroupSubject?: string;
  groupDescription?: string;
  timezone?: string;
  joinApprovalMode?: 'auto_approve' | 'approval_required';
};

export type CompleteOwnerOnboardingResult =
  | {
      ok: true;
      storeId: string;
      provision:
        | { status: 'started'; provisionId: string; metaRequestId: string | null }
        | { status: 'skipped'; reason: string }
        | { status: 'failed_meta'; error: string; details?: unknown };
    }
  | { ok: false; status: number; error: string; details?: unknown };

const DEFAULT_SHEET_PLACEHOLDER = 'pending_google_sheet';

function defaultSheetId(): string {
  return process.env.ONBOARDING_DEFAULT_SHEET_ID?.trim() || DEFAULT_SHEET_PLACEHOLDER;
}

export async function completeOwnerStoreOnboarding(
  prisma: PrismaClient,
  input: CompleteOwnerOnboardingInput
): Promise<CompleteOwnerOnboardingResult> {
  const phone = normalizeOwnerPhoneE164(input.ownerPhoneE164);
  if (!phone) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid phone number. Use international format with country code, e.g. +15551234567',
    };
  }

  const storeName = input.storeName.trim();
  if (!storeName || storeName.length > 200) {
    return { ok: false, status: 400, error: 'storeName is required (max 200 characters)' };
  }

  const existingMembership = await prisma.userStore.findFirst({
    where: { userId: input.userId },
  });
  if (existingMembership) {
    return {
      ok: false,
      status: 409,
      error: 'You already belong to a store. Open the dashboard or contact support to add another location.',
    };
  }

  const phoneTaken = await prisma.userDirectory.findUnique({
    where: { phoneE164: phone },
  });
  if (phoneTaken) {
    return {
      ok: false,
      status: 409,
      error: 'This WhatsApp number is already registered to another account.',
    };
  }

  let storeId = '';
  let createdStore = false;
  for (let attempt = 0; attempt < 15; attempt++) {
    storeId = await allocateSequentialStoreId(prisma);
    try {
      await prisma.$transaction(async (tx) => {
        await tx.storeConfig.create({
          data: {
            storeId,
            storeName,
            sheetId: defaultSheetId(),
            timezone: input.timezone?.trim() || 'America/New_York',
            active: true,
          },
        });
        await tx.userStore.create({
          data: {
            userId: input.userId,
            storeId,
            role: UserRole.OWNER,
          },
        });
        await tx.userDirectory.create({
          data: {
            phoneE164: phone,
            name: null,
            role: UserRole.OWNER,
            storeId,
            isActive: true,
          },
        });
      });
      createdStore = true;
      break;
    } catch (e: unknown) {
      const code = e && typeof e === 'object' && 'code' in e ? (e as { code?: string }).code : '';
      if (code === 'P2002') continue;
      throw e;
    }
  }

  if (!createdStore || !storeId) {
    return { ok: false, status: 500, error: 'Could not allocate a store ID. Try again.' };
  }

  if (!isGroupAutoProvisionEnabled()) {
    return {
      ok: true,
      storeId,
      provision: {
        status: 'skipped',
        reason:
          'Manual group setup (Path A): create a WhatsApp group on your phone, add the opsAi business number, then send any message from your registered number in that group to connect it.',
      },
    };
  }

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  if (!phoneNumberId || !accessToken) {
    return {
      ok: true,
      storeId,
      provision: {
        status: 'skipped',
        reason:
          'WhatsApp group auto-create is enabled but WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN is missing.',
      },
    };
  }

  const subject =
    (input.whatsappGroupSubject?.trim() || storeName).slice(0, 128) || storeName.slice(0, 128);

  const prov = await startWhatsAppGroupProvision(prisma, {
    storeId,
    userId: input.userId,
    subject,
    description: input.groupDescription?.trim() || null,
    joinApprovalMode: input.joinApprovalMode,
  });

  if (!prov.ok) {
    return {
      ok: true,
      storeId,
      provision: {
        status: 'failed_meta',
        error: prov.error,
        details: prov.details,
      },
    };
  }

  return {
    ok: true,
    storeId,
    provision: {
      status: 'started',
      provisionId: prov.provision.id,
      metaRequestId: prov.provision.metaRequestId,
    },
  };
}
