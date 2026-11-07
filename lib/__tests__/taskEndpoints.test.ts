import { sign } from 'jsonwebtoken';

const userStoreFindFirst = jest.fn();
const storeFindUnique = jest.fn();
const storeUpdate = jest.fn();
const templateFindMany = jest.fn();
const templateCreate = jest.fn();
const templateCount = jest.fn();
const runFindMany = jest.fn();
const runFindFirst = jest.fn();
const runUpdate = jest.fn();
const reportFindFirst = jest.fn();
const reportCreate = jest.fn();
const pdfText = jest.fn();
const tick = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: function PrismaClient() {
    return {
      userStore: { findFirst: userStoreFindFirst, findMany: jest.fn().mockResolvedValue([]) },
      userDirectory: { findMany: jest.fn().mockResolvedValue([]) },
      storeConfig: { findUnique: storeFindUnique, update: storeUpdate },
      taskTemplate: { findMany: templateFindMany, create: templateCreate, count: templateCount },
      taskRun: { findMany: runFindMany, findFirst: runFindFirst, update: runUpdate },
      inspectionReport: { findFirst: reportFindFirst, create: reportCreate },
    };
  },
}));
jest.mock('../tasks/pdfText', () => ({
  extractPdfText: (...args: unknown[]) => pdfText(...args),
  NotAPdfError: class NotAPdfError extends Error {},
}));
jest.mock('../tasks/tick', () => ({ runTaskTick: (...args: unknown[]) => tick(...args) }));

import { REPORT } from '../tasks/__tests__/reportFixture';
import tasksHandler from '../../api/stores/tasks';
import cronHandler from '../../api/cron/tasks';

process.env.JWT_SECRET = 'test-secret';
const token = sign({ userId: 'u1', email: 'a@b.c' }, 'test-secret');

async function run(handler: (req: never, res: never) => Promise<void>, req: Record<string, unknown>) {
  let status = 200;
  let body: Record<string, unknown> = {};
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
  await handler(req as never, res as never);
  return { status, body };
}

const asUser = (method: string, body?: unknown, query: Record<string, string> = {}) =>
  run(tasksHandler as never, { method, query: { storeId: 'S001', ...query }, body, headers: { authorization: `Bearer ${token}` } });

