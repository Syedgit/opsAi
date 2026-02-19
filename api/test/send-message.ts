import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const to = req.body.to || req.query.to; // Phone number to send to

  if (!to) {
    res.status(400).json({ error: 'Missing "to" parameter (phone number)' });
    return;
  }

  if (!phoneNumberId || !accessToken) {
    res.status(500).json({ error: 'WhatsApp credentials not configured' });
    return;
  }

  try {
    const message = req.body.message || 'Hello! This is a test message from opsAi webhook.';
    
    // Check if this is a test number (for test numbers, recipient must be in test list)
    // For production numbers, you can send free-form messages within 24-hour window
    // For first message outside 24-hour window, you need to use message templates
    
    const response = await axios.post(
      `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual', // Add this for clarity
        to: to,
        type: 'text',
        text: { 
          body: message,
          preview_url: false, // Set to true if you want link previews
        },
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

    res.status(200).json({
      success: true,
      messageId: response.data.messages?.[0]?.id,
      to: to,
    });
    return;
  } catch (error: unknown) {
    const errorDetails = axios.isAxiosError(error)
      ? error.response?.data || error.message
      : error instanceof Error
      ? error.message
      : 'Unknown error';

    console.error('❌ Failed to send message', {
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
          message: 'Your phone number needs to be registered with Meta. Please check:',
          steps: [
            '1. Go to Meta App Dashboard → WhatsApp → API Setup',
            '2. Verify your phone number is registered and shows "Connected"',
            '3. Check Phone Number ID matches your .env file',
            '4. Ensure access token is valid (may need to regenerate)',
            '5. Make sure business verification is complete',
            '6. If using test number, add recipient to test recipient list',
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
          message: 'You can only send free-form messages within 24 hours of receiving a message from the user. For first contact, use a message template.',
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
}

