import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(_req: VercelRequest, res: VercelResponse): void {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
}

