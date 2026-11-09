import type { PrismaClient } from '@prisma/client';
import { PendingStatus } from '@prisma/client';
import { format, startOfDay, endOfDay } from 'date-fns';
import { deliverStoreMessage, postToStoreGroups, sendWhatsAppMessage } from './whatsappMessaging';
import { computerDashboardHint, groupDashboardHint, isPublicAppUrl, sendPrivateDashboardLinks } from './whatsappLogin';
import {
  cancelPendingAction,
  confirmPendingAction,
  getLatestPendingAction,
  getLatestPendingBatch,
} from './pendingActionService';
import { describeDepositRule, matchStore, type Check } from './understanding/checks';
import { applyFixToPayload, dailyClosePayload, describeEntryPayload, invoicePayload, scheduleHoursMessage, scheduleSheetMessage } from './understanding/plan';
import { mergeDailyCloseReports } from './understanding/closeMerge';
import { reportFromClosePayload } from './understanding/depositDue';
import type { DailyCloseReport } from './understanding/schema';
import {
  businessDayOf,
  formatDaySummary,
  loadDayActivity,
  storeTypeOf,
  summaryKindForStore,
} from './understanding/daySummary';
import { formatBagLine, formatSlipResult, isDepositStoreType, loadDepositBag } from './understanding/depositDue';
import { DepositRuleSchema, clearDepositRule, saveDepositRule } from './understanding/profileStore';
import { loadStoreProfiles } from './understanding/storeProfiles';
import { completeOpenFuelPriceTask, describeOpenTasks } from './tasks/evidence';
import { describeOpenBills, formatInvoiceDay, loadOpenInvoices, scheduleInvoicePaymentReminder } from './tasks/invoiceReminder';
import { localDateString } from './tasks/time';
import type { Invoice } from './understanding/schema';

export interface CommandResult {
  success: boolean;
  message: string;
  storeId?: string;
}

const COMMAND_RE = /^(OK|CANCEL|FIX|STATUS|TODAY|TASKS|WEEK|MONTH|HELP|SEND|RULE|DUE)(\s|$)/i;
/** Old link command only — not "store sales" / "store cash" captions on a close photo. */
const STORE_LINK_RE = /^STORE(\s+S\d+)?$/i;

export function isWhatsAppCommand(text: string): boolean {
  const trimmed = text.trim();
  return COMMAND_RE.test(trimmed) || STORE_LINK_RE.test(trimmed);
}

export async function handleWhatsAppCommand(
  prisma: PrismaClient,
  phoneE164: string,
  commandText: string,
  extra: { groupId?: string | null } = {}
): Promise<CommandResult> {
  const parts = commandText.trim().split(/\s+/);
  const command = parts[0].toUpperCase();

  switch (command) {
    case 'OK':
      return handleOK(prisma, phoneE164, extra.groupId ?? null);
    case 'CANCEL':
      return handleCancel(prisma, phoneE164);
    case 'FIX':
      return handleFix(prisma, phoneE164, parts.slice(1));
    case 'STATUS':
      return handleStatus(prisma, phoneE164);
    case 'TODAY':
      return handleToday(prisma, phoneE164);
    case 'TASKS':
      return handleTasks(prisma, phoneE164);
    case 'RULE':
      return handleRule(prisma, phoneE164, parts.slice(1));
    case 'HELP':
      return handleHelp();
    case 'DUE':
      return handleDue(prisma, phoneE164);
    case 'STORE':
      return {
        success: false,
        message:
          'Store linking via WhatsApp is disabled for security. Ask your store owner to add your number from the dashboard.',
      };
    default:
      return {
        success: false,
        message: 'Unknown command. Reply HELP for available commands.',
      };
  }
}

function sourceGroupId(payload: Record<string, unknown> | null, inboundGroupId?: string | null): string | null {
  const fromPayload = typeof payload?.source_group_id === 'string' ? payload.source_group_id.trim() : '';
  const inbound = inboundGroupId?.trim() || '';
  return fromPayload || inbound || null;
}

