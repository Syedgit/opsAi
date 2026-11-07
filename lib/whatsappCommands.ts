import type { PrismaClient } from '@prisma/client';
import { PendingStatus } from '@prisma/client';
import { format, startOfDay, endOfDay } from 'date-fns';
import { postToStoreGroups, sendWhatsAppMessage } from './whatsappMessaging';
import { groupDashboardHint, sendPrivateDashboardLinks } from './whatsappLogin';
import {
  cancelPendingAction,
  confirmPendingAction,
  getLatestPendingAction,
  getLatestPendingBatch,
} from './pendingActionService';
import { describeDepositRule, matchStore } from './understanding/checks';
import { applyFixToPayload, describeEntryPayload, scheduleGroupMessage } from './understanding/plan';
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
import { describeOpenTasks } from './tasks/evidence';
import { formatInvoiceDay, scheduleInvoicePaymentReminder } from './tasks/invoiceReminder';
import { localDateString } from './tasks/time';
import type { Invoice } from './understanding/schema';

export interface CommandResult {
  success: boolean;
  message: string;
  storeId?: string;
}

const COMMAND_RE = /^(OK|CANCEL|FIX|STATUS|TODAY|TASKS|WEEK|MONTH|HELP|SEND|STORE|RULE)(\s|$)/i;

export function isWhatsAppCommand(text: string): boolean {
  return COMMAND_RE.test(text.trim());
}

export async function handleWhatsAppCommand(
  prisma: PrismaClient,
  phoneE164: string,
  commandText: string
): Promise<CommandResult> {
  const parts = commandText.trim().split(/\s+/);
  const command = parts[0].toUpperCase();

  switch (command) {
    case 'OK':
      return handleOK(prisma, phoneE164);
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

async function handleOK(prisma: PrismaClient, phoneE164: string): Promise<CommandResult> {
  const batch = await getLatestPendingBatch(prisma, phoneE164);
  if (batch.length === 0) {
    return { success: false, message: 'No pending action found.' };
  }

  let sheetsWritten = 0;
  let sheetsFailed = 0;
  const learned: string[] = [];
  const hoursPosted: string[] = [];
  const invoiceReminders: string[] = [];

  for (const pending of batch) {
    await confirmPendingAction(prisma, pending.actionId);

    // The owner saw "OK also teaches me this store's deposit rule" and confirmed, so remember it.
    const proposed = (pending.payloadJson as Record<string, unknown> | null)?.suggested_deposit_rule;
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

    const payload = pending.payloadJson as Record<string, unknown> | null;
    if (payload?._kind === 'invoice' && payload.invoice) {
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

    // A confirmed schedule is told back to the store's group: each person's hours, nothing about pay.
    if ((pending.payloadJson as Record<string, unknown> | null)?._kind === 'work_schedule') {
      const store = await prisma.storeConfig.findUnique({ where: { storeId: pending.storeId }, select: { storeName: true } });
      const groupMessage = scheduleGroupMessage(pending.payloadJson as Record<string, unknown>, store?.storeName ?? pending.storeId);
      if (groupMessage && (await postToStoreGroups(prisma, pending.storeId, groupMessage)) > 0) {
        hoursPosted.push(store?.storeName ?? pending.storeId);
      }
    }

    try {
      const { writeConfirmedActionToSheets } = await import('./googleSheetsWrite');
      const result = await writeConfirmedActionToSheets(prisma, pending.storeId, pending.type, pending.payloadJson);
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
  if (hoursPosted.length > 0) message += `\n📣 Posted the hours to the ${hoursPosted.join(' and ')} group.`;
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
    } catch (e) {
      console.warn('Could not send private dashboard links', e instanceof Error ? e.message : e);
    }
    const posted = hasClose && (await postToStoreGroups(prisma, storeId, text)) > 0;
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
      'HELP — this message',
      '',
      '📸 Send a photo or text for sales, invoices, orders, fuel, or paid-outs.',
      '✅ Answer a task by sending its number with a photo or a few words, for example: 2 190F',
      '📅 Owners and managers: send the weekly schedule sheet and I will add up each person\'s hours.',
    ].join('\n'),
  };
}
