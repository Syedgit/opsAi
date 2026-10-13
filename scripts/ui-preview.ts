/**
 * Local UI preview. Serves the real pages in public/ and answers the dashboard's API calls with
 * sample data built by the real understanding code. No database, no WhatsApp, no OpenAI.
 *
 *   npm run preview        then open http://localhost:3100/dashboard?token=preview
 *
 * Stores: S001 Rockaway and S002 Denville (one owner). Oct 12 comes from the real owner message;
 * the earlier days are invented demo numbers so the tables and charts have something to show.
 */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { dailyClosePayload, invoicePayload, planUnderstanding } from '../lib/understanding/plan';
import { buildDefaultProfile } from '../lib/understanding/profile';
import type { Understanding } from '../lib/understanding/schema';

delete process.env.DATABASE_URL;
delete process.env.DIRECT_URL;
delete process.env.WHATSAPP_ACCESS_TOKEN;
delete process.env.OPENAI_API_KEY;

const PORT = Number(process.env.PREVIEW_PORT ?? 3100);
const PUBLIC = path.join(__dirname, '..', 'public');

/* ------------------------------- sample data ------------------------------- */

interface Item {
  id: string;
  date: string;
  storeId: string;
  type: 'sales' | 'invoices';
  data: Record<string, unknown>;
  confidence: number;
}

const stores = [
  { storeId: 'S001', storeName: 'Rockaway', timezone: 'America/New_York', active: true, role: 'OWNER' },
  { storeId: 'S002', storeName: 'Denville', timezone: 'America/New_York', active: true, role: 'OWNER' },
];
const profiles = stores.map((s) => buildDefaultProfile({ storeId: s.storeId, storeName: s.storeName }));
const ctx = { profiles, primaryStoreId: 'S001', now: new Date('2026-10-13T08:00:00Z'), multiStoreSender: true, canTeachRules: true };

const items: Item[] = [];
let seq = 0;

function addDailyClose(storeHint: string, date: string, v: { card: number; cash: number; gas: number; payout?: number; deposit: number }): void {
  const understanding: Understanding = {
    kind: 'daily_close',
    confidence: 0.92,
    needsReview: [],
    reports: [
      {
        storeHint,
        reportDate: date,
        cardSales: v.card,
        cashSales: v.cash,
        fuelSales: v.gas,
        payouts: v.payout ? [{ label: 'Lays', amount: v.payout }] : [],
        reportedDeposit: v.deposit,
      },
    ],
  };
  const entry = planUnderstanding(understanding, ctx).entries[0];
  items.push({
    id: `p${++seq}`,
    date: `${date}T20:00:00-04:00`,
    storeId: entry.storeId,
    type: 'sales',
    data: entry.payload,
    confidence: entry.confidence,
  });
}

// Oct 12: the real message.
addDailyClose('Rockaway', '2026-10-12', { card: 334, cash: 106, gas: 1355, payout: 142, deposit: 1653 });
addDailyClose('Denville', '2026-10-12', { card: 23, cash: 3, gas: 872, deposit: 875 });

// Earlier days: invented demo numbers.
const demo: Array<[string, number, number, number, number]> = [
  ['2026-10-11', 410, 122, 1290, 120],
  ['2026-10-10', 381, 98, 1410, 0],
  ['2026-10-09', 356, 131, 1188, 95],
  ['2026-10-08', 402, 117, 1340, 0],
  ['2026-10-07', 339, 104, 1275, 142],
];
for (const [date, card, cash, gas, payout] of demo) {
  addDailyClose('Rockaway', date, { card, cash, gas, payout: payout || undefined, deposit: card + cash + gas - payout });
  addDailyClose('Denville', date, { card: Math.round(card / 12), cash: Math.round(cash / 20), gas: Math.round(gas * 0.62), deposit: Math.round(cash / 20) + Math.round(gas * 0.62) });
}

