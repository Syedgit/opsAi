# Webhook Testing Guide

## What is a Webhook?

A **webhook** is like a phone call from WhatsApp to your app. Instead of your app constantly checking WhatsApp for new messages, WhatsApp automatically calls your app when something happens (like receiving a message).

**Simple analogy:**
- **Polling** (old way): Your app asks WhatsApp every few seconds "Any new messages?" 
- **Webhook** (new way): WhatsApp calls your app immediately when a message arrives

## How It Works

1. **WhatsApp receives a message** → Someone sends a message to your WhatsApp Business number
2. **WhatsApp calls your webhook** → Sends a POST request to your webhook URL
3. **Your app processes it** → Your code receives the message data and processes it
4. **Your app responds** → Sends back "OK" to WhatsApp (must be within 20 seconds)

## Your Webhook Endpoint

- **Local:** `http://localhost:3000/api/webhook/whatsapp`
- **Vercel:** `https://ops-ai-delta.vercel.app/api/webhook/whatsapp`

## Testing Methods

### Method 1: Test with Mock Webhook (Easiest)

Use the mock webhook endpoint to simulate WhatsApp messages:

```bash
# Test with curl
curl -X POST https://ops-ai-delta.vercel.app/api/test/mock-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+17329397703",
    "message": "Sales today: Cash $2100, Card $5400, Tax $320",
    "type": "text"
  }'
```

Or test locally:
```bash
curl -X POST http://localhost:3000/api/test/mock-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+17329397703",
    "message": "Sales today: Cash $2100, Card $5400",
    "type": "text"
  }'
```

### Method 2: Test with Real WhatsApp Message

1. **Send a message** from your phone to your WhatsApp Business number
2. **Check the logs:**
   - **Vercel:** Go to your Vercel dashboard → Functions → View logs
   - **Local:** Check your terminal where `npm run dev` is running

### Method 3: Test Webhook Verification (GET request)

WhatsApp verifies your webhook when you first set it up:

```bash
# Test verification locally
curl "http://localhost:3000/api/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=opsAi_whatsapp_poc_2026&hub.challenge=test123"

# Should return: test123
```

### Method 4: Test Sending Messages (Outbound)

Test sending messages FROM your app TO WhatsApp:

```bash
# Send a test message
curl -X POST https://ops-ai-delta.vercel.app/api/test/send-message \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+17329397703",
    "message": "Hello! This is a test from opsAi"
  }'
```

## Testing Locally with ngrok

If you want to test locally with real WhatsApp messages:

1. **Start your local server:**
   ```bash
   npm run dev
   ```

2. **Start ngrok** (in another terminal):
   ```bash
   ngrok http 3000
   ```

3. **Copy the ngrok URL** (e.g., `https://abc123.ngrok.io`)

4. **Update WhatsApp webhook URL** in Meta Developer Console:
   - Go to: https://developers.facebook.com/apps
   - Select your app → WhatsApp → Configuration
   - Set Callback URL: `https://abc123.ngrok.io/api/webhook/whatsapp`
   - Set Verify Token: `opsAi_whatsapp_poc_2026`
   - Click "Verify and Save"

5. **Send a test message** from your phone to your WhatsApp Business number

6. **Check your terminal** - you should see the message logged!

## What to Look For

When testing, check:

1. **Webhook receives the message** - Look for logs like:
   ```
   📱 WhatsApp Message Received
   {
     messageId: "...",
     phoneE164: "+17329397703",
     messageType: "text",
     text: "Sales today..."
   }
   ```

2. **Response is OK** - WhatsApp expects a 200 OK response within 20 seconds

3. **No errors** - Check for any error messages in logs

## Example Test Scenarios

### Test 1: Simple Text Message
```bash
curl -X POST http://localhost:3000/api/test/mock-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+17329397703",
    "message": "Sales today: Cash $2100, Card $5400, Tax $320",
    "type": "text"
  }'
```

### Test 2: Image Message
```bash
curl -X POST http://localhost:3000/api/test/mock-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+17329397703",
    "message": "Invoice attached",
    "type": "image"
  }'
```

### Test 3: Multiple Messages
Send multiple messages quickly to test handling:
```bash
for i in {1..5}; do
  curl -X POST http://localhost:3000/api/test/mock-webhook \
    -H "Content-Type: application/json" \
    -d "{
      \"phone\": \"+17329397703\",
      \"message\": \"Test message $i\",
      \"type\": \"text\"
    }"
  sleep 1
done
```

## Troubleshooting

### Webhook not receiving messages?
- ✅ Check webhook URL is correct in Meta Console
- ✅ Check verify token matches (`opsAi_whatsapp_poc_2026`)
- ✅ Check your app is subscribed to webhooks in Meta Console
- ✅ Check server logs for errors

### Getting 403 Forbidden?
- ✅ Check verify token matches exactly
- ✅ Check webhook URL is accessible (not behind firewall)

### Messages not processing?
- ✅ Check server logs for errors
- ✅ Verify database connection
- ✅ Check environment variables are set

## Next Steps

Once webhook is working:
1. ✅ Messages are received and logged
2. 🔄 Add message classification (sales, invoices, etc.)
3. 🔄 Add data extraction (OCR, AI)
4. 🔄 Add Google Sheets writing
5. 🔄 Add confirmation flow
