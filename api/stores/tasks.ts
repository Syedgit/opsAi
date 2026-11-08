import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireStoreAccess } from '../../lib/storeAccess';
import { downloadWhatsAppMedia } from '../../lib/whatsappMedia';
import { TaskTemplateInputSchema, describeSchedule } from '../../lib/tasks/schedule';
import { STORE_FEATURE_LABEL, TASK_BUCKETS, TASK_PRESETS, bucketFor, getPreset, inspectionApplies, presetIsOnStore, presetsForStore } from '../../lib/tasks/presets';
import { scoreRuns } from '../../lib/tasks/score';
import { isValidTimeZone, localDateString } from '../../lib/tasks/time';
import { runTaskTick } from '../../lib/tasks/tick';
import { predictInspection } from '../../lib/tasks/inspection';
import { customTemplate, parseInspectorReport, presetTemplate, proposeFromReport, type ParsedReport } from '../../lib/tasks/inspectorReport';
import { extractPdfText, NotAPdfError } from '../../lib/tasks/pdfText';
import { StoreSetupSchema, readStoredSetup, storeTypeOptions, suggestTasks } from '../../lib/tasks/storeSetup';
import { dashboardModules } from '../../lib/businessProfile';
import {
  applyStoredProfile,
  deletePictureTemplate,
  parseStoredProfile,
  saveMessageSamples,
  savePictureTemplate,
  saveVendors,
} from '../../lib/understanding/profileStore';
import {
  MAX_PICTURE_FIELDS,
  PICTURE_FIELD_PURPOSES,
  PICTURE_TEMPLATE_KINDS,
  describePictureTemplate,
  pictureMapsBoard,
} from '../../lib/understanding/pictureTemplate';
import { sampleFromDailyClosePhoto } from '../../lib/understanding/closeSample';
import { sampleFromInvoicePhoto } from '../../lib/understanding/invoiceSample';
import { buildDefaultProfile } from '../../lib/understanding/profile';
import { StoreVendorsSchema, VENDOR_CATEGORIES, VENDOR_CATEGORY_LABEL } from '../../lib/understanding/vendors';
import {
  addDashboardMember,
  addWhatsAppPerson,
  deactivateStore,
  loadStoreTeam,
  removeDashboardMember,
  removeWhatsAppPerson,
  updateWhatsAppPerson,
} from '../../lib/tasks/people';
import { logApp, logAppError, loggedHandler, serializeError } from '../../lib/requestLog';

const prisma = new PrismaClient();

const MAX_TEMPLATES_PER_STORE = 100;
const DAY = 24 * 60 * 60 * 1000;

const BodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), template: z.unknown() }),
  z.object({ action: z.literal('update'), id: z.string().min(1), template: z.unknown() }),
  z.object({ action: z.literal('delete'), id: z.string().min(1) }),
  z.object({ action: z.literal('import_presets'), presetIds: z.array(z.string().min(1)).min(1).max(50) }),
  z.object({ action: z.literal('close'), runId: z.string().min(1) }),
  // A manager accepts the photo the AI would not pass.
  z.object({ action: z.literal('approve'), runId: z.string().min(1) }),
  z.object({ action: z.literal('run_now') }),
  // Store setup: shifts, hours and type. Preview shows the starter tasks placed to fit; apply saves the setup and adds the chosen ones.
  z.object({ action: z.literal('setup_preview'), setup: z.unknown() }),
  z.object({ action: z.literal('setup_apply'), setup: z.unknown(), presetIds: z.array(z.string().trim().min(1).max(60)).max(60) }),
  z.object({
    action: z.literal('save_samples'),
    dailyClose: z.string().max(2000).optional(),
    invoice: z.string().max(2000).optional(),
    dailyCloseImage: z.string().min(80).max(2_500_000).optional(),
    dailyCloseMime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']).optional(),
    invoiceImage: z.string().min(80).max(2_500_000).optional(),
    invoiceMime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']).optional(),
  }),
  z.object({
    action: z.literal('save_vendors'),
    vendors: StoreVendorsSchema,
  }),
  z.object({
    action: z.literal('save_picture_template'),
    template: z.object({
      id: z.string().trim().max(40).optional(),
      kind: z.enum(PICTURE_TEMPLATE_KINDS),
      title: z.string().max(80),
      note: z.string().max(400).optional(),
      fields: z.array(z.object({
        label: z.string().max(80).optional(),
        purpose: z.enum(PICTURE_FIELD_PURPOSES),
        note: z.string().max(120).optional(),
      })).max(MAX_PICTURE_FIELDS),
    }),
  }),
  z.object({
    action: z.literal('delete_picture_template'),
    id: z.string().trim().min(1).max(40),
  }),
  // The inspector's report as base64. Preview reads it and says what it would do; apply saves the result and adds the chosen tasks.
  z.object({ action: z.literal('preview_report'), pdf: z.string().min(100).max(3_500_000) }),
  z.object({ action: z.literal('apply_report'), pdf: z.string().min(100).max(3_500_000), standardIds: z.array(z.string().trim().max(20)).max(60) }),
  z.object({
    action: z.literal('add_whatsapp_person'),
    name: z.string().max(80).optional(),
    phoneE164: z.string().min(8).max(20),
    role: z.enum(['OWNER', 'MANAGER', 'STAFF']),
  }),
  z.object({
    action: z.literal('update_whatsapp_person'),
    id: z.string().min(1),
    name: z.string().max(80).optional(),
    phoneE164: z.string().max(20).optional(),
    role: z.enum(['OWNER', 'MANAGER', 'STAFF']).optional(),
  }),
  z.object({ action: z.literal('remove_whatsapp_person'), id: z.string().min(1) }),
  z.object({
    action: z.literal('add_dashboard_member'),
    email: z.string().min(3).max(254),
    role: z.enum(['OWNER', 'MANAGER', 'STAFF']),
  }),
  z.object({ action: z.literal('remove_dashboard_member'), userId: z.string().min(1) }),
  z.object({ action: z.literal('deactivate_store') }),
]);

/** An "every N days" task counts from a start date: the owner's, or today (store time) when they left it out. */
function withAnchor<T extends { frequency: string; anchorDate: string | null }>(t: T, today: string): T {
  return t.frequency === 'interval' && !t.anchorDate ? { ...t, anchorDate: today } : t;
}

class ReportError extends Error {}

async function readReport(pdf: string): Promise<ParsedReport> {
  let text: string;
  try {
    text = await extractPdfText(Buffer.from(pdf, 'base64'));
  } catch (error) {
    throw new ReportError(error instanceof NotAPdfError ? error.message : 'Could not read that file.');
  }
  const report = parseInspectorReport(text);
  if (!report || report.percent === null) {
    throw new ReportError('This does not look like a 7-Eleven 7Clean "Debrief Report". Nothing was changed.');
  }
  return report;
}

function wouldExceedLimit(current: number, adding: number): boolean {
  return current + adding > MAX_TEMPLATES_PER_STORE;
}

