/**
 * Local UI preview. Serves the real pages in public/ and answers the dashboard's API calls with
 * sample data built by the real understanding code. No database, no WhatsApp, no OpenAI.
 *
 *   npm run preview        then open http://localhost:3100/dashboard?token=preview
 *
 * The Tasks page (/tasks) shows sample tasks for today; its buttons change this sample only, nothing is saved.
 * Stores: S001 Rockaway and S002 Denville (one owner). Oct 12 comes from the real owner message;
 * the earlier days are invented demo numbers so the tables and charts have something to show.
 */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { dailyClosePayload, invoicePayload, planUnderstanding } from '../lib/understanding/plan';
import { buildDefaultProfile } from '../lib/understanding/profile';
import type { Understanding } from '../lib/understanding/schema';
import { describeSchedule } from '../lib/tasks/schedule';
import { STORE_FEATURE_LABEL, TASK_PRESETS, bucketFor, inspectionApplies, presetIsOnStore, presetsForStore } from '../lib/tasks/presets';
import { scoreRuns } from '../lib/tasks/score';
import { predictInspection } from '../lib/tasks/inspection';
import { StoreSetupSchema, storeTypeOptions, suggestTasks, type StoreSetup } from '../lib/tasks/storeSetup';
import { parseLoginInput, parseSignupInput, readJsonBody } from '../lib/authCredentials';

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


/* ------------------------------- sample tasks ------------------------------- */

const MIN = 60 * 1000;
const taskNow = Date.now();
const ago = (minutes: number) => new Date(taskNow - minutes * MIN);
const dayKey = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

const sampleIds = ['fs6-milk-labels', 'own-fire-safety', 'own-cooler-deep-clean'];
const samplePresets = [...TASK_PRESETS.slice(0, 7), ...TASK_PRESETS.filter((p) => sampleIds.includes(p.id) && !TASK_PRESETS.slice(0, 7).includes(p))];
const sampleTemplates = samplePresets.map((p, i) => ({
  instructions: null, shift: null, endTime: null, repeatEveryMinutes: null, minValue: null, maxValue: null, unit: null, fallback: null,
  standardId: null, criticality: null, intervalDays: null, monthDays: [] as number[], anchorDate: null, photoCheck: null,
  ...p.template,
  id: `tpl-${i + 1}`,
  active: true,
  scheduleText: describeSchedule(p.template),
}));

type SampleRun = {
  id: string; templateId: string; title: string; category: string; evidence: string; points: number; dueAt: Date; code: number; status: string;
  completedAt: Date | null; evidenceType: string | null; evidenceText: string | null; hasPhoto: boolean; lateAfterMinutes: number;
  standardId: string | null; criticality: string | null; outcome: string | null; resultValue: number | null; unit: string | null; issueText: string | null;
  photoCheck: string | null; photoVerdict: string | null; photoNote: string | null; photoMisses: number; reminderCount: number; escalated: boolean; localDate: string;
};

function sampleRun(i: number, dueMinutesAgo: number, over: Partial<SampleRun>): SampleRun {
  const t = sampleTemplates[i];
  const dueAt = ago(dueMinutesAgo);
  return {
    id: `run-${i + 1}`, templateId: t.id, title: t.title, category: t.category, evidence: t.evidence, points: t.points, dueAt, code: i + 1, status: 'OPEN',
    completedAt: null, evidenceType: null, evidenceText: null, hasPhoto: false, lateAfterMinutes: t.lateAfterMinutes,
    standardId: t.standardId, criticality: t.criticality, outcome: null, resultValue: null, unit: t.unit, issueText: null,
    photoCheck: t.photoCheck, photoVerdict: null, photoNote: null, photoMisses: 0, reminderCount: 0, escalated: false, localDate: dayKey(dueAt), ...over,
  };
}

const sampleRuns: SampleRun[] = [
  sampleRun(0, 240, { status: 'DONE', completedAt: ago(225), evidenceType: 'photo', hasPhoto: true, outcome: 'pass', photoCheck: 'Opened milk and creamers carry a date label', photoVerdict: 'pass', photoNote: 'Both dispensers show dated labels.' }),
  sampleRun(1, 200, { status: 'DONE', completedAt: ago(190), evidenceType: 'text', evidenceText: '38F, all good', outcome: 'pass', resultValue: 38 }),
  sampleRun(2, 150, { status: 'OPEN', hasPhoto: true, outcome: 'photo_fail', photoCheck: 'Both dispensers show a date label', photoVerdict: 'fail', photoNote: 'The cream dispenser has no label.', photoMisses: 1, reminderCount: 2, escalated: true }),
  sampleRun(3, 95, { status: 'OPEN', reminderCount: 3 }),
  sampleRun(4, 30, { status: 'OPEN' }),
  sampleRun(5, 400, { status: 'MISSED' }),
  sampleRun(6, 20, { status: 'DONE', completedAt: ago(10), evidenceType: 'text', evidenceText: 'done' }),
];