describe('Tasks API', () => {
  beforeEach(() => {
    [userStoreFindFirst, storeFindUnique, storeUpdate, templateFindMany, templateCreate, templateCount, runFindMany, runFindFirst, runUpdate, reportFindFirst, reportCreate, pdfText, tick].forEach((m) => m.mockReset());
    reportFindFirst.mockResolvedValue(null);
    storeFindUnique.mockResolvedValue({ storeName: 'Rockaway', timezone: 'America/New_York' });
    templateFindMany.mockResolvedValue([]);
    runFindMany.mockResolvedValue([]);
    templateCount.mockResolvedValue(0);
  });

  it('predicts an inspection result from the store\'s own tasks and runs', async () => {
    userStoreFindFirst.mockResolvedValue({ role: 'STAFF' });
    templateFindMany.mockResolvedValue([{ id: 't1', standardId: 'FS6', points: 50, active: true }]);
    runFindMany.mockResolvedValue([
      { templateId: 't1', status: 'MISSED', outcome: null, dueAt: new Date(Date.now() - 3 * 3600e3), localDate: '2026-10-26', lateAfterMinutes: 60 },
    ]);
    const { status, body } = await asUser('GET', undefined, { view: 'inspection' });
    expect(status).toBe(200);
    const p = body.prediction as { percent: number; fails: Array<{ standardId: string; reason: string }>; notTracked: unknown[] };
    expect(p.percent).toBe(0);
    expect(p.fails.map((f) => [f.standardId, f.reason])).toEqual([['FS6', 'missed']]);
    expect(p.notTracked.length).toBeGreaterThan(5);
    expect(runFindMany.mock.calls[0][0].where.storeId).toBe('S001');
  });

  it('uses the latest run of a monthly task even when it ran more than two weeks ago', async () => {
    userStoreFindFirst.mockResolvedValue({ role: 'STAFF' });
    templateFindMany.mockResolvedValue([{ id: 'm1', standardId: 'BOH2', points: 2, active: true, frequency: 'monthly' }]);
    runFindMany.mockResolvedValue([]);
    runFindFirst.mockResolvedValue({ id: 'old', templateId: 'm1', status: 'DONE', outcome: 'pass', dueAt: new Date(Date.now() - 20 * 86400000), localDate: '2026-10-01', lateAfterMinutes: 60 });
    const { body } = await asUser('GET', undefined, { view: 'inspection' });
    const p = body.prediction as { passes: Array<{ standardId: string }>; percent: number };
    expect(p.passes.map((r) => r.standardId)).toEqual(['BOH2']);
    expect(p.percent).toBe(100);
    expect(runFindFirst.mock.calls[0][0].where.templateId).toBe('m1');
  });

  it('starts an every-N-days task counting from today when no start date is given', async () => {
    userStoreFindFirst.mockResolvedValue({ role: 'MANAGER' });
    templateCreate.mockResolvedValue({ id: 'new' });
    const { status } = await asUser('POST', { action: 'create', template: { title: 'Deep clean', startTime: '14:00', frequency: 'interval', intervalDays: 14 } });
    expect(status).toBe(201);
    const data = templateCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ frequency: 'interval', intervalDays: 14, storeId: 'S001' });
    expect(data.anchorDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  describe('accepting a photo the AI would not pass', () => {
    it('lets a manager accept it: the task is done and counts as fixed', async () => {
      userStoreFindFirst.mockResolvedValue({ role: 'MANAGER' });
      runFindFirst.mockResolvedValue({ id: 'r1', storeId: 'S001', status: 'OPEN', evidenceMediaId: 'media1', completedByPhone: null });
      const { status } = await asUser('POST', { action: 'approve', runId: 'r1' });
      expect(status).toBe(200);
      expect(runFindFirst.mock.calls[0][0].where).toMatchObject({ id: 'r1', storeId: 'S001', status: 'OPEN' });
      expect(runUpdate.mock.calls[0][0].data).toMatchObject({ status: 'DONE', outcome: 'fixed', photoVerdict: 'approved' });
    });

    it('needs an open task that has a photo', async () => {
      userStoreFindFirst.mockResolvedValue({ role: 'MANAGER' });
      runFindFirst.mockResolvedValue({ id: 'r1', status: 'OPEN', evidenceMediaId: null });
      expect((await asUser('POST', { action: 'approve', runId: 'r1' })).status).toBe(404);
      runFindFirst.mockResolvedValue(null);
      expect((await asUser('POST', { action: 'approve', runId: 'nope' })).status).toBe(404);
      expect(runUpdate).not.toHaveBeenCalled();
    });

    it('is for owners and managers only', async () => {
      userStoreFindFirst.mockResolvedValue({ role: 'STAFF' });
      expect((await asUser('POST', { action: 'approve', runId: 'r1' })).status).toBe(403);
      expect(runUpdate).not.toHaveBeenCalled();
    });
  });

  describe('inspector report import', () => {
    const pdf = 'A'.repeat(200); // content is mocked; only its shape is checked
    beforeEach(() => {
      userStoreFindFirst.mockResolvedValue({ role: 'MANAGER' });
      pdfText.mockResolvedValue(REPORT);
      templateCreate.mockResolvedValue({ id: 'new' });
      templateFindMany.mockResolvedValue([{ standardId: 'FS5', active: true }]);
    });

    it('previews what it found without changing anything', async () => {
      const { status, body } = await asUser('POST', { action: 'preview_report', pdf });
      expect(status).toBe(200);
      expect(body.report).toMatchObject({ percent: 80, inspectedOn: '2026-10-13', cycle: 4, hasFuelPumps: false });
      const kinds = Object.fromEntries((body.proposals as Array<{ standardId: string; kind: string }>).map((p) => [p.standardId, p.kind]));
      expect(kinds).toMatchObject({ FS5: 'tracked', FS1: 'add', EC9: 'custom' });
      expect(JSON.stringify(body)).not.toMatch(/example\.com|Pat Example/);
      expect(templateCreate).not.toHaveBeenCalled();
      expect(reportCreate).not.toHaveBeenCalled();
    });

    it('adds only the ticked tasks and saves the report once', async () => {
      const { status, body } = await asUser('POST', { action: 'apply_report', pdf, standardIds: ['fs1', 'EC9', 'FS5'] });
      expect(status).toBe(200);
      expect(body).toMatchObject({ added: 2, saved: true });
      const created = templateCreate.mock.calls.map((c) => c[0].data);
      expect(created.map((d) => d.standardId).sort()).toEqual(['EC9', 'FS1']);
      expect(created.every((d) => d.storeId === 'S001')).toBe(true);
      expect(created.find((d) => d.standardId === 'FS1').instructions).toContain('Inspector 2026-10-13: Label printer is broken');
      const saved = reportCreate.mock.calls[0][0].data;
      expect(saved).toMatchObject({ storeId: 'S001', percent: 80, cycle: 4 });
      expect(JSON.stringify(saved)).not.toMatch(/example\.com|Pat/);
    });

    it('saves the report but adds nothing when nothing is ticked', async () => {
      const { body } = await asUser('POST', { action: 'apply_report', pdf, standardIds: [] });
      expect(body).toMatchObject({ added: 0, saved: true });
      expect(templateCreate).not.toHaveBeenCalled();
    });

    it('does not save the same report twice', async () => {
      reportFindFirst.mockResolvedValue({ id: 'r1' });
      const { body } = await asUser('POST', { action: 'apply_report', pdf, standardIds: ['FS1'] });
      expect(body).toMatchObject({ added: 1, saved: false });
      expect(reportCreate).not.toHaveBeenCalled();
    });

    it('treats a duplicate saved by someone else a moment ago as already saved', async () => {
      reportCreate.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
      const { status, body } = await asUser('POST', { action: 'apply_report', pdf, standardIds: [] });
      expect(status).toBe(200);
      expect(body.saved).toBe(false);
    });

    it('says so when the file is not a 7Clean report, and changes nothing', async () => {
      pdfText.mockResolvedValue('Some other document');
      const { status, body } = await asUser('POST', { action: 'apply_report', pdf, standardIds: ['FS1'] });
      expect(status).toBe(422);
      expect(String(body.error)).toContain('7Clean');
      expect(templateCreate).not.toHaveBeenCalled();
      expect(reportCreate).not.toHaveBeenCalled();
    });

    it('is for owners and managers only', async () => {
      userStoreFindFirst.mockResolvedValue({ role: 'STAFF' });
      expect((await asUser('POST', { action: 'preview_report', pdf })).status).toBe(403);
      expect(pdfText).not.toHaveBeenCalled();
    });

    it('shows the last imported report and marks its findings in the inspection view', async () => {
      userStoreFindFirst.mockResolvedValue({ role: 'STAFF' });
      reportFindFirst.mockResolvedValue({ inspectedOn: new Date('2026-10-13'), percent: 72.9, cycle: 4, visit: 1, property: 'X', categories: [], findings: [{ standardId: 'PB1' }] });
      const { body } = await asUser('GET', undefined, { view: 'inspection' });
      expect(body.lastReport).toMatchObject({ percent: 72.9 });
      const p = body.prediction as { notTracked: Array<{ standardId: string; lastFinding: boolean }> };
      expect(p.notTracked[0]).toMatchObject({ standardId: 'PB1', lastFinding: true });
    });
  });

  it('needs a login', async () => {
    const { status } = await run(tasksHandler as never, { method: 'GET', query: { storeId: 'S001' }, headers: {} });
    expect(status).toBe(401);
  });

  it('refuses someone who is not a member of the store', async () => {
    userStoreFindFirst.mockResolvedValue(null);
    expect((await asUser('GET')).status).toBe(403);
  });

  it('lets staff read the board but tells them they cannot edit', async () => {
    userStoreFindFirst.mockResolvedValue({ role: 'STAFF' });
    const { status, body } = await asUser('GET');
    expect(status).toBe(200);
    expect(body.canEdit).toBe(false);
    expect((body.presets as unknown[]).length).toBeGreaterThan(5);
  });

  it('marks starter tasks the store already has so the checkbox list can hide them', async () => {
    userStoreFindFirst.mockResolvedValue({ role: 'OWNER' });
    templateFindMany.mockResolvedValue([
      {
        id: 't1', title: 'Send the daily close report', instructions: null, category: 'reports',
        standardId: null, criticality: null, minValue: null, maxValue: null, unit: null, fallback: null,
        shift: 'End of shift', startTime: '22:00', endTime: null, repeatEveryMinutes: null,
        frequency: 'weekly', intervalDays: null, monthDays: [], anchorDate: null, daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        evidence: 'either', photoCheck: null, points: 3, remindEveryMinutes: 15, escalateAfterMinutes: null,
        lateAfterMinutes: 60, active: true,
      },
    ]);
    const { body } = await asUser('GET');
    const presets = body.presets as Array<{ id: string; alreadyOnStore: boolean }>;
    expect(presets.find((p) => p.id === 'own-daily-close')?.alreadyOnStore).toBe(true);
    expect(presets.find((p) => p.id === 'own-invoice-photo')?.alreadyOnStore).toBe(false);
  });

  it('does not let staff change anything', async () => {
    userStoreFindFirst.mockResolvedValue({ role: 'STAFF' });
    const { status } = await asUser('POST', { action: 'create', template: { title: 'x', startTime: '10:00' } });
    expect(status).toBe(403);
    expect(templateCreate).not.toHaveBeenCalled();
  });

  it('creates a task for a manager and cleans the input', async () => {
    userStoreFindFirst.mockResolvedValue({ role: 'MANAGER' });
    templateCreate.mockResolvedValue({ id: 't1' });
    const { status } = await asUser('POST', { action: 'create', template: { title: '  Check coffee ', startTime: '9:05', evidence: 'photo', storeId: 'S999' } });
    expect(status).toBe(201);
    const data = templateCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ title: 'Check coffee', startTime: '09:05', evidence: 'photo', storeId: 'S001' });
  });

  it('rejects an invalid task with a readable message', async () => {
    userStoreFindFirst.mockResolvedValue({ role: 'OWNER' });
    const { status, body } = await asUser('POST', { action: 'create', template: { title: 'Hourly', startTime: '07:00', repeatEveryMinutes: 60 } });
    expect(status).toBe(400);
    expect(String(body.error)).toMatch(/end time/);
    expect(templateCreate).not.toHaveBeenCalled();
  });

  it('looks a proof photo up by run and store, so another store\'s run id finds nothing', async () => {
    userStoreFindFirst.mockResolvedValue({ role: 'OWNER' });
    runFindFirst.mockResolvedValue(null);
    const { status } = await asUser('GET', undefined, { photo: 'run-of-another-store' });
    expect(status).toBe(404);
    expect(runFindFirst.mock.calls[0][0].where).toEqual({ id: 'run-of-another-store', storeId: 'S001' });
  });
});

