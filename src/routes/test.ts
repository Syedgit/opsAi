import express from 'express';
import axios from 'axios';
import { logger } from '../utils/logger';

const router = express.Router();

/**
 * Test endpoint to send WhatsApp messages locally
 * POST /api/test/send-message
 * Body: { to: "+1234567890", message: "Test message" }
 */
router.post('/send-message', async (req, res) => {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const to = req.body.to || req.query.to;

  if (!to) {
    res.status(400).json({ error: 'Missing "to" parameter (phone number)' });
    return;
  }

  if (!phoneNumberId || !accessToken) {
    res.status(500).json({ error: 'WhatsApp credentials not configured' });
    return;
  }

  try {
    const message = req.body.message || 'Hello! This is a test message from opsAi (local).';

    logger.info('Sending WhatsApp message', { to, phoneNumberId });

    const response = await axios.post(
      `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'text',
        text: {
          body: message,
          preview_url: false,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    logger.info('✅ Message sent successfully', {
      to,
      messageId: response.data.messages?.[0]?.id,
    });

    res.status(200).json({
      success: true,
      messageId: response.data.messages?.[0]?.id,
      to: to,
      phoneNumberId,
      displayPhoneNumber: '15558608667',
    });
    return;
  } catch (error: unknown) {
    const errorDetails = axios.isAxiosError(error)
      ? error.response?.data || error.message
      : error instanceof Error
      ? error.message
      : 'Unknown error';

    logger.error('❌ Failed to send message', {
      error: errorDetails,
      to,
      phoneNumberId,
    });

    // Check for specific WhatsApp API errors
    if (axios.isAxiosError(error) && error.response?.data) {
      const whatsappError = error.response.data.error;

      if (whatsappError?.code === 133010) {
        res.status(400).json({
          error: 'WhatsApp Business Account not registered',
          message: 'Your phone number needs to be registered with Meta.',
          steps: [
            '1. Go to Meta App Dashboard → WhatsApp → API Setup',
            '2. Verify your phone number is registered and shows "Connected"',
            '3. Check Phone Number ID matches your .env file',
            '4. Ensure access token is valid (may need to regenerate)',
          ],
          details: whatsappError,
        });
        return;
      }

      // Error 131047: Recipient phone number not in allowed list
      if (whatsappError?.code === 131047) {
        res.status(400).json({
          error: 'Recipient not in test list',
          message: 'For test numbers, the recipient must be added to your test recipient list.',
          steps: [
            '1. Go to Meta App Dashboard → WhatsApp → API Setup',
            '2. Scroll to "Phone Numbers" → "Manage phone number list"',
            '3. Click "Add phone number"',
            `4. Add ${to} and verify via SMS/call`,
            '5. Try sending again',
          ],
          details: whatsappError,
        });
        return;
      }

      // Error 131026: Message template required (outside 24-hour window)
      if (whatsappError?.code === 131026) {
        res.status(400).json({
          error: 'Message template required',
          message:
            'You can only send free-form messages within 24 hours of receiving a message from the user. For first contact, use a message template.',
          details: whatsappError,
        });
        return;
      }
    }

    res.status(500).json({
      error: 'Failed to send message',
      details: errorDetails,
    });
    return;
  }
});

/**
 * Get phone number information
 * GET /api/test/get-phone-info
 */
router.get('/get-phone-info', async (_req, res) => {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    res.status(500).json({ error: 'WhatsApp credentials not configured' });
    return;
  }

  try {
    const phoneResponse = await axios.get(`https://graph.facebook.com/v22.0/${phoneNumberId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      params: {
        fields: 'display_phone_number,verified_name,code_verification_status,quality_rating,account_mode',
      },
    });

    res.status(200).json({
      success: true,
      phoneNumberId,
      phoneNumberInfo: phoneResponse.data,
      message: 'Phone number information retrieved successfully',
    });
    return;
  } catch (error: unknown) {
    const errorDetails = axios.isAxiosError(error)
      ? error.response?.data || error.message
      : error instanceof Error
      ? error.message
      : 'Unknown error';

    logger.error('❌ Failed to get phone info', {
      error: errorDetails,
      phoneNumberId,
    });

    res.status(500).json({
      error: 'Failed to get phone number information',
      details: errorDetails,
    });
    return;
  }
});

/**
 * Mock webhook endpoint for local testing
 * POST /api/test/mock-webhook
 * Body: { phone: "+1234567890", message: "Test message" }
 */
router.post('/mock-webhook', async (req, res) => {
  const { phone, message, type = 'text' } = req.body;

  if (!phone || !message) {
    res.status(400).json({
      error: 'Missing required fields',
      required: ['phone', 'message'],
      example: {
        phone: '+17329397703',
        message: 'Sales today: Cash $2100, Card $5400',
        type: 'text',
      },
    });
    return;
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
                phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID || '869870982886772',
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

  // Forward to local webhook handler
  try {
    logger.info('📨 Mock webhook received', { phone, message });
    
    const response = await axios.post('http://localhost:3000/api/webhook/whatsapp', mockPayload, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    res.status(200).json({
      success: true,
      message: 'Mock webhook forwarded to local handler',
      payload: mockPayload,
      webhookResponse: response.data,
    });
    return;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to forward mock webhook', { error: errorMessage });
    
    res.status(500).json({
      error: 'Failed to forward mock webhook',
      details: errorMessage,
      payload: mockPayload,
    });
    return;
  }
});

export { router as testRouter };