const sampleCatalog = TASK_PRESETS.filter((p) => p.source === 'report' && p.template.standardId).map((p) => ({
  standardId: p.template.standardId as string, presetId: p.id, title: p.template.title, category: p.template.category,
  criticality: p.template.criticality, points: p.template.points, requires: p.requires,
}));

let savedSetup: StoreSetup | null = null;

function tasksApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL, body: string): void {
  const view = url.searchParams.get('view');
  const base = { success: true, storeName: 'Rockaway', canEdit: true };
  if (req.method === 'POST') {
    const b = JSON.parse(body || '{}') as { action?: string; runId?: string; id?: string; setup?: unknown; presetIds?: string[] };
    if (b.action === 'setup_preview' || b.action === 'setup_apply') {
      const parsed = StoreSetupSchema.safeParse(b.setup);
      if (!parsed.success) return sendJson(res, 400, { error: parsed.error.issues.map((i) => i.message).join('; ') });
      const list = suggestTasks(parsed.data);
      if (b.action === 'setup_preview') {
        return sendJson(res, 200, {
          success: true,
          suggestions: list.map((x) => ({ presetId: x.presetId, title: x.title, group: x.group, bucket: x.bucket, bucketLabel: x.bucketLabel, source: x.source, recommended: x.recommended, scheduleText: x.scheduleText, shift: x.template.shift, standardId: x.template.standardId, criticality: x.template.criticality, points: x.template.points, evidence: x.template.evidence, instructions: x.template.instructions })),
        });
      }
      savedSetup = parsed.data;
      return sendJson(res, 200, { success: true, added: (b.presetIds ?? []).length, skipped: 0, preview: true });
    }
    if (b.action === 'save_samples' || b.action === 'save_vendors') return sendJson(res, 200, { success: true, preview: true }), true;
    const run = sampleRuns.find((r) => r.id === b.runId);
    if (b.action === 'close' && run) { run.status = 'MISSED'; run.completedAt = null; }
    if (b.action === 'approve' && run) { run.status = 'DONE'; run.completedAt = new Date(); run.outcome = 'fixed'; run.photoVerdict = 'approved'; run.evidenceType = 'photo'; }
    if (b.action === 'run_now') return sendJson(res, 200, { success: true, note: 'Preview: nothing was sent.' });
    if (b.action === 'preview_report' || b.action === 'apply_report') return sendJson(res, 400, { error: 'Report import needs the real server (not in the sample preview).' });
    return sendJson(res, 200, { success: true, preview: true });
  }
  if (view === 'setup') {
    return sendJson(res, 200, {
      ...base,
      setup: savedSetup,
      storeTypes: storeTypeOptions(),
      vendors: [
        { name: 'HLA', category: 'cigarettes' },
        { name: 'ABC', category: 'drinks' },
        { name: 'RPS', category: 'auto' },
      ],
      vendorCategories: [
        { id: 'cigarettes', label: 'Cigarettes / tobacco' }, { id: 'drinks', label: 'Drinks' }, { id: 'snacks', label: 'Snacks' },
        { id: 'candy', label: 'Candy' }, { id: 'lottery', label: 'Lottery' }, { id: 'auto', label: 'Auto / automotive' },
        { id: 'ice', label: 'Ice' }, { id: 'bread', label: 'Bread / bakery' }, { id: 'dairy', label: 'Dairy' }, { id: 'other', label: 'Other' },
      ],
    });
  }
  if (view === 'inspection') {
    if (!inspectionApplies(savedSetup?.storeType ?? null)) return sendJson(res, 400, { error: 'The inspection score is for 7-Eleven stores.' });
    const now = new Date();
    const prediction = predictInspection(sampleCatalog, sampleTemplates.map((t) => ({ id: t.id, standardId: t.standardId, points: t.points, active: t.active, title: t.title, category: t.category, criticality: t.criticality })), sampleRuns, now, new Set(['FS6']));
    return sendJson(res, 200, { ...base, prediction, generatedAt: now, lastReport: null });
  }
  if (url.searchParams.get('photo')) return sendJson(res, 404, { error: 'Photos are not kept in the preview.' });
  const now = new Date();
  return sendJson(res, 200, {
    ...base,
    timeZone: 'America/New_York',
    today: dayKey(now),
    templates: sampleTemplates,
    runs: sampleRuns,
    scoreToday: scoreRuns(sampleRuns, now),
    scoreWeek: scoreRuns(sampleRuns, now),
    presets: presetsForStore(savedSetup?.storeType ?? null).map((p) => ({
      id: p.id, group: p.group, bucket: bucketFor(p), source: p.source, requires: p.requires ?? null, title: p.template.title, scheduleText: describeSchedule(p.template),
      category: p.template.category, standardId: p.template.standardId, criticality: p.template.criticality, points: p.template.points,
      alreadyOnStore: presetIsOnStore(p, sampleTemplates),
    })),
    messageSamples: {},
    vendors: [
      { name: 'HLA', category: 'cigarettes' },
      { name: 'ABC', category: 'drinks' },
      { name: 'RPS', category: 'auto' },
    ],
    vendorCategories: [
      { id: 'cigarettes', label: 'Cigarettes / tobacco' }, { id: 'drinks', label: 'Drinks' }, { id: 'snacks', label: 'Snacks' },
      { id: 'candy', label: 'Candy' }, { id: 'lottery', label: 'Lottery' }, { id: 'auto', label: 'Auto / automotive' },
      { id: 'ice', label: 'Ice' }, { id: 'bread', label: 'Bread / bakery' }, { id: 'dairy', label: 'Dairy' }, { id: 'other', label: 'Other' },
    ],
    features: Object.entries(STORE_FEATURE_LABEL).map(([id, label]) => ({ id, label })),
    setup: savedSetup,
    canManageOwners: true,
    people: {
      whatsapp: [{ id: 'd1', name: 'Preview Owner', phoneE164: '+15550100100', role: 'OWNER' }],
      dashboard: [{ userId: 'preview-user', email: 'preview@opsai.local', name: 'Preview Owner', role: 'OWNER' }],
    },
  });
}

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
const PAGES: Record<string, string> = { '/dashboard': 'dashboard.html', '/tasks': 'tasks.html', '/login': 'login.html', '/signup': 'signup.html', '/onboarding': 'onboarding.html', '/': 'dashboard.html' };

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

  if (p === '/api/stores/tasks') return tasksApi(req, res, url, req.method === 'POST' ? await readBody(req) : ''), true;

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

  if (p === '/api/auth/signup' && req.method === 'POST') {
    const parsed = parseSignupInput(readJsonBody(await readBody(req)));
    if (!parsed.ok) return sendJson(res, parsed.status, { error: parsed.error }), true;
    return (
      sendJson(res, 201, {
        success: true,
        token: 'preview',
        user: { id: 'preview-user', email: parsed.email, name: parsed.name, stores: [] },
      }),
      true
    );
  }

  if (p === '/api/auth/login' && req.method === 'POST') {
    const body = readJsonBody(await readBody(req));
    if (typeof body.link === 'string' && body.link.trim()) {
      return (
        sendJson(res, 200, {
          success: true,
          token: 'preview',
          user: {
            id: 'preview-user',
            email: 'preview@opsai.local',
            name: 'Preview Owner',
            stores: [{ storeId: 'S001', storeName: 'Rockaway', role: 'OWNER' }],
          },
        }),
        true
      );
    }
    const parsed = parseLoginInput(body);
    if (!parsed.ok) return sendJson(res, parsed.status, { error: parsed.error }), true;
    return (
      sendJson(res, 200, {
        success: true,
        token: 'preview',
        user: {
          id: 'preview-user',
          email: parsed.email,
          name: 'Preview Owner',
          stores: [{ storeId: 'S001', storeName: 'Rockaway', role: 'OWNER' }],
        },
      }),
      true
    );
  }

  if (p === '/api/auth/me' && req.method === 'GET') {
    const auth = req.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ') || !auth.substring(7)) {
      return sendJson(res, 401, { error: 'No token provided' }), true;
    }
    return (
      sendJson(res, 200, {
        success: true,
        user: {
          id: 'preview-user',
          email: 'preview@opsai.local',
          name: 'Preview Owner',
          stores: [{ storeId: 'S001', storeName: 'Rockaway', role: 'OWNER' }],
        },
      }),
      true
    );
  }

  if (p === '/api/auth/google/initiate') {
    res.writeHead(302, { Location: '/login' });
    res.end();
    return true;
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
    if (['tasks.html', 'onboarding.html'].includes(path.basename(full))) {
      // The preview has no login: give the page a pretend token so it does not send you to /login.
      const html = fs.readFileSync(full, 'utf8').replace('<head>', "<head><script>localStorage.setItem('authToken','preview')</script>");
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      res.end(html);
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
  console.log(`Tasks page (sample tasks):                       http://localhost:${PORT}/tasks`);
  console.log(`Add-another-store screen:                      http://localhost:${PORT}/onboarding?add=1`);
});
