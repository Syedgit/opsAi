import { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';

const WHATSAPP_API_URL = 'https://graph.facebook.com/v22.0';
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const BUSINESS_ACCOUNT_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (!ACCESS_TOKEN || !BUSINESS_ACCOUNT_ID) {
      return res.status(400).json({
        error: 'WhatsApp configuration missing',
        details: 'WHATSAPP_ACCESS_TOKEN and WHATSAPP_BUSINESS_ACCOUNT_ID must be set',
      });
    }

    const response = await axios.get(
      `${WHATSAPP_API_URL}/${BUSINESS_ACCOUNT_ID}/phone_numbers`,
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
        },
        params: {
          fields: 'id,display_phone_number,verified_name,code_verification_status',
        },
      }
    );

    const phoneNumbers = response.data.data || [];

    return res.json({
      success: true,
      phoneNumbers: phoneNumbers.map((pn: any) => ({
        phoneNumberId: pn.id,
        displayNumber: pn.display_phone_number,
        verifiedName: pn.verified_name,
        verificationStatus: pn.code_verification_status,
      })),
    });
  } catch (error: any) {
    return res.status(500).json({
      error: 'Failed to list phone numbers',
      details: error.response?.data?.error?.message || error.message,
    });
  }
}
