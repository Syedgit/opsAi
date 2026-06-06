import { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import { requireAdmin } from '../utils/auth';

const WHATSAPP_API_URL = 'https://graph.facebook.com/v22.0';
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const BUSINESS_ACCOUNT_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!requireAdmin(req, res)) return;

  try {
    if (!ACCESS_TOKEN) {
      return res.status(400).json({
        error: 'WhatsApp configuration missing',
        details: 'WHATSAPP_ACCESS_TOKEN must be set',
      });
    }

    if (!BUSINESS_ACCOUNT_ID) {
      const pid = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
      if (!pid) {
        return res.status(400).json({
          error: 'WhatsApp configuration missing',
          details:
            'Set WHATSAPP_BUSINESS_ACCOUNT_ID or WHATSAPP_PHONE_NUMBER_ID',
        });
      }
      const response = await axios.get(`${WHATSAPP_API_URL}/${pid}`, {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
        },
        params: {
          fields: 'id,display_phone_number,verified_name,code_verification_status',
        },
      });
      const pn = response.data;
      return res.json({
        success: true,
        phoneNumbers: [
          {
            phoneNumberId: pn.id,
            displayNumber: pn.display_phone_number,
            verifiedName: pn.verified_name,
            verificationStatus: pn.code_verification_status,
          },
        ],
        note: 'WHATSAPP_BUSINESS_ACCOUNT_ID not set; returning WHATSAPP_PHONE_NUMBER_ID only.',
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
