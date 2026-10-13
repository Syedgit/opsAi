import type { PrismaClient } from '@prisma/client';
import { PendingStatus } from '@prisma/client';
import { format, startOfDay, endOfDay } from 'date-fns';
import { sendWhatsAppMessage } from './whatsappMessaging';
import {
  cancelPendingAction,
  confirmPendingAction,
  getLatestPendingAction,
  getLatestPendingBatch,
} from './pendingActionService';
import { describeDepositRule, matchStore } from './understanding/checks';
import { applyFixToPayload } from './understanding/plan';
import { DepositRuleSchema, clearDepositRule, saveDepositRule } from './understanding/profileStore';
import { loadStoreProfiles } from './understanding/storeProfiles';

export interface CommandResult {
  success: boolean;
  message: string;
  storeId?: string;
}

const COMMAND_RE = /^(OK|CANCEL|FIX|STATUS|TODAY|WEEK|MONTH|HELP|SEND|STORE|RULE)(\s|$)/i;

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

  return { success: true, message, storeId: batch[0].storeId };
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
    const warnings = (fixed.payload.checks as Array<{ status: string; message: string }>)
      .filter((c) => c.status !== 'pass')
      .map((c) => `⚠️ ${c.message}`);
    const suggested = DepositRuleSchema.safeParse(fixed.payload.suggested_deposit_rule);
    const teaching = suggested.success
      ? [`💡 OK also teaches me this store's deposit rule (${describeDepositRule(suggested.data)}).`]
      : [];
    return {
      success: true,
      message: [`🔧 Updated ${field}.`, ...warnings, ...teaching, 'Reply OK to save, or FIX to change more.'].join('\n'),
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
      'HELP — this message',
      '',
      '📸 Send a photo or text for sales, invoices, orders, fuel, or paid-outs.',
    ].join('\n'),
  };
}
