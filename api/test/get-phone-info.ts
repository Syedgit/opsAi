import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';

/**
 * Test endpoint to get phone number information from Meta API
 * This helps verify which phone number corresponds to your Phone Number ID
 */
export default async function handler(_req: VercelRequest, res: VercelResponse): Promise<void> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    res.status(500).json({ error: 'WhatsApp credentials not configured' });
    return;
  }

  try {
    // Get phone number details
    const phoneResponse = await axios.get(
      `https://graph.facebook.com/v22.0/${phoneNumberId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        params: {
          fields: 'display_phone_number,verified_name,code_verification_status,quality_rating,account_mode',
        },
      }
    );

    // Get phone number list (to see all numbers)
    const listResponse = await axios.get(
      `https://graph.facebook.com/v22.0/${phoneNumberId}/phone_numbers`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    res.status(200).json({
      success: true,
      phoneNumberId,
      phoneNumberInfo: phoneResponse.data,
      phoneNumbersList: listResponse.data,
      message: 'Phone number information retrieved successfully',
    });
    return;
  } catch (error: unknown) {
    const errorDetails = axios.isAxiosError(error)
      ? error.response?.data || error.message
      : error instanceof Error
      ? error.message
      : 'Unknown error';

    console.error('❌ Failed to get phone info', {
      error: errorDetails,
      phoneNumberId,
    });

    res.status(500).json({
      error: 'Failed to get phone number information',
      details: errorDetails,
    });
    return;
  }
}
