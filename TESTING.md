# WhatsApp Testing Guide

## Current Configuration
- **Phone Number ID**: `869870982886772`
- **Phone Number**: `15558608667` (Connected)
- **Access Token**: Configured in `.env`

## Step-by-Step Testing

### 1. Start Local Server
```bash
npm run dev
```

Wait for: `🚀 Server running on port 3000`

### 2. Test Phone Number Info
Verify which phone number corresponds to your Phone Number ID:

```bash
curl http://localhost:3000/api/test/get-phone-info
```

Expected: Should show `display_phone_number: "15558608667"`

### 3. Test Sending a Message

**Important**: Make sure the recipient phone number (`+17329397703`) is:
- Added to your test recipient list (if using test number)
- OR has messaged you first (if using production number)

**Option A: Using curl**
```bash
curl -X POST http://localhost:3000/api/test/send-message \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+17329397703",
    "message": "Hello! This is a test message from opsAi."
  }'
```

**Option B: Using test script**
```bash
./scripts/test-whatsapp-local.sh "+17329397703" "Hello from opsAi!"
```

### 4. Check Response

**Success Response:**
```json
{
  "success": true,
  "messageId": "wamid.xxx",
  "to": "+17329397703",
  "phoneNumberId": "869870982886772",
  "displayPhoneNumber": "15558608667"
}
```

**Common Errors:**

- **Error 131047**: Recipient not in test list
  - Solution: Add recipient to Meta Dashboard → WhatsApp → API Setup → Manage phone number list

- **Error 131026**: Message template required
  - Solution: Recipient must message you first, or use a message template

- **Error 133010**: Account not registered
  - Solution: Verify phone number is connected in Meta Dashboard

### 5. Test Webhook (Receiving Messages)

Once sending works, test receiving messages:

**Option A: Using mock webhook**
```bash
curl -X POST http://localhost:3000/api/test/mock-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+17329397703",
    "message": "Sales today: Cash $2100, Card $5400"
  }'
```

**Option B: Set up Meta Webhook**
1. Go to Meta App Dashboard → WhatsApp → Configuration
2. Set Webhook URL: `https://your-domain.com/api/webhook/whatsapp`
3. Set Verify Token: `opsAi_whatsapp_poc_2026`
4. Subscribe to `messages` events
5. Send a test message from WhatsApp

### 6. Verify Webhook is Working

Check server logs for:
```
📱 WhatsApp Message Received
```

## Next Steps After Testing

1. ✅ Sending messages works
2. ✅ Receiving messages works
3. ✅ Set up production webhook URL
4. ✅ Configure message processing logic
5. ✅ Test with real store data