async function handleOK(prisma: PrismaClient, phoneE164: string, inboundGroupId?: string | null): Promise<CommandResult> {
  const batch = await getLatestPendingBatch(prisma, phoneE164);
  if (batch.length === 0) {
    return { success: false, message: 'No pending action found.' };
  }

  let sheetsWritten = 0;
  let sheetsFailed = 0;
  const learned: string[] = [];
  const hoursPosted: string[] = [];
  const hoursPostedDirect: string[] = [];
  const hoursNotPosted: string[] = [];
  const invoiceReminders: string[] = [];

  for (const pending of batch) {
    let payload = pending.payloadJson as Record<string, unknown> | null;
    let mergedAway = false;
    const updateId = typeof payload?.updates_action_id === 'string' ? payload.updates_action_id : '';
    if (payload?._kind === 'daily_close' && updateId && updateId !== pending.actionId) {
      try {
        const original = await prisma.pendingActions.findFirst({
          where: { actionId: updateId, storeId: pending.storeId },
        });
        const incoming = reportFromClosePayload(payload);
        if (original && incoming) {
          const origPayload = (original.payloadJson ?? {}) as Record<string, unknown>;
          const existing = reportFromClosePayload(origPayload);
          const merged = existing ? mergeDailyCloseReports(existing, incoming) : incoming;
          const checks = Array.isArray(payload.checks) ? (payload.checks as Check[]) : [];
          const review = Array.isArray(payload.needs_review) ? (payload.needs_review as string[]) : [];
          const mergedPayload = {
            ...origPayload,
            ...dailyClosePayload(merged as DailyCloseReport, checks, review),
          };
          await prisma.pendingActions.update({
            where: { actionId: original.actionId },
            data: { payloadJson: mergedPayload as object, status: PendingStatus.CONFIRMED },
          });
          await prisma.pendingActions.update({
            where: { actionId: pending.actionId },
            data: { status: PendingStatus.CANCELLED },
          });
          payload = mergedPayload;
          mergedAway = true;
        }
      } catch (e) {
        console.warn('Could not merge close pages', e instanceof Error ? e.message : e);
      }
    }

    if (!mergedAway) {
      await confirmPendingAction(prisma, pending.actionId);
    }

    // The owner saw "OK also teaches me this store's deposit rule" and confirmed, so remember it.
    const proposed = payload?.suggested_deposit_rule;
    const rule = proposed ? DepositRuleSchema.safeParse(proposed) : null;
    if (rule?.success) {
      try {
        await saveDepositRule(prisma, pending.storeId, rule.data);
        const store = await prisma.storeConfig.findUnique({
          where: { storeId: pending.storeId },
          select: { storeName: true },
        });
        learned.push(
          `🧠 Remembered the deposit rule for ${store?.storeName ?? pending.storeId}: ${describeDepositRule(rule.data)}.`
        );
      } catch (e) {
        console.warn('Could not save deposit rule', e instanceof Error ? e.message : e);
      }
    }
    if ((payload?._kind === 'invoice' || payload?._kind === 'invoice_payment') && payload.invoice) {
      if (payload._kind === 'invoice_payment' && typeof payload.updates_action_id === 'string') {
        try {
          const original = await prisma.pendingActions.findFirst({
            where: { actionId: payload.updates_action_id, storeId: pending.storeId },
          });
          const invoice = payload.invoice as Invoice;
          const checks = Array.isArray(payload.checks) ? (payload.checks as Check[]) : [];
          const review = Array.isArray(payload.needs_review) ? (payload.needs_review as string[]) : [];
          if (original) {
            const origPayload = (original.payloadJson ?? {}) as Record<string, unknown>;
            await prisma.pendingActions.update({
              where: { actionId: original.actionId },
              data: { payloadJson: { ...origPayload, ...invoicePayload(invoice, checks, review), _kind: 'invoice' } as object },
            });
          } else {
            await prisma.pendingActions.update({
              where: { actionId: pending.actionId },
              data: { payloadJson: { ...payload, ...invoicePayload(invoice, checks, review), _kind: 'invoice' } as object },
            });
          }
        } catch (e) {
          console.warn('Could not merge invoice payment', e instanceof Error ? e.message : e);
        }
      }
      try {
        const store = await prisma.storeConfig.findUnique({
          where: { storeId: pending.storeId },
          select: { storeName: true, timezone: true },
        });
        const timeZone = store?.timezone || 'America/New_York';
        const now = new Date();
        const result = await scheduleInvoicePaymentReminder(prisma, pending.storeId, payload.invoice as Invoice, {
          today: localDateString(now, timeZone),
          now,
          timeZone,
        });
        if (result.scheduled) {
          invoiceReminders.push(
            `⏰ I'll remind the group on ${formatInvoiceDay(result.reminderDate)} to pay ${result.title.replace(/^Pay /, '')}.`
          );
        }
      } catch (e) {
        console.warn('Could not schedule invoice payment reminder', e instanceof Error ? e.message : e);
      }
    }

    const payloadKind = (pending.payloadJson as Record<string, unknown> | null)?._kind;
    if (payloadKind === 'fuel_prices') {
      const source = (pending.payloadJson as { source?: string }).source === 'own' ? 'own' : 'competitor';
      try {
        await completeOpenFuelPriceTask(prisma, {
          storeId: pending.storeId,
          phoneE164,
          source,
        });
      } catch (e) {
        console.warn('Could not close competitor-price task', e instanceof Error ? e.message : e);
      }
    }

    // Confirmed hours go to the store group, or 1:1 to the owner when there is no group. Never pay.
    if (payloadKind === 'work_schedule') {
      const store = await prisma.storeConfig.findUnique({ where: { storeId: pending.storeId }, select: { storeName: true } });
      const payloadJson = pending.payloadJson as Record<string, unknown>;
      const storeName = store?.storeName ?? pending.storeId;
      const sheet = scheduleSheetMessage(payloadJson, storeName);
      const extraGroup = sourceGroupId(pending.payloadJson as Record<string, unknown> | null, inboundGroupId);
      const delivery = sheet
        ? await deliverStoreMessage(prisma, pending.storeId, sheet, {
            extraGroupId: extraGroup,
            extraPhone: phoneE164,
            directMessage: scheduleHoursMessage(payloadJson, storeName),
          })
        : { posted: 0, via: 'none' as const };
      if (delivery.via === 'group') hoursPosted.push(store?.storeName ?? pending.storeId);
      else if (delivery.via === 'direct') hoursPostedDirect.push(store?.storeName ?? pending.storeId);
      else hoursNotPosted.push(store?.storeName ?? pending.storeId);
    }

    try {
      const { writeConfirmedActionToSheets } = await import('./googleSheetsWrite');
      const result = await writeConfirmedActionToSheets(prisma, pending.storeId, pending.type, payload);
      if (result === 'written') sheetsWritten += 1;
    } catch (e) {
      sheetsFailed += 1;
      console.warn('Google Sheets write failed', e instanceof Error ? e.message : e);
    }
  }

  const count = batch.length > 1 ? `${batch.length} entries` : 'entry';
  let message: string;
  if (sheetsFailed > 0) {
    // Never claim a sheet was updated when it was not.
    message = `✅ Saved ${count} to your dashboard.\n⚠️ The Google Sheet could not be updated this time.`;
  } else if (sheetsWritten > 0) {
    message = `✅ Saved ${count} to your dashboard and Google Sheet.`;
  } else {
    message = `✅ Saved ${count} to your dashboard.`;
  }

  if (learned.length > 0) message += `\n${learned.join('\n')}`;
  if (hoursPosted.length > 0) message += `\n📣 Posted this week's shifts to the ${hoursPosted.join(' and ')} group.`;
  if (hoursPostedDirect.length > 0) {
    message += `\n📣 Sent the hours to your WhatsApp${hoursPostedDirect.length === 1 ? '' : ` (${hoursPostedDirect.join(' and ')})`}.`;
  }
  if (hoursNotPosted.length > 0) {
    message += `\n⚠️ Hours are on the dashboard, but I could not send them on WhatsApp.`;
  }
  if (invoiceReminders.length > 0) message += `\n${invoiceReminders.join('\n')}`;

  const wrapUp = await maybePostDaySummary(prisma, batch);
  if (wrapUp) message += `\n\n${wrapUp}`;

  const bagNote = await maybeDepositBagNote(prisma, batch);
  if (bagNote) message += `\n${bagNote}`;

  return { success: true, message, storeId: batch[0].storeId };
}

