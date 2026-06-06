import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getWhatsAppStoreRoutingMode } from '../../lib/whatsappStoreResolution';
import { requireAdmin } from '../../utils/auth';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!requireAdmin(req, res)) return;

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const mode = getWhatsAppStoreRoutingMode();
  res.json({
    success: true,
    WHATSAPP_STORE_ROUTING: mode,
    description: {
      phone_number: 'Resolve store by business phone number ID only (per-store numbers on WABA).',
      group: 'Resolve store by Meta group_id only (map rows in store_whatsapp_groups).',
      both: 'Try group_id first, then phone number ID.',
    }[mode],
  });
}
