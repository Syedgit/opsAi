import axios from 'axios';
import { logger } from '../utils/logger';

const WHATSAPP_API_URL = 'https://graph.facebook.com/v18.0';
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

/**
 * Send a WhatsApp message
 */
export async function sendWhatsAppMessage(
  to: string,
  message: string
): Promise<boolean> {
  try {
    const response = await axios.post(
      `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: message },
      },
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    logger.info('WhatsApp message sent', { to, messageId: response.data.messages?.[0]?.id });
    return true;
  } catch (error: any) {
    logger.error('Failed to send WhatsApp message', {
      error: error.message,
      to,
    });
    return false;
  }
}

/**
 * Format and send confirmation message with commands
 */
export async function sendConfirmationMessage(
  to: string,
  summary: string,
  _actionId: string
): Promise<void> {
  const message = `${summary}\n\nReply:\n✅ OK - Confirm\n❌ CANCEL - Reject\n🔧 FIX <field> <value> - Correct field\n\nExample: FIX amount 1260`;
  await sendWhatsAppMessage(to, message);
}