async function maybePostDaySummary(
  prisma: PrismaClient,
  batch: Array<{ storeId: string; type: string; payloadJson: unknown }>
): Promise<string | null> {
  const storeId = batch[0]?.storeId;
  if (!storeId) return null;
  try {
    const store = await prisma.storeConfig.findUnique({
      where: { storeId },
      select: { storeId: true, storeName: true, timezone: true, setupJson: true, profileJson: true },
    });
    const rows = batch.map((p) => ({
      type: p.type,
      payload: (p.payloadJson ?? {}) as Record<string, unknown>,
    }));
    const kind = summaryKindForStore(storeTypeOf(store?.setupJson), rows);
    if (!kind) return null;
    const timeZone = store?.timezone?.trim() || 'America/New_York';
    const now = new Date();
    const day = businessDayOf(rows, now, timeZone);
    const activity = await loadDayActivity(prisma, storeId, day, kind, now);
    if (!activity) return null;
    let text = formatDaySummary(activity);
    if (!text) return null;
    if (kind === 'store_day') {
      const bag = await loadDepositBag(prisma, store ?? { storeId }, now, { includeTodayCloses: true });
      const bagLine = formatBagLine(bag);
      if (bagLine) text += `\n${bagLine}`;
    }
    const hasClose = rows.some((r) => r.type === 'STORE_SALES' || r.payload._kind === 'daily_close');
    try {
      const privateLinks = await sendPrivateDashboardLinks(prisma, storeId, store?.storeName || 'Store');
      if (privateLinks > 0) text += `\n${groupDashboardHint()}`;
      else if (!isPublicAppUrl()) text += `\n${computerDashboardHint(store?.storeName || 'this store')}`;
    } catch (e) {
      console.warn('Could not send private dashboard links', e instanceof Error ? e.message : e);
    }
    const extraGroup = rows.map((r) => sourceGroupId(r.payload)).find((id) => id) ?? null;
    const posted = hasClose && (await postToStoreGroups(prisma, storeId, text, extraGroup)) > 0;
    return posted ? `${text}\n📣 Posted to the group.` : text;
  } catch (e) {
    console.warn('Could not build the day summary', e instanceof Error ? e.message : e);
    return null;
  }
}

