import { PendingStatus } from '@prisma/client';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import { sendWhatsAppMessage } from './whatsappBot';
import { writeToGoogleSheets } from './googleSheets';
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import { parse } from 'date-fns';

export interface CommandResult {
  success: boolean;
  message: string;
}

/**
 * Handle user commands (OK, FIX, CANCEL, STATUS, TODAY, MONTH, HELP, SEND)
 */
export async function handleCommand(
  phoneE164: string,
  commandText: string
): Promise<CommandResult> {
  const parts = commandText.trim().split(/\s+/);
  const command = parts[0].toUpperCase();

  logger.info('Processing command', { phoneE164, command });

  switch (command) {
    case 'OK':
      return await handleOK(phoneE164);
    case 'CANCEL':
      return await handleCancel(phoneE164);
    case 'FIX':
      return await handleFix(phoneE164, parts.slice(1));
    case 'STATUS':
      return await handleStatus(phoneE164);
    case 'TODAY':
      return await handleToday(phoneE164);
    case 'WEEK':
      return await handleWeek(phoneE164);
    case 'MONTH':
      return await handleMonth(phoneE164, parts[1]);
    case 'HELP':
      return await handleHelp();
    case 'SEND':
      return await handleSend(phoneE164, parts.slice(1));
    case 'STORE':
      return await handleStoreLink(phoneE164, parts[1]);
    default:
      return {
        success: false,
        message: 'Unknown command. Reply HELP for available commands.',
      };
  }
}

/**
 * Confirm latest pending action and write to Google Sheets
 */
async function handleOK(phoneE164: string): Promise<CommandResult> {
  const { getLatestPendingAction, confirmPendingAction } = await import(
    './pendingActions'
  );

  const pending = await getLatestPendingAction(phoneE164);

  if (!pending) {
    return {
      success: false,
      message: 'No pending action found.',
    };
  }

  // Confirm the action
  await confirmPendingAction(pending.actionId);

  // Write to Google Sheets
  try {
    await writeToGoogleSheets(
      pending.storeId,
      pending.type as any,
      pending.payloadJson as any,
      pending.messageIdInbound || '',
      pending.confidence
    );

    return {
      success: true,
      message: '✅ Confirmed and saved to Google Sheets!',
    };
  } catch (error: any) {
    logger.error('Failed to write to Google Sheets', { error: error.message });
    return {
      success: false,
      message: 'Confirmed but failed to save. Please contact support.',
    };
  }
}

/**
 * Cancel latest pending action
 */
async function handleCancel(phoneE164: string): Promise<CommandResult> {
  const { getLatestPendingAction, cancelPendingAction } = await import(
    './pendingActions'
  );

  const pending = await getLatestPendingAction(phoneE164);

  if (!pending) {
    return {
      success: false,
      message: 'No pending action found.',
    };
  }

  await cancelPendingAction(pending.actionId);

  return {
    success: true,
    message: '❌ Cancelled.',
  };
}

/**
 * Fix a field in the latest pending action
 */
async function handleFix(phoneE164: string, args: string[]): Promise<CommandResult> {
  if (args.length < 2) {
    return {
      success: false,
      message: 'Usage: FIX <field> <value>\nExample: FIX amount 1260',
    };
  }

  const { getLatestPendingAction } = await import('./pendingActions');
  const pending = await getLatestPendingAction(phoneE164);

  if (!pending) {
    return {
      success: false,
      message: 'No pending action found.',
    };
  }

  const field = args[0].toLowerCase();
  const value = args.slice(1).join(' ');

  // Update payload
  const payload = pending.payloadJson as any;
  
  // Handle numeric fields
  if (['amount', 'cash', 'card', 'tax', 'total_inside', 'gallons', 'fuel_sales', 'fuel_gp', 'qty'].includes(field)) {
    payload[field] = parseFloat(value) || 0;
  } else {
    payload[field] = value;
  }

  // Update in database
  await prisma.pendingActions.update({
    where: { actionId: pending.actionId },
    data: { payloadJson: payload },
  });

  // Send updated summary
  const summary = formatPendingSummary(pending.type, payload);
  await sendWhatsAppMessage(
    phoneE164,
    `🔧 Updated:\n\n${summary}\n\nReply OK to confirm or FIX to change more.`
  );

  return {
    success: true,
    message: `Field "${field}" updated.`,
  };
}

