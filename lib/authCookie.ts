/** HttpOnly session cookie. Scripts on the page cannot read this. */

export const SESSION_COOKIE = 'opsai_session';
export const SESSION_MAX_AGE_SEC = 7 * 24 * 60 * 60;

type HeaderBag = Record<string, unknown> | undefined;

function headerValue(headers: HeaderBag, name: string): string | undefined {
  if (!headers) return undefined;
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (typeof value === 'string' && value) return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

export function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const split = part.indexOf('=');
    if (split < 0) continue;
    const key = part.slice(0, split).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(split + 1).trim());
    } catch {
      out[key] = part.slice(split + 1).trim();
    }
  }
  return out;
}

export function readSessionToken(req: { headers?: HeaderBag }): string | null {
  const raw = headerValue(req.headers, 'cookie');
  if (!raw) return null;
  return parseCookies(raw)[SESSION_COOKIE] || null;
}

export function cookieShouldBeSecure(
  req: { headers?: HeaderBag },
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production' || env.VERCEL_ENV === 'preview') {
    return true;
  }
  return headerValue(req.headers, 'x-forwarded-proto') === 'https';
}

export function sessionSetCookie(
  token: string,
  req: { headers?: HeaderBag },
  env: NodeJS.ProcessEnv = process.env,
): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${SESSION_MAX_AGE_SEC}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (cookieShouldBeSecure(req, env)) parts.push('Secure');
  return parts.join('; ');
}

export function sessionClearCookie(
  req: { headers?: HeaderBag },
  env: NodeJS.ProcessEnv = process.env,
): string {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Lax'];
  if (cookieShouldBeSecure(req, env)) parts.push('Secure');
  return parts.join('; ');
}

type CookieRes = {
  setHeader: (name: string, value: string | number | readonly string[]) => unknown;
};

export function setSessionCookie(res: CookieRes, token: string, req: { headers?: HeaderBag }): void {
  res.setHeader('Set-Cookie', sessionSetCookie(token, req));
}

export function clearSessionCookie(res: CookieRes, req: { headers?: HeaderBag }): void {
  res.setHeader('Set-Cookie', sessionClearCookie(req));
}
