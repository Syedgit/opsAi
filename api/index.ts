import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(_req: VercelRequest, res: VercelResponse): void {
  res.json({ 
    message: 'opsAi API',
    endpoints: {
      webhook: '/api/webhook/whatsapp',
      health: '/api/health'
    }
  });
}

