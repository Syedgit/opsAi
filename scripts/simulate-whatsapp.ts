/**
 * Local end-to-end simulator for the WhatsApp message pipeline.
 *
 * Runs the REAL pipeline (lib/processWhatsAppMessage and everything under it) with:
 *   - an in-memory stand-in for the database (nothing touches Supabase), and
 *   - a stand-in for WhatsApp (replies are printed, nothing is sent; media comes from local files).
 * The only outside call is to OpenAI, using OPENAI_API_KEY from .env, when AI understanding is enabled.
 *
 * Usage:
 *   npx ts-node -T scripts/simulate-whatsapp.ts [text|photos|voice|all] [--scripted]
 *
 * --scripted replaces the AI with canned readings of the sample files (no OpenAI call, no cost). It tests
 * the conversation flow (replies, OK, rule learning, RULE, deposit warnings) but NOT how well the model reads.
 *
 * Output is also written to samples/real-inputs/last-simulation.txt (git-ignored: it contains real business data).
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config();
// Safety: this tool must never reach the real database or send real WhatsApp messages.
delete process.env.DATABASE_URL;
delete process.env.DIRECT_URL;
delete process.env.WHATSAPP_ACCESS_TOKEN;
process.env.OPENAI_EXTRACTION_MODEL ||= 'gpt-4.1';
process.env.OPENAI_TRANSCRIPTION_MODEL ||= 'gpt-4o-mini-transcribe';

const SCRIPTED = process.argv.includes('--scripted');
if (SCRIPTED) process.env.OPENAI_API_KEY = 'scripted';

const SAMPLES = path.join(__dirname, '..', 'samples', 'real-inputs');
const OUT_FILE = path.join(SAMPLES, 'last-simulation.txt');
fs.writeFileSync(OUT_FILE, '');

function say(line = ''): void {
  console.log(line);
  fs.appendFileSync(OUT_FILE, line + '\n');
}

/* ------------------------- stand-ins for WhatsApp I/O ------------------------- */

const media = new Map<string, { buffer: Buffer; mimeType: string }>();
const sent: Array<{ to: string; message: string }> = [];

const fakeMessaging = {
  sendWhatsAppMessage: async (_prisma: unknown, to: string, message: string) => {
    sent.push({ to, message });
    return true;
  },
};
const fakeMedia = {
  MAX_MEDIA_BYTES: 20 * 1024 * 1024,
  downloadWhatsAppMedia: async (mediaId: string) => {
    const file = media.get(mediaId);
    if (!file) throw new Error(`no such media ${mediaId}`);
    return file;
  },
};

/* ---------------- scripted stand-in for the AI (only with --scripted) ---------------- */

const VOICE_TEXT = 'Rockaway. Store credit three thirty four. Store cash one oh six. Gas thirteen fifty five. Total deposit sixteen fifty three.';

function report(over: Record<string, unknown>) {
  return {
    storeHint: null, reportDate: null, cardSales: null, cashSales: null, storeSalesTotal: null, fuelSales: null,
    fuelGallons: null, fuelDiscounts: null, payouts: [], reportedDeposit: null, reportedDayTotal: null, periodClosed: null,
    ...over,
  };
}
const daily = (reports: unknown[], confidence = 0.9, needsReview: string[] = []) => ({ kind: 'daily_close', reports, confidence, needsReview });

const IMAGE_READINGS: Record<string, unknown> = {
  '01-pos-store-close-denville.png': daily(
    [report({ storeHint: 'Denville Exxon', reportDate: '2026-10-12', storeSalesTotal: 23, fuelSales: 6992.13, fuelGallons: 1609.62, fuelDiscounts: -3.28, reportedDayTotal: 7011.85, periodClosed: false })],
    0.85
  ),
  '02-handwritten-invoice-empire-snacks.png': {
    kind: 'invoice', confidence: 0.8, needsReview: ['invoiceNumber'],
    invoice: {
      vendorName: 'Empire Snacks LLC', invoiceNumber: null, invoiceDate: '2026-10-12', storeHint: 'Exxon Mart',
      lineItems: [1, 2, 3].map(() => ({ description: 'Lays mix', quantity: 24, unitPrice: 1.89, amount: 45.36 })),
      tax: null, total: 136.08, paymentStatus: 'unknown',
    },
  },
  '03-pump-discount-host-unavailable.png': {
    kind: 'equipment_issue', confidence: 0.85, needsReview: [],
    issue: {
      equipment: null, category: 'payment_network', description: 'Pump screen shows an error and the pump is not working',
      screenText: 'Discount Host Unavailable', severity: 'high',
      questions: ['Which pump is it?', 'Can customers still pay at the pump?'],
    },
  },
  '04-bank-deposit-receipts.png': {
    kind: 'deposit_receipt', confidence: 0.7, needsReview: ['accountLast4'],
    receipts: [
      { bank: 'Bank of America', storeHint: 'Denville East Main St', depositDate: '2026-10-12', postsOn: '2026-10-13', accountLast4: '4390', totalDeposit: 4358, cashCounts: [] },
      {
        bank: 'Bank of America', storeHint: 'Denville East Main St', depositDate: '2026-10-12', postsOn: '2026-10-13', accountLast4: '4707', totalDeposit: 2183,
        cashCounts: [[100, 5], [1, 23], [5, 26], [10, 8], [20, 71]].map(([denomination, count]) => ({ denomination, count })),
      },
    ],
  },
  '05-handwritten-store-sales-notebook.png': daily(
    [report({ reportDate: '2026-10-10', cardSales: 281, cashSales: 66, storeSalesTotal: 347, fuelSales: 1827, reportedDayTotal: 2174 })],
    0.75
  ),
};

