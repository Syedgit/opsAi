import {
  SESSION_COOKIE,
  cookieShouldBeSecure,
  parseCookies,
  readSessionToken,
  sessionClearCookie,
  sessionSetCookie,
} from '../authCookie';

describe('parseCookies', () => {
  it('reads a session cookie and decodes it', () => {
    expect(parseCookies(`${SESSION_COOKIE}=abc%2Edef; other=1`)).toEqual({
      [SESSION_COOKIE]: 'abc.def',
      other: '1',
    });
  });

  it('returns empty for a missing header', () => {
    expect(parseCookies(undefined)).toEqual({});
  });
});

describe('readSessionToken', () => {
  it('returns the session cookie value', () => {
    expect(readSessionToken({ headers: { cookie: `${SESSION_COOKIE}=session-jwt` } })).toBe('session-jwt');
  });

  it('returns null when the cookie is missing', () => {
    expect(readSessionToken({ headers: {} })).toBeNull();
  });
});

describe('session cookie flags', () => {
  it('is HttpOnly, SameSite=Lax, and not Secure on localhost', () => {
    const value = sessionSetCookie('tok', { headers: {} }, { NODE_ENV: 'test' });
    expect(value).toContain(`${SESSION_COOKIE}=tok`);
    expect(value).toContain('HttpOnly');
    expect(value).toContain('SameSite=Lax');
    expect(value).toContain('Path=/');
    expect(value).not.toMatch(/;\s*Secure(?:;|$)/);
  });

  it('sets Secure in production', () => {
    expect(cookieShouldBeSecure({ headers: {} }, { NODE_ENV: 'production' })).toBe(true);
    expect(sessionSetCookie('tok', { headers: {} }, { NODE_ENV: 'production' })).toMatch(/;\s*Secure$/);
  });

  it('sets Secure when the proxy says https', () => {
    expect(
      cookieShouldBeSecure({ headers: { 'x-forwarded-proto': 'https' } }, { NODE_ENV: 'test' }),
    ).toBe(true);
  });

  it('clears the cookie with Max-Age=0', () => {
    const value = sessionClearCookie({ headers: {} }, { NODE_ENV: 'test' });
    expect(value).toContain(`${SESSION_COOKIE}=`);
    expect(value).toContain('Max-Age=0');
    expect(value).toContain('HttpOnly');
  });
});