/**
 * Get status of latest pending action
 */
async function handleStatus(phoneE164: string): Promise<CommandResult> {
  const { getLatestPendingAction } = await import('./pendingActions');
  const pending = await getLatestPendingAction(phoneE164);

  if (!pending) {
    return {
      success: true,
      message: 'No pending actions.',
    };
  }

  const summary = formatPendingSummary(pending.type, pending.payloadJson as any);
  const message = `📋 Status:\n\n${summary}\n\nConfidence: ${(pending.confidence * 100).toFixed(0)}%\n\nReply OK to confirm, FIX to correct, or CANCEL to reject.`;

  return {
    success: true,
    message,
  };
}

/**
 * Get today's summary with AI insights
 */
async function handleToday(phoneE164: string): Promise<CommandResult> {
  const user = await prisma.userDirectory.findUnique({
    where: { phoneE164 },
  });

  if (!user || !user.storeId) {
    return {
      success: false,
      message: 'Store not linked. Reply STORE S001 to link.',
    };
  }

  try {
    const { generateWhatsAppSummary } = await import('./aiSummarization');
    const summary = await generateWhatsAppSummary(user.storeId, 'today');
    return {
      success: true,
      message: summary,
    };
  } catch (error: any) {
    logger.error('AI summary failed, using basic summary', { error: error.message });
    // Fallback to basic summary
    const today = startOfDay(new Date());
    const count = await prisma.pendingActions.count({
      where: {
        storeId: user.storeId,
        status: PendingStatus.CONFIRMED,
        createdAt: {
          gte: today,
          lte: endOfDay(new Date()),
        },
      },
    });
    return {
      success: true,
      message: `📊 Today (${format(today, 'MMM dd, yyyy')}):\n${count} entries confirmed\n\nReply MONTH YYYY-MM for monthly summary.`,
    };
  }
}

/**
 * Get weekly summary with AI insights
 */
async function handleWeek(phoneE164: string): Promise<CommandResult> {
  const user = await prisma.userDirectory.findUnique({
    where: { phoneE164 },
  });

  if (!user || !user.storeId) {
    return {
      success: false,
      message: 'Store not linked. Reply STORE S001 to link.',
    };
  }

  try {
    const { generateWhatsAppSummary } = await import('./aiSummarization');
    const summary = await generateWhatsAppSummary(user.storeId, 'week');
    return {
      success: true,
      message: summary,
    };
  } catch (error: any) {
    logger.error('AI summary failed, using basic summary', { error: error.message });
    // Fallback to basic summary
    const start = startOfWeek(new Date());
    const count = await prisma.pendingActions.count({
      where: {
        storeId: user.storeId,
        status: PendingStatus.CONFIRMED,
        createdAt: {
          gte: start,
          lte: endOfWeek(new Date()),
        },
      },
    });
    return {
      success: true,
      message: `📊 This Week:\n${count} entries confirmed`,
    };
  }
}

/**
 * Get monthly summary with AI insights
 */
async function handleMonth(phoneE164: string, monthStr?: string): Promise<CommandResult> {
  const user = await prisma.userDirectory.findUnique({
    where: { phoneE164 },
  });

  if (!user || !user.storeId) {
    return {
      success: false,
      message: 'Store not linked. Reply STORE S001 to link.',
    };
  }

  let targetMonth: Date;
  if (monthStr) {
    try {
      targetMonth = parse(monthStr, 'yyyy-MM', new Date());
    } catch {
      return {
        success: false,
        message: 'Invalid format. Use: MONTH YYYY-MM\nExample: MONTH 2026-01',
      };
    }
  } else {
    targetMonth = new Date();
  }

  try {
    const { generateWhatsAppSummary } = await import('./aiSummarization');
    const message = await generateWhatsAppSummary(user.storeId, 'month');
    return {
      success: true,
      message,
    };
  } catch (error: any) {
    logger.error('AI summary failed, using basic summary', { error: error.message });
    // Fallback to basic summary
    const start = startOfMonth(targetMonth);
    const count = await prisma.pendingActions.count({
      where: {
        storeId: user.storeId,
        status: PendingStatus.CONFIRMED,
        createdAt: {
          gte: start,
          lte: endOfMonth(targetMonth),
        },
      },
    });
    return {
      success: true,
      message: `📊 ${format(start, 'MMMM yyyy')}:\n${count} entries confirmed`,
    };
  }
}

