import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient, PendingStatus } from '@prisma/client';
import { z } from 'zod';
import { requireStoreAccess } from '../../lib/storeAccess';
import { applyAdminEntryEdit } from '../../lib/entryEdit';
import { logApp, logAppError, loggedHandler, serializeError } from '../../lib/requestLog';

const prisma = new PrismaClient();

const BodySchema = z.object({
  storeId: z.string().min(1).max(20),
  actionId: z.string().min(1).max(80),
  patches: z
    .array(
      z.object({
        field: z.string().trim().min(1).max(40),
        value: z.string().trim().max(120),
      })
    )
    .max(20)
    .optional()
    .default([]),
  clearFlags: z.boolean().optional().default(false),
});

/**
 * Owner/manager edit of a confirmed WhatsApp entry (same FIX fields as WhatsApp).
 * Updates pending_actions.payload_json in the DB — no invented numbers.
 */
async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Send storeId, actionId, and patches and/or clearFlags' });
    return;
  }

  const storeId = parsed.data.storeId.toUpperCase();
  const access = await requireStoreAccess(req, res, prisma, storeId, false);
  if (!access) return;
  if (access.role !== 'OWNER' && access.role !== 'MANAGER') {
    res.status(403).json({ error: 'Only owners and managers can edit store data' });
    return;
  }

  const row = await prisma.pendingActions.findFirst({
    where: { actionId: parsed.data.actionId, storeId },
  });
  if (!row) {
    res.status(404).json({ error: 'Entry not found' });
    return;
  }
  if (row.status !== PendingStatus.CONFIRMED) {
    res.status(400).json({ error: 'Only confirmed entries can be edited here. Use WhatsApp FIX before OK for pending ones.' });
    return;
  }

  const payload =
    row.payloadJson && typeof row.payloadJson === 'object' && !Array.isArray(row.payloadJson)
      ? ({ ...(row.payloadJson as Record<string, unknown>) } as Record<string, unknown>)
      : null;
  if (!payload) {
    res.status(400).json({ error: 'This entry has no editable payload' });
    return;
  }

  const edited = applyAdminEntryEdit(payload, parsed.data.patches, {
    clearFlags: parsed.data.clearFlags,
  });
  if (!edited.ok) {
    res.status(400).json({ error: edited.message });
    return;
  }

  try {
    await prisma.pendingActions.update({
      where: { actionId: row.actionId },
      data: { payloadJson: edited.payload as object },
    });
    logApp('entry.edit', {
      storeId,
      actionId: row.actionId,
      role: access.role,
      patches: parsed.data.patches.length,
      clearFlags: parsed.data.clearFlags,
    });
    res.status(200).json({
      success: true,
      item: {
        id: row.actionId,
        date: row.createdAt,
        data: edited.payload,
        confidence: row.confidence,
      },
      clearedFlags: edited.clearedFlags,
    });
  } catch (error) {
    logAppError('entry.edit', serializeError(error));
    res.status(500).json({ error: 'Could not save that edit' });
  }
}

export default loggedHandler('stores.entry', handler);