function scriptedTextReading(text: string): unknown {
  if (text.includes('Danville')) {
    const date = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    const iso = date ? `${date[3]}-${date[1].padStart(2, '0')}-${date[2].padStart(2, '0')}` : null;
    const rockawayDeposit = Number(text.match(/Total deposit Rockaway:\s*\$\s*(\d+)/)?.[1]);
    return daily([
      report({ storeHint: 'RockAway', reportDate: iso, cardSales: 334, cashSales: 106, fuelSales: 1355, payouts: [{ label: 'Lays', amount: 142 }], reportedDeposit: rockawayDeposit }),
      report({ storeHint: 'Danville', reportDate: iso, cardSales: 23, cashSales: 3, fuelSales: 872, reportedDeposit: 875 }),
    ]);
  }
  if (text.includes('Store credit three thirty four')) {
    return daily([report({ storeHint: 'Rockaway', reportDate: '2026-10-12', cardSales: 334, cashSales: 106, fuelSales: 1355, reportedDeposit: 1653 })], 0.8);
  }
  if (text.includes('deposit 1020')) {
    return daily([report({ reportDate: '2026-10-12', cardSales: 300, cashSales: 120, fuelSales: 900, reportedDeposit: 1020 })]);
  }
  return { kind: 'unknown', reason: 'scripted AI has no reading for this text', confidence: 0, needsReview: [] };
}

const crypto = require('crypto') as typeof import('crypto');
const imageHashes = new Map<string, string>();
if (SCRIPTED) {
  for (const name of Object.keys(IMAGE_READINGS)) {
    const file = path.join(SAMPLES, name);
    if (fs.existsSync(file)) imageHashes.set(crypto.createHash('sha1').update(fs.readFileSync(file).toString('base64')).digest('hex'), name);
  }
}

class ScriptedOpenAI {
  chat = {
    completions: {
      create: async (params: { messages: Array<{ role: string; content: unknown }> }) => {
        const parts = params.messages[1].content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
        const image = parts.find((p) => p.type === 'image_url');
        let reading: unknown;
        if (image?.image_url) {
          const base64 = image.image_url.url.split(',')[1];
          const name = imageHashes.get(crypto.createHash('sha1').update(base64).digest('hex'));
          reading = name ? IMAGE_READINGS[name] : { kind: 'unknown', reason: 'unknown image', confidence: 0, needsReview: [] };
        } else {
          reading = scriptedTextReading(parts.map((p) => p.text ?? '').join('\n'));
        }
        return { choices: [{ message: { content: JSON.stringify(reading) } }] };
      },
    },
  };
  audio = { transcriptions: { create: async () => ({ text: VOICE_TEXT }) } };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const M = Module as any;
const originalLoad = M._load;
M._load = function (request: string, parent: unknown, isMain: boolean) {
  if (/(^|\/)whatsappMessaging$/.test(request)) return fakeMessaging;
  if (/(^|\/)whatsappMedia$/.test(request)) return fakeMedia;
  if (SCRIPTED && request === 'openai') {
    return { __esModule: true, default: ScriptedOpenAI, toFile: async (b: Buffer, name: string) => ({ name, size: b.length }) };
  }
  // eslint-disable-next-line prefer-rest-params
  return originalLoad.apply(this, arguments);
};

/* ------------------------- in-memory stand-in database ------------------------- */

type Row = Record<string, unknown>;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    const value = row[key];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as Row;
      if ('in' in c) return (c.in as unknown[]).includes(value);
      if ('gt' in c) return (value as Date) > (c.gt as Date);
      if ('gte' in c) return (value as Date) >= (c.gte as Date);
      if ('lte' in c) return (value as Date) <= (c.lte as Date);
    }
    return value === cond;
  });
}

