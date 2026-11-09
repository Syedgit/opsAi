import { isPublicAppUrl, pairWhatsAppDashboardLogins, publicAppUrl, verifyWhatsAppLogin, signWhatsAppLogin } from '../whatsappLogin';
import type { StoreTeam } from '../tasks/people';

const team = (over: Partial<StoreTeam> = {}): StoreTeam => ({
  whatsapp: [],
  dashboard: [],
  ...over,
});

describe('pairWhatsAppDashboardLogins', () => {
  it('pairs the only owner on WhatsApp with the only dashboard owner', () => {
    expect(
      pairWhatsAppDashboardLogins(
        team({
          whatsapp: [{ id: 'w1', name: null, phoneE164: '+15551111111', role: 'OWNER' }],
          dashboard: [{ userId: 'u1', email: 'sam@store.com', name: 'Sam', role: 'OWNER' }],
        }),
      ),
    ).toEqual([{ phoneE164: '+15551111111', userId: 'u1', email: 'sam@store.com' }]);
  });

  it('matches two people by name and never sends staff a link', () => {
    const paired = pairWhatsAppDashboardLogins(
      team({
        whatsapp: [
          { id: 'w1', name: 'Sam', phoneE164: '+15551111111', role: 'OWNER' },
          { id: 'w2', name: 'Aftab', phoneE164: '+15552222222', role: 'OWNER' },
          { id: 'w3', name: 'Clerk', phoneE164: '+15553333333', role: 'STAFF' },
        ],
        dashboard: [
          { userId: 'u2', email: 'aftab@store.com', name: 'Aftab', role: 'OWNER' },
          { userId: 'u1', email: 'sam@store.com', name: 'Sam', role: 'OWNER' },
          { userId: 'u3', email: 'clerk@store.com', name: 'Clerk', role: 'STAFF' },
        ],
      }),
    );
    expect(paired).toEqual([
      { phoneE164: '+15551111111', userId: 'u1', email: 'sam@store.com' },
      { phoneE164: '+15552222222', userId: 'u2', email: 'aftab@store.com' },
    ]);
  });

  it('does not guess when two owners cannot be told apart', () => {
    expect(
      pairWhatsAppDashboardLogins(
        team({
          whatsapp: [
            { id: 'w1', name: null, phoneE164: '+15551111111', role: 'OWNER' },
            { id: 'w2', name: null, phoneE164: '+15552222222', role: 'OWNER' },
          ],
          dashboard: [
            { userId: 'u1', email: 'a@store.com', name: null, role: 'OWNER' },
            { userId: 'u2', email: 'b@store.com', name: null, role: 'OWNER' },
          ],
        }),
      ),
    ).toEqual([]);
  });
});

describe('WhatsApp tap-link token', () => {
  it('round-trips and rejects a session token', () => {
    process.env.JWT_SECRET = 'unit-test-secret';
    const token = signWhatsAppLogin({ id: 'u1', email: 'sam@store.com' }, 'S001');
    expect(verifyWhatsAppLogin(token)).toEqual({ userId: 'u1', email: 'sam@store.com', storeId: 'S001' });
    expect(verifyWhatsAppLogin('nope')).toBeNull();
  });
});

describe('publicAppUrl', () => {
  it('uses APP_URL when set', () => {
    const prev = process.env.APP_URL;
    process.env.APP_URL = 'https://ops.example.com/';
    expect(publicAppUrl()).toBe('https://ops.example.com');
    expect(isPublicAppUrl()).toBe(true);
    if (prev === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = prev;
  });

  it('treats localhost as not phone-reachable', () => {
    expect(isPublicAppUrl('http://localhost:3000')).toBe(false);
    expect(isPublicAppUrl('https://ops.example.com')).toBe(true);
  });
});
