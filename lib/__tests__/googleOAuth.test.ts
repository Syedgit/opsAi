import { googleOAuthStep } from '../googleOAuth';

describe('googleOAuthStep', () => {
  it('treats /initiate as the start of Google sign-in', () => {
    expect(googleOAuthStep('/api/auth/google/initiate')).toBe('initiate');
    expect(googleOAuthStep('/api/auth/google/initiate?x=1')).toBe('initiate');
  });

  it('treats the callback (and anything else) as the return from Google', () => {
    expect(googleOAuthStep('/api/auth/google/callback')).toBe('callback');
    expect(googleOAuthStep('/api/auth/google/callback?code=abc')).toBe('callback');
    expect(googleOAuthStep('/api/auth/google')).toBe('callback');
  });
});
