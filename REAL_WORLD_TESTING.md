# Real-World WhatsApp Testing Guide

## Overview

This guide walks you through testing your opsAi app with **real WhatsApp messages** from your phone.

## Prerequisites

- ✅ WhatsApp Business API access token
- ✅ WhatsApp Business Phone Number ID
- ✅ Your phone number added as a test recipient in Meta
- ✅ ngrok installed (for local testing) OR Vercel deployment (for production testing)

## Option 1: Test Locally with ngrok

### Step 1: Install ngrok

```bash
# Using npm (recommended)
npm install -g ngrok

# Or using Homebrew (macOS)
brew install ngrok

# Or download from: https://ngrok.com/download
```

### Step 2: Start Your Local Server

```bash
npm run dev
```

Your server should be running on `http://localhost:3000`

### Step 3: Start ngrok Tunnel

Open a **new terminal** and run:

```bash
ngrok http 3000
```

You'll see output like:
```
Forwarding    https://abc123xyz.ngrok-free.app -> http://localhost:3000
```

**Copy the HTTPS URL** (e.g., `https://abc123xyz.ngrok-free.app`)

### Step 4: Configure Webhook in Meta Developer Console

1. Go to: https://developers.facebook.com/apps
2. Select your app
3. Go to **WhatsApp** → **Configuration** (left sidebar)
4. Scroll to **Webhook** section
5. Click **Edit** or **Add Callback URL**

6. Enter:
   - **Callback URL**: `https://abc123xyz.ngrok-free.app/api/webhook/whatsapp`
     (Replace with your ngrok URL)
   - **Verify Token**: `opsAi_whatsapp_poc_2026`
   - Click **Verify and Save**

7. You should see ✅ "Webhook verified successfully"

8. Click **Manage** next to Webhook
9. Subscribe to **messages** field
   - Check the box for `messages`
   - Click **Save**

### Step 5: Add Your Phone as Test Recipient

1. In Meta Developer Console → **WhatsApp** → **API Setup**
2. Scroll to **"To"** field
3. Click **"Manage phone number list"**
4. Click **"Add phone number"**
5. Enter your phone number (e.g., `+17329397703`)
6. Click **"Send Code"**
7. Enter the verification code sent to your phone
8. Click **"Verify"**

✅ Your phone is now a verified test recipient!

### Step 6: Test Sending a Message

**From your phone**, send a message to your WhatsApp Business number.

Example messages to test:
- `Sales today: Cash $2100, Card $5400, Tax $320`
- `Invoice: HLA $1290, paid Y`
- `Fuel: 3200 gallons, sales $11000`

### Step 7: Check Logs

**In your terminal** where `npm run dev` is running, you should see:

```
📨 Webhook received { object: 'whatsapp_business_account', entryCount: 1 }
📱 Messages received { messageCount: 1 }
📱 WhatsApp Message Received {
  messageId: 'wamid.xxx',
  phoneE164: '+17329397703',
  messageType: 'text',
  text: 'Sales today: Cash $2100...',
  timestamp: '2026-02-14T...'
}
```

**In ngrok terminal**, you'll see the incoming request:
```
POST /api/webhook/whatsapp    200 OK
```

## Option 2: Test on Vercel (Production)

### Step 1: Deploy to Vercel

```bash
# If not already deployed
vercel --prod
```

Your webhook URL will be:
`https://ops-ai-delta.vercel.app/api/webhook/whatsapp`

### Step 2: Configure Webhook in Meta

1. Go to Meta Developer Console → WhatsApp → Configuration
2. Set **Callback URL**: `https://ops-ai-delta.vercel.app/api/webhook/whatsapp`
3. Set **Verify Token**: `opsAi_whatsapp_poc_2026`
4. Click **Verify and Save**
5. Subscribe to `messages` field

### Step 3: Test

Send a message from your phone to your WhatsApp Business number.

### Step 4: Check Vercel Logs

1. Go to: https://vercel.com/dashboard
2. Select your project
3. Click **Functions** tab
4. Click on `/api/webhook/whatsapp`
5. View **Logs** to see incoming messages

## Testing Different Scenarios

### Scenario 1: Store Sales Message

**Send from phone:**
```
Sales today: Cash $2100, Card $5400, Tax $320
```

**Expected:**
- ✅ Webhook receives message
- ✅ Logs show message details
- ✅ (Future) Message classified as STORE_SALES
- ✅ (Future) Data extracted and stored

### Scenario 2: Invoice Message

**Send from phone:**
```
Invoice: HLA $1290, paid Y
```

