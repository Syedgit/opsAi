/**
 * The simulated world for end-to-end cases.
 *
 * Real code under test: the Vercel webhook handler (signature check, parsing, de-duplication), the whole
 * message pipeline, OK/CANCEL/FIX/RULE, and the dashboard data API.
 * Faked: the database (in memory), WhatsApp sending and media download, and (in replay mode) the AI.
 * Nothing here can reach Supabase or send a real WhatsApp message.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import Module from 'module';
import { Readable } from 'stream';
import dotenv from 'dotenv';
import type { CaseFile, EntryView, Recording, Recordings, Sender, StepActual } from './types';
import { TaskTemplateInputSchema } from '../../lib/tasks/schedule';
import { defaultSetup } from '../../lib/tasks/storeSetup';
import { usageFromExtractedData, type AiUsageRecord } from '../../lib/understanding/usage';

dotenv.config();
// Safety first: this tool must never touch the real database or send a real message.
delete process.env.DATABASE_URL;
delete process.env.DIRECT_URL;
delete process.env.WHATSAPP_ACCESS_TOKEN;
process.env.OPENAI_EXTRACTION_MODEL ||= 'gpt-4.1';
process.env.OPENAI_TRANSCRIPTION_MODEL ||= 'gpt-4o-mini-transcribe';
process.env.WHATSAPP_APP_SECRET = 'e2e-app-secret';
process.env.JWT_SECRET = 'e2e-jwt-secret';
process.env.WHATSAPP_STORE_ROUTING = 'group';
process.env.MAX_MESSAGES_PER_HOUR = '1000';
delete process.env.AI_UNDERSTANDING;
if (process.env.NODE_ENV === 'production') process.env.NODE_ENV = 'development';
delete process.env.VERCEL_ENV;

export type AiMode = 'replay' | 'live';

export const PHONES: Record<Sender, string> = {
  owner: '+15550001111',
  staff: '+15550002222',
  stranger: '+15550009999',
};

const RealDate = Date;

/* ------------------------------------ clock ------------------------------------ */

let clockInstalled = false;
export function setToday(iso: string | undefined): void {
  if (clockInstalled) {
    global.Date = RealDate;
    clockInstalled = false;
  }
  if (!iso) return;
  const fixed = new RealDate(iso).getTime();
  const started = RealDate.now();
  class FakeDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(fixed + (RealDate.now() - started));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      else super(...(args as [any]));
    }
    static now(): number {
      return fixed + (RealDate.now() - started);
    }
  }
  global.Date = FakeDate as unknown as DateConstructor;
  clockInstalled = true;
}

/* ------------------------------- in-memory database ------------------------------- */

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
      if ('lt' in c) return (value as Date) < (c.lt as Date);
      if ('lte' in c) return (value as Date) <= (c.lte as Date);
    }
    return value === cond;
  });
}

