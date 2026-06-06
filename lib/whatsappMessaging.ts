import type { PrismaClient } from '@prisma/client';
import axios from 'axios';

const WHATSAPP_API_URL = 'https://graph.facebook.com/v22.0';

export async function sendWhatsAppMessage(
  prisma: PrismaClient,
  to: string,
  message: string,
  storeId?: string
): Promise<boolean> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!accessToken) {
    console.error('WHATSAPP_ACCESS_TOKEN not configured');
    return false;
  }

  let phoneNumberId: string | null = null;
  if (storeId) {
    const store = await prisma.storeConfig.findUnique({
      where: { storeId },
      select: { whatsappPhoneNumberId: true },
    });
    phoneNumberId = store?.whatsappPhoneNumberId ?? null;
  }
  if (!phoneNumberId) {
    phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || null;
  }
  if (!phoneNumberId) {
    console.error('No WhatsApp phone number ID available', { storeId });
    return false;
  }

  const toDigits = to.replace(/^\+/, '');
  try {
    await axios.post(
      `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: toDigits,
        type: 'text',
        text: { body: message },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return true;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to send WhatsApp message', { to, storeId, error: msg });
    return false;
  }
}