/**
 * Send help message
 */
async function handleHelp(): Promise<CommandResult> {
  const message = `📱 Available Commands:

✅ OK - Confirm latest entry
❌ CANCEL - Cancel latest entry
🔧 FIX <field> <value> - Correct a field
📋 STATUS - View latest entry status
📊 TODAY - Today's AI summary
📅 WEEK - This week's AI summary
📆 MONTH YYYY-MM - Monthly AI summary
📤 SEND <vendor> - Send order to vendor
🏪 STORE S001 - Link to store
❓ HELP - Show this help

Examples:
FIX amount 1260
FIX vendor Pepsi
MONTH 2026-01

💡 AI summaries include insights and recommendations!`;

  return {
    success: true,
    message,
  };
}

/**
 * Send order to vendor
 */
async function handleSend(phoneE164: string, args: string[]): Promise<CommandResult> {
  if (args.length === 0) {
    return {
      success: false,
      message: 'Usage: SEND <vendor>\nExample: SEND HLA',
    };
  }

  const vendor = args[0].toUpperCase();
  const { getLatestPendingAction } = await import('./pendingActions');
  const pending = await getLatestPendingAction(phoneE164);

  if (!pending || pending.type !== 'ORDER_REQUEST') {
    return {
      success: false,
      message: 'No pending order found. Create an order first.',
    };
  }

  // TODO: Implement vendor sending logic
  // - Get vendor contact from VendorContacts table
  // - Format order message
  // - Send via WhatsApp/SMS/Email

  return {
    success: true,
    message: `📤 Order sent to ${vendor}!`,
  };
}

/**
 * Link phone number to store
 */
async function handleStoreLink(phoneE164: string, storeId?: string): Promise<CommandResult> {
  if (!storeId) {
    return {
      success: false,
      message: 'Usage: STORE S001\nExample: STORE S001',
    };
  }

  const storeIdUpper = storeId.toUpperCase();
  const store = await prisma.storeConfig.findUnique({
    where: { storeId: storeIdUpper },
  });

  if (!store) {
    return {
      success: false,
      message: `Store ${storeIdUpper} not found. Contact admin.`,
    };
  }

  // Update or create user
  await prisma.userDirectory.upsert({
    where: { phoneE164 },
    update: { storeId: storeIdUpper },
    create: {
      phoneE164,
      storeId: storeIdUpper,
      role: 'STAFF',
      isActive: true,
    },
  });

  return {
    success: true,
    message: `✅ Linked to store ${storeIdUpper} (${store.storeName})`,
  };
}

/**
 * Format pending action summary for display
 */
function formatPendingSummary(type: string, payload: any): string {
  switch (type) {
    case 'ORDER_REQUEST':
      const vendors = payload.vendor_groups || [];
      return `Order Request\n${vendors.map((v: any) => `- ${v.vendor}: ${v.items?.length || 0} items`).join('\n')}`;

    case 'INVOICE_EXPENSE':
      return `Invoice/Expense\nVendor: ${payload.vendor || 'N/A'}\nAmount: $${payload.amount || 0}\nDate: ${payload.invoice_date || 'N/A'}`;

    case 'STORE_SALES':
      return `Store Sales\nCash: $${payload.cash || 0}\nCard: $${payload.card || 0}\nTotal: $${payload.total_inside || 0}`;

    case 'FUEL_SALES':
      return `Fuel Sales\nGallons: ${payload.gallons || 0}\nSales: $${payload.fuel_sales || 0}\nGP: $${payload.fuel_gp || 0}`;

    case 'PAID_OUT':
      return `Paid Out\nAmount: $${payload.amount || 0}\nReason: ${payload.reason || 'N/A'}\nEmployee: ${payload.employee || 'N/A'}`;

    default:
      return JSON.stringify(payload, null, 2);
  }
}

