import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';

const router = Router();

// Debug: Log when router is initialized
console.log('✅ Twilio router initialized');

/**
 * Twilio SMS Webhook - Receives SMS messages sent to Twilio phone numbers
 * POST /api/webhook/twilio-sms
 * 
 * This endpoint receives SMS messages that come to your Twilio virtual number.
 * Meta will send verification codes here when verifying your phone number.
 */
router.post('/twilio-sms', async (req: Request, res: Response) => {
  try {
    // Twilio sends data as form-urlencoded, so we need to parse it
    const {
      MessageSid,
      AccountSid,
      From,
      To,
      Body,
      NumMedia,
    } = req.body;

    console.log('📨 Raw request body:', req.body);

    // Log the incoming SMS message
    logger.info('📨 Twilio SMS Received', {
      messageSid: MessageSid,
      accountSid: AccountSid,
      from: From,
      to: To,
      body: Body,
      numMedia: NumMedia,
      timestamp: new Date().toISOString(),
    });

    // Also log to console for easy visibility
    console.log('\n========================================');
    console.log('📨 INCOMING SMS FROM TWILIO');
    console.log('========================================');
    console.log(`From: ${From}`);
    console.log(`To: ${To}`);
    console.log(`Message: ${Body}`);
    console.log(`Message SID: ${MessageSid}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log('========================================\n');

    // Check if this looks like a verification code from Meta
    const bodyLower = Body?.toLowerCase() || '';
    if (
      bodyLower.includes('verification') ||
      bodyLower.includes('code') ||
      bodyLower.includes('whatsapp') ||
      /^\d{4,8}$/.test(Body?.trim() || '') // 4-8 digit code
    ) {
      console.log('⚠️  THIS LOOKS LIKE A VERIFICATION CODE!');
      console.log(`🔑 CODE: ${Body}`);
      console.log('⚠️  Copy this code and use it in Meta Business Manager\n');
    }

    // Return TwiML response (Twilio expects this)
    // Empty response is fine, but we can return a simple TwiML
    res.type('text/xml');
    res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  } catch (error: any) {
    logger.error('Error processing Twilio SMS webhook', {
      error: error.message,
      body: req.body,
    });
    // Still return 200 to Twilio
    res.type('text/xml');
    res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
});

/**
 * GET endpoint for webhook verification (optional)
 */
router.get('/twilio-sms', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    message: 'Twilio SMS webhook endpoint is active',
    endpoint: '/api/webhook/twilio-sms',
  });
});

export default router;