**Expected:**
- ✅ Webhook receives message
- ✅ Logs show message details
- ✅ (Future) Classified as INVOICE_EXPENSE

### Scenario 3: Image Message (Invoice Photo)

**Send from phone:**
- Take a photo of an invoice
- Send as image with caption: "Invoice"

**Expected:**
- ✅ Webhook receives image
- ✅ Logs show image ID
- ✅ (Future) Image downloaded and OCR processed

### Scenario 4: Multiple Messages Quickly

**Send multiple messages quickly:**
1. "Sales: Cash $2000"
2. "Invoice: Pepsi $850"
3. "Fuel: 3000 gallons"

**Expected:**
- ✅ All messages received
- ✅ Each processed independently
- ✅ No errors or timeouts

## Testing Outbound Messages (Sending TO WhatsApp)

### Using Test Endpoint

```bash
curl -X POST https://ops-ai-delta.vercel.app/api/test/send-message \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+17329397703",
    "message": "Hello! This is a test message from opsAi."
  }'
```

**Expected:**
- ✅ Message sent successfully
- ✅ You receive message on your phone
- ✅ Response shows message ID

### Using WhatsApp API Directly

```bash
curl -X POST \
  "https://graph.facebook.com/v18.0/YOUR_PHONE_NUMBER_ID/messages" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "messaging_product": "whatsapp",
    "to": "+17329397703",
    "type": "text",
    "text": { "body": "Hello from opsAi!" }
  }'
```

## Troubleshooting

### ❌ Webhook not receiving messages?

**Check:**
1. ✅ Webhook URL is correct in Meta Console
2. ✅ Verify token matches exactly (`opsAi_whatsapp_poc_2026`)
3. ✅ Webhook is subscribed to `messages` field
4. ✅ Your phone is added as test recipient
5. ✅ ngrok is running (if testing locally)
6. ✅ Server is running and accessible

**Debug:**
```bash
# Test webhook endpoint directly
curl "https://your-url.com/api/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=opsAi_whatsapp_poc_2026&hub.challenge=test123"
# Should return: test123
```

### ❌ Getting 403 Forbidden?

- Check verify token matches exactly
- Check webhook URL is accessible (not behind firewall)
- Check ngrok URL is correct (if testing locally)

### ❌ Messages not appearing in logs?

- Check Vercel function logs (if deployed)
- Check local terminal (if testing locally)
- Check ngrok inspector: http://localhost:4040 (if using ngrok)

### ❌ Can't send messages TO WhatsApp?

**Check:**
1. ✅ Phone number is verified test recipient
2. ✅ Access token is valid
3. ✅ Phone Number ID is correct
4. ✅ You're sending to a verified test number

**Test:**
```bash
# Test sending endpoint
curl -X POST http://localhost:3000/api/test/send-message \
  -H "Content-Type: application/json" \
  -d '{"to": "+17329397703", "message": "Test"}'
```

## What Happens Next?

Currently, your webhook:
1. ✅ Receives messages
2. ✅ Logs message details
3. ✅ Responds with 200 OK

**Future enhancements** (not yet implemented):
- 🔄 Classify message type (sales, invoice, etc.)
- 🔄 Extract data using OCR/AI
- 🔄 Store in database
- 🔄 Write to Google Sheets
- 🔄 Send confirmation back to user

## Quick Test Checklist

- [ ] ngrok running (or Vercel deployed)
- [ ] Webhook URL configured in Meta
- [ ] Verify token matches
- [ ] Subscribed to `messages` field
- [ ] Phone added as test recipient
- [ ] Server running (`npm run dev`)
- [ ] Send test message from phone
- [ ] Check logs for received message
- [ ] Test sending message TO phone

## Example Test Flow

1. **Start local server:**
   ```bash
   npm run dev
   ```

2. **Start ngrok:**
   ```bash
   ngrok http 3000
   ```

3. **Update Meta webhook** with ngrok URL

4. **Send message from phone:**
   ```
   Sales today: Cash $2100, Card $5400
   ```

5. **Check terminal logs** - should see message logged

6. **Test sending back:**
   ```bash
   curl -X POST http://localhost:3000/api/test/send-message \
     -H "Content-Type: application/json" \
     -d '{"to": "+17329397703", "message": "Got it! Thanks."}'
   ```

7. **Check phone** - should receive confirmation message

## Next Steps

Once webhook is working:
1. ✅ Test with different message types
2. ✅ Test with images
3. ✅ Test error handling
4. ✅ Monitor logs for issues
5. 🔄 Add message processing logic
6. 🔄 Add data extraction
7. 🔄 Add Google Sheets integration
