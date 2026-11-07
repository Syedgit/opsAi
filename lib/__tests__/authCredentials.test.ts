import {
  DUPLICATE_EMAIL_ERROR,
  authActionFromRequest,
  authActionFromUrl,
  parseLoginInput,
  parseSignupInput,
  readJsonBody,
} from '../authCredentials';

describe('authActionFromUrl', () => {
  it('reads the last path segment so rewrites still match', () => {
    expect(authActionFromUrl('/api/auth/signup')).toBe('signup');
    expect(authActionFromUrl('/api/auth/login?next=/onboarding')).toBe('login');
    expect(authActionFromUrl('/api/auth/me/')).toBe('me');
    expect(authActionFromUrl('/api/auth/index.ts')).toBeNull();
  });
});

describe('authActionFromRequest', () => {
  it('falls back to forwarded headers when dest path replaced the url', () => {
    expect(
      authActionFromRequest({
        url: '/api/auth/index.ts',
        headers: { 'x-forwarded-uri': '/api/auth/signup' },
      }),
    ).toBe('signup');
  });
});

describe('readJsonBody', () => {
  it('parses a JSON string or object', () => {
    expect(readJsonBody('{"email":"a@b.c"}')).toEqual({ email: 'a@b.c' });
    expect(readJsonBody({ email: 'a@b.c' })).toEqual({ email: 'a@b.c' });
    expect(readJsonBody('not-json')).toEqual({});
  });
});

describe('parseSignupInput', () => {
  const valid = {
    name: '  Sam Owner  ',
    email: '  Sam@Store.COM ',
    password: 'secret123',
    passwordConfirm: 'secret123',
  };

  it('trims name and lowercases email', () => {
    expect(parseSignupInput(valid)).toEqual({
      ok: true,
      name: 'Sam Owner',
      email: 'sam@store.com',
      password: 'secret123',
    });
  });

  it('requires a name', () => {
    expect(parseSignupInput({ ...valid, name: '  ' })).toMatchObject({
      ok: false,
      status: 400,
      error: 'Name is required',
    });
  });

  it('rejects a short password', () => {
    expect(parseSignupInput({ ...valid, password: 'short', passwordConfirm: 'short' })).toMatchObject({
      ok: false,
      error: 'Password must be at least 8 characters',
    });
  });

  it('rejects a mismatched confirm password', () => {
    expect(parseSignupInput({ ...valid, passwordConfirm: 'different1' })).toMatchObject({
      ok: false,
      error: 'Passwords do not match',
    });
  });

  it('rejects a malformed email', () => {
    expect(parseSignupInput({ ...valid, email: 'not-an-email' })).toMatchObject({
      ok: false,
      error: 'Enter a valid email address',
    });
  });
});

describe('parseLoginInput', () => {
  it('normalizes email and keeps the password as typed', () => {
    expect(parseLoginInput({ email: 'Sam@Store.COM', password: 'secret123' })).toEqual({
      ok: true,
      email: 'sam@store.com',
      password: 'secret123',
    });
  });

  it('requires both fields', () => {
    expect(parseLoginInput({})).toMatchObject({ ok: false, error: 'Email and password are required' });
  });
});

describe('copy', () => {
  it('tells an existing email to sign in instead of creating another account', () => {
    expect(DUPLICATE_EMAIL_ERROR).toMatch(/Sign in instead/i);
  });
});
