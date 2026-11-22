import { sign, verify } from 'jsonwebtoken';
import type { PrismaClient } from '@prisma/client';
import { getJwtSecret } from './apiAuth';
import { normalizeOwnerPhoneE164 } from './storeOwnerOnboarding';
import { loadStoreTeam } from './tasks/people';
import {
  dashboardLoginUrl,
  isPublicAppUrl,
  pairWhatsAppDashboardLogins,
  privateDashboardChatText,
  publicAppUrl,
  signWhatsAppLogin,
} from './whatsappLogin';
import { sendWhatsAppMessage } from './whatsappMessaging';

/** Short-lived proof that this WhatsApp number wrote to opsAi. */
export const WA_PHONE_SIGNUP_TYP = 'wa_phone_signup';
export const WA_PHONE_SIGNUP_MINUTES = 30;

const LOGIN_RE = /^(login|log\s*in|signin|sign\s*in|start|dashboard)$/i;

export function isPhoneLoginKeyword(text: string): boolean {
  return LOGIN_RE.test(text.trim());
}

export function opsWhatsAppDisplayNumber(): string | null {
  const raw = process.env.OPS_WHATSAPP_DISPLAY_NUMBER?.trim() || '';
  if (!raw) return null;
  return raw;
}

/** Digits only for wa.me links. */
export function opsWhatsAppWaMeNumber(): string | null {
  const display = opsWhatsAppDisplayNumber();
  if (!display) return null;
  const digits = display.replace(/\D/g, '');
  return digits.length >= 8 ? digits : null;
}

export function whatsappLoginDeepLink(prefill = 'Login'): string | null {
  const num = opsWhatsAppWaMeNumber();
  if (!num) return null;
  return `https://wa.me/${num}?text=${encodeURIComponent(prefill)}`;
}

export function phoneAccountEmail(phoneE164: string): string {
  const digits = phoneE164.replace(/\D/g, '');
  return `wa.${digits}@phone.opsai.us`;
}

export function signPhoneSignup(phoneE164: string): string {
  return sign({ typ: WA_PHONE_SIGNUP_TYP, phoneE164 }, getJwtSecret(), {
    expiresIn: `${WA_PHONE_SIGNUP_MINUTES}m`,
  });
}

export function verifyPhoneSignup(token: string): { phoneE164: string } | null {
  try {
    const payload = verify(token, getJwtSecret()) as { typ?: string; phoneE164?: string };
    if (payload.typ !== WA_PHONE_SIGNUP_TYP || !payload.phoneE164) return null;
    const phone = normalizeOwnerPhoneE164(payload.phoneE164);
    return phone ? { phoneE164: phone } : null;
  } catch {
    return null;
  }
}

export function phoneSignupUrl(token: string): string {
  return `${publicAppUrl()}/signup?wa=${encodeURIComponent(token)}`;
}

/**
 * Send a dashboard tap-link to this phone when they are a paired owner/manager,
 * otherwise a signup link that proves the number.
 */
export async function handlePhoneLoginKeyword(
  prisma: PrismaClient,
  phoneE164: string
): Promise<{ success: boolean; message: string }> {
  if (!isPublicAppUrl()) {
    return {
      success: true,
      message:
        'Open the opsAi dashboard on your computer to sign in. A phone tap-link is not sent while the app is only on this computer.',
    };
  }

  const sent = await sendDashboardLinksForPhone(prisma, phoneE164);
  if (sent > 0) {
    return {
      success: true,
      message: `📊 Dashboard link sent above — tap to open (no password). Expires in 20 minutes. Do not forward it.`,
    };
  }

  const existing = await findWhatsAppAccountUser(prisma, phoneE164);
  const token = signPhoneSignup(phoneE164);
  if (existing) {
    return {
      success: true,
      message: `📊 Tap to open opsAi (no password):\n${phoneContinueUrl(token)}\n\nExpires in ${WA_PHONE_SIGNUP_MINUTES} minutes.`,
    };
  }

  const onTeam = await prisma.userDirectory.findFirst({
    where: { phoneE164, isActive: true, role: { in: ['OWNER', 'MANAGER'] } },
    select: { id: true },
  });
  if (onTeam) {
    return {
      success: true,
      message:
        'Your WhatsApp is on the team, but it is not paired with a dashboard login yet. Ask the owner to match your name under Tasks → People, or sign in with email on the website.',
    };
  }

  return {
    success: true,
    message: `👋 Welcome to opsAi.\n\nTap to create your owner account (no password):\n${phoneSignupUrl(token)}\n\nLink expires in ${WA_PHONE_SIGNUP_MINUTES} minutes.`,
  };
}

export function phoneContinueUrl(token: string): string {
  return `${publicAppUrl()}/login?phone=${encodeURIComponent(token)}`;
}

async function sendDashboardLinksForPhone(prisma: PrismaClient, phoneE164: string): Promise<number> {
  const rows = await prisma.userDirectory.findMany({
    where: { phoneE164, isActive: true, role: { in: ['OWNER', 'MANAGER'] } },
    select: { storeId: true },
  });
  const storeIds = [...new Set(rows.map((r) => r.storeId).filter(Boolean))] as string[];
  let sent = 0;
  for (const storeId of storeIds) {
    const team = await loadStoreTeam(prisma, storeId);
    const target = pairWhatsAppDashboardLogins(team).find((t) => t.phoneE164 === phoneE164);
    if (!target) continue;
    const store = await prisma.storeConfig.findUnique({
      where: { storeId },
      select: { storeName: true },
    });
    const token = signWhatsAppLogin({ id: target.userId, email: target.email }, storeId);
    const url = dashboardLoginUrl(token, storeId);
    if (
      await sendWhatsAppMessage(
        prisma,
        phoneE164,
        privateDashboardChatText(store?.storeName || 'Store', url),
        storeId
      )
    ) {
      sent += 1;
    }
  }
  return sent;
}

async function findWhatsAppAccountUser(prisma: PrismaClient, phoneE164: string) {
  return prisma.user.findFirst({
    where: { provider: 'whatsapp', providerId: phoneE164, isActive: true },
  });
}
