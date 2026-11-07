/**
 * Local owner app against the real database and Vercel API handlers.
 * Signup, onboarding, and dashboard persist. Reports stay empty until WhatsApp messages are confirmed.
 *
 *   npx ts-node -T scripts/local-app.ts
 *   then open http://localhost:3000/signup
 */
import dotenv from 'dotenv';
dotenv.config();

import { readFileSync } from 'fs';
import { join } from 'path';
import express, { type Request, type Response } from 'express';
import { PrismaClient } from '@prisma/client';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuthUser } from '../lib/apiAuth';
import { getGroupSetupMode, isGroupAutoProvisionEnabled } from '../lib/whatsappGroupConfig';
import authHandler from '../api/auth/index';
import onboardingHandler from '../api/onboarding/index';
import storesHandler from '../api/stores/index';
import storesDataHandler from '../api/stores/data';
import storesSummaryHandler from '../api/stores/summary';
import storesTasksHandler from '../api/stores/tasks';
import storesLinkHandler from '../api/stores/[storeId]/link';

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC = join(__dirname, '..', 'public');
const prisma = new PrismaClient();

type VercelHandler = (req: VercelRequest, res: VercelResponse) => void | Promise<void>;

function wrap(handler: VercelHandler, extraQuery?: (req: Request) => Record<string, string>): (req: Request, res: Response) => Promise<void> {
  return async (req, res) => {
    const vReq = req as unknown as VercelRequest;
    Object.defineProperty(vReq, 'url', { value: req.originalUrl, configurable: true });
    if (extraQuery) {
      vReq.query = { ...(vReq.query as Record<string, string>), ...extraQuery(req) };
    }
    await handler(vReq, res as unknown as VercelResponse);
  };
}

function sendPage(name: string) {
  return (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(readFileSync(join(PUBLIC, name), 'utf8'));
  };
}

async function whatsappProvision(req: Request, res: Response): Promise<void> {
  const storeId = (req.params.storeId || '').toUpperCase();
  const authUser = getAuthUser(req as unknown as VercelRequest);
  if (!authUser) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const member = await prisma.userStore.findFirst({
    where: { userId: authUser.userId, storeId },
  });
  if (!member) {
    res.status(403).json({ error: 'Not a member of this store' });
    return;
  }
  const provision = await prisma.whatsAppGroupProvision.findFirst({
    where: { storeId },
    orderBy: { updatedAt: 'desc' },
  });
  const groups = await prisma.storeWhatsAppGroup.findMany({
    where: { storeId, active: true },
    select: { id: true, whatsappGroupId: true, createdAt: true },
  });
  res.json({
    success: true,
    groupSetupMode: getGroupSetupMode(),
    autoProvisionEnabled: isGroupAutoProvisionEnabled(),
    provision: provision
      ? {
          id: provision.id,
          status: provision.status,
          subject: provision.subject,
          description: provision.description,
          metaRequestId: provision.metaRequestId,
          whatsappGroupId: provision.whatsappGroupId,
          inviteLink: provision.inviteLink,
          lastError: provision.lastError,
          updatedAt: provision.updatedAt,
        }
      : null,
    activeGroups: groups,
  });
}

const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC));

app.get('/', (_req, res) => res.redirect('/signup'));
app.get('/signup', sendPage('signup.html'));
app.get('/login', sendPage('login.html'));
app.get('/onboarding', sendPage('onboarding.html'));
app.get('/dashboard', sendPage('dashboard.html'));
app.get('/tasks', sendPage('tasks.html'));

app.all('/api/auth/signup', wrap(authHandler));
app.all('/api/auth/login', wrap(authHandler));
app.all('/api/auth/me', wrap(authHandler));
app.all('/api/onboarding/status', wrap(onboardingHandler));
app.all('/api/onboarding/complete-store', wrap(onboardingHandler));
app.all('/api/stores/tasks', wrap(storesTasksHandler));
app.all('/api/stores/dashboard', wrap(storesHandler));
app.all('/api/stores/data', wrap(storesDataHandler));
app.all('/api/stores/detail', wrap(storesHandler));
app.all('/api/stores/summary', wrap(storesSummaryHandler));
app.all('/api/stores', wrap(storesHandler));
app.all('/api/stores/:storeId/link', wrap(storesLinkHandler, (req) => ({ storeId: String(req.params.storeId) })));
app.get('/api/stores/:storeId/whatsapp-group-provision', (req, res, next) => {
  whatsappProvision(req, res).catch(next);
});

app.listen(PORT, () => {
  console.log(`Local owner app (real database): http://localhost:${PORT}/signup`);
  console.log(`Onboarding:                      http://localhost:${PORT}/onboarding`);
  console.log(`Dashboard reports:               http://localhost:${PORT}/dashboard`);
  console.log(`Tasks & alerts:                  http://localhost:${PORT}/tasks`);
});
