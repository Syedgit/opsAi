import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Test and debugging endpoints must never run in production: they are unauthenticated and some
 * of them act with the business WhatsApp credentials. Returns true (after sending 404) when blocked.
 */
export function blockInProduction(
  _req: VercelRequest,
  res: VercelResponse,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production') {
    res.status(404).json({ error: 'Not found' });
    return true;
  }
  return false;
}
