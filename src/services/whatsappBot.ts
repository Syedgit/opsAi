import axios from 'axios';
import { logger } from '../utils/logger';
import { prisma } from '../config/database';

const WHATSAPP_API_URL = 'https://graph.facebook.com/v22.0';
// Shared Meta account access token (one token for all stores)
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

/**
 * Get phone number ID for a store
 */
async function getStorePhoneNumberId(storeId: string): Promise<string | null> {
  try {
    const store = await prisma.storeConfig.findUnique({
      where: { storeId },
      select: { whatsappPhoneNumberId: true },
    });
    return store?.whatsappPhoneNumberId || null;
  } catch (error) {
    logger.error('Failed to get store phone number ID', { storeId, error });
    return null;
  }
}

/**
 * Send a WhatsApp message
 * @param to - Recipient phone number (E.164 format)
 * @param message - Message text
 * @param storeId - Store ID to determine which phone number to send from
 */
export async function sendWhatsAppMessage(
  to: string,
  message: string,
  storeId?: string
): Promise<boolean> {
  try {
    // Get phone number ID for the store, or fallback to env var
    let phoneNumberId: string | null = null;
    
    if (storeId) {
      phoneNumberId = await getStorePhoneNumberId(storeId);
    }
    
    // Fallback to environment variable if store doesn't have one yet
    if (!phoneNumberId) {
      phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || null;
    }
    
    if (!phoneNumberId) {
      logger.error('No phone number ID available', { storeId });
      return false;
    }
    
    if (!ACCESS_TOKEN) {
      logger.error('WhatsApp access token not configured');
      return false;
    }

    const response = await axios.post(
      `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
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

    logger.info('WhatsApp message sent', { 
      to, 
      storeId,
      phoneNumberId,
      messageId: response.data.messages?.[0]?.id 
    });
    return true;
  } catch (error: any) {
    logger.error('Failed to send WhatsApp message', {
      error: error.message,
      to,
      storeId,
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
  _actionId: string,
  storeId?: string
): Promise<void> {
  const message = `${summary}\n\nReply:\n✅ OK - Confirm\n❌ CANCEL - Reject\n🔧 FIX <field> <value> - Correct field\n\nExample: FIX amount 1260`;
  await sendWhatsAppMessage(to, message, storeId);
}

