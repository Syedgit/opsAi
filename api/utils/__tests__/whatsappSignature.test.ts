import crypto from 'crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyWhatsAppWebhookSignature } from '../whatsappSignature';

function mockRes(): VercelResponse {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as VercelResponse;
}

describe('verifyWhatsAppWebhookSignature', () => {
  const originalSecret = process.env.WHATSAPP_APP_SECRET;

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.WHATSAPP_APP_SECRET;
    else process.env.WHATSAPP_APP_SECRET = originalSecret;
    delete process.env.NODE_ENV;
    delete process.env.VERCEL_ENV;
  });

  it('accepts valid signature', () => {
    process.env.WHATSAPP_APP_SECRET = 'meta-secret';
    const body = { object: 'whatsapp_business_account' };
    const digest = crypto.createHmac('sha256', 'meta-secret').update(JSON.stringify(body)).digest('hex');
    const req = {
      body,
      headers: { 'x-hub-signature-256': `sha256=${digest}` },
    } as unknown as VercelRequest;
    const res = mockRes();
    expect(verifyWhatsAppWebhookSignature(req, res)).toBe(true);
  });

  it('rejects invalid signature', () => {
    process.env.WHATSAPP_APP_SECRET = 'meta-secret';
    const req = {
      body: { test: true },
      headers: { 'x-hub-signature-256': 'sha256=deadbeef' },
    } as unknown as VercelRequest;
    const res = mockRes();
    expect(verifyWhatsAppWebhookSignature(req, res)).toBe(false);
    expect(res.statusCode).toBe(401);
  });
});