async function maybeDepositBagNote(
  prisma: PrismaClient,
  batch: Array<{ storeId: string; type: string; payloadJson: unknown }>
): Promise<string | null> {
  const storeId = batch[0]?.storeId;
  if (!storeId) return null;
  const hasSlip = batch.some((p) => (p.payloadJson as Record<string, unknown> | null)?._kind === 'deposit_receipt');
  if (!hasSlip) return null;
  try {
    const store = await prisma.storeConfig.findUnique({
      where: { storeId },
      select: { storeId: true, storeName: true, timezone: true, setupJson: true, profileJson: true },
    });
    if (!store || !isDepositStoreType(storeTypeOf(store.setupJson))) return null;
    const bag = await loadDepositBag(prisma, store, new Date(), { includeTodayCloses: true });
    return formatSlipResult(bag);
  } catch (e) {
    console.warn('Could not update the deposit bag', e instanceof Error ? e.message : e);
    return null;
  }
}

async function handleCancel(prisma: PrismaClient, phoneE164: string): Promise<CommandResult> {
  const batch = await getLatestPendingBatch(prisma, phoneE164);
  if (batch.length === 0) {
    return { success: false, message: 'No pending action found.' };
  }
  for (const pending of batch) {
    await cancelPendingAction(prisma, pending.actionId);
  }
  return {
    success: true,
    message: batch.length > 1 ? `❌ Cancelled ${batch.length} entries.` : '❌ Cancelled.',
    storeId: batch[0].storeId,
  };
}