// The real handwritten invoice.
{
  const lines = [1, 2, 3].map(() => ({ description: 'Lays mix', quantity: 24, unitPrice: 1.89, amount: 45.36 }));
  const understanding: Understanding = {
    kind: 'invoice',
    confidence: 0.8,
    needsReview: [],
    invoice: {
      vendorName: 'Empire Snacks LLC',
      invoiceNumber: null,
      invoiceDate: '2026-10-12',
      storeHint: 'Rockaway',
      lineItems: lines,
      total: 136.08,
      paymentStatus: 'paid_cash',
    },
  };
  const entry = planUnderstanding(understanding, ctx).entries[0];
  items.push({ id: `p${++seq}`, date: '2026-10-12T14:00:00-04:00', storeId: entry.storeId, type: 'invoices', data: { ...entry.payload, paid: 'Y', category: 'Snacks' }, confidence: entry.confidence });
}
// Keep imports used (also handy for readers): payload builders are what the pipeline stores.
void dailyClosePayload;
void invoicePayload;

const forStore = (storeId: string, type: string) =>
  items.filter((i) => i.storeId === storeId && i.type === type).sort((a, b) => b.date.localeCompare(a.date));

const shaped = (list: Item[]) => list.map((i) => ({ id: i.id, date: i.date, data: i.data, confidence: i.confidence }));

/* ---------------------------------- server ---------------------------------- */

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};
const PAGES: Record<string, string> = { '/dashboard': 'dashboard.html', '/login': 'login.html', '/signup': 'signup.html', '/onboarding': 'onboarding.html', '/': 'dashboard.html' };

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  const p = url.pathname;
  const storeId = url.searchParams.get('storeId') ?? 'S001';
  const type = url.searchParams.get('type') ?? 'sales';

  if (p === '/api/stores') return sendJson(res, 200, { stores }), true;

  if (p === '/api/stores/dashboard') {
    const count = (t: string) => forStore(storeId, t).length;
    return (
      sendJson(res, 200, {
        storeId,
        today: { sales: 1, invoices: storeId === 'S001' ? 1 : 0, orders: 0 },
        month: { sales: count('sales'), invoices: count('invoices') },
        pending: 0,
      }),
      true
    );
  }

  if (p === '/api/stores/data') {
    const list = type === 'sales' || type === 'invoices' ? forStore(storeId, type) : [];
    return sendJson(res, 200, { [type]: shaped(list) }), true;
  }

  if (p === '/api/stores/detail') {
    const id = url.searchParams.get('id');
    const item = items.find((i) => i.id === id && i.storeId === storeId);
    return item ? (sendJson(res, 200, { item: shaped([item])[0] }), true) : (sendJson(res, 404, { error: 'Item not found' }), true);
  }

  if (p === '/api/onboarding/status') {
    return (
      sendJson(res, 200, {
        success: true,
        needsOnboarding: false,
        storeId: 'S001',
        role: 'OWNER',
        groupSetupMode: 'manual',
        opsWhatsAppDisplayNumber: '+1 (555) 010-0100',
      }),
      true
    );
  }

  if (p === '/api/onboarding/complete-store' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)) || '{}') as { storeName?: string; ownerPhoneE164?: string };
    if (!body.storeName) return sendJson(res, 400, { error: 'storeName is required' }), true;
    return sendJson(res, 201, { success: true, storeId: 'S003', message: 'Store created (preview only; nothing was saved).', opsWhatsAppDisplayNumber: '+1 (555) 010-0100' }), true;
  }

  if (p.startsWith('/api/')) return sendJson(res, 404, { error: 'Not available in preview' }), true;
  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    if (await api(req, res, url)) return;

    const file = PAGES[url.pathname] ?? url.pathname.replace(/^\//, '');
    const full = path.normalize(path.join(PUBLIC, file));
    if (!full.startsWith(PUBLIC) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] ?? 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : 'error' });
  }
});

server.listen(PORT, () => {
  console.log(`UI preview running (sample data, no database): http://localhost:${PORT}/dashboard?token=preview`);
  console.log(`Add-another-store screen:                      http://localhost:${PORT}/onboarding?add=1`);
});
