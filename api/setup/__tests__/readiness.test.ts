import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from '../readiness';

function mockRes(): VercelResponse & { statusCode: number; body: unknown } {
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
  return res as unknown as VercelResponse & { statusCode: number; body: unknown };
}

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  })),
}));

describe('GET /api/setup/readiness', () => {
  it('returns checklist without secrets', async () => {
    const req = { method: 'GET' } as VercelRequest;
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.groupSetupMode).toBe('manual');
    expect(body.storeRouting).toBe('group');
    expect(body.checks).toBeDefined();
    expect(body.database).toBeDefined();
    expect(body.optional).toBeDefined();
    expect(body.metaChecklist).toBeInstanceOf(Array);
    expect(JSON.stringify(body)).not.toMatch(/WHATSAPP_ACCESS_TOKEN/);
  });

  it('rejects non-GET', async () => {
    const req = { method: 'POST' } as VercelRequest;
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(405);
  });
});