async function handleFix(
  prisma: PrismaClient,
  phoneE164: string,
  args: string[]
): Promise<CommandResult> {
  if (args.length < 2) {
    return { success: false, message: 'Usage: FIX <field> <value>\nExample: FIX amount 1260' };
  }

  const batch = await getLatestPendingBatch(prisma, phoneE164);
  if (batch.length === 0) {
    return { success: false, message: 'No pending action found.' };
  }
  if (batch.length > 1) {
    return {
      success: false,
      message: `That message had ${batch.length} entries, so FIX can't tell which one you mean. Reply CANCEL, then send it again with the correction.`,
      storeId: batch[0].storeId,
    };
  }
  const pending = batch[0];

  const field = args[0].toLowerCase();
  const value = args.slice(1).join(' ');
  const payload = { ...(pending.payloadJson as Record<string, unknown>) };

  if (payload._kind) {
    const fixed = applyFixToPayload(payload, field, value);
    if (!fixed.ok) {
      return { success: false, message: fixed.message, storeId: pending.storeId };
    }
    await prisma.pendingActions.update({
      where: { actionId: pending.actionId },
      data: { payloadJson: fixed.payload as object },
    });
    const store = await prisma.storeConfig.findUnique({ where: { storeId: pending.storeId }, select: { storeName: true } });
    const summary = describeEntryPayload(fixed.payload, store?.storeName ?? pending.storeId);
    // Show the corrected entry so the owner can see the fix took; fall back to warnings alone for old-format entries.
    const warnings = summary
      ? ['', ...summary, '']
      : (fixed.payload.checks as Array<{ status: string; message: string }>)
          .filter((c) => c.status !== 'pass')
          .map((c) => `⚠️ ${c.message}`);
    const suggested = DepositRuleSchema.safeParse(fixed.payload.suggested_deposit_rule);
    const teaching = suggested.success
      ? [`💡 OK also teaches me this store's deposit rule (${describeDepositRule(suggested.data)}).`]
      : [];
    const vendorName = typeof fixed.payload.vendor === 'string' ? fixed.payload.vendor.trim() : '';
    const nextStep =
      fixed.payload._kind === 'order' && vendorName
        ? `Reply OK if this is right so we can send this order to ${vendorName}, or FIX to change more.`
        : 'Reply OK to save, or FIX to change more.';
    return {
      success: true,
      message: [`🔧 Updated ${field}.`, ...warnings, ...teaching, nextStep].join('\n'),
      storeId: pending.storeId,
    };
  }

  if (['amount', 'cash', 'card', 'tax', 'total_inside', 'gallons', 'fuel_sales', 'fuel_gp', 'qty'].includes(field)) {
    payload[field] = parseFloat(value) || 0;
  } else {
    payload[field] = value;
  }

  await prisma.pendingActions.update({
    where: { actionId: pending.actionId },
    data: { payloadJson: payload as object },
  });

  await sendWhatsAppMessage(
    prisma,
    phoneE164,
    `🔧 Updated ${field}. Reply OK to confirm or FIX to change more.`,
    pending.storeId
  );

  return { success: true, message: `Field "${field}" updated.`, storeId: pending.storeId };
}

async function handleStatus(prisma: PrismaClient, phoneE164: string): Promise<CommandResult> {
  const pending = await getLatestPendingAction(prisma, phoneE164);
  if (!pending) {
    return { success: true, message: 'No pending actions.' };
  }
  return {
    success: true,
    message: `📋 Pending ${pending.type}\nConfidence: ${(pending.confidence * 100).toFixed(0)}%\n\nReply OK to confirm or CANCEL to reject.`,
    storeId: pending.storeId,
  };
}

async function handleToday(prisma: PrismaClient, phoneE164: string): Promise<CommandResult> {
  const user = await prisma.userDirectory.findUnique({ where: { phoneE164 } });
  if (!user?.storeId) {
    return { success: false, message: 'Your number is not linked to a store yet.' };
  }

  const today = startOfDay(new Date());
  const count = await prisma.pendingActions.count({
    where: {
      storeId: user.storeId,
      status: PendingStatus.CONFIRMED,
      createdAt: { gte: today, lte: endOfDay(new Date()) },
    },
  });

  return {
    success: true,
    message: `📊 Today (${format(today, 'MMM dd, yyyy')}): ${count} entries confirmed.`,
    storeId: user.storeId,
  };
}

