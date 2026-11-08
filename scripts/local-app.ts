/**
 * Local owner app against the real database and Vercel API handlers.
 * Signup, onboarding, and dashboard persist. WhatsApp hits /api/webhook/whatsapp
 * when Meta (or a tunnel) points at this process.
 *
 *   npx ts-node -T scripts/local-app.ts
 *   then open http://localhost:3000/signup
 */
import dotenv from 'dotenv';
dotenv.config();

import { readFileSync } from 'fs';
import { join } from 'path';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import authHandler from '../api/auth/index';
import onboardingHandler from '../api/onboarding/index';
import storesHandler from '../api/stores/index';
import storesDataHandler from '../api/stores/data';
import storesSummaryHandler from '../api/stores/summary';
import storesTasksHandler from '../api/stores/tasks';
import storesLinkHandler from '../api/stores/[storeId]/link';
import webhookHandler from '../api/webhook/whatsapp';
import billingHandler from '../api/billing/index';
import stripeWebhookHandler from '../api/webhook/stripe';

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC = join(__dirname, '..', 'public');

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

const app = express();
const jsonParser = express.json({ limit: '4mb' });
const formParser = express.urlencoded({ extended: true });
app.use((req: Request, res: Response, next: NextFunction) => {
  // Meta signs the raw body; do not parse JSON on the webhook path.
  if (req.path === '/api/webhook/whatsapp' || req.path === '/api/webhook/stripe') {
    next();
    return;
  }
  jsonParser(req, res, (err) => {
    if (err) {
      next(err);
      return;
    }
    formParser(req, res, next);
  });
});
app.use(express.static(PUBLIC));

app.get('/', (_req, res) => res.redirect('/signup'));
app.get('/signup', sendPage('signup.html'));
app.get('/login', sendPage('login.html'));
app.get('/onboarding', sendPage('onboarding.html'));
app.get('/dashboard', sendPage('dashboard.html'));
app.get('/tasks', sendPage('tasks.html'));
app.get('/pricing', sendPage('pricing.html'));
app.get('/billing', sendPage('billing.html'));

app.all('/api/auth/signup', wrap(authHandler));
app.all('/api/auth/login', wrap(authHandler));
app.all('/api/auth/me', wrap(authHandler));
app.all('/api/billing', wrap(billingHandler));
app.all('/api/onboarding/status', wrap(onboardingHandler));
app.all('/api/onboarding/complete-store', wrap(onboardingHandler));
app.all('/api/stores/tasks', wrap(storesTasksHandler));
app.all('/api/stores/dashboard', wrap(storesHandler));
app.all('/api/stores/data', wrap(storesDataHandler));
app.all('/api/stores/detail', wrap(storesHandler));
app.all('/api/stores/summary', wrap(storesSummaryHandler));
app.all('/api/stores', wrap(storesHandler));
app.all('/api/stores/:storeId/link', wrap(storesLinkHandler, (req) => ({ storeId: String(req.params.storeId) })));
app.all('/api/stores/:storeId/whatsapp-group-provision', wrap(storesHandler, (req) => ({ storeId: String(req.params.storeId) })));
app.all('/api/webhook/whatsapp', wrap(webhookHandler));
app.all('/api/webhook/stripe', wrap(stripeWebhookHandler));

app.listen(PORT, () => {
  console.log(`Local owner app (real database): http://localhost:${PORT}/signup`);
  console.log(`Onboarding:                      http://localhost:${PORT}/onboarding`);
  console.log(`Dashboard reports:               http://localhost:${PORT}/dashboard`);
  console.log(`Tasks & alerts:                  http://localhost:${PORT}/tasks`);
  console.log(`WhatsApp webhook:                http://localhost:${PORT}/api/webhook/whatsapp`);
  console.log(`Stripe webhook:                  http://localhost:${PORT}/api/webhook/stripe`);
});
