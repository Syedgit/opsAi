import type { ClassificationType, PrismaClient } from '@prisma/client';
import { google } from 'googleapis';

export type SheetsWriteResult = 'written' | 'skipped';

/**
 * Write confirmed action to store Google Sheet when credentials are configured.
 * Returns 'skipped' when there is nothing to write to (no credentials, no sheet, or an entry
 * type that has no tab yet) and throws when the write itself fails, so callers can tell the user.
 */
export async function writeConfirmedActionToSheets(
  prisma: PrismaClient,
  storeId: string,
  type: ClassificationType,
  payloadJson: unknown
): Promise<SheetsWriteResult> {
  // Deposit slips are stored as UNKNOWN entries and have no sheet tab yet.
  if (type === 'UNKNOWN') return 'skipped';

  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!clientEmail || !privateKey) return 'skipped';

  const store = await prisma.storeConfig.findUnique({ where: { storeId } });
  if (!store?.sheetId || store.sheetId === 'pending_google_sheet') return 'skipped';

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const tabName = type.toLowerCase().replace(/_/g, '-');
  const row = [new Date().toISOString(), JSON.stringify(payloadJson)];

  await sheets.spreadsheets.values.append({
    spreadsheetId: store.sheetId,
    range: `${tabName}!A:B`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });
  return 'written';
}
