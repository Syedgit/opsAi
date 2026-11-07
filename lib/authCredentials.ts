/** Email/password signup and login — shared by the auth API and the local preview. */

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;
export const MAX_NAME_LENGTH = 80;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type AuthAction = 'login' | 'signup' | 'me';

export type CredentialError = { ok: false; error: string; status: number };

export type SignupInput = { ok: true; email: string; password: string; name: string };
export type LoginInput = { ok: true; email: string; password: string };

function headerValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value) return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

/** Which auth route this request is for. Rewrites may replace req.url with the destination file. */
export function authActionFromRequest(req: {
  url?: string;
  headers?: Record<string, unknown>;
}): AuthAction | null {
  const headers = req.headers ?? {};
  const candidates = [
    headerValue(headers['x-forwarded-uri']),
    headerValue(headers['x-invoke-path']),
    headerValue(headers['x-matched-path']),
    req.url,
  ];
  for (const candidate of candidates) {
    const action = authActionFromUrl(candidate);
    if (action) return action;
  }
  return null;
}

export function authActionFromUrl(url?: string): AuthAction | null {
  const path = (url || '').split('?')[0].replace(/\/+$/, '');
  if (path.endsWith('/signup')) return 'signup';
  if (path.endsWith('/login')) return 'login';
  if (path.endsWith('/me')) return 'me';
  return null;
}

export function readJsonBody(body: unknown): Record<string, unknown> {
  if (!body) return {};
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  if (typeof body === 'object' && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }
  return {};
}

function parseEmail(raw: unknown): string | CredentialError {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, error: 'Email and password are required', status: 400 };
  }
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    return { ok: false, error: 'Enter a valid email address', status: 400 };
  }
  return email;
}

function parseNewPassword(raw: unknown): string | CredentialError {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, error: 'Email and password are required', status: 400 };
  }
  if (raw.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: 'Password must be at least 8 characters', status: 400 };
  }
  if (raw.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, error: 'Password is too long', status: 400 };
  }
  return raw;
}

export function parseSignupInput(body: Record<string, unknown>): SignupInput | CredentialError {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return { ok: false, error: 'Name is required', status: 400 };
  }
  if (name.length > MAX_NAME_LENGTH) {
    return { ok: false, error: 'Name is too long', status: 400 };
  }

  const email = parseEmail(body.email);
  if (typeof email !== 'string') return email;

  const password = parseNewPassword(body.password);
  if (typeof password !== 'string') return password;

  const confirm = body.passwordConfirm ?? body.confirmPassword;
  if (typeof confirm === 'string' && confirm !== password) {
    return { ok: false, error: 'Passwords do not match', status: 400 };
  }

  return { ok: true, email, password, name };
}

export function parseLoginInput(body: Record<string, unknown>): LoginInput | CredentialError {
  const email = parseEmail(body.email);
  if (typeof email !== 'string') return email;
  if (typeof body.password !== 'string' || body.password.length === 0) {
    return { ok: false, error: 'Email and password are required', status: 400 };
  }
  return { ok: true, email, password: body.password };
}

export const DUPLICATE_EMAIL_ERROR = 'An account with this email already exists. Sign in instead.';
export const NO_PASSWORD_ERROR = 'This account has no password set. Create a new account with email and password.';
export const INVALID_LOGIN_ERROR = 'Invalid email or password';
