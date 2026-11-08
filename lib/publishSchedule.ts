import type { PrismaClient } from '@prisma/client';
import { ClassificationType, PendingStatus } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { WorkScheduleSchema, type WorkSchedule } from './understanding/schema';
import { summarizeSchedule } from './understanding/schedule';
import { scheduleGroupMessage, schedulePayload } from './understanding/plan';
import { postToStoreGroups } from './whatsappMessaging';

export type PublishScheduleInput = {
  storeId: string;
  storeName: string;
  phoneE164: string;
  weekStart: string;
  employees: Array<{
    name: string;
    shifts: Array<{ day?: string | null; date?: string | null; start: string; end: string }>;
  }>;
  postToGroup?: boolean;
};

export type PublishScheduleResult =
  | { ok: true; actionId: string; posted: number }
  | { ok: false; status: number; error: string };

function asWorkSchedule(input: PublishScheduleInput): WorkSchedule | null {
  const parsed = WorkScheduleSchema.safeParse({
    storeHint: null,
    weekStart: input.weekStart,
    employees: input.employees
      .map((e) => ({
        name: String(e.name || '').trim(),
        statedTotalHours: null,
        adjustedHours: null,
        shifts: (e.shifts || [])
          .filter((s) => s.start && s.end)
          .map((s) => ({
            day: s.day ?? null,
            date: s.date ?? null,
            start: s.start,
            end: s.end,
            breakMinutes: null,
          })),
      }))
      .filter((e) => e.name && e.shifts.length > 0),
  });
  return parsed.success ? parsed.data : null;
}

/**
 * Owner/manager publishes a week from the dashboard. Hours only — the same shape as a
 * WhatsApp schedule sheet after OK. Replaces an existing confirmed week with the same start.
 */
export async function publishDashboardSchedule(
  prisma: PrismaClient,
  input: PublishScheduleInput
): Promise<PublishScheduleResult> {
  const schedule = asWorkSchedule(input);
  if (!schedule || schedule.employees.length === 0) {
    return { ok: false, status: 400, error: 'Add at least one person with a start and end time.' };
  }

  const summary = summarizeSchedule(schedule);
  const payload = schedulePayload(schedule, summary, []);

  const existing = await prisma.pendingActions.findMany({
    where: { storeId: input.storeId, type: ClassificationType.UNKNOWN, status: PendingStatus.CONFIRMED },
    orderBy: { createdAt: 'desc' },
    take: 80,
  });
  const same = existing.find((row) => {
    const data = row.payloadJson as { _kind?: string; week_start?: string } | null;
    return data?._kind === 'work_schedule' && data.week_start === schedule.weekStart;
  });

  let actionId = same?.actionId || uuidv4();
  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 2);

  if (same) {
    await prisma.pendingActions.update({
      where: { actionId: same.actionId },
      data: { payloadJson: payload as object, confidence: 1, phoneE164: input.phoneE164 },
    });
    actionId = same.actionId;
  } else {
    await prisma.pendingActions.create({
      data: {
        actionId,
        phoneE164: input.phoneE164,
        storeId: input.storeId,
        type: ClassificationType.UNKNOWN,
        payloadJson: payload as object,
        confidence: 1,
        status: PendingStatus.CONFIRMED,
        messageIdInbound: `dashboard-schedule:${input.storeId}:${schedule.weekStart}`,
        expiresAt,
      },
    });
  }

  let posted = 0;
  if (input.postToGroup !== false) {
    const message = scheduleGroupMessage(payload, input.storeName);
    if (message) posted = await postToStoreGroups(prisma, input.storeId, message);
  }

  return { ok: true, actionId, posted };
}
