import type { ClassificationType, PrismaClient } from '@prisma/client';
import { google, type sheets_v4 } from 'googleapis';
import {
  isSheetConnected,
  rowsForConfirmedAction,
  sheetsCredentialsConfigured,
  type SheetAppend,
} from './googleSheetsRows';
import { summarySheetGrid, summaryTabName } from './googleSheetsSummary';
import { loadStoreReport } from './storeReport';

export type SheetsWriteResult = 'written' | 'skipped';

type SheetsClient = sheets_v4.Sheets;

/** Quote tab titles so "2026-11 Paid outs"!A1 works in the Sheets API. */
function sheetRange(tab: string, cells: string): string {
  const safe = String(tab).replace(/'/g, "''");
  return `'${safe}'!${cells}`;
}

function sheetsAuthClient(): SheetsClient | null {
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!clientEmail || !privateKey) return null;
  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function ensureTab(
  sheets: SheetsClient,
  spreadsheetId: string,
  tab: string
): Promise<void> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties.title',
  });
  const titles = new Set((meta.data.sheets || []).map((s) => s.properties?.title).filter(Boolean) as string[]);
  if (titles.has(tab)) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: tab } } }],
    },
  });
}

async function ensureTabWithHeaders(
  sheets: SheetsClient,
  spreadsheetId: string,
  tab: string,
  headers: string[]
): Promise<void> {
  await ensureTab(sheets, spreadsheetId, tab);
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: sheetRange(tab, 'A1:Z1'),
  });
  const first = existing.data.values?.[0];
  if (!first || first.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: sheetRange(tab, 'A1'),
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [headers] },
    });
  }
}

async function appendRows(sheets: SheetsClient, spreadsheetId: string, items: SheetAppend[]): Promise<void> {
  for (const item of items) {
    await ensureTabWithHeaders(sheets, spreadsheetId, item.tab, item.headers);
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: sheetRange(item.tab, 'A:Z'),
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [item.row] },
    });
  }
}

/** Overwrite the Summary tab with this month's live store standing. */
async function refreshSummaryTab(
  prisma: PrismaClient,
  sheets: SheetsClient,
  spreadsheetId: string,
  storeId: string
): Promise<void> {
  const report = await loadStoreReport(prisma, storeId, { period: 'month' });
  if ('error' in report) return;
  const tab = summaryTabName();
  await ensureTab(sheets, spreadsheetId, tab);
  const grid = summarySheetGrid(report, { updatedAt: new Date() });
  // Clear old block then write current numbers so removed vendors don't linger.
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: sheetRange(tab, 'A1:B60'),
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: sheetRange(tab, 'A1'),
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: grid },
  });
}

/**
 * Write confirmed action to the store's Google Sheet when credentials + sheetId are set.
 * Appends the day to the month tab, then refreshes the single Summary tab with current month totals.
 */
export async function writeConfirmedActionToSheets(
  prisma: PrismaClient,
  storeId: string,
  type: ClassificationType,
  payloadJson: unknown,
  confidence?: number | null
): Promise<SheetsWriteResult> {
  if (type === 'UNKNOWN' && !(payloadJson && typeof payloadJson === 'object' && (payloadJson as { _kind?: string })._kind)) {
    return 'skipped';
  }
  if (!sheetsCredentialsConfigured()) return 'skipped';

  const store = await prisma.storeConfig.findUnique({
    where: { storeId },
    select: { sheetId: true, storeName: true },
  });
  if (!isSheetConnected(store?.sheetId)) return 'skipped';

  const rows = rowsForConfirmedAction(type, payloadJson, {
    storeId,
    storeName: store?.storeName,
    confidence,
  });
  if (rows.length === 0) return 'skipped';

  const sheets = sheetsAuthClient();
  if (!sheets) return 'skipped';

  await appendRows(sheets, store!.sheetId, rows);
  try {
    await refreshSummaryTab(prisma, sheets, store!.sheetId, storeId);
  } catch (e) {
    console.warn('Google Sheets Summary tab refresh failed', e instanceof Error ? e.message : e);
  }
  return 'written';
}