function one(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function vendorCatalog(profileJson: unknown) {
  const stored = parseStoredProfile(profileJson);
  return {
    vendors: stored.vendors,
    vendorCategories: VENDOR_CATEGORIES.map((id) => ({ id, label: VENDOR_CATEGORY_LABEL[id] })),
  };
}

function pictureMaps(profileJson: unknown) {
  return pictureMapsBoard(parseStoredProfile(profileJson).pictureTemplates);
}

function templateView(t: {
  id: string; title: string; instructions: string | null; category: string; standardId: string | null; criticality: string | null;
  minValue: number | null; maxValue: number | null; unit: string | null; fallback: string | null; shift: string | null; startTime: string; endTime: string | null;
  repeatEveryMinutes: number | null; frequency: string; intervalDays: number | null; monthDays: number[]; anchorDate: string | null;
  daysOfWeek: number[]; evidence: string; photoCheck: string | null; points: number; remindEveryMinutes: number;
  escalateAfterMinutes: number | null; lateAfterMinutes: number; active: boolean;
}) {
  return { ...t, scheduleText: describeSchedule(t) };
}

/**
 * GET  /api/stores/tasks?storeId=S001                 board: setup, today's tasks, scores, starter tasks
 * GET  /api/stores/tasks?storeId=S001&view=inspection  predicted inspection result "if the inspector walked in now"
 * GET  /api/stores/tasks?storeId=S001&photo=<runId>   the proof photo of a finished task
 * POST /api/stores/tasks?storeId=S001  { action: create | update | delete | import_presets | close | approve | run_now | preview_report | apply_report }
 * Reading is for any member of the store; changing setup is for owners and managers.
 */
async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const storeId = one(req.query.storeId);
  if (!storeId) {
    res.status(400).json({ error: 'storeId required' });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const access = await requireStoreAccess(req, res, prisma, storeId, false);
    if (!access) return;
    const canEdit = access.role === 'OWNER' || access.role === 'MANAGER';
    const canManageOwners = access.role === 'OWNER';
    const actor = { userId: access.user.userId, role: access.role };

    const store = await prisma.storeConfig.findUnique({ where: { storeId }, select: { storeName: true, timezone: true, setupJson: true, profileJson: true } });
    if (!store) {
      res.status(404).json({ error: 'Store not found' });
      return;
    }
    const timeZone = isValidTimeZone(store.timezone) ? store.timezone : 'America/New_York';

    if (req.method === 'GET') {
      logApp('tasks.get', { storeId, view: one(req.query.view) || 'board', photo: Boolean(one(req.query.photo)) });
      const photoRunId = one(req.query.photo);
      if (photoRunId) {
        await sendPhoto(res, storeId, photoRunId);
        return;
      }
      const now = new Date();
      if (one(req.query.view) === 'setup') {
        res.status(200).json({
          success: true, storeName: store.storeName, canEdit, setup: readStoredSetup(store.setupJson),
          storeTypes: storeTypeOptions().map((t) => ({ ...t, modules: dashboardModules(t.id, t.defaults.fuel) })),
          messageSamples: parseStoredProfile(store.profileJson).messageSamples,
          ...vendorCatalog(store.profileJson),
          ...pictureMaps(store.profileJson),
          buckets: TASK_BUCKETS,
        });
        return;
      }
      const setup = readStoredSetup(store.setupJson);
      if (one(req.query.view) === 'inspection') {
        if (!inspectionApplies(setup?.storeType ?? null)) {
          res.status(400).json({ error: 'The inspection score is for 7-Eleven stores.' });
          return;
        }
        const [templates, runs, lastReport] = await Promise.all([
          prisma.taskTemplate.findMany({ where: { storeId }, take: 200 }),
          prisma.taskRun.findMany({ where: { storeId, dueAt: { gte: new Date(now.getTime() - 14 * DAY) } }, orderBy: { dueAt: 'desc' }, take: 5000 }),
          prisma.inspectionReport.findFirst({ where: { storeId }, orderBy: { inspectedOn: 'desc' } }),
        ]);
        // A task that comes round every few days or monthly may not have run in the last two weeks: take its latest run.
        const seenRuns = new Set(runs.map((r) => r.id));
        const latestRare = await Promise.all(
          templates.filter((t) => t.active && t.frequency !== 'weekly').map((t) => prisma.taskRun.findFirst({ where: { templateId: t.id, dueAt: { lte: now } }, orderBy: { dueAt: 'desc' } })),
        );
        for (const r of latestRare) if (r && !seenRuns.has(r.id)) runs.push(r);
        const lastFindings = Array.isArray(lastReport?.findings) ? (lastReport.findings as Array<{ standardId?: string }>) : [];
        const catalog = TASK_PRESETS.filter((p) => p.source === 'report' && p.template.standardId).map((p) => ({
          standardId: p.template.standardId as string, presetId: p.id, title: p.template.title, category: p.template.category,
          criticality: p.template.criticality, points: p.template.points, requires: p.requires,
        }));
        const prediction = predictInspection(catalog, templates, runs, now, new Set(lastFindings.map((f) => f.standardId).filter((id): id is string => Boolean(id))));
        res.status(200).json({
          success: true, storeName: store.storeName, canEdit, prediction, generatedAt: now,
          lastReport: lastReport && {
            inspectedOn: lastReport.inspectedOn, percent: lastReport.percent, cycle: lastReport.cycle, visit: lastReport.visit,
            property: lastReport.property, categories: lastReport.categories, findings: lastReport.findings,
          },
        });
        return;
      }
      const today = localDateString(now, timeZone);
      const [templates, recent, people] = await Promise.all([
        prisma.taskTemplate.findMany({ where: { storeId }, orderBy: [{ startTime: 'asc' }, { title: 'asc' }], take: 200 }),
        prisma.taskRun.findMany({ where: { storeId, dueAt: { gte: new Date(now.getTime() - 7 * DAY) } }, orderBy: { dueAt: 'asc' }, take: 3000 }),
        loadStoreTeam(prisma, storeId),
      ]);
      const todayRuns = recent.filter((r) => r.localDate === today || r.status === 'OPEN');
      res.status(200).json({
        success: true,
        storeName: store.storeName,
        timeZone,
        canEdit,
        canManageOwners,
        people,
        today,
        templates: templates.map(templateView),
        runs: todayRuns.map((r) => ({
          id: r.id, title: r.title, category: r.category, evidence: r.evidence, points: r.points, dueAt: r.dueAt, code: r.code,
          status: r.status, completedAt: r.completedAt, evidenceType: r.evidenceType, evidenceText: r.evidenceText,
          hasPhoto: Boolean(r.evidenceMediaId), lateAfterMinutes: r.lateAfterMinutes,
          standardId: r.standardId, criticality: r.criticality, outcome: r.outcome, resultValue: r.resultValue, unit: r.unit, issueText: r.issueText, photoCheck: r.photoCheck, photoVerdict: r.photoVerdict, photoNote: r.photoNote, photoMisses: r.photoMisses, reminderCount: r.reminderCount, escalated: Boolean(r.escalatedAt),
        })),
        scoreToday: scoreRuns(recent.filter((r) => r.localDate === today), now),
        scoreWeek: scoreRuns(recent, now),
        presets: presetsForStore(setup?.storeType ?? null).map((p) => ({
          id: p.id, group: p.group, bucket: bucketFor(p), source: p.source, requires: p.requires ?? null, title: p.template.title, scheduleText: describeSchedule(p.template),
          category: p.template.category, standardId: p.template.standardId, criticality: p.template.criticality, points: p.template.points,
          alreadyOnStore: presetIsOnStore(p, templates),
        })),
        features: Object.entries(STORE_FEATURE_LABEL).map(([id, label]) => ({ id, label })),
        setup,
        modules: dashboardModules(setup?.storeType ?? null, setup?.fuel),
        messageSamples: parseStoredProfile(store.profileJson).messageSamples,
        ...vendorCatalog(store.profileJson),
        ...pictureMaps(store.profileJson),
        buckets: TASK_BUCKETS,
      });
      return;
    }

    if (!canEdit) {
      res.status(403).json({ error: 'Only owners and managers can change tasks' });
      return;
    }
    const parsedBody = BodySchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({ error: 'Unknown or incomplete request' });
      return;
    }
    const body = parsedBody.data;
    logApp('tasks.action', { storeId, action: body.action, userId: actor.userId });

    if (body.action === 'run_now') {
      const result = await runTaskTick(prisma, new Date(), { storeId });
      res.status(200).json({ success: true, ...result });
      return;
    }

    if (body.action === 'setup_preview' || body.action === 'setup_apply') {
      const parsedSetup = StoreSetupSchema.safeParse(body.setup);
      if (!parsedSetup.success) {
        res.status(400).json({ error: parsedSetup.error.issues.map((i) => i.message).join('; ') });
        return;
      }
      const suggestions = suggestTasks(parsedSetup.data);
      if (body.action === 'setup_preview') {
        res.status(200).json({
          success: true,
          suggestions: suggestions.map((x) => ({
            presetId: x.presetId, title: x.title, group: x.group, bucket: x.bucket, bucketLabel: x.bucketLabel, source: x.source, recommended: x.recommended,
            scheduleText: x.scheduleText, shift: x.template.shift, standardId: x.template.standardId, criticality: x.template.criticality, points: x.template.points,
            evidence: x.template.evidence, instructions: x.template.instructions,
          })),
        });
        return;
      }
      const wanted = new Set(body.presetIds);
      const chosen = suggestions.filter((x) => wanted.has(x.presetId));
      if (chosen.length !== wanted.size) {
        res.status(400).json({ error: 'Unknown starter task for this store' });
        return;
      }
      const existing = await prisma.taskTemplate.findMany({ where: { storeId }, select: { title: true } });
      const have = new Set(existing.map((t) => t.title.toLowerCase()));
      const toAdd = chosen.filter((x) => !have.has(x.template.title.toLowerCase()));
      if (wouldExceedLimit(existing.length, toAdd.length)) {
        res.status(400).json({ error: `A store can have up to ${MAX_TEMPLATES_PER_STORE} tasks` });
        return;
      }
      await prisma.storeConfig.update({ where: { storeId }, data: { setupJson: parsedSetup.data as unknown as Prisma.InputJsonValue } });
      const today = localDateString(new Date(), timeZone);
      for (const x of toAdd) await prisma.taskTemplate.create({ data: { ...withAnchor(x.template, today), storeId } });
      res.status(200).json({ success: true, added: toAdd.length, skipped: chosen.length - toAdd.length });
      return;
    }

    if (body.action === 'save_samples') {
      let dailyClose = body.dailyClose;
      let invoice = body.invoice;
      if (body.dailyCloseImage) {
        const profile = applyStoredProfile(
          buildDefaultProfile({ storeId, storeName: store.storeName, timezone: store.timezone }),
          parseStoredProfile(store.profileJson),
        );
        const read = await sampleFromDailyClosePhoto(
          { base64: body.dailyCloseImage, mimeType: body.dailyCloseMime ?? 'image/jpeg' },
          undefined,
          [profile],
        );
        if (!read.ok) {
          res.status(400).json({ error: read.error });
          return;
        }
        dailyClose = read.text;
      }
      if (body.invoiceImage) {
        const read = await sampleFromInvoicePhoto({
          base64: body.invoiceImage,
          mimeType: body.invoiceMime ?? 'image/jpeg',
        });
        if (!read.ok) {
          res.status(400).json({ error: read.error });
          return;
        }
        invoice = read.text;
      }
      await saveMessageSamples(prisma, storeId, { dailyClose, invoice });
      res.status(200).json({
        success: true,
        dailyCloseSample: dailyClose?.trim() || undefined,
        invoiceSample: invoice?.trim() || undefined,
      });
      return;
    }

    if (body.action === 'save_vendors') {
      await saveVendors(prisma, storeId, body.vendors);
      res.status(200).json({ success: true });
      return;
    }

    if (body.action === 'save_picture_template') {
      try {
        const saved = await savePictureTemplate(prisma, storeId, body.template);
        res.status(200).json({ success: true, template: saved, summary: describePictureTemplate(saved) });
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Could not save that picture map.' });
      }
      return;
    }

    if (body.action === 'delete_picture_template') {
      await deletePictureTemplate(prisma, storeId, body.id);
      res.status(200).json({ success: true });
      return;
    }

    if (body.action === 'add_whatsapp_person') {
      const result = await addWhatsAppPerson(prisma, storeId, actor, body);
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.status(200).json({ success: true });
      return;
    }
    if (body.action === 'update_whatsapp_person') {
      const result = await updateWhatsAppPerson(prisma, storeId, actor, body);
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.status(200).json({ success: true });
      return;
    }
    if (body.action === 'remove_whatsapp_person') {
      const result = await removeWhatsAppPerson(prisma, storeId, actor, body.id);
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.status(200).json({ success: true });
      return;
    }
    if (body.action === 'add_dashboard_member') {
      const result = await addDashboardMember(prisma, storeId, actor, body);
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.status(200).json({ success: true });
      return;
    }
    if (body.action === 'remove_dashboard_member') {
      const result = await removeDashboardMember(prisma, storeId, actor, body.userId);
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.status(200).json({ success: true });
      return;
    }
    if (body.action === 'deactivate_store') {
      const result = await deactivateStore(prisma, storeId, actor);
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.status(200).json({ success: true });
      return;
    }

    if (body.action === 'close') {
      const run = await prisma.taskRun.findFirst({ where: { id: body.runId, storeId, status: 'OPEN' } });
      if (!run) {
        res.status(404).json({ error: 'Open task not found' });
        return;
      }
      // A manager closing a task by hand: it counts as missed, so it stops nagging but is not a free pass.
      await prisma.taskRun.update({ where: { id: run.id }, data: { status: 'MISSED' } });
      res.status(200).json({ success: true });
      return;
    }

    if (body.action === 'approve') {
      const run = await prisma.taskRun.findFirst({ where: { id: body.runId, storeId, status: 'OPEN' } });
      if (!run || !run.evidenceMediaId) {
        res.status(404).json({ error: 'No open task with a photo to accept' });
        return;
      }
      await prisma.taskRun.update({
        where: { id: run.id },
        data: { status: 'DONE', completedAt: new Date(), completedByPhone: run.completedByPhone, outcome: 'fixed', photoVerdict: 'approved', evidenceType: 'photo' },
      });
      res.status(200).json({ success: true });
      return;
    }

    if (body.action === 'delete') {
      const found = await prisma.taskTemplate.findFirst({ where: { id: body.id, storeId } });
      if (!found) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }
      await prisma.taskTemplate.delete({ where: { id: found.id } });
      res.status(200).json({ success: true });
      return;
    }

    if (body.action === 'preview_report' || body.action === 'apply_report') {
      if (!inspectionApplies(readStoredSetup(store.setupJson)?.storeType ?? null)) {
        res.status(400).json({ error: 'The inspector report import is for 7-Eleven stores.' });
        return;
      }
      let report: ParsedReport;
      try {
        report = await readReport(body.pdf);
      } catch (error) {
        if (error instanceof ReportError) {
          res.status(422).json({ error: error.message });
          return;
        }
        throw error;
      }
      const existing = await prisma.taskTemplate.findMany({ where: { storeId }, select: { standardId: true, active: true } });
      const proposals = proposeFromReport(report, TASK_PRESETS, existing);
      const inspectedOn = report.inspectedOn ? new Date(`${report.inspectedOn}T00:00:00Z`) : null;
      const alreadySaved = inspectedOn
        ? Boolean(await prisma.inspectionReport.findFirst({ where: { storeId, inspectedOn, percent: report.percent as number }, select: { id: true } }))
        : false;

      if (body.action === 'preview_report') {
        res.status(200).json({
          success: true,
          alreadySaved,
          report: {
            property: report.property, inspectedOn: report.inspectedOn, cycle: report.cycle, visit: report.visit, percent: report.percent,
            earned: report.earned, possible: report.possible, categories: report.categories, hasFuelPumps: report.hasFuelPumps,
          },
          proposals,
        });
        return;
      }

      const chosen = new Set(body.standardIds.map((id) => id.toUpperCase()));
      const toAdd = proposals.filter((p) => (p.kind === 'add' || p.kind === 'custom') && chosen.has(p.standardId));
      if (wouldExceedLimit(await prisma.taskTemplate.count({ where: { storeId } }), toAdd.length)) {
        res.status(400).json({ error: `A store can have up to ${MAX_TEMPLATES_PER_STORE} tasks` });
        return;
      }
      let added = 0;
      for (const proposal of toAdd) {
        const finding = report.findings.find((f) => f.standardId === proposal.standardId);
        if (!finding) continue;
        const preset = proposal.kind === 'add' && proposal.presetId ? getPreset(proposal.presetId) : undefined;
        const template = preset ? presetTemplate(preset, finding, report.inspectedOn) : customTemplate(finding, report.inspectedOn);
        await prisma.taskTemplate.create({ data: { ...withAnchor(template, localDateString(new Date(), timeZone)), storeId } });
        added += 1;
      }
      let saved = false;
      if (!alreadySaved) {
        try {
          await prisma.inspectionReport.create({
            data: {
              storeId,
              inspectedOn: inspectedOn ?? new Date(`${localDateString(new Date(), timeZone)}T00:00:00Z`),
              cycle: report.cycle, visit: report.visit, percent: report.percent as number, earned: report.earned, possible: report.possible,
              property: report.property,
              categories: report.categories.map((c) => ({ label: c.label, earned: c.earned, possible: c.possible })),
              findings: report.findings.map((f) => ({ standardId: f.standardId, question: f.question, criticality: f.criticality, points: f.points, comment: f.comment, details: f.details, repeat: f.repeat })),
            },
          });
          saved = true;
        } catch (error) {
          // Two people importing the same report at once: the second finds it already there.
          if (!(error instanceof Error && 'code' in error && (error as { code?: string }).code === 'P2002')) throw error;
        }
      }
      res.status(200).json({ success: true, added, saved });
      return;
    }

    const count = await prisma.taskTemplate.count({ where: { storeId } });

    if (body.action === 'import_presets') {
      const presets = body.presetIds.map(getPreset);
      if (presets.some((p) => !p)) {
        res.status(400).json({ error: 'Unknown starter task' });
        return;
      }
      if (count + presets.length > MAX_TEMPLATES_PER_STORE) {
        res.status(400).json({ error: `A store can have up to ${MAX_TEMPLATES_PER_STORE} tasks` });
        return;
      }
      const existingRows = await prisma.taskTemplate.findMany({ where: { storeId }, select: { title: true, standardId: true } });
      let added = 0;
      for (const preset of presets) {
        const found = preset as NonNullable<typeof preset>;
        if (presetIsOnStore(found, existingRows)) continue;
        const t = found.template;
        await prisma.taskTemplate.create({ data: { ...withAnchor(t, localDateString(new Date(), timeZone)), storeId } });
        existingRows.push({ title: t.title, standardId: t.standardId ?? null });
        added += 1;
      }
      res.status(200).json({ success: true, added, skipped: presets.length - added });
      return;
    }

    const parsedTemplate = TaskTemplateInputSchema.safeParse(body.template);
    if (!parsedTemplate.success) {
      res.status(400).json({ error: parsedTemplate.error.issues.map((i) => i.message).join('; ') });
      return;
    }

    if (body.action === 'create') {
      if (count >= MAX_TEMPLATES_PER_STORE) {
        res.status(400).json({ error: `A store can have up to ${MAX_TEMPLATES_PER_STORE} tasks` });
        return;
      }
      const created = await prisma.taskTemplate.create({ data: { ...withAnchor(parsedTemplate.data, localDateString(new Date(), timeZone)), storeId } });
      res.status(201).json({ success: true, id: created.id });
      return;
    }

    const found = await prisma.taskTemplate.findFirst({ where: { id: body.id, storeId } });
    if (!found) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    await prisma.taskTemplate.update({ where: { id: found.id }, data: withAnchor(parsedTemplate.data, localDateString(new Date(), timeZone)) });
    res.status(200).json({ success: true });
  } catch (error) {
    logAppError('stores.tasks', serializeError(error));
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}

export default loggedHandler('stores.tasks', handler);

/** Proof photos live at WhatsApp, which keeps them for about 30 days. */
async function sendPhoto(res: VercelResponse, storeId: string, runId: string): Promise<void> {
  const run = await prisma.taskRun.findFirst({ where: { id: runId, storeId }, select: { evidenceMediaId: true } });
  if (!run?.evidenceMediaId) {
    res.status(404).json({ error: 'No photo for this task' });
    return;
  }
  try {
    const media = await downloadWhatsAppMedia(run.evidenceMediaId);
    if (!/^image\/(jpeg|png|webp|gif)$/i.test(media.mimeType)) {
      res.status(415).json({ error: 'Not an image' });
      return;
    }
    res.setHeader('Content-Type', media.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.status(200).send(media.buffer);
  } catch {
    res.status(404).json({ error: 'The photo is no longer available from WhatsApp' });
  }
}
