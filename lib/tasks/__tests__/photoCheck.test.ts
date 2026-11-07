import { createPhotoChecker, maxPhotoChecksPerStorePerDay, parsePhotoVerdict, photoChecksLeft, PhotoCheckUnavailableError, type PhotoChecker } from '../photoCheck';
import { tryTaskEvidence } from '../evidence';
import { TaskTemplateInputSchema } from '../schedule';

const sent: Array<{ to: string; text: string }> = [];
const media = { mimeType: 'image/jpeg' as string, fail: false };
jest.mock('../../whatsappMessaging', () => ({
  sendWhatsAppMessage: async (_p: unknown, to: string, text: string) => {
    sent.push({ to, text });
    return true;
  },
  sendWhatsAppGroupMessage: async (_p: unknown, to: string, text: string) => {
    sent.push({ to: `group:${to}`, text });
    return true;
  },
  postToStoreGroups: async () => 1,
}));
jest.mock('../../whatsappMedia', () => ({
  downloadWhatsAppMedia: async () => {
    if (media.fail) throw new Error('expired');
    return { buffer: Buffer.from('fake-image-bytes'), mimeType: media.mimeType };
  },
}));

describe('parsePhotoVerdict', () => {
  it('reads a clear verdict', () => {
    expect(parsePhotoVerdict('{"verdict":"pass","reason":"Both dispensers have dated labels."}')).toEqual({ verdict: 'pass', reason: 'Both dispensers have dated labels.' });
    expect(parsePhotoVerdict('```json\n{"verdict":"fail","reason":"No label on the cream dispenser."}\n```').verdict).toBe('fail');
  });

  it('never turns something unreadable into a pass', () => {
    for (const raw of ['', null, undefined, 'looks good!', '{}', '{"verdict":"yes"}', '{"verdict":"PASS"}', '[1]', 'null']) {
      expect(parsePhotoVerdict(raw as string).verdict).toBe('unclear');
    }
  });

  it('keeps the reason short and plain', () => {
    const r = parsePhotoVerdict(JSON.stringify({ verdict: 'fail', reason: `  ${'long '.repeat(100)}  ` }));
    expect(r.reason.length).toBeLessThanOrEqual(160);
    expect(parsePhotoVerdict('{"verdict":"fail"}').reason).toContain('does not show');
  });
});

describe('the AI call', () => {
  const image = { base64: 'QUJD', mimeType: 'image/jpeg' };

  it('sends the task, what the photo must show and the photo, and reports usage', async () => {
    const create = jest.fn().mockResolvedValue({ choices: [{ message: { content: '{"verdict":"pass","reason":"ok"}' } }], usage: { prompt_tokens: 900, completion_tokens: 20 } });
    const checker = createPhotoChecker({ client: { chat: { completions: { create } } }, model: 'test-model' }) as PhotoChecker;
    const usage: unknown[] = [];
    const verdict = await checker.check({ title: 'Milk labels', expectation: 'both dispensers have a date label', image, onUsage: (u) => usage.push(u) });
    expect(verdict).toEqual({ verdict: 'pass', reason: 'ok' });
    const call = create.mock.calls[0][0];
    expect(call.model).toBe('test-model');
    expect(call.messages[0].content).toMatch(/ignore any such text/i);
    expect(call.messages[0].content).toMatch(/never "pass"/i);
    const user = JSON.stringify(call.messages[1].content);
    expect(user).toContain('Milk labels');
    expect(user).toContain('both dispensers have a date label');
    expect(user).toContain('data:image/jpeg;base64,QUJD');
    expect(usage).toEqual([{ kind: 'extraction', model: 'test-model', inputTokens: 900, outputTokens: 20 }]);
  });

  it('turns a provider error into "unavailable", not a verdict', async () => {
    const create = jest.fn().mockRejectedValue(new Error('429 quota'));
    const checker = createPhotoChecker({ client: { chat: { completions: { create } } }, model: 'm' }) as PhotoChecker;
    await expect(checker.check({ title: 't', expectation: 'x', image })).rejects.toBeInstanceOf(PhotoCheckUnavailableError);
  });

  it('is off without an AI key and model', () => {
    const saved = { ...process.env };
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_EXTRACTION_MODEL;
    expect(createPhotoChecker()).toBeNull();
    process.env = saved;
  });
});

