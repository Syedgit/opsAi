import { readToolsWanted, withToolsWanted, BUSINESS_TOOLS } from '../notify/tools';
import { withChannelPrefs, readChannelPrefs, taskAlertsEnabled } from '../notify/channels';
import { formatOwnerDigest } from '../notify/digest';
import { verifySlackSignature } from '../notify/slack';
import crypto from 'crypto';

describe('business tools prefs', () => {
  it('defaults WhatsApp on and other tools off', () => {
    expect(readToolsWanted(null)).toEqual({
      whatsapp: true,
      googleSheets: false,
      gmail: false,
      slack: false,
      email: false,
      books: false,
    });
    expect(BUSINESS_TOOLS.map((t) => t.id)).toEqual([
      'whatsapp',
      'googleSheets',
      'gmail',
      'slack',
      'email',
      'books',
    ]);
  });

  it('persists tool picks under profileJson.channels.tools', () => {
    const next = withToolsWanted({}, { googleSheets: true, email: true, slack: true });
    expect(readToolsWanted(next).googleSheets).toBe(true);
    expect(readToolsWanted(next).email).toBe(true);
    expect((next.channels as { emailDigest: { enabled: boolean } }).emailDigest.enabled).toBe(true);
    expect((next.channels as { slack: { enabled: boolean } }).slack.enabled).toBe(true);
  });

  it('keeps tools in sync when channel toggles change', () => {
    const next = withChannelPrefs({}, { emailDigest: { enabled: true }, slack: { enabled: true } });
    const prefs = readChannelPrefs(next);
    expect(prefs.tools.email).toBe(true);
    expect(prefs.tools.slack).toBe(true);
    expect(prefs.emailDigest.enabled).toBe(true);
  });

  it('defaults WhatsApp task alerts on and can pause them', () => {
    expect(taskAlertsEnabled(null)).toBe(true);
    const off = withChannelPrefs({}, { taskAlerts: { enabled: false } });
    expect(taskAlertsEnabled(off)).toBe(false);
    const on = withChannelPrefs(off, { taskAlerts: { enabled: true } });
    expect(taskAlertsEnabled(on)).toBe(true);
  });
});

describe('formatOwnerDigest', () => {
  it('builds standing / missing closes / open invoices text without AI', () => {
    const digest = formatOwnerDigest({
      storeName: 'Rockaway',
      today: '2026-11-17',
      standing: 420.5,
      sales: 1200,
      missingCloses: 1,
      openInvoices: [{ vendor: 'Pepsi', remaining: 84.2, due: '2026-11-10' }],
    });
    expect(digest.subject).toBe('Rockaway: morning brief');
    expect(digest.text).toContain('Standing');
    expect(digest.text).toContain('Missing closes: 1');
    expect(digest.text).toContain('Pepsi');
    expect(digest.html).toContain('Rockaway');
  });
});

describe('verifySlackSignature', () => {
  it('accepts a valid v0 signature', () => {
    const secret = 'sign_secret';
    const timestamp = '1700000000';
    const rawBody = '{"type":"event_callback"}';
    const base = `v0:${timestamp}:${rawBody}`;
    const signature = `v0=${crypto.createHmac('sha256', secret).update(base).digest('hex')}`;
    expect(
      verifySlackSignature({
        signingSecret: secret,
        timestamp,
        signature,
        rawBody,
        nowMs: 1700000000 * 1000,
      })
    ).toEqual({ ok: true });
  });

  it('rejects a bad signature', () => {
    expect(
      verifySlackSignature({
        signingSecret: 'sign_secret',
        timestamp: '1700000000',
        signature: 'v0=deadbeef',
        rawBody: '{}',
        nowMs: 1700000000 * 1000,
      }).ok
    ).toBe(false);
  });
});
