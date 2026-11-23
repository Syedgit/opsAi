import type { PrismaClient } from '@prisma/client';
import { decryptSecret, encryptSecret } from '../tokenCrypto';
import { gmailConfigured } from './oauth';
import {
  GMAIL_BUILTIN_RULE_INFO,
  normalizeNewGmailRule,
  parseGmailOwnerRules,
  type GmailBuiltinRuleInfo,
  type GmailOwnerRule,
} from './rules';

export type GmailPublicStatus = {
  configured: boolean;
  connected: boolean;
  email: string | null;
  status: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  storeId: string | null;
  rules: GmailOwnerRule[];
  builtinRules: GmailBuiltinRuleInfo[];
};

export function emptyGmailStatus(configured = gmailConfigured()): GmailPublicStatus {
  return {
    configured,
    connected: false,
    email: null,
    status: null,
    lastSyncAt: null,
    lastError: null,
    storeId: null,
    rules: [],
    builtinRules: GMAIL_BUILTIN_RULE_INFO,
  };
}

export async function getGmailPublicStatus(
  prisma: PrismaClient,
  storeId: string
): Promise<GmailPublicStatus> {
  const configured = gmailConfigured();
  const row = await prisma.gmailConnection.findUnique({ where: { storeId } });
  if (!row || row.status === 'disconnected') {
    return { ...emptyGmailStatus(configured), storeId };
  }
  return {
    configured,
    connected: row.status === 'active' || row.status === 'needs_reconnect',
    email: row.googleEmail,
    status: row.status,
    lastSyncAt: row.lastSyncAt ? row.lastSyncAt.toISOString() : null,
    lastError: row.lastError,
    storeId,
    rules: parseGmailOwnerRules(row.alertRulesJson),
    builtinRules: GMAIL_BUILTIN_RULE_INFO,
  };
}

export async function upsertGmailConnection(
  prisma: PrismaClient,
  input: {
    storeId: string;
    userId: string;
    googleEmail: string;
    refreshToken: string;
    scope: string;
  }
): Promise<void> {
  const refreshTokenEnc = encryptSecret(input.refreshToken);
  await prisma.gmailConnection.upsert({
    where: { storeId: input.storeId },
    create: {
      storeId: input.storeId,
      userId: input.userId,
      googleEmail: input.googleEmail,
      refreshTokenEnc,
      scope: input.scope,
      status: 'active',
      lastError: null,
    },
    update: {
      userId: input.userId,
      googleEmail: input.googleEmail,
      refreshTokenEnc,
      scope: input.scope,
      status: 'active',
      lastError: null,
    },
  });
}

export async function disconnectGmail(prisma: PrismaClient, storeId: string): Promise<boolean> {
  const row = await prisma.gmailConnection.findUnique({ where: { storeId } });
  if (!row) return false;
  await prisma.gmailConnection.update({
    where: { storeId },
    data: {
      status: 'disconnected',
      refreshTokenEnc: encryptSecret(`revoked:${Date.now()}`),
      lastError: null,
    },
  });
  return true;
}

export async function loadActiveGmailRefreshToken(
  prisma: PrismaClient,
  storeId: string
): Promise<{
  email: string;
  refreshToken: string;
  connectionId: string;
  storeId: string;
  userId: string;
  rules: GmailOwnerRule[];
} | null> {
  const row = await prisma.gmailConnection.findUnique({ where: { storeId } });
  if (!row || row.status !== 'active') return null;
  return {
    email: row.googleEmail,
    refreshToken: decryptSecret(row.refreshTokenEnc),
    connectionId: row.id,
    storeId: row.storeId,
    userId: row.userId,
    rules: parseGmailOwnerRules(row.alertRulesJson),
  };
}

export async function addGmailOwnerRule(
  prisma: PrismaClient,
  storeId: string,
  input: { label?: unknown; from?: unknown; contains?: unknown; mode?: unknown; route?: unknown }
): Promise<{ ok: true; gmail: GmailPublicStatus } | { ok: false; error: string; status?: number }> {
  const row = await prisma.gmailConnection.findUnique({ where: { storeId } });
  if (!row || row.status === 'disconnected') {
    return { ok: false, error: 'Connect Gmail first.', status: 400 };
  }
  const parsed = normalizeNewGmailRule(input);
  if (!parsed.ok) return { ok: false, error: parsed.error, status: 400 };
  const rules = parseGmailOwnerRules(row.alertRulesJson);
  if (rules.length >= 20) {
    return { ok: false, error: 'You can have at most 20 Gmail alert rules.', status: 400 };
  }
  rules.push(parsed.rule);
  await prisma.gmailConnection.update({
    where: { storeId },
    data: { alertRulesJson: rules },
  });
  return { ok: true, gmail: await getGmailPublicStatus(prisma, storeId) };
}

export async function removeGmailOwnerRule(
  prisma: PrismaClient,
  storeId: string,
  ruleId: string
): Promise<{ ok: true; gmail: GmailPublicStatus } | { ok: false; error: string; status?: number }> {
  const row = await prisma.gmailConnection.findUnique({ where: { storeId } });
  if (!row || row.status === 'disconnected') {
    return { ok: false, error: 'Connect Gmail first.', status: 400 };
  }
  const id = String(ruleId || '').trim();
  if (!id) return { ok: false, error: 'Rule id required.', status: 400 };
  const rules = parseGmailOwnerRules(row.alertRulesJson).filter((r) => r.id !== id);
  await prisma.gmailConnection.update({
    where: { storeId },
    data: { alertRulesJson: rules },
  });
  return { ok: true, gmail: await getGmailPublicStatus(prisma, storeId) };
}

export async function markGmailNeedsReconnect(
  prisma: PrismaClient,
  storeId: string,
  error: string
): Promise<void> {
  await prisma.gmailConnection.updateMany({
    where: { storeId, status: 'active' },
    data: { status: 'needs_reconnect', lastError: error.slice(0, 500) },
  });
}

export async function touchGmailSync(
  prisma: PrismaClient,
  storeId: string,
  ok: boolean,
  error?: string
): Promise<void> {
  await prisma.gmailConnection.updateMany({
    where: { storeId },
    data: {
      lastSyncAt: new Date(),
      lastError: ok ? null : (error || 'sync failed').slice(0, 500),
    },
  });
}