function table(rows: Row[]) {
  const byOrder = (a: Row, b: Row, dir: string) => {
    const x = (a.createdAt as Date)?.getTime?.() ?? 0;
    const y = (b.createdAt as Date)?.getTime?.() ?? 0;
    return dir === 'desc' ? y - x : x - y;
  };
  const sorted = (found: Row[], orderBy?: { createdAt?: string }) => {
    if (orderBy?.createdAt) found.sort((a, b) => byOrder(a, b, orderBy.createdAt as string));
    return found;
  };
  return {
    rows,
    findUnique: async ({ where }: { where: Row }) => rows.find((r) => matches(r, where)) ?? null,
    findFirst: async ({ where, orderBy }: { where?: Row; orderBy?: { createdAt?: string } }) =>
      sorted(rows.filter((r) => matches(r, where)), orderBy)[0] ?? null,
    findMany: async ({ where, orderBy, take }: { where?: Row; orderBy?: { createdAt?: string }; take?: number } = {}) => {
      const found = sorted(rows.filter((r) => matches(r, where)), orderBy);
      return take ? found.slice(0, take) : found;
    },
    count: async ({ where }: { where?: Row } = {}) => rows.filter((r) => matches(r, where)).length,
    create: async ({ data }: { data: Row }) => {
      // Like the real database, a second row with the same message id is refused (Prisma code P2002).
      const duplicateRun =
        data.templateId !== undefined && data.dueAt instanceof RealDate && rows.some((r) => r.templateId === data.templateId && (r.dueAt as Date).getTime() === (data.dueAt as Date).getTime());
      if (duplicateRun || (data.messageId !== undefined && rows.some((r) => r.messageId === data.messageId))) {
        throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      }
      const row = { id: crypto.randomUUID(), createdAt: new RealDate(Date.now() + rows.length), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error('no row to update');
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
      const made = { createdAt: new RealDate(Date.now() + rows.length), ...create };
      rows.push(made);
      return made;
    },
  };
}

export const STORES = [
  { storeId: 'S001', storeName: 'Rockaway' },
  { storeId: 'S002', storeName: 'Denville' },
];

function freshDb(
  savedRules: CaseFile['savedRules'],
  linkedGroups: string[] = [],
  vendorsByStore: CaseFile['vendors'] = {},
  storeTypes: CaseFile['storeTypes'] = {}
) {
  const profile = (name: string) => {
    const rule = savedRules?.[name];
    const vendors = vendorsByStore?.[name] ?? [];
    if (!rule && vendors.length === 0) return null;
    return {
      aliases: [],
      depositRule: rule ? { floatLeftInRegister: 0, ...rule } : null,
      labelAliases: {},
      vendorAliases: {},
      messageSamples: {},
      pictureTemplates: [],
      vendors,
    };
  };
  const groupRows = linkedGroups.flatMap((name) => {
    const store = STORES.find((x) => x.storeName.toLowerCase() === name.toLowerCase());
    return store ? [{ whatsappGroupId: `grp-${store.storeName.toLowerCase()}`, storeId: store.storeId, active: true }] : [];
  });
  return {
    storeWhatsAppGroup: table(groupRows),
    messageLog: table([]),
    pendingActions: table([]),
    userDirectory: table([
      { id: 'dir-owner', name: 'Owner', phoneE164: PHONES.owner, role: 'OWNER', storeId: 'S001', isActive: true },
      { id: 'dir-staff', name: 'Staff', phoneE164: PHONES.staff, role: 'STAFF', storeId: 'S001', isActive: true },
    ]),
    taskTemplate: table([]),
    taskRun: table([]),
    userStore: table([
      { userId: 'u1', storeId: 'S001', role: 'OWNER', user: { email: 'owner@demo.local', name: 'Owner' } },
      { userId: 'u1', storeId: 'S002', role: 'OWNER', user: { email: 'owner@demo.local', name: 'Owner' } },
    ]),
    storeConfig: table(
      STORES.map((s) => ({
        ...s,
        timezone: 'America/New_York',
        active: true,
        sheetId: 'pending_google_sheet',
        profileJson: profile(s.storeName),
        setupJson: storeTypes?.[s.storeName] ? defaultSetup(storeTypes[s.storeName]) : undefined,
      }))
    ),
    inspectionReport: table([]),
  };
}

type Db = ReturnType<typeof freshDb>;

function seedTaskTemplates(caseFile: CaseFile): void {
  caseFile.taskTemplates?.forEach((raw, i) => {
    const { store, ...input } = raw;
    const found = STORES.find((s) => s.storeName.toLowerCase() === String(store).toLowerCase());
    if (!found) throw new Error(`taskTemplates[${i}]: no store named "${store}"`);
    const parsed = TaskTemplateInputSchema.parse(input);
    db.taskTemplate.rows.push({ id: `tpl-${i + 1}`, storeId: found.storeId, createdAt: new RealDate(Date.now()), ...parsed });
  });
}

/* ------------------------------ fakes wired into require ------------------------------ */

const media = new Map<string, { buffer: Buffer; mimeType: string }>();
const sent: Array<{ to: string; message: string }> = [];
let db: Db = freshDb(undefined);
const prismaProxy = new Proxy({}, { get: (_t, key) => (db as unknown as Record<string, unknown>)[key as string] });

interface StepAiState {
  recordings: Recordings;
  stepIndex: number;
  /** Set when replay had no recording for an AI call in the current step. */
  missingRecording: boolean;
  /** Filled in live mode: what the model returned for the current step. */
  captured: Recording;
}
const ai: StepAiState = { recordings: {}, stepIndex: 0, missingRecording: false, captured: {} };
let aiMode: AiMode = 'replay';

class ReplayOpenAI {
  chat = {
    completions: {
      create: async () => {
        const rec = ai.recordings[String(ai.stepIndex)];
        if (rec?.reading === undefined) {
          ai.missingRecording = true;
          throw new Error('no recorded AI reading for this step');
        }
        return { choices: [{ message: { content: JSON.stringify(rec.reading) } }] };
      },
    },
  };
  audio = {
    transcriptions: {
      create: async () => {
        const rec = ai.recordings[String(ai.stepIndex)];
        if (rec?.transcript === undefined) {
          ai.missingRecording = true;
          throw new Error('no recorded transcript for this step');
        }
        return { text: rec.transcript };
      },
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const M = Module as any;
const originalLoad = M._load;
M._load = function (request: string, ...rest: unknown[]) {
  if (/(^|\/)whatsappMessaging$/.test(request)) {
    const sendWhatsAppMessage = async (_prisma: unknown, to: string, message: string) => {
      sent.push({ to, message });
      return true;
    };
    const sendWhatsAppGroupMessage = async (_prisma: unknown, groupId: string, message: string) => {
      sent.push({ to: `group:${groupId}`, message });
      return true;
    };
    const postToStoreGroups = async (_prisma: unknown, storeId: string, message: string, extraGroupId?: string | null) => {
      let groups = db.storeWhatsAppGroup.rows.filter((g) => g.storeId === storeId && g.active === true);
      if (groups.length === 0) {
        const owners = db.userStore.rows.filter((u) => u.storeId === storeId && u.role === 'OWNER');
        const siblingIds = new Set(
          db.userStore.rows
            .filter((u) => u.role === 'OWNER' && owners.some((o) => o.userId === u.userId))
            .map((u) => u.storeId as string)
        );
        siblingIds.delete(storeId);
        const shared = db.storeWhatsAppGroup.rows.filter((g) => siblingIds.has(g.storeId as string) && g.active === true);
        const unique = [...new Set(shared.map((g) => g.whatsappGroupId as string))];
        if (unique.length === 1) groups = [{ whatsappGroupId: unique[0], storeId, active: true }];
      }
      const ids = [...new Set([...groups.map((g) => g.whatsappGroupId as string), extraGroupId?.trim()].filter(Boolean))];
      for (const id of ids) sent.push({ to: `group:${id}`, message });
      return ids.length;
    };
    const managerPhonesForStore = async (_prisma: unknown, storeId: string) => {
      const own = db.userDirectory.rows.filter(
        (d) => d.storeId === storeId && d.isActive !== false && (d.role === 'OWNER' || d.role === 'MANAGER')
      );
      if (own.length > 0) return [...new Set(own.map((d) => d.phoneE164 as string))];
      const owners = db.userStore.rows.filter((u) => u.storeId === storeId && (u.role === 'OWNER' || u.role === 'MANAGER'));
      const siblingIds = new Set(
        db.userStore.rows
          .filter((u) => owners.some((o) => o.userId === u.userId))
          .map((u) => u.storeId as string)
      );
      return [
        ...new Set(
          db.userDirectory.rows
            .filter((d) => siblingIds.has(d.storeId as string) && d.isActive !== false && (d.role === 'OWNER' || d.role === 'MANAGER'))
            .map((d) => d.phoneE164 as string)
        ),
      ];
    };
    const deliverStoreMessage = async (
      prisma: unknown,
      storeId: string,
      message: string,
      extra?: { extraGroupId?: string | null; extraPhone?: string | null; directMessage?: string | null }
    ) => {
      const groupPosted = await postToStoreGroups(prisma, storeId, message, extra?.extraGroupId);
      if (groupPosted > 0) return { posted: groupPosted, via: 'group' };
      const phones = new Set<string>(await managerPhonesForStore(prisma, storeId));
      const extraPhone = extra?.extraPhone?.trim();
      if (extraPhone && /^\+[1-9]\d{6,14}$/.test(extraPhone)) phones.add(extraPhone);
      const direct = extra?.directMessage?.trim() || message;
      let sentCount = 0;
      for (const phone of phones) {
        if (await sendWhatsAppMessage(prisma, phone, direct)) sentCount += 1;
      }
      if (sentCount > 0) return { posted: sentCount, via: 'direct' };
      return { posted: 0, via: 'none' };
    };
    return {
      sendWhatsAppMessage,
      sendWhatsAppGroupMessage,
      postToStoreGroups,
      managerPhonesForStore,
      deliverStoreMessage,
    };
  }
  if (/(^|\/)whatsappMedia$/.test(request)) {
    return {
      MAX_MEDIA_BYTES: 20 * 1024 * 1024,
      downloadWhatsAppMedia: async (mediaId: string) => {
        const file = media.get(mediaId);
        if (!file) throw new Error(`no such media ${mediaId}`);
        return file;
      },
    };
  }
  if (request === '@prisma/client') {
    const real = originalLoad.call(this, request, ...rest);
    function FakePrismaClient() {
      return prismaProxy;
    }
    return { ...real, PrismaClient: FakePrismaClient };
  }
  if (request === 'openai') {
    const real = originalLoad.call(this, request, ...rest);
    if (aiMode === 'replay') {
      return { __esModule: true, default: ReplayOpenAI, toFile: async (b: Buffer, name: string) => ({ name, size: b.length }) };
    }
    // Live: the real model, with its answers captured so they can be recorded for replay.
    const RealOpenAI = real.default ?? real;
    class RecordingOpenAI extends RealOpenAI {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructor(options: any) {
        super(options);
        const chat = this.chat.completions;
        const chatCreate = chat.create.bind(chat);
        chat.create = async (...args: unknown[]) => {
          const response = await chatCreate(...args);
          try {
            ai.captured.reading = JSON.parse(response.choices[0].message.content);
          } catch {
            ai.captured.reading = { unparseable: response.choices?.[0]?.message?.content };
          }
          return response;
        };
        const transcribe = this.audio.transcriptions;
        const transcribeCreate = transcribe.create.bind(transcribe);
        transcribe.create = async (...args: unknown[]) => {
          const response = await transcribeCreate(...args);
          ai.captured.transcript = response.text;
          return response;
        };
      }
    }
    return { ...real, __esModule: true, default: RecordingOpenAI };
  }
  return originalLoad.call(this, request, ...rest);
};

/* ------------------------------------- the world ------------------------------------- */

export interface World {
  reset(caseFile: CaseFile, recordings: Recordings): void;
  runStep(input: StepInput): Promise<StepOutcome>;
  usedAi(): boolean;
}

export interface StepInput {
  index: number;
  from: Sender;
  text?: string;
  image?: { buffer: Buffer; mimeType: string };
  audio?: { buffer: Buffer; mimeType: string };
  repeat: number;
  badSignature: boolean;
  at?: string;
  tick?: boolean;
  removeTasks?: string;
}

export interface StepOutcome {
  actual: StepActual;
  /** Replay had no recording for what this step needed. */
  missingRecording: boolean;
  /** What the AI read for this step (replay: the recording; live: the model's answer). */
  aiRead?: Recording;
  /** What the AI calls for this step used (live mode only). */
  usage: AiUsageRecord[];
  messageId: string;
}

// Meta escapes non-ASCII characters as \uXXXX in the bytes it signs. Do the same so the signature path is tested for real.
function metaStyleJson(value: unknown): string {
  return JSON.stringify(value).replace(/[\u0080-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

function buildPayload(input: StepInput, wamid: string, mediaId: string | undefined) {
  const from = PHONES[input.from].replace('+', '');
  const base = { from, id: wamid, timestamp: String(Math.floor(Date.now() / 1000)) };
  let message: Record<string, unknown>;
  if (input.audio) {
    message = { ...base, type: 'audio', audio: { id: mediaId, mime_type: input.audio.mimeType, voice: true } };
  } else if (input.image) {
    message = { ...base, type: 'image', image: { id: mediaId, mime_type: input.image.mimeType, ...(input.text ? { caption: input.text } : {}) } };
  } else {
    message = { ...base, type: 'text', text: { body: input.text ?? '' } };
  }
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_E2E',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550000000', phone_number_id: 'PNID_E2E' },
              contacts: [{ profile: { name: input.from }, wa_id: from }],
              messages: [message],
            },
          },
        ],
      },
    ],
  };
}

