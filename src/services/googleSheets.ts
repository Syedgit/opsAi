import { google } from 'googleapis';
import { format } from 'date-fns';
import { ClassificationType } from '../types';
import { logger } from '../utils/logger';

let sheetsClient: any = null;

function getSheetsClient() {
  if (!sheetsClient) {
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
      key: process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    sheetsClient = google.sheets({ version: 'v4', auth });
  }
  return sheetsClient;
}

/**
 * Get sheet ID for a store
 */
export async function getStoreSheetId(storeId: string): Promise<string> {
  const { prisma } = await import('../config/database');
  const store = await prisma.storeConfig.findUnique({
    where: { storeId },
  });

  if (!store) {
    throw new Error(`Store ${storeId} not found`);
  }

  return store.sheetId;
}

/**
 * Write data to Google Sheet tab
 */
async function writeToTab(
  sheetId: string,
  tabName: string,
  rowData: any[]
): Promise<void> {
  try {
    const sheets = getSheetsClient();
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${tabName}!A:Z`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [rowData],
      },
    });

    logger.info('Data written to Google Sheets', { sheetId, tabName });
  } catch (error: any) {
    logger.error('Failed to write to Google Sheets', {
      error: error.message,
      sheetId,
      tabName,
    });
    throw error;
  }
}

/**
 * Write order request to Orders tabs
 */
export async function writeOrderRequest(
  storeId: string,
  data: any,
  messageId: string,
  mediaUrl?: string
): Promise<void> {
  const sheetId = await getStoreSheetId(storeId);
  const now = new Date();
  const date = format(now, 'yyyy-MM-dd');
  const month = format(now, 'yyyy-MM');

  // Write to Orders_Raw tab
  await writeToTab(sheetId, 'Orders_Raw', [
    date,
    month,
    messageId,
    JSON.stringify(data),
    mediaUrl || '',
    'WhatsApp',
    new Date().toISOString(),
  ]);

  // Write individual items to Orders_Items tab
  if (data.vendor_groups && Array.isArray(data.vendor_groups)) {
    for (const group of data.vendor_groups) {
      for (const item of group.items || []) {
        await writeToTab(sheetId, 'Orders_Items', [
          date,
          month,
          data.order_batch_id || '',
          group.vendor || '',
          item.name || '',
          item.qty || 0,
          item.unit || '',
          messageId,
          'WhatsApp',
        ]);
      }
    }
  }
}

/**
 * Write invoice/expense to Expenses_Invoices tab
 */
export async function writeInvoiceExpense(
  storeId: string,
  data: any,
  messageId: string,
  mediaUrl?: string
): Promise<void> {
  const sheetId = await getStoreSheetId(storeId);
  const now = new Date();
  const date = data.invoice_date || format(now, 'yyyy-MM-dd');
  const month = format(new Date(date), 'yyyy-MM');

  await writeToTab(sheetId, 'Expenses_Invoices', [
    date,
    month,
    data.vendor || '',
    data.amount || 0,
    data.invoice_number || '',
    data.category || '',
    data.paid || 'N',
    messageId,
    mediaUrl || '',
    'WhatsApp',
    new Date().toISOString(),
  ]);
}

/**
 * Write store sales to Daily_Store_Sales tab
 */
export async function writeStoreSales(
  storeId: string,
  data: any,
  messageId: string,
  mediaUrl?: string
): Promise<void> {
  const sheetId = await getStoreSheetId(storeId);
  const date = data.date || format(new Date(), 'yyyy-MM-dd');
  const month = format(new Date(date), 'yyyy-MM');

  await writeToTab(sheetId, 'Daily_Store_Sales', [
    date,
    month,
    data.cash || 0,
    data.card || 0,
    data.tax || 0,
    data.total_inside || 0,
    messageId,
    mediaUrl || '',
    'WhatsApp',
    new Date().toISOString(),
  ]);
}

/**
 * Write fuel sales to Daily_Fuel_Sales tab
 */
export async function writeFuelSales(
  storeId: string,
  data: any,
  messageId: string,
  mediaUrl?: string
): Promise<void> {
  const sheetId = await getStoreSheetId(storeId);
  const date = data.date || format(new Date(), 'yyyy-MM-dd');
  const month = format(new Date(date), 'yyyy-MM');

  await writeToTab(sheetId, 'Daily_Fuel_Sales', [
    date,
    month,
    data.gallons || 0,
    data.fuel_sales || 0,
    data.fuel_gp || 0,
    messageId,
    mediaUrl || '',
    'WhatsApp',
    new Date().toISOString(),
  ]);
}

/**
 * Write paid-out to PaidOuts tab
 */
export async function writePaidOut(
  storeId: string,
  data: any,
  messageId: string,
  mediaUrl?: string
): Promise<void> {
  const sheetId = await getStoreSheetId(storeId);
  const date = data.date || format(new Date(), 'yyyy-MM-dd');
  const month = format(new Date(date), 'yyyy-MM');

  await writeToTab(sheetId, 'PaidOuts', [
    date,
    month,
    data.amount || 0,
    data.reason || '',
    data.employee || '',
    messageId,
    mediaUrl || '',
    'WhatsApp',
    new Date().toISOString(),
  ]);
}

/**
 * Write to Needs_Review tab for low-confidence extractions
 */
export async function writeToReviewQueue(
  storeId: string,
  classificationType: ClassificationType,
  data: any,
  messageId: string,
  confidence: number,
  mediaUrl?: string
): Promise<void> {
  const sheetId = await getStoreSheetId(storeId);
  const now = new Date();
  const date = format(now, 'yyyy-MM-dd');
  const month = format(now, 'yyyy-MM');

  await writeToTab(sheetId, 'Needs_Review', [
    date,
    month,
    classificationType,
    JSON.stringify(data),
    confidence.toString(),
    messageId,
    mediaUrl || '',
    'WhatsApp',
    new Date().toISOString(),
  ]);
}

/**
 * Main function to write data based on classification type
 */
export async function writeToGoogleSheets(
  storeId: string,
  classificationType: ClassificationType,
  data: any,
  messageId: string,
  confidence: number,
  mediaUrl?: string
): Promise<void> {
  const threshold = 0.7; // Confidence threshold

  // If low confidence, write to review queue
  if (confidence < threshold) {
    await writeToReviewQueue(
      storeId,
      classificationType,
      data,
      messageId,
      confidence,
      mediaUrl
    );
    return;
  }

  // Write to appropriate tab based on type
  switch (classificationType) {
    case ClassificationType.ORDER_REQUEST:
      await writeOrderRequest(storeId, data, messageId, mediaUrl);
      break;
    case ClassificationType.INVOICE_EXPENSE:
      await writeInvoiceExpense(storeId, data, messageId, mediaUrl);
      break;
    case ClassificationType.STORE_SALES:
      await writeStoreSales(storeId, data, messageId, mediaUrl);
      break;
    case ClassificationType.FUEL_SALES:
      await writeFuelSales(storeId, data, messageId, mediaUrl);
      break;
    case ClassificationType.PAID_OUT:
      await writePaidOut(storeId, data, messageId, mediaUrl);
      break;
    default:
      // Unknown type goes to review queue
      await writeToReviewQueue(
        storeId,
        classificationType,
        data,
        messageId,
        confidence,
        mediaUrl
      );
  }
}