describe('Task cron endpoint', () => {
  const call = (authorization?: string, method = 'GET') => run(cronHandler as never, { method, headers: authorization ? { authorization } : {}, query: {} });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    tick.mockReset();
  });

  it('stays closed when no secret is configured', async () => {
    delete process.env.CRON_SECRET;
    expect((await call('Bearer anything')).status).toBe(401);
    expect(tick).not.toHaveBeenCalled();
  });

  it('refuses a missing or wrong secret', async () => {
    process.env.CRON_SECRET = 'a-long-enough-secret-value';
    expect((await call()).status).toBe(401);
    expect((await call('Bearer wrong')).status).toBe(401);
    expect(tick).not.toHaveBeenCalled();
  });

  it('runs the tick with the right secret', async () => {
    process.env.CRON_SECRET = 'a-long-enough-secret-value';
    tick.mockResolvedValue({ stores: 1, created: 2, alerted: 2, reminded: 0, escalated: 0, closed: 0, errors: 0 });
    const { status, body } = await call('Bearer a-long-enough-secret-value');
    expect(status).toBe(200);
    expect(body).toMatchObject({ success: true, created: 2 });
  });

  it('only answers GET and POST', async () => {
    expect((await call('Bearer x', 'DELETE')).status).toBe(405);
  });
});