async function handleRule(prisma: PrismaClient, phoneE164: string, args: string[]): Promise<CommandResult> {
  const member = await prisma.userDirectory.findUnique({
    where: { phoneE164 },
    select: { role: true, storeId: true, isActive: true },
  });
  if (!member?.isActive || !member.storeId) {
    return { success: false, message: 'Your number is not linked to a store yet.' };
  }
  if (member.role !== 'OWNER' && member.role !== 'MANAGER') {
    return { success: false, message: 'Only owners and managers can view or change deposit rules.' };
  }

  const profiles = await loadStoreProfiles(prisma, member.storeId, { includeOwnerSiblings: true });

  if (args[0]?.toUpperCase() === 'CLEAR') {
    const name = args.slice(1).join(' ').trim();
    if (!name && profiles.length > 1) {
      return { success: false, message: 'Which store? Example: RULE CLEAR Rockaway', storeId: member.storeId };
    }
    const target = name ? matchStore(name, profiles).profile : profiles[0];
    if (!target) {
      return { success: false, message: `I could not find a store called "${name}". Reply RULE to see your stores.`, storeId: member.storeId };
    }
    await clearDepositRule(prisma, target.storeId);
    return {
      success: true,
      message: `🧹 Cleared the deposit rule for ${target.storeName}. I'll suggest one again after your next report.`,
      storeId: member.storeId,
    };
  }

  const lines = profiles.map((p) =>
    p.depositRule
      ? `• ${p.storeName}: deposit = ${describeDepositRule(p.depositRule)}`
      : `• ${p.storeName}: not set yet (I'll suggest one after your next report)`
  );
  return {
    success: true,
    message: ['📐 Deposit rules', ...lines, '', 'To forget one: RULE CLEAR <store name>'].join('\n'),
    storeId: member.storeId,
  };
}

async function handleTasks(prisma: PrismaClient, phoneE164: string): Promise<CommandResult> {
  const member = await prisma.userDirectory.findUnique({ where: { phoneE164 }, select: { storeId: true, isActive: true } });
  if (!member || !member.isActive || !member.storeId) {
    return { success: false, message: 'Your number is not linked to a store. Ask the owner to add you from the dashboard.' };
  }
  return { success: true, message: await describeOpenTasks(prisma, member.storeId), storeId: member.storeId };
}

async function handleDue(prisma: PrismaClient, phoneE164: string): Promise<CommandResult> {
  const member = await prisma.userDirectory.findUnique({
    where: { phoneE164 },
    select: { role: true, storeId: true, isActive: true },
  });
  if (!member?.isActive || !member.storeId) {
    return { success: false, message: 'Your number is not linked to a store yet.' };
  }
  const canAll = member.role === 'OWNER' || member.role === 'MANAGER';
  const profiles = await loadStoreProfiles(prisma, member.storeId, { includeOwnerSiblings: canAll });
  const storeIds = canAll ? profiles.map((p) => p.storeId) : [member.storeId];
  const open = await loadOpenInvoices(prisma, storeIds);
  const names = Object.fromEntries(profiles.map((p) => [p.storeId, p.storeName]));
  return { success: true, message: describeOpenBills(open, names, storeIds.length > 1), storeId: member.storeId };
}

async function handleHelp(): Promise<CommandResult> {
  return {
    success: true,
    message: [
      '📱 opsAi commands',
      '',
      'OK — confirm last entry',
      'CANCEL — discard last entry',
      'FIX <field> <value> — correct a field',
      'STATUS — show pending entry',
      'RULE — see each store\'s deposit rule',
      'TODAY — today\'s confirmed count',
      'TASKS — what is still open for your shift',
      'DUE — vendor bills still owed',
      'HELP — this message',
      '',
      '📸 Send a photo or text for sales, invoices, orders, fuel, or paid-outs.',
      '💵 Partial pay: Pepsi paid cash 500 remaining 400 send check Friday.',
      '✅ Answer a task by sending its number with a photo or a few words, for example: 2 190F',
      '📅 Send a photo of the 7-Eleven Shift Schedule in the group (Time In / Time Out). I add up hours from the sheet. Owners and managers reply OK to save it.',
    ].join('\n'),
  };
}
