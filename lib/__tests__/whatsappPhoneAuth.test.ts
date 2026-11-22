import { sign } from 'jsonwebtoken';
import {
  isPhoneLoginKeyword,
  phoneAccountEmail,
  signPhoneSignup,
  verifyPhoneSignup,
  whatsappLoginDeepLink,
} from '../whatsappPhoneAuth';

describe('whatsappPhoneAuth', () => {
  const originalSecret = process.env.JWT_SECRET;
  const originalDisplay = process.env.OPS_WHATSAPP_DISPLAY_NUMBER;

  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret-for-phone-auth';
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
    if (originalDisplay === undefined) delete process.env.OPS_WHATSAPP_DISPLAY_NUMBER;
    else process.env.OPS_WHATSAPP_DISPLAY_NUMBER = originalDisplay;
  });

  it('matches login keywords only', () => {
    expect(isPhoneLoginKeyword('Login')).toBe(true);
    expect(isPhoneLoginKeyword('start')).toBe(true);
    expect(isPhoneLoginKeyword('sign in')).toBe(true);
    expect(isPhoneLoginKeyword('hi')).toBe(false);
    expect(isPhoneLoginKeyword('OK')).toBe(false);
    expect(isPhoneLoginKeyword('login please')).toBe(false);
  });

  it('round-trips a phone signup token', () => {
    const token = signPhoneSignup('+15551234567');
    expect(verifyPhoneSignup(token)).toEqual({ phoneE164: '+15551234567' });
    expect(verifyPhoneSignup('nope')).toBeNull();
  });

  it('rejects a wrong token type', () => {
    const token = sign({ typ: 'session', phoneE164: '+15551234567' }, 'test-secret-for-phone-auth', {
      expiresIn: '5m',
    });
    expect(verifyPhoneSignup(token)).toBeNull();
  });

  it('builds a stable phone account email', () => {
    expect(phoneAccountEmail('+1 (555) 123-4567')).toBe('wa.15551234567@phone.opsai.us');
  });

  it('builds a wa.me deep link from the display number', () => {
    process.env.OPS_WHATSAPP_DISPLAY_NUMBER = '+1 (732) 555-0100';
    expect(whatsappLoginDeepLink('Login')).toBe('https://wa.me/17325550100?text=Login');
  });
});