function table(rows: Row[], keyField?: string) {
  const byOrder = (a: Row, b: Row, dir: string) => {
    const x = (a.createdAt as Date)?.getTime?.() ?? 0;
    const y = (b.createdAt as Date)?.getTime?.() ?? 0;
    return dir === 'desc' ? y - x : x - y;
  };
  return {
    rows,
    findUnique: async ({ where }: { where: Row }) => rows.find((r) => matches(r, where)) ?? null,
    findFirst: async ({ where, orderBy }: { where?: Row; orderBy?: { createdAt?: string } }) => {
      const found = rows.filter((r) => matches(r, where));
      if (orderBy?.createdAt) found.sort((a, b) => byOrder(a, b, orderBy.createdAt as string));
      return found[0] ?? null;
    },
    findMany: async ({ where, orderBy }: { where?: Row; orderBy?: { createdAt?: string } } = {}) => {
      const found = rows.filter((r) => matches(r, where));
      if (orderBy?.createdAt) found.sort((a, b) => byOrder(a, b, orderBy.createdAt as string));
      return found;
    },
    count: async ({ where }: { where?: Row } = {}) => rows.filter((r) => matches(r, where)).length,
    create: async ({ data }: { data: Row }) => {
      const row = { createdAt: new Date(Date.now() + rows.length), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error(`no row for ${keyField}`);
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const found = rows.filter((r) => matches(r, where));
      found.forEach((r) => Object.assign(r, data));
      return { count: found.length };
    },
    upsert: async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
      const row = rows.find((r) => matches(r, where));
      if (row) return Object.assign(row, update);
      const made = { createdAt: new Date(Date.now() + rows.length), ...create };
      rows.push(made);
      return made;
    },
  };
}

const OWNER = '+15550001111';
const STAFF = '+15550002222';

const db = {
  messageLog: table([], 'messageId'),
  pendingActions: table([], 'actionId'),
  userDirectory: table(
    [
      { phoneE164: OWNER, role: 'OWNER', storeId: 'S001', isActive: true },
      { phoneE164: STAFF, role: 'STAFF', storeId: 'S001', isActive: true },
    ],
    'phoneE164'
  ),
  userStore: table([
    { userId: 'u1', storeId: 'S001', role: 'OWNER' },
    { userId: 'u1', storeId: 'S002', role: 'OWNER' },
  ]),
  storeConfig: table(
    [
      { storeId: 'S001', storeName: 'Rockaway', timezone: 'America/New_York', active: true, sheetId: 'pending_google_sheet', profileJson: null },
      { storeId: 'S002', storeName: 'Denville', timezone: 'America/New_York', active: true, sheetId: 'pending_google_sheet', profileJson: null },
    ],
    'storeId'
  ),
};

/* --------------------------------- helpers --------------------------------- */

let counter = 0;

