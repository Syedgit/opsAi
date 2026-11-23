import type { PrismaClient } from '@prisma/client';
import { isOwnerRole } from '../understanding/storeProfiles';
import {
  isSendableWhatsAppPhone,
  managerPhonesForStore,
  postToStoreGroups,
  sendWhatsAppMessage,
} from '../whatsappMessaging';
import { logApp, logAppError, serializeError } from '../requestLog';
import {
  loadActiveGmailRefreshToken,
  markGmailNeedsReconnect,
  touchGmailSync,
} from './connection';
import { gmailClientFromRefreshToken } from './oauth';
import { channelsForGmailHits } from './rules';
import { formatGmailHitsDigest, scanGmailForActionItems } from './scan';

/** WhatsApp DMs for this store’s owners (includes owner phone linked from another business). */
async function whatsappTargetsForStore(
  prisma: PrismaClient,
  storeId: string
): Promise<Array<{ phoneE164: string; storeId: string }>> {
  const people = await prisma.userDirectory.findMany({
    where: { storeId, isActive: true },
    select: { phoneE164: true, storeId: true, role: true },
  });
  const out: Array<{ phoneE164: string; storeId: string }> = [];
  for (const person of people) {
    if (!person.storeId || !isOwnerRole(person.role)) continue;
    if (!isSendableWhatsAppPhone(person.phoneE164)) continue;
    out.push({ phoneE164: person.phoneE164, storeId: person.storeId });
  }
  if (out.length === 0) {
    for (const phone of await managerPhonesForStore(prisma, storeId)) {
      out.push({ phoneE164: phone, storeId });
    }
  }
  const seen = new Set<string>();
  return out.filter((row) => {
    if (seen.has(row.phoneE164)) return false;
    seen.add(row.phoneE164);
    return true;
  });
}

export type GmailDigestRunResult = {
  stores: number;
  scanned: number;
  withHits: number;
  sent: number;
  errors: number;
};

/** Scan each store’s connected inbox; WhatsApp DM and/or group per rule route. */
export async function runGmailActionDigests(
  prisma: PrismaClient,
  now = new Date()
): Promise<GmailDigestRunResult> {
  const rows = await prisma.gmailConnection.findMany({
    where: { status: 'active' },
    select: { storeId: true, googleEmail: true, lastSyncAt: true },
    take: 200,
  });

  const result: GmailDigestRunResult = {
    stores: rows.length,
    scanned: 0,
    withHits: 0,
    sent: 0,
    errors: 0,
  };

  for (const row of rows) {
    try {
      const creds = await loadActiveGmailRefreshToken(prisma, row.storeId);
      if (!creds) continue;
      const afterMs = row.lastSyncAt
        ? Math.max(row.lastSyncAt.getTime() - 60 * 60 * 1000, now.getTime() - 48 * 60 * 60 * 1000)
        : now.getTime() - 36 * 60 * 60 * 1000;

      const auth = await gmailClientFromRefreshToken(creds.refreshToken);
      const hits = await scanGmailForActionItems(auth, {
        afterMs,
        maxMessages: 40,
        ownerRules: creds.rules,
      });
      result.scanned += 1;
      await touchGmailSync(prisma, row.storeId, true);

      if (hits.length === 0) continue;
      result.withHits += 1;

      const text = formatGmailHitsDigest(creds.email, hits);
      const channels = channelsForGmailHits(
        hits.map((h) => h.reason),
        creds.rules
      );
      let sentHere = 0;
      let groupPosted = 0;

      if (channels.group) {
        groupPosted = await postToStoreGroups(prisma, row.storeId, text);
        sentHere += groupPosted;
      }

      const needDm = channels.dm || (channels.group && groupPosted === 0);
      if (needDm) {
        const targets = await whatsappTargetsForStore(prisma, row.storeId);
        if (targets.length === 0 && groupPosted === 0) {
          logApp('gmail.digest', { storeId: row.storeId, ok: false, reason: 'no_whatsapp_target' });
          continue;
        }
        for (const target of targets) {
          const ok = await sendWhatsAppMessage(prisma, target.phoneE164, text, target.storeId);
          if (ok) sentHere += 1;
        }
      }

      result.sent += sentHere;
      logApp('gmail.digest', {
        storeId: row.storeId,
        ok: sentHere > 0,
        hits: hits.length,
        dm: needDm,
        groupPosted,
        sent: sentHere,
      });
    } catch (error) {
      result.errors += 1;
      const message = error instanceof Error ? error.message : 'Gmail sync failed';
      logAppError('gmail.digest', { storeId: row.storeId, ...serializeError(error) });
      if (/invalid_grant|invalid credentials|unauthorized/i.test(message)) {
        await markGmailNeedsReconnect(prisma, row.storeId, message);
      } else {
        await touchGmailSync(prisma, row.storeId, false, message);
      }
    }
  }

  return result;
}
