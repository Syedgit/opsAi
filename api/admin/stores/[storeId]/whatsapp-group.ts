import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { requireAdmin } from '../../../utils/auth';

const prisma = new PrismaClient();

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!requireAdmin(req, res)) return;

  const { storeId } = req.query;
  const sid = storeId as string;

  if (req.method === 'GET') {
    try {
      const list = await prisma.storeWhatsAppGroup.findMany({
        where: { storeId: sid, active: true },
        select: { id: true, whatsappGroupId: true, storeId: true, createdAt: true },
      });
      res.json({ success: true, groups: list });
    } catch (e: any) {
      res.status(500).json({ error: 'Failed to list groups', details: e.message });
    }
    return;
  }

  if (req.method === 'POST') {
    try {
      const { whatsappGroupId } = req.body as { whatsappGroupId?: string };
      if (!whatsappGroupId || typeof whatsappGroupId !== 'string') {
        res.status(400).json({ error: 'whatsappGroupId is required' });
        return;
      }
      const trimmed = whatsappGroupId.trim();
      const store = await prisma.storeConfig.findUnique({ where: { storeId: sid } });
      if (!store) {
        res.status(404).json({ error: 'Store not found' });
        return;
      }
      const existing = await prisma.storeWhatsAppGroup.findFirst({
        where: { whatsappGroupId: trimmed, active: true },
      });
      if (existing && existing.storeId !== sid) {
        res.status(400).json({
          error: 'This WhatsApp group is already linked to another store',
          otherStoreId: existing.storeId,
        });
        return;
      }
      const row = await prisma.storeWhatsAppGroup.upsert({
        where: { whatsappGroupId: trimmed },
        create: { whatsappGroupId: trimmed, storeId: sid },
        update: { storeId: sid, active: true },
      });
      res.json({
        success: true,
        mapping: { id: row.id, storeId: row.storeId, whatsappGroupId: row.whatsappGroupId, active: row.active },
      });
    } catch (e: any) {
      res.status(500).json({ error: 'Failed to link WhatsApp group', details: e.message });
    }
    return;
  }

  if (req.method === 'DELETE') {
    try {
      const gid = (req.query.whatsappGroupId as string) || '';
      if (!gid) {
        res.status(400).json({ error: 'Query whatsappGroupId is required' });
        return;
      }
      const row = await prisma.storeWhatsAppGroup.findFirst({
        where: { storeId: sid, whatsappGroupId: gid },
      });
      if (!row) {
        res.status(404).json({ error: 'Mapping not found' });
        return;
      }
      await prisma.storeWhatsAppGroup.update({
        where: { id: row.id },
        data: { active: false },
      });
      res.json({ success: true, message: 'Group mapping deactivated' });
    } catch (e: any) {
      res.status(500).json({ error: 'Failed to unlink group', details: e.message });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
