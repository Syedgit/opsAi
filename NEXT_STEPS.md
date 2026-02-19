# Next Steps - WhatsApp Integration

## ✅ What's Working
- ✅ Sending WhatsApp messages (tested successfully!)
- ✅ Phone Number ID: `869870982886772`
- ✅ Phone Number: `15558608667` (Connected)
- ✅ Local server running on port 3000

## 🎯 Immediate Next Steps

### Step 1: Test Receiving Messages (Local)
Test that your app can receive and process incoming WhatsApp messages:

```bash
curl -X POST http://localhost:3000/api/test/mock-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+17329397703",
    "message": "Sales today: Cash $2100, Card $5400"
  }'
```

**What to check:**
- Look at your server terminal logs
- You should see: `📱 WhatsApp Message Received`
- This confirms your webhook handler is working

### Step 2: Set Up Production Webhook (Meta Dashboard)
To receive REAL WhatsApp messages, configure the webhook in Meta:

1. **Go to Meta App Dashboard**
   - https://developers.facebook.com/apps
   - Select your app
   - Go to: WhatsApp → Configuration

2. **Configure Webhook**
   - **Webhook URL**: `https://your-domain.vercel.app/api/webhook/whatsapp`
     - Replace `your-domain` with your actual Vercel domain
   - **Verify Token**: `opsAi_whatsapp_poc_2026`
     - This is in your `.env` file as `WHATSAPP_WEBHOOK_VERIFY_TOKEN`

3. **Subscribe to Events**
   - Check: `messages`
   - Click "Verify and Save"

4. **Test**
   - Send a WhatsApp message to `+15558608667`
   - Check your Vercel logs to see if it's received

### Step 3: Deploy to Vercel (if not already done)
Make sure your latest code is deployed:

```bash
git add .
git commit -m "Add WhatsApp test endpoints"
git push
```

Vercel will auto-deploy. Then use your Vercel URL in Step 2.

### Step 4: Test End-to-End Flow
Once webhook is set up:

1. **Send a message FROM your app:**
   ```bash
   curl -X POST http://localhost:3000/api/test/send-message \
     -H "Content-Type: application/json" \
     -d '{
       "to": "+17329397703",
       "message": "Hello! Reply with OK to confirm."
     }'
   ```

2. **Reply FROM WhatsApp:**
   - Open WhatsApp on `+17329397703`
   - Reply: "OK"
   - Check your server/Vercel logs to see the incoming message

## 📋 Checklist

- [ ] Test receiving messages locally (Step 1)
- [ ] Deploy to Vercel (if needed)
- [ ] Set up webhook in Meta Dashboard (Step 2)
- [ ] Test sending a real message
- [ ] Test receiving a real message
- [ ] Verify logs show incoming messages

## 🔧 Troubleshooting

**Webhook verification fails?**
- Check Verify Token matches exactly: `opsAi_whatsapp_poc_2026`
- Make sure URL is accessible (not localhost)
- Check Vercel deployment is live

**Not receiving messages?**
- Verify webhook is subscribed to `messages` events
- Check Vercel function logs
- Make sure phone number is connected in Meta Dashboard

**Need help?**
- Check server logs for error messages
- Verify `.env` variables are set in Vercel
- Test with mock webhook first (Step 1)
