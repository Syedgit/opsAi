import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';

/**
 * Mock webhook endpoint to simulate WhatsApp messages
 * Useful for testing without a real WhatsApp number
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { phone, message, type = 'text' } = req.body;

  if (!phone || !message) {
    return res.status(400).json({
      error: 'Missing required fields',
      required: ['phone', 'message'],
      example: {
        phone: '+17329397703',
        message: 'Sales today: Cash $2100, Card $5400',
        type: 'text', // or 'image'
      },
    });
  }

  // Simulate WhatsApp webhook payload
  const mockPayload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WHATSAPP_BUSINESS_ACCOUNT_ID',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '15558608667',
                phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID || '2118921505602634',
              },
              messages: [
                {
                  from: phone.replace('+', ''),
                  id: `wamid.${Date.now()}`,
                  timestamp: Math.floor(Date.now() / 1000).toString(),
                  type: type,
                  ...(type === 'text'
                    ? {
                        text: {
                          body: message,
                        },
                      }
                    : {
                        image: {
                          id: `image_${Date.now()}`,
                          caption: message,
                        },
                      }),
                },
              ],
            },
            field: 'messages',
          },
        ],
      },
    ],
  };

  // Forward to actual webhook handler
  try {
    const webhookUrl =
      process.env.WEBHOOK_URL || 'https://ops-ai-delta.vercel.app/api/webhook/whatsapp';
    const response = await axios.post(webhookUrl, mockPayload, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const responseText = response.data;

    return res.status(200).json({
      success: true,
      message: 'Mock webhook sent',
      payload: mockPayload,
      webhookResponse: responseText,
      status: response.status || 200,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      error: 'Failed to forward mock webhook',
      details: errorMessage,
      payload: mockPayload,
    });
  }
}
