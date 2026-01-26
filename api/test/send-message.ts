import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const to = req.body.to || req.query.to; // Phone number to send to

  if (!to) {
    return res.status(400).json({ error: 'Missing "to" parameter (phone number)' });
  }

  if (!phoneNumberId || !accessToken) {
    return res.status(500).json({ error: 'WhatsApp credentials not configured' });
  }

  try {
    const message = req.body.message || 'Hello! This is a test message from opsAi webhook.';
    
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: to,
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

    console.log('✅ Message sent successfully', {
      to,
      messageId: response.data.messages?.[0]?.id,
    });

    return res.status(200).json({
      success: true,
      messageId: response.data.messages?.[0]?.id,
      to: to,
    });
  } catch (error: unknown) {
    const errorDetails = axios.isAxiosError(error)
      ? error.response?.data || error.message
      : error instanceof Error
      ? error.message
      : 'Unknown error';

    console.error('❌ Failed to send message', {
      error: errorDetails,
      to,
    });

    return res.status(500).json({
      error: 'Failed to send message',
      details: errorDetails,
    });
  }
}

