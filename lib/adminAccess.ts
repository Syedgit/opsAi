import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuthUser } from './apiAuth';

export function adminEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.ADMIN_EMAILS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function bearerAdminKey(req: VercelRequest, env: NodeJS.ProcessEnv): boolean {
  const key = env.ADMIN_API_KEY?.trim();
  if (!key) return false;
  const authHeader = req.headers.authorization;
  return typeof authHeader === 'string' && authHeader.startsWith('Bearer ') && authHeader.substring(7) === key;
}

function isProduction(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production';
}

/** Founder cookie, admin API key, or (local only) any signed-in owner. */
export function isAdminRequest(req: VercelRequest, env: NodeJS.ProcessEnv = process.env): boolean {
  if (bearerAdminKey(req, env)) return true;
  const user = getAuthUser(req);
  if (!user) return false;
  const allowed = adminEmails(env);
  if (allowed.length) return allowed.includes(user.email.toLowerCase());
  return !isProduction(env);
}

export function requireCeo(req: VercelRequest, res: VercelResponse): boolean {
  if (isAdminRequest(req)) return true;
  res.status(401).json({ error: 'CEO login required' });
  return false;
}