async function send(
  label: string,
  input: { from?: string; text?: string; file?: { name: string; mimeType: string; buffer?: Buffer }; audio?: boolean }
): Promise<void> {
  // Imported late so the module hooks above are already in place.
  const { processWhatsAppMessage } = await import('../lib/processWhatsAppMessage');

  counter += 1;
  const from = input.from ?? OWNER;
  const messageId = `sim-${counter}`;
  let mediaId: string | undefined;
  let mediaType: string | undefined;
  if (input.file) {
    mediaId = `media-${counter}`;
    const buffer = input.file.buffer ?? fs.readFileSync(path.join(SAMPLES, input.file.name));
    media.set(mediaId, { buffer, mimeType: input.file.mimeType });
    mediaType = input.audio ? 'audio' : 'image/jpeg';
  }

  say('');
  say(`━━━ ${label}`);
  say(`${from === OWNER ? 'OWNER' : 'STAFF'} → ${input.file ? `[${input.file.name}] ` : ''}${input.text ? JSON.stringify(input.text) : ''}`);

  sent.length = 0;
  const started = Date.now();
  await processWhatsAppMessage(db as never, {
    messageId,
    phoneE164: from,
    messageText: input.text,
    mediaId,
    mediaType,
    storeId: 'S001',
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  for (const reply of sent) {
    say(`opsAi (${seconds}s) ↓`);
    say(reply.message.split('\n').map((l) => '   ' + l).join('\n'));
  }
  if (sent.length === 0) say('(no reply)');

  const log = db.messageLog.rows.find((r) => r.messageId === messageId);
  const data = log?.extractedData as { understanding?: unknown } | undefined;
  if (data?.understanding) {
    say('   — what the AI read —');
    say('   ' + JSON.stringify(data.understanding));
  }
}

function showEntries(): void {
  const rows = db.pendingActions.rows;
  say('');
  say(`   [pending_actions: ${rows.map((r) => `${r.storeId}:${r.type}:${r.status}`).join(', ') || 'none'}]`);
  for (const s of db.storeConfig.rows) {
    const rule = (s.profileJson as { depositRule?: unknown } | null)?.depositRule;
    say(`   [${s.storeName} saved deposit rule: ${rule ? JSON.stringify(rule) : 'none'}]`);
  }
}

/* -------------------------------- scenarios -------------------------------- */

async function textScenario(): Promise<void> {
  say('\n######## TEXT: the real 10/12 message covering two stores ########');
  const report = fs.readFileSync(path.join(SAMPLES, '00-text-daily-report.txt'), 'utf8');

  await send('1. Owner sends the two-store text report', { text: report });
  showEntries();
  await send('2. Owner replies OK', { text: 'OK' });
  showEntries();
  await send('3. Owner asks for the deposit rules', { text: 'RULE' });

  // Next day: Rockaway's deposit is 53 short of what the saved rule expects.
  const nextDay = report.replace('10/12/2026', '10/13/2026').replace('$ 1653', '$ 1600');
  await send('4. Next day: Rockaway deposit is off', { text: nextDay });
  await send('5. Owner cancels it', { text: 'CANCEL' });

  await send('6. Staff sends one store report with no name', { from: STAFF, text: 'cash 120 card 300 gas 900 deposit 1020' });
  await send('7. Staff cancels', { from: STAFF, text: 'CANCEL' });
}

async function photosScenario(): Promise<void> {
  say('\n######## PHOTOS: real sample images, no captions unless noted ########');
  const png = 'image/png';
  const items: Array<[string, string, string?]> = [
    ['POS "Store Close" screen (Denville)', '01-pos-store-close-denville.png'],
    ['Handwritten invoice (Empire Snacks)', '02-handwritten-invoice-empire-snacks.png'],
    ['Pump photo with the real caption', '03-pump-discount-host-unavailable.png', 'pump not working'],
    ['Bank deposit receipts', '04-bank-deposit-receipts.png'],
    ['Handwritten sales notebook (no POS store)', '05-handwritten-store-sales-notebook.png'],
  ];
  for (const [label, file, caption] of items) {
    await send(label, { text: caption, file: { name: file, mimeType: png } });
    await send('   cancel', { text: 'CANCEL' });
  }
}

async function voiceScenario(): Promise<void> {
  say('\n######## VOICE: a spoken report (macOS text-to-speech) ########');
  const tmp = path.join(SAMPLES, '.sim-voice');
  const aiff = `${tmp}.aiff`;
  const wav = `${tmp}.wav`;
  execFileSync('say', ['-o', aiff, 'Rockaway. Store credit three thirty four. Store cash one oh six. Gas thirteen fifty five. Total deposit sixteen fifty three.']);
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', aiff, wav]);
  const buffer = fs.readFileSync(wav);
  fs.rmSync(aiff, { force: true });
  fs.rmSync(wav, { force: true });
  await send('Owner sends a voice note', { file: { name: 'voice.wav', mimeType: 'audio/wav', buffer }, audio: true });
  await send('   cancel', { text: 'CANCEL' });
}

async function main(): Promise<void> {
  const which = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'all';
  say(`opsAi simulation — ${SCRIPTED ? 'SCRIPTED AI (flow test only, model accuracy NOT tested)' : `model ${process.env.OPENAI_EXTRACTION_MODEL}`}, ${new Date().toISOString()}`);
  say('In-memory database and fake WhatsApp. Stores: S001 Rockaway, S002 Denville (same owner).');
  if (which === 'text' || which === 'all') await textScenario();
  if (which === 'photos' || which === 'all') await photosScenario();
  if (which === 'voice' || which === 'all') await voiceScenario();
  say('\nDone. Full transcript: samples/real-inputs/last-simulation.txt');
}

main().catch((error) => {
  console.error('SIMULATION FAILED', error);
  process.exit(1);
});
