/** Gmail read-only + email identity for the connector consent screen. */
export const GMAIL_READONLY_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
] as const;

export const GMAIL_SCOPE_STRING = GMAIL_READONLY_SCOPES.join(' ');
