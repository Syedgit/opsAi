import { verify } from 'jsonwebtoken';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export interface AuthUser {
  userId: string;
  email: string;
}

/** JWT secret — fails closed in production when unset. */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (secret) return secret;

  const isProd =
    process.env.NODE_ENV === 'production' ||
    process.env.VERCEL_ENV === 'production' ||
    process.env.VERCEL_ENV === 'preview';

  if (isProd) {
    throw new Error('JWT_SECRET must be set in production');
  }

  return 'dev-only-insecure-jwt-secret';
}

export function getAuthUser(req: VercelRequest): AuthUser | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.substring(7);
  try {
    return verify(token, getJwtSecret()) as AuthUser;
  } catch {
    return null;
  }
}

/** Returns authenticated user or sends 401 and returns null. */
export function requireAuthUser(req: VercelRequest, res: VercelResponse): AuthUser | null {
  const user = getAuthUser(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }
  return user;
}

/** Admin routes: require `Authorization: Bearer <ADMIN_API_KEY>`. */
export function requireAdmin(req: VercelRequest, res: VercelResponse): boolean {
  const adminKey = process.env.ADMIN_API_KEY?.trim();
  if (!adminKey) {
    res.status(503).json({ error: 'Admin API is not configured' });
    return false;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ') || authHeader.substring(7) !== adminKey) {
    res.status(401).json({ error: 'Admin authentication required' });
    return false;
  }
  return true;
}
