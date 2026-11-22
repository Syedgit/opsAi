import {
  gmailConfigured,
  gmailRedirectUri,
  signGmailOAuthState,
  verifyGmailOAuthState,
} from '../oauth';
import { matchGmailActionReason, formatGmailHitsDigest } from '../scan';
import { encryptSecret, decryptSecret } from '../../tokenCrypto';
import { GMAIL_READONLY_SCOPES } from '../scopes';

describe('gmail oauth helpers', () => {
  const original = {
    JWT_SECRET: process.env.JWT_SECRET,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_GMAIL_REDIRECT_URI: process.env.GOOGLE_GMAIL_REDIRECT_URI,
    APP_URL: process.env.APP_URL,
    TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY,
  };

  beforeAll(() => {
    process.env.JWT_SECRET = 'gmail-oauth-test-secret';
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
    process.env.APP_URL = 'https://app.example.com';
    delete process.env.GOOGLE_GMAIL_REDIRECT_URI;
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('reports configured when client id and secret exist', () => {
    expect(gmailConfigured()).toBe(true);
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(gmailConfigured()).toBe(false);
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
  });

  it('defaults redirect URI to APP_URL callback', () => {
    expect(gmailRedirectUri()).toBe('https://app.example.com/api/connectors/gmail/callback');
    process.env.GOOGLE_GMAIL_REDIRECT_URI = 'https://custom.example/cb';
    expect(gmailRedirectUri()).toBe('https://custom.example/cb');
    delete process.env.GOOGLE_GMAIL_REDIRECT_URI;
  });

  it('round-trips signed oauth state', () => {
    const token = signGmailOAuthState({ userId: 'user-1', storeId: 'S001' });
    expect(verifyGmailOAuthState(token)).toEqual({ userId: 'user-1', storeId: 'S001' });
    expect(verifyGmailOAuthState('not-a-jwt')).toBeNull();
  });

  it('exposes readonly gmail scopes plus email identity', () => {
    expect(GMAIL_READONLY_SCOPES).toContain('https://www.googleapis.com/auth/gmail.readonly');
    expect(GMAIL_READONLY_SCOPES).toContain('https://www.googleapis.com/auth/userinfo.email');
    expect(GMAIL_READONLY_SCOPES.join(' ')).not.toMatch(/gmail\.(modify|compose|insert|send)/);
  });
});

describe('gmail action rules', () => {
  it('matches past-due and action-required subjects', () => {
    expect(matchGmailActionReason('Invoice past due', '')).toBe('past_due');
    expect(matchGmailActionReason('Action required', 'please review')).toBe('action_required');
    expect(matchGmailActionReason('Weekly newsletter', 'hello')).toBeNull();
  });

  it('matches upcoming service appointment emails', () => {
    expect(
      matchGmailActionReason(
        'Upcoming Service Appointment on Monday, Nov 23rd between 2:00pm-4:00pm',
        'Upcoming service appointment with Action Termite & Pest Control'
      )
    ).toBe('service_appointment');
  });

  it('formats a short WhatsApp digest', () => {
    const text = formatGmailHitsDigest('owner@example.com', [
      {
        id: '1',
        threadId: 't1',
        from: 'Acme Billing <billing@vendor.com>',
        subject: 'Payment due',
        snippet: 'Your balance is past due.',
        date: null,
        reason: 'Pest visit',
      },
    ]);
    expect(text).toContain('Gmail alert · 1 new');
    expect(text).toContain('• Pest visit — Payment due');
    expect(text).toContain('Acme Billing');
    expect(text).toContain('Inbox: owner@example.com');
    expect(text).not.toContain('past due');
    expect(text).not.toContain('Read-only scan');
  });
});

describe('tokenCrypto', () => {
  const originalSecret = process.env.JWT_SECRET;
  const originalKey = process.env.TOKEN_ENCRYPTION_KEY;

  beforeAll(() => {
    process.env.JWT_SECRET = 'token-crypto-test-secret';
    delete process.env.TOKEN_ENCRYPTION_KEY;
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
    if (originalKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = originalKey;
  });

  it('encrypts and decrypts connector secrets', () => {
    const cipher = encryptSecret('refresh-token-abc');
    expect(cipher).not.toContain('refresh-token-abc');
    expect(decryptSecret(cipher)).toBe('refresh-token-abc');
  });
});
