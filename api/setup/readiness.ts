import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { getGroupSetupMode } from '../../lib/whatsappGroupConfig';
import { getWhatsAppStoreRoutingMode } from '../../lib/whatsappStoreResolution';

const prisma = new PrismaClient();

/**
 * GET /api/setup/readiness — deployment checklist (no secrets exposed).
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const isProd =
    process.env.NODE_ENV === 'production' ||
    process.env.VERCEL_ENV === 'production';

  const checks = {
    jwtSecret: Boolean(process.env.JWT_SECRET?.trim()),
    databaseUrl: Boolean(process.env.DATABASE_URL?.trim()),
    whatsappPhoneNumberId: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()),
    whatsappAccessToken: Boolean(process.env.WHATSAPP_ACCESS_TOKEN?.trim()),
    webhookVerifyToken: Boolean(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim()),
    whatsappAppSecret: Boolean(process.env.WHATSAPP_APP_SECRET?.trim()),
    adminApiKey: Boolean(process.env.ADMIN_API_KEY?.trim()),
    storeLinkInviteCode: Boolean(process.env.STORE_LINK_INVITE_CODE?.trim()),
    opsDisplayNumber: Boolean(process.env.OPS_WHATSAPP_DISPLAY_NUMBER?.trim()),
  };

  const requiredForProd = [
    'jwtSecret',
    'databaseUrl',
    'whatsappPhoneNumberId',
    'whatsappAccessToken',
    'webhookVerifyToken',
    'whatsappAppSecret',
    'adminApiKey',
    'storeLinkInviteCode',
  ] as const;

  const missing = requiredForProd.filter((k) => !checks[k]);

  let database: { connected: boolean; error?: string } = { connected: false };
  if (checks.databaseUrl) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      database = { connected: true };
    } catch (e: unknown) {
      database = {
        connected: false,
        error: e instanceof Error ? e.message : 'Database connection failed',
      };
    }
  } else {
    database = { connected: false, error: 'DATABASE_URL not set' };
  }

  const optional = {
    openaiApiKey: Boolean(process.env.OPENAI_API_KEY?.trim()),
    googleOAuth: Boolean(
      process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim()
    ),
    googleSheets: Boolean(
      process.env.GOOGLE_SHEETS_CLIENT_EMAIL?.trim() &&
        process.env.GOOGLE_SHEETS_PRIVATE_KEY?.trim()
    ),
    redisUrl: Boolean(process.env.REDIS_URL?.trim()),
    awsS3: Boolean(
      process.env.AWS_S3_BUCKET_NAME?.trim() && process.env.AWS_ACCESS_KEY_ID?.trim()
    ),
  };

  res.json({
    success: true,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
    groupSetupMode: getGroupSetupMode(),
    storeRouting: getWhatsAppStoreRoutingMode(),
    checks,
    database,
    optional,
    stackNotes: {
      redis: 'Not required on Vercel — messages process inline. Redis only for local Express + BullMQ worker.',
      openai: 'Optional for core WhatsApp flow (rule-based). Needed for dashboard AI Summary page.',
      googleSheets: 'Optional — OK command saves to DB; Sheets write only when credentials are set.',
      awsS3: 'Optional — receipt image storage not in simplified production pipeline yet.',
    },
    readyForProduction:
      (!isProd || missing.length === 0) && database.connected,
    missingIfProduction: isProd ? missing : [],
    metaChecklist: [
      'WhatsApp number registered on WABA (Cloud API)',
      'Webhook URL points to /api/webhook/whatsapp',
      'Webhook verify token matches WHATSAPP_WEBHOOK_VERIFY_TOKEN',
      'Subscribed to messages field',
      'Path A: owner creates group, adds opsAi number, messages from registered phone',
      'Phase 2 only: Groups API + group_lifecycle_update + WHATSAPP_GROUP_AUTO_PROVISION=true',
    ],
  });
}