async function callWebhook(raw: string, signature: string): Promise<number> {
  const { default: handler } = await import('../../api/webhook/whatsapp');
  const req = Object.assign(Readable.from([Buffer.from(raw, 'utf8')]), {
    method: 'POST',
    headers: { 'x-hub-signature-256': signature, 'content-type': 'application/json' },
    query: {},
  });
  let status = 200;
  const res = {
    status(code: number) {
      status = code;
      return res;
    },
    json() {
      return res;
    },
    send() {
      return res;
    },
  };
  await handler(req as never, res as never);
  return status;
}

function sign(raw: string): string {
  return 'sha256=' + crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET as string).update(raw, 'utf8').digest('hex');
}

function entryView(row: Row): EntryView {
  const p = (row.payloadJson ?? {}) as Record<string, unknown>;
  const store = (db.storeConfig.rows.find((s) => s.storeId === row.storeId)?.storeName as string) ?? String(row.storeId);
  const checks: Record<string, string> = {};
  for (const c of (p.checks as Array<{ id: string; status: string }> | undefined) ?? []) checks[c.id] = c.status;
  const report = (p.report ?? {}) as Record<string, unknown>;
  const invoice = (p.invoice ?? {}) as Record<string, unknown>;
  const receipt = (p.receipt ?? {}) as Record<string, unknown>;
  const kind = String(p._kind ?? 'legacy');

  const view: EntryView = {
    kind,
    store,
    date: (p.report_date ?? p.invoice_date ?? p.deposit_date ?? null) as string | null,
    checks,
    suggestsDepositRule: p.suggested_deposit_rule != null,
  };
  if (kind === 'daily_close') {
    Object.assign(view, {
      cash: p.cash ?? null,
      card: p.card ?? null,
      insideTotal: p.total_inside ?? null,
      fuel: p.fuel_sales ?? null,
      gallons: p.gallons ?? null,
      deposit: p.deposit ?? null,
      dayTotal: (report.reportedDayTotal as number | null | undefined) ?? null,
      payouts: (report.payouts as Array<{ label: string; amount: number }> | undefined) ?? [],
    });
  } else if (kind === 'invoice') {
    Object.assign(view, {
      vendor: p.vendor ?? null,
      total: p.amount ?? null,
      invoiceNumber: (p.invoice_number as string | null | undefined) ?? null,
      lineCount: ((invoice.lineItems as unknown[] | undefined) ?? []).length,
      paymentStatus: (invoice.paymentStatus as string | undefined) ?? null,
    });
  } else if (kind === 'work_schedule') {
    Object.assign(view, {
      date: (p.week_start as string | null | undefined) ?? null,
      employees: ((p.employees as Array<{ name: string; hours: number }> | undefined) ?? []).map((e) => ({ name: e.name, hours: e.hours })),
      totalHours: (p.total_hours as number | undefined) ?? null,
    });
  } else if (kind === 'deposit_receipt') {
    Object.assign(view, {
      total: p.amount ?? null,
      bank: (receipt.bank as string | null | undefined) ?? null,
      accountLast4: (receipt.accountLast4 as string | null | undefined) ?? null,
    });
  } else if (kind === 'order') {
    const groups = (p.vendor_groups as Array<{ items?: unknown[] }> | undefined) ?? [];
    Object.assign(view, {
      vendor: (p.vendor as string | null | undefined) ?? null,
      lineCount: groups.reduce((n, g) => n + ((g.items ?? []).length), 0),
    });
  }
  return view;
}