describe('Store setup (type, hours, shifts)', () => {
  const setup = {
    storeType: 'seven_eleven', open24h: true, opensAt: null, closesAt: null, fuel: false,
    shifts: [{ name: 'Morning', start: '06:00' }, { name: 'Evening', start: '14:00' }, { name: 'Night', start: '22:00' }],
  };

  beforeEach(() => {
    [userStoreFindFirst, storeFindUnique, storeUpdate, templateFindMany, templateCreate, templateCount].forEach((m) => m.mockReset());
    storeFindUnique.mockResolvedValue({ storeName: 'Rockaway', timezone: 'America/New_York', setupJson: null });
    templateFindMany.mockResolvedValue([]);
    templateCreate.mockResolvedValue({ id: 'new' });
    storeUpdate.mockResolvedValue({});
  });

  it('gives the setup form its starting points for each kind of store, and no saved setup yet', async () => {
    userStoreFindFirst.mockResolvedValue({ role: 'OWNER' });
    const { status, body } = await asUser('GET', undefined, { view: 'setup' });
    expect(status).toBe(200);
    expect(body.setup).toBeNull();
    const types = body.storeTypes as Array<{ id: string; label: string; blurb: string; defaults: { open24h: boolean } }>;
    expect(types.map((t) => t.id)).toEqual(['seven_eleven', 'convenience', 'gas_station', 'other']);
    expect(types[0]).toMatchObject({ label: '7-Eleven', defaults: { open24h: true } });
    expect(types[2]).toMatchObject({ label: 'Gas station' });
    expect(types[3].blurb.toLowerCase()).toMatch(/other business/);
  });

  it('returns the saved setup on the board and on the setup view', async () => {
    userStoreFindFirst.mockResolvedValue({ role: 'OWNER' });
    storeFindUnique.mockResolvedValue({ storeName: 'Rockaway', timezone: 'America/New_York', setupJson: setup });
    runFindMany.mockResolvedValue([]);
    const board = await asUser('GET');
    expect((board.body.setup as { storeType: string }).storeType).toBe('seven_eleven');
    const view = await asUser('GET', undefined, { view: 'setup' });
    expect((view.body.setup as { shifts: unknown[] }).shifts).toHaveLength(3);
  });

  it('treats a damaged saved setup as not set up', async () => {
    userStoreFindFirst.mockResolvedValue({ role: 'OWNER' });
    storeFindUnique.mockResolvedValue({ storeName: 'Rockaway', timezone: 'America/New_York', setupJson: { storeType: 'bank' } });
    const view = await asUser('GET', undefined, { view: 'setup' });
    expect(view.body.setup).toBeNull();
  });

  it('previews the starter tasks placed around the shifts, and saves nothing', async () => {
    userStoreFindFirst.mockResolvedValue({ role: 'OWNER' });
    const { status, body } = await asUser('POST', { action: 'setup_preview', setup });
    expect(status).toBe(200);
    const list = body.suggestions as Array<{ presetId: string; recommended: boolean; scheduleText: string; shift: string | null }>;
    const hands = list.find((s) => s.presetId === 'fs14-handwashing');
    expect(hands).toMatchObject({ recommended: true, shift: 'Morning' });
    expect(hands?.scheduleText).toContain('11:30am');
    expect(storeUpdate).not.toHaveBeenCalled();
    expect(templateCreate).not.toHaveBeenCalled();
  });

  it('answers a setup mistake in plain words', async () => {
    userStoreFindFirst.mockResolvedValue({ role: 'OWNER' });
    const { status, body } = await asUser('POST', { action: 'setup_preview', setup: { ...setup, shifts: [] } });
    expect(status).toBe(400);
    expect(String(body.error)).toMatch(/at least one shift/);
  });

  it('saves the setup and adds the chosen tasks at the placed times', async () => {
    userStoreFindFirst.mockResolvedValue({ role: 'OWNER' });
    const { status, body } = await asUser('POST', { action: 'setup_apply', setup, presetIds: ['fs14-handwashing', 'ic-restrooms'] });
    expect(status).toBe(200);
    expect(body).toMatchObject({ success: true, added: 2, skipped: 0 });
    expect(storeUpdate).toHaveBeenCalledWith({ where: { storeId: 'S001' }, data: { setupJson: expect.objectContaining({ storeType: 'seven_eleven', open24h: true }) } });
    const created = templateCreate.mock.calls.map((c) => c[0].data);
    expect(created.map((d) => [d.startTime, d.shift, d.storeId])).toEqual([
      ['11:30', 'Morning', 'S001'],
      ['01:00', 'Night', 'S001'],
    ]);
  });

  it('skips a task the store already has, and still saves the setup', async () => {
    userStoreFindFirst.mockResolvedValue({ role: 'OWNER' });
    const preview = await asUser('POST', { action: 'setup_preview', setup });
    const title = (preview.body.suggestions as Array<{ presetId: string; title: string }>).find((s) => s.presetId === 'fs14-handwashing')?.title as string;
    templateFindMany.mockResolvedValue([{ title: title.toUpperCase() }]);
    const { body } = await asUser('POST', { action: 'setup_apply', setup, presetIds: ['fs14-handwashing'] });
    expect(body).toMatchObject({ added: 0, skipped: 1 });
    expect(templateCreate).not.toHaveBeenCalled();
    expect(storeUpdate).toHaveBeenCalled();
  });

  it('rejects a starter task that is not on this store\'s list (fuel standard without fuel pumps)', async () => {
    userStoreFindFirst.mockResolvedValue({ role: 'OWNER' });
    const { status } = await asUser('POST', { action: 'setup_apply', setup, presetIds: ['ec2-fuel-islands'] });
    expect(status).toBe(400);
    expect(storeUpdate).not.toHaveBeenCalled();
  });

  it('refuses to go past the task limit', async () => {
    userStoreFindFirst.mockResolvedValue({ role: 'OWNER' });
    templateFindMany.mockResolvedValue(Array.from({ length: 100 }, (_, i) => ({ title: `Task ${i}` })));
    const { status } = await asUser('POST', { action: 'setup_apply', setup, presetIds: ['fs14-handwashing'] });
    expect(status).toBe(400);
    expect(storeUpdate).not.toHaveBeenCalled();
  });

  it('imports starter tasks onto this store id and skips titles already there', async () => {
    userStoreFindFirst.mockResolvedValue({ role: 'OWNER' });
    templateFindMany.mockResolvedValue([{ title: 'Send the daily close report' }]);
    templateCount.mockResolvedValue(1);
    const { status, body } = await asUser('POST', {
      action: 'import_presets',
      presetIds: ['own-daily-close', 'own-invoice-photo'],
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({ success: true, added: 1, skipped: 1 });
    expect(templateCreate.mock.calls[0][0].data).toMatchObject({
      title: 'Photo of today’s vendor invoices',
      storeId: 'S001',
    });
  });

  it('lets only owners and managers set a store up', async () => {
    userStoreFindFirst.mockResolvedValue({ role: 'STAFF' });
    expect((await asUser('POST', { action: 'setup_preview', setup })).status).toBe(403);
    expect((await asUser('POST', { action: 'setup_apply', setup, presetIds: [] })).status).toBe(403);
    expect(storeUpdate).not.toHaveBeenCalled();
  });

  it('saves the store vendor catalog used to confirm orders', async () => {
    userStoreFindFirst.mockResolvedValue({ role: 'OWNER' });
    storeFindUnique.mockResolvedValue({ storeName: 'Rockaway', timezone: 'America/New_York', profileJson: null });
    const vendors = [
      { name: 'HLA', category: 'cigarettes' },
      { name: 'ABC', category: 'drinks' },
      { name: 'RPS', category: 'auto' },
    ];
    const { status, body } = await asUser('POST', { action: 'save_vendors', vendors });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(storeUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { storeId: 'S001' },
      data: expect.objectContaining({
        profileJson: expect.objectContaining({ vendors }),
      }),
    }));
  });

  it('saves WhatsApp message samples on the store profile', async () => {
    userStoreFindFirst.mockResolvedValue({ role: 'OWNER' });
    storeFindUnique.mockResolvedValue({ storeName: 'Rockaway', timezone: 'America/New_York', profileJson: null });
    const { status, body } = await asUser('POST', { action: 'save_samples', dailyClose: 'cash 100 card 200 deposit 300' });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(storeUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { storeId: 'S001' },
      data: expect.objectContaining({
        profileJson: expect.objectContaining({ messageSamples: expect.objectContaining({ dailyClose: 'cash 100 card 200 deposit 300' }) }),
      }),
    }));
  });
});

