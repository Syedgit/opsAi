import { OAuth2Client } from 'google-auth-library';
import { sign, verify } from 'jsonwebtoken';
import { getJwtSecret } from '../apiAuth';
import { publicAppUrl } from '../whatsappLogin';
import { GMAIL_READONLY_SCOPES } from './scopes';

const STATE_TYP = 'gmail_oauth';
const STATE_MINUTES = 20;

export type GmailOAuthState = { userId: string; storeId: string | null };

export function gmailConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim()
  );
}

export function gmailRedirectUri(): string {
  const explicit = process.env.GOOGLE_GMAIL_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  return `${publicAppUrl()}/api/connectors/gmail/callback`;
}

export function gmailOAuthClient(redirectUri = gmailRedirectUri()): OAuth2Client {
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID?.trim(),
    process.env.GOOGLE_CLIENT_SECRET?.trim(),
    redirectUri
  );
}

export function signGmailOAuthState(input: GmailOAuthState): string {
  return sign({ typ: STATE_TYP, userId: input.userId, storeId: input.storeId }, getJwtSecret(), {
    expiresIn: `${STATE_MINUTES}m`,
  });
}

export function verifyGmailOAuthState(token: string): GmailOAuthState | null {
  try {
    const payload = verify(token, getJwtSecret()) as {
      typ?: string;
      userId?: string;
      storeId?: string | null;
    };
    if (payload.typ !== STATE_TYP || !payload.userId) return null;
    return {
      userId: payload.userId,
      storeId: typeof payload.storeId === 'string' && payload.storeId ? payload.storeId : null,
    };
  } catch {
    return null;
  }
}

export function buildGmailAuthUrl(state: string): string {
  const client = gmailOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [...GMAIL_READONLY_SCOPES],
    state,
    include_granted_scopes: true,
  });
}

export async function exchangeGmailCode(code: string): Promise<{
  refreshToken: string;
  accessToken: string | null;
  email: string;
  scope: string;
}> {
  const client = gmailOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      'Google did not return a refresh token. Disconnect opsAi in Google Account permissions and connect again.'
    );
  }
  client.setCredentials(tokens);
  const profile = await client.request<{ email?: string; verified_email?: boolean }>({
    url: 'https://www.googleapis.com/oauth2/v2/userinfo',
  });
  const email = String(profile.data.email || '')
    .trim()
    .toLowerCase();
  if (!email) throw new Error('Google did not return an email for this account');
  return {
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token || null,
    email,
    scope: typeof tokens.scope === 'string' ? tokens.scope : GMAIL_READONLY_SCOPES.join(' '),
  };
}

export async function gmailClientFromRefreshToken(refreshToken: string): Promise<OAuth2Client> {
  const client = gmailOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  await client.getAccessToken();
  return client;
}
