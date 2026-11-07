import { sign, verify } from 'jsonwebtoken';
import type { PrismaClient } from '@prisma/client';
import { getJwtSecret } from './apiAuth';
import { loadStoreTeam, type DashboardMember, type StoreTeam, type WhatsAppPerson } from './tasks/people';
import { sendWhatsAppMessage } from './whatsappMessaging';

/** Short-lived tap-from-WhatsApp token. Never use this as a Bearer session. */
export const WA_LOGIN_TYP = 'wa_link';
export const WA_LOGIN_MINUTES = 20;
export const WA_LINK_ERROR = 'That dashboard link expired or is not valid. Sign in with email.';

export type WhatsAppLogin = { userId: string; email: string; storeId: string };
export type WhatsAppLoginTarget = { phoneE164: string; userId: string; email: string };

export function publicAppUrl(): string {
  const raw = (process.env.APP_URL || process.env.VERCEL_URL || '').trim();
  if (!raw) return 'http://localhost:3000';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw.replace(/\/$/, '');
  return `https://${raw.replace(/\/$/, '')}`;
}

export function signWhatsAppLogin(user: { id: string; email: string }, storeId: string): string {
  return sign(
    { typ: WA_LOGIN_TYP, userId: user.id, email: user.email, storeId },
    getJwtSecret(),
    { expiresIn: `${WA_LOGIN_MINUTES}m` },
  );
}

export function verifyWhatsAppLogin(token: string): WhatsAppLogin | null {
  try {
    const payload = verify(token, getJwtSecret()) as Partial<WhatsAppLogin> & { typ?: string };
    if (payload.typ !== WA_LOGIN_TYP) return null;
    if (!payload.userId || !payload.email || !payload.storeId) return null;
    return { userId: payload.userId, email: payload.email, storeId: payload.storeId };
  } catch {
    return null;
  }
}

export function dashboardLoginUrl(token: string, storeId: string): string {
  const next = `/dashboard?storeId=${encodeURIComponent(storeId)}`;
  return `${publicAppUrl()}/login?wa=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`;
}

export function privateDashboardChatText(storeName: string, url: string): string {
  return (
    `📊 ${storeName} dashboard — tap to open (no password). Private to you, expires in ${WA_LOGIN_MINUTES} minutes.\n${url}`
  );
}

export function groupDashboardHint(): string {
  return `Want this in the browser? I sent owners a private link in a chat with opsAi. It expires in ${WA_LOGIN_MINUTES} minutes — do not forward it.`;
}

function normName(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function canOpenDashboard(role: string): boolean {
  return role === 'OWNER' || role === 'MANAGER';
}

/**
 * Pair a WhatsApp owner/manager with a dashboard login so a 1:1 link signs in as that person.
 * Never guess when two people could match — staff never get a link.
 */
export function pairWhatsAppDashboardLogins(team: StoreTeam): WhatsAppLoginTarget[] {
  const wa = team.whatsapp.filter((p) => canOpenDashboard(p.role));
  const dash = team.dashboard.filter((p) => canOpenDashboard(p.role));
  const usedWa = new Set<string>();
  const usedDash = new Set<string>();
  const out: WhatsAppLoginTarget[] = [];

  const take = (person: WhatsAppPerson, member: DashboardMember) => {
    if (usedWa.has(person.id) || usedDash.has(member.userId)) return;
    usedWa.add(person.id);
    usedDash.add(member.userId);
    out.push({ phoneE164: person.phoneE164, userId: member.userId, email: member.email });
  };

  for (const person of wa) {
    const name = normName(person.name);
    if (!name) continue;
    const matches = dash.filter((m) => !usedDash.has(m.userId) && normName(m.name) === name);
    if (matches.length === 1) take(person, matches[0]);
  }

  const leftoverWa = () => wa.filter((p) => !usedWa.has(p.id));
  const leftoverDash = () => dash.filter((m) => !usedDash.has(m.userId));

  if (leftoverWa().length === 1 && leftoverDash().length === 1) {
    take(leftoverWa()[0], leftoverDash()[0]);
  }

  for (const role of ['OWNER', 'MANAGER'] as const) {
    const wr = leftoverWa().filter((p) => p.role === role);
    const dr = leftoverDash().filter((m) => m.role === role);
    if (wr.length === 1 && dr.length === 1) take(wr[0], dr[0]);
  }

  return out;
}

/** 1:1 chats only. The group wrap-up must never include this URL. */
export async function sendPrivateDashboardLinks(
  prisma: PrismaClient,
  storeId: string,
  storeName: string,
): Promise<number> {
  const team = await loadStoreTeam(prisma, storeId);
  const targets = pairWhatsAppDashboardLogins(team);
  let sent = 0;
  for (const target of targets) {
    const token = signWhatsAppLogin({ id: target.userId, email: target.email }, storeId);
    const url = dashboardLoginUrl(token, storeId);
    if (await sendWhatsAppMessage(prisma, target.phoneE164, privateDashboardChatText(storeName, url), storeId)) {
      sent += 1;
    }
  }
  return sent;
}