async function dashboardFor(storeNames: string[]): Promise<StepActual['dashboard']> {
  const { default: dataHandler } = await import('../../api/stores/data');
  const { sign: jwtSign } = await import('jsonwebtoken');
  const token = jwtSign({ userId: 'u1', email: 'owner@example.com' }, process.env.JWT_SECRET as string);
  const result: StepActual['dashboard'] = {};
  for (const name of storeNames) {
    const store = STORES.find((s) => s.storeName.toLowerCase() === name.toLowerCase());
    if (!store) continue;
    result[name] = {};
    for (const tab of ['sales', 'invoices', 'schedules', 'orders']) {
      let body: Record<string, unknown> = {};
      let status = 200;
      const res = {
        status(code: number) {
          status = code;
          return res;
        },
        json(payload: Record<string, unknown>) {
          body = payload;
          return res;
        },
      };
      await dataHandler(
        { method: 'GET', query: { storeId: store.storeId, type: tab }, headers: { authorization: `Bearer ${token}` } } as never,
        res as never
      );
      const items = status === 200 ? ((body[tab] as Array<{ data: Record<string, unknown> }> | undefined) ?? []) : [];
      result[name][tab] = { count: items.length, first: items[0]?.data };
    }
  }
  return result;
}

const appliedEnv = new Map<string, string | undefined>();

