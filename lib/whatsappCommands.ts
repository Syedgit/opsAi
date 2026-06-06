import type { PrismaClient } from '@prisma/client';
import { PendingStatus } from '@prisma/client';
import { format, startOfDay, endOfDay } from 'date-fns';
import { sendWhatsAppMessage } from './whatsappMessaging';
import {
  cancelPendingAction,
  confirmPendingAction,
  getLatestPendingAction,
} from './pendingActionService';

export interface CommandResult {
  success: boolean;
  message: string;
  storeId?: string;
}

const COMMAND_RE = /^(OK|CANCEL|FIX|STATUS|TODAY|WEEK|MONTH|HELP|SEND|STORE)(\s|$)/i;

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
  const pending = await getLatestPendingAction(prisma, phoneE164);
  if (!pending) {
    return { success: false, message: 'No pending action found.' };
  }

  await confirmPendingAction(prisma, pending.actionId);

  try {
    const { writeConfirmedActionToSheets } = await import('./googleSheetsWrite');
    await writeConfirmedActionToSheets(prisma, pending.storeId, pending.type, pending.payloadJson);
  } catch (e) {
    console.warn('Google Sheets write skipped or failed', e instanceof Error ? e.message : e);
  }

  return {
    success: true,
    message: '✅ Confirmed and saved!',
    storeId: pending.storeId,
  };
}

async function handleCancel(prisma: PrismaClient, phoneE164: string): Promise<CommandResult> {
  const pending = await getLatestPendingAction(prisma, phoneE164);
  if (!pending) {
    return { success: false, message: 'No pending action found.' };
  }
  await cancelPendingAction(prisma, pending.actionId);
  return { success: true, message: '❌ Cancelled.', storeId: pending.storeId };
}

async function handleFix(
  prisma: PrismaClient,
  phoneE164: string,
  args: string[]
): Promise<CommandResult> {
  if (args.length < 2) {
    return { success: false, message: 'Usage: FIX <field> <value>\nExample: FIX amount 1260' };
  }

  const pending = await getLatestPendingAction(prisma, phoneE164);
  if (!pending) {
    return { success: false, message: 'No pending action found.' };
  }

  const field = args[0].toLowerCase();
  const value = args.slice(1).join(' ');
  const payload = { ...(pending.payloadJson as Record<string, unknown>) };

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
      'TODAY — today\'s confirmed count',
      'HELP — this message',
      '',
      '📸 Send a photo or text for sales, invoices, orders, fuel, or paid-outs.',
    ].join('\n'),
  };
}