describe('Store type decides what a store sees', () => {
  const convenience = {
    storeType: 'convenience', open24h: false, opensAt: '06:00', closesAt: '22:00', fuel: false,
    shifts: [{ name: 'Morning', start: '06:00' }, { name: 'Evening', start: '14:00' }],
  };

  beforeEach(() => {
    [userStoreFindFirst, storeFindUnique, templateFindMany, runFindMany, runFindFirst, reportFindFirst].forEach((m) => m.mockReset());
    userStoreFindFirst.mockResolvedValue({ role: 'OWNER' });
    templateFindMany.mockResolvedValue([]);
    runFindMany.mockResolvedValue([]);
    reportFindFirst.mockResolvedValue(null);
  });

  it('offers a convenience store only simple tasks, not the 7Clean standards', async () => {
    storeFindUnique.mockResolvedValue({ storeName: 'Corner', timezone: 'America/New_York', setupJson: convenience });
    const { body } = await asUser('GET');
    const presets = body.presets as Array<{ source: string; standardId: string | null; id: string }>;
    expect(presets.length).toBeGreaterThan(5);
    expect(presets.every((p) => p.source === 'suggested' && !p.standardId)).toBe(true);
    expect(presets.map((p) => p.id)).toContain('own-restroom-check');
  });

  it('offers a 7-Eleven the 7Clean standards, and a store not set up yet everything', async () => {
    storeFindUnique.mockResolvedValue({ storeName: 'Rockaway', timezone: 'America/New_York', setupJson: { ...convenience, storeType: 'seven_eleven' } });
    const seven = (await asUser('GET')).body.presets as Array<{ source: string }>;
    expect(seven.some((p) => p.source === 'report')).toBe(true);
    storeFindUnique.mockResolvedValue({ storeName: 'New', timezone: 'America/New_York', setupJson: null });
    const unset = (await asUser('GET')).body.presets as Array<{ source: string; id: string }>;
    expect(unset.some((p) => p.source === 'report')).toBe(true);
    expect(unset.some((p) => p.id === 'own-restroom-check')).toBe(true);
  });

  it('has no inspection score for a store that is not a 7-Eleven', async () => {
    storeFindUnique.mockResolvedValue({ storeName: 'Corner', timezone: 'America/New_York', setupJson: convenience });
    const { status, body } = await asUser('GET', undefined, { view: 'inspection' });
    expect(status).toBe(400);
    expect(String(body.error)).toMatch(/7-Eleven/);
    expect(templateFindMany).not.toHaveBeenCalled();
  });

  it('does not import an inspector report for a store that is not a 7-Eleven', async () => {
    storeFindUnique.mockResolvedValue({ storeName: 'Corner', timezone: 'America/New_York', setupJson: { ...convenience, storeType: 'gas_station' } });
    const { status, body } = await asUser('POST', { action: 'preview_report', pdf: 'A'.repeat(200) });
    expect(status).toBe(400);
    expect(String(body.error)).toMatch(/7-Eleven/);
    expect(pdfText).not.toHaveBeenCalled();
  });

  it('turns a convenience store\'s starter-task choice into simple tasks only', async () => {
    storeFindUnique.mockResolvedValue({ storeName: 'Corner', timezone: 'America/New_York', setupJson: null });
    templateCount.mockResolvedValue(0);
    const bad = await asUser('POST', { action: 'setup_apply', setup: convenience, presetIds: ['fs6-milk-labels'] });
    expect(bad.status).toBe(400);
  });
});