export function createWorld(mode: AiMode): World {
  aiMode = mode;
  let usedAi = false;
  let counter = 0;
  let dashboardStores: string[] = [];

  return {
    reset(caseFile, recordings) {
      for (const [key, previous] of appliedEnv) {
        if (previous === undefined) delete process.env[key];
        else process.env[key] = previous;
      }
      appliedEnv.clear();
      for (const [key, value] of Object.entries(caseFile.env ?? {})) {
        appliedEnv.set(key, process.env[key]);
        process.env[key] = value;
      }
      setToday(caseFile.today);
      db = freshDb(caseFile.savedRules, caseFile.linkedGroups, caseFile.vendors, caseFile.storeTypes);
      media.clear();
      sent.length = 0;
      ai.recordings = recordings;
      seedTaskTemplates(caseFile);
      dashboardStores = STORES.map((s) => s.storeName);
    },

    usedAi: () => usedAi,

    async runStep(input) {
      counter += 1;
      const wamid = `wamid.E2E${counter}`;
      const mediaId = input.image || input.audio ? `media-${counter}` : undefined;
      const file = input.audio ?? input.image;
      if (mediaId && file) media.set(mediaId, file);

      ai.stepIndex = input.index;
      ai.missingRecording = false;
      ai.captured = {};
      sent.length = 0;

      if (input.at) setToday(input.at);
      if (input.removeTasks) {
        const needle = input.removeTasks.toLowerCase();
        for (let i = db.taskTemplate.rows.length - 1; i >= 0; i -= 1) {
          if (String(db.taskTemplate.rows[i].title).toLowerCase().includes(needle)) db.taskTemplate.rows.splice(i, 1);
        }
      }

      const raw = metaStyleJson(buildPayload(input, wamid, mediaId));
      const signature = input.badSignature ? 'sha256=' + '0'.repeat(64) : sign(raw);

      const entriesBefore = db.pendingActions.rows.length;
      let httpStatus = 200;
      if (input.tick) {
        const { runTaskTick } = await import('../../lib/tasks/tick');
        await runTaskTick(prismaProxy as never, new Date());
      } else {
        for (let i = 0; i < input.repeat; i += 1) {
          httpStatus = await callWebhook(raw, signature);
        }
      }

      const newRows = db.pendingActions.rows.slice(entriesBefore).filter((r) => r.messageIdInbound === wamid);
      const count = (status: string) => db.pendingActions.rows.filter((r) => r.status === status).length;
      const savedRule: Record<string, boolean> = {};
      for (const s of db.storeConfig.rows) {
        const profile = s.profileJson as { depositRule?: unknown } | null;
        savedRule[s.storeName as string] = Boolean(profile?.depositRule);
      }

      const log = db.messageLog.rows.find((r) => r.messageId === wamid);
      const understanding = (log?.extractedData as { understanding?: unknown; transcript?: string } | undefined) ?? undefined;
      const aiRead: Recording | undefined =
        ai.captured.reading !== undefined || ai.captured.transcript !== undefined
          ? { ...ai.captured }
          : understanding?.understanding !== undefined
            ? { reading: understanding.understanding, transcript: understanding.transcript }
            : undefined;
      if (aiRead || ai.missingRecording) usedAi = true;

      return {
        messageId: wamid,
        missingRecording: ai.missingRecording,
        aiRead,
        usage: usageFromExtractedData(log?.extractedData),
        actual: {
          httpStatus,
          replies: sent.filter((s) => !s.to.startsWith('group:')).map((s) => s.message),
          groupPosts: sent.filter((s) => s.to.startsWith('group:')).map((s) => s.message),
          entries: newRows.map(entryView),
          status: { PENDING: count('PENDING'), CONFIRMED: count('CONFIRMED'), CANCELLED: count('CANCELLED') },
          savedRule,
          tasks: db.taskRun.rows.map((r) => ({
            title: String(r.title),
            status: String(r.status),
            code: Number(r.code),
            evidenceType: (r.evidenceType as string | null | undefined) ?? null,
            evidenceText: (r.evidenceText as string | null | undefined) ?? null,
            outcome: (r.outcome as string | null | undefined) ?? null,
            photoVerdict: (r.photoVerdict as string | null | undefined) ?? null,
          })),
          taskCounts: {
            OPEN: db.taskRun.rows.filter((r) => r.status === 'OPEN').length,
            DONE: db.taskRun.rows.filter((r) => r.status === 'DONE').length,
            MISSED: db.taskRun.rows.filter((r) => r.status === 'MISSED').length,
            CANCELLED: db.taskRun.rows.filter((r) => r.status === 'CANCELLED').length,
          },
          dashboard: await dashboardFor(dashboardStores),
        },
      };
    },
  };
}

export function readCaseFile(file: string): Buffer {
  return fs.readFileSync(file);
}

export function mimeFor(file: string): string {
  const ext = path.extname(file).toLowerCase();
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.opus': 'audio/ogg',
  };
  return map[ext] ?? 'application/octet-stream';
}