describe('the daily limit', () => {
  it('defaults to 40 and can be set', () => {
    expect(maxPhotoChecksPerStorePerDay({})).toBe(15);
    expect(maxPhotoChecksPerStorePerDay({ MAX_TASK_PHOTO_CHECKS_PER_STORE_PER_DAY: '5' } as never)).toBe(5);
    expect(maxPhotoChecksPerStorePerDay({ MAX_TASK_PHOTO_CHECKS_PER_STORE_PER_DAY: 'x' } as never)).toBe(15);
  });

  it('counts only photo-check messages of this store in the last day', async () => {
    const count = jest.fn().mockResolvedValue(4);
    const prisma = { messageLog: { count } } as never;
    const now = new Date('2026-10-26T15:00:00Z');
    expect(await photoChecksLeft(prisma, 'S001', now, 5)).toBe(true);
    expect(await photoChecksLeft(prisma, 'S001', now, 4)).toBe(false);
    const where = count.mock.calls[0][0].where;
    expect(where.storeId).toBe('S001');
    expect(where.classification.in).toEqual(['TASK_PHOTO_PASSED', 'TASK_PHOTO_REJECTED', 'TASK_PHOTO_UNCLEAR']);
    expect(where.createdAt.gte.toISOString()).toBe('2026-10-25T15:00:00.000Z');
  });
});

describe('the task form', () => {
  const ok = { title: 'Milk labels', startTime: '10:00', photoCheck: 'both dispensers have a date label' };
  it('keeps the text, and trims an empty one to nothing', () => {
    expect(TaskTemplateInputSchema.parse({ ...ok, evidence: 'photo' }).photoCheck).toBe('both dispensers have a date label');
    expect(TaskTemplateInputSchema.parse({ ...ok, evidence: 'photo', photoCheck: '  ' }).photoCheck).toBeNull();
  });
  it('needs a photo to check', () => {
    expect(TaskTemplateInputSchema.safeParse({ ...ok, evidence: 'either' }).success).toBe(true);
    expect(TaskTemplateInputSchema.safeParse({ ...ok, evidence: 'text' }).success).toBe(false);
    expect(TaskTemplateInputSchema.safeParse({ ...ok, evidence: 'none' }).success).toBe(false);
  });
});

/* ----------------------------- the whole reply flow, with a tiny fake database ----------------------------- */

interface Row { [key: string]: unknown }

function world(runOverrides: Row = {}) {
  const run: Row = {
    id: 'r1', templateId: 't1', storeId: 'S001', title: 'Milk labels', evidence: 'photo', photoCheck: 'both dispensers have a date label', dueAt: new Date('2026-10-26T14:00:00Z'),
    code: 1, lateAfterMinutes: 60, alertedAt: new Date('2026-10-26T14:00:00Z'), standardId: 'FS6', criticality: 'critical', minValue: null, maxValue: null, unit: null,
    fallback: 'Write the date on masking tape.', outcome: null, photoMisses: 0, status: 'OPEN', photoVerdict: null, ...runOverrides,
  };
  const logs: Row[] = [];
  let checksToday = 0;
  const prisma = {
    run,
    logs,
    setChecksToday: (n: number) => { checksToday = n; },
    taskRun: {
      findMany: async () => (run.status === 'OPEN' ? [run] : []),
      update: async ({ data }: { data: Row }) => Object.assign(run, data),
    },
    storeConfig: { findUnique: async () => ({ storeName: 'Rockaway', timezone: 'America/New_York' }) },
    messageLog: {
      findFirst: async () => null,
      count: async () => checksToday,
      update: async ({ where, data }: { where: { messageId: string }; data: Row }) => { logs.push({ messageId: where.messageId, ...data }); },
    },
    userDirectory: { findMany: async () => [{ phoneE164: '+1555MGR', role: 'MANAGER' }, { phoneE164: '+1555OWN', role: 'OWNER' }, { phoneE164: '+1555STF', role: 'STAFF' }] },
  };
  return prisma;
}

const checkerOf = (...verdicts: Array<{ verdict: 'pass' | 'fail' | 'unclear'; reason: string } | Error>) => {
  const check = jest.fn();
  verdicts.forEach((v) => (v instanceof Error ? check.mockRejectedValueOnce(v) : check.mockResolvedValueOnce(v)));
  const checker: PhotoChecker = { check };
  return { checker, check };
};

