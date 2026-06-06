import type { ClassificationType, PrismaClient } from '@prisma/client';
import { google } from 'googleapis';

/**
 * Write confirmed action to store Google Sheet when credentials are configured.
 */
export async function writeConfirmedActionToSheets(
  prisma: PrismaClient,
  storeId: string,
  type: ClassificationType,
  payloadJson: unknown
): Promise<void> {
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!clientEmail || !privateKey) return;

  const store = await prisma.storeConfig.findUnique({ where: { storeId } });
  if (!store?.sheetId || store.sheetId === 'pending_google_sheet') return;

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
}