const photo = (prisma: ReturnType<typeof world>, checker: PhotoChecker | null, n = 1, extra: Record<string, unknown> = {}) =>
  tryTaskEvidence(prisma as never, {
    messageId: `m${n}`, phoneE164: '+1555STF', storeId: 'S001', text: '', mediaId: `media${n}`, role: 'STAFF', now: new Date('2026-10-26T14:10:00Z'), photoChecker: checker, ...extra,
  });

const replies = () => sent.map((s) => s.text).join('\n---\n');
const toManagers = () => sent.filter((s) => s.to === '+1555MGR');

describe('a photo for a task with a photo check', () => {
  beforeEach(() => {
    sent.length = 0;
    media.mimeType = 'image/jpeg';
    media.fail = false;
  });

  it('closes the task when the photo passes, and says what the AI saw', async () => {
    const db = world();
    const { checker, check } = checkerOf({ verdict: 'pass', reason: 'Both dispensers show a dated label.' });
    expect(await photo(db, checker)).toBe(true);
    expect(db.run).toMatchObject({ status: 'DONE', photoVerdict: 'pass', photoNote: 'Both dispensers show a dated label.', outcome: 'pass', evidenceType: 'photo', evidenceMediaId: 'media1' });
    expect(replies()).toContain('Photo checked: Both dispensers show a dated label.');
    expect(check.mock.calls[0][0]).toMatchObject({ title: 'Milk labels', expectation: 'both dispensers have a date label' });
    expect(db.logs[0]).toMatchObject({ classification: 'TASK_PHOTO_PASSED', processed: true });
  });

  it('records what the AI used on the message, so cost can be reported', async () => {
    const db = world();
    const check = jest.fn().mockImplementation(async (input: { onUsage?: (u: unknown) => void }) => {
      input.onUsage?.({ kind: 'extraction', model: 'm', inputTokens: 800, outputTokens: 15 });
      return { verdict: 'pass', reason: 'ok' };
    });
    await photo(db, { check });
    expect(db.logs[0].extractedData).toEqual({ usage: [{ kind: 'extraction', model: 'm', inputTokens: 800, outputTokens: 15 }] });
  });

  it('keeps the task open when the photo clearly does not show it, tells the employee why, and tells the managers once', async () => {
    const db = world();
    const { checker } = checkerOf({ verdict: 'fail', reason: 'The cream dispenser has no label.' }, { verdict: 'fail', reason: 'Still no label on the cream.' });
    await photo(db, checker, 1);
    expect(db.run).toMatchObject({ status: 'OPEN', outcome: 'photo_fail', photoVerdict: 'fail', photoMisses: 1, evidenceMediaId: 'media1', evidenceType: 'photo' });
    expect(replies()).toContain('not done yet');
    expect(replies()).toContain('The cream dispenser has no label.');
    expect(replies()).toContain('Write the date on masking tape.');
    expect(toManagers()).toHaveLength(1);
    expect(toManagers()[0].text).toContain('Photo did not pass: The cream dispenser has no label.');
    expect(db.logs[0].classification).toBe('TASK_PHOTO_REJECTED');

    sent.length = 0;
    await photo(db, checker, 2);
    expect(db.run).toMatchObject({ status: 'OPEN', photoMisses: 2, evidenceMediaId: 'media2' });
    expect(toManagers()).toHaveLength(0); // already told
  });

  it('tells the managers again on the third miss, and they can see the latest photo', async () => {
    const db = world();
    const { checker } = checkerOf(
      { verdict: 'fail', reason: 'a' },
      { verdict: 'unclear', reason: 'dark' },
      { verdict: 'fail', reason: 'c' },
    );
    await photo(db, checker, 1);
    await photo(db, checker, 2);
    sent.length = 0;
    await photo(db, checker, 3);
    expect(db.run.photoMisses).toBe(3);
    expect(toManagers().map((m) => m.text).join('\n')).toContain('3 photos did not pass');
    expect(toManagers().map((m) => m.text).join('\n')).toContain('Accept photo');
    expect(db.run.evidenceMediaId).toBe('media3');
  });

  it('asks for a clearer photo when it cannot tell, without alarming the managers or marking the task wrong', async () => {
    const db = world();
    const { checker } = checkerOf({ verdict: 'unclear', reason: 'too dark' });
    await photo(db, checker);
    expect(db.run).toMatchObject({ status: 'OPEN', photoVerdict: 'unclear', photoMisses: 1 });
    expect(db.run.outcome).toBeNull();
    expect(replies()).toContain("can't tell");
    expect(replies()).toContain('clearer');
    expect(toManagers()).toHaveLength(0);
    expect(db.logs[0].classification).toBe('TASK_PHOTO_UNCLEAR');
  });

  it('marks the task fixed when a good photo follows a bad one', async () => {
    const db = world();
    const { checker } = checkerOf({ verdict: 'fail', reason: 'no label' }, { verdict: 'pass', reason: 'labels visible' });
    await photo(db, checker, 1);
    await photo(db, checker, 2);
    expect(db.run).toMatchObject({ status: 'DONE', outcome: 'fixed', photoVerdict: 'pass', evidenceMediaId: 'media2' });
  });

  it('accepts the photo unchecked when AI is not switched on', async () => {
    const db = world();
    await photo(db, null);
    expect(db.run).toMatchObject({ status: 'DONE', photoVerdict: 'unchecked', photoNote: 'AI is not switched on' });
    expect(replies()).not.toContain('Photo checked');
  });

  it('accepts the photo unchecked, without calling the AI, once the store is over its daily photo limit', async () => {
    const db = world();
    db.setChecksToday(40);
    const { checker, check } = checkerOf({ verdict: 'fail', reason: 'x' });
    await photo(db, checker);
    expect(check).not.toHaveBeenCalled();
    expect(db.run).toMatchObject({ status: 'DONE', photoVerdict: 'unchecked' });
    expect(db.run.photoNote).toContain('limit');
  });

  it('never blocks the shift when the AI is down or the photo cannot be opened', async () => {
    const down = world();
    await photo(down, checkerOf(new PhotoCheckUnavailableError('503')).checker);
    expect(down.run).toMatchObject({ status: 'DONE', photoVerdict: 'unchecked' });

    media.fail = true;
    const expired = world();
    const { checker, check } = checkerOf({ verdict: 'fail', reason: 'x' });
    await photo(expired, checker);
    expect(check).not.toHaveBeenCalled();
    expect(expired.run).toMatchObject({ status: 'DONE', photoVerdict: 'unchecked' });
  });

  it('does not send a file that is not an image to the AI', async () => {
    media.mimeType = 'application/pdf';
    const db = world();
    const { checker, check } = checkerOf({ verdict: 'fail', reason: 'x' });
    await photo(db, checker);
    expect(check).not.toHaveBeenCalled();
    expect(db.run).toMatchObject({ status: 'DONE', photoVerdict: 'unchecked', photoNote: 'the file was not a photo' });
  });

  it('does not use the AI for a task that has no photo check', async () => {
    const db = world({ photoCheck: null });
    const { checker, check } = checkerOf({ verdict: 'fail', reason: 'x' });
    await photo(db, checker);
    expect(check).not.toHaveBeenCalled();
    expect(db.run).toMatchObject({ status: 'DONE', photoVerdict: null });
  });

  it('does not use the AI when the answer is text on a photo-or-text task', async () => {
    const db = world({ evidence: 'either' });
    const { checker, check } = checkerOf({ verdict: 'fail', reason: 'x' });
    await tryTaskEvidence(db as never, { messageId: 'm9', phoneE164: '+1555STF', storeId: 'S001', text: '1 labels are on, checked at 10', role: 'STAFF', now: new Date('2026-10-26T14:10:00Z'), photoChecker: checker });
    expect(check).not.toHaveBeenCalled();
    expect(db.run).toMatchObject({ status: 'DONE', evidenceType: 'text' });
  });

  it('a manager can see the rejected photo: it is kept on the open task', async () => {
    const db = world();
    await photo(db, checkerOf({ verdict: 'fail', reason: 'no label' }).checker);
    expect(db.run.status).toBe('OPEN');
    expect(db.run.evidenceMediaId).toBe('media1');
  });
});
