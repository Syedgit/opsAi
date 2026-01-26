# WhatsApp Webhook Setup - Step by Step

## Step 1: Meta WhatsApp Test Setup

### A) Create Meta App & Enable WhatsApp

1. **Create Meta App**:
   - Go to https://developers.facebook.com/apps
   - Click "Create App" → Select "Business" type
   - Name: `opsAi` (or your choice)
   - Create app

2. **Add WhatsApp Product**:
   - In your app dashboard, find "WhatsApp" in products
   - Click "Set up"
   - Create or select WhatsApp Business Account

3. **Get Test Credentials**:
   - Go to **WhatsApp** → **API Setup**
   - You'll see:
     - **Test Phone Number** (Meta provides this)
     - **Phone Number ID** (copy this)
     - **WABA ID** (copy this)
     - **Temporary Access Token** (copy this)

4. **Add Your Phone as Test Recipient**:
   - In **WhatsApp** → **API Setup**
   - Under "Phone Numbers" → "Manage phone number list"
   - Click "Add phone number"
   - Enter your WhatsApp number
   - Verify via SMS/call
   - ✅ Now you can send messages to Meta's test number

### B) Choose Verify Token

Decide on a verify token (example):
```
syed_whatsapp_poc_2026
```

Or create your own secure token. **Save this** - you'll need it!

## Step 2: Deploy Webhook to Vercel

### A) Prepare for Vercel Deployment

1. **Install Vercel CLI** (optional, can use web UI):
   ```bash
   npm i -g vercel
   ```

2. **Create Vercel Configuration**:
   - We'll create `vercel.json` for routing
   - Webhook endpoint: `/api/webhook/whatsapp`

### B) Deploy to Vercel

**Option 1: Using Vercel CLI**
```bash
vercel login
vercel
```

**Option 2: Using GitHub + Vercel**
1. Push code to GitHub
2. Go to https://vercel.com
3. Import your GitHub repo
4. Deploy automatically

**Option 3: Using Vercel Web UI**
1. Go to https://vercel.com
2. Click "Add New Project"
3. Import your project
4. Deploy

### C) Get Your Vercel URL

After deployment, you'll get a URL like:
```
https://opsai-xxxxx.vercel.app
```

Your webhook URL will be:
```
https://opsai-xxxxx.vercel.app/api/webhook/whatsapp
```

## Step 3: Register Webhook in Meta

1. Go to **Meta App** → **WhatsApp** → **Configuration**
2. Under "Webhook", click "Edit"
3. Enter:
   - **Callback URL**: `https://your-app.vercel.app/api/webhook/whatsapp`
   - **Verify Token**: `syed_whatsapp_poc_2026` (or your chosen token)
4. Click **"Verify and Save"**
5. ✅ Success: Meta shows "Webhook verified" ✅

## Step 4: Subscribe to Events

1. In **WhatsApp** → **Configuration** → **Webhook**
2. Click "Manage" next to Webhook fields
3. Subscribe to:
   - ✅ `messages` (required)
   - (Optional) `message_status`
   - (Optional) `message_template_status_update`
4. Click "Save"

## Step 5: Test Inbound Messages

1. **Send a test message**:
   - Open WhatsApp on your phone
   - Send a message to Meta's test number (from Step 1A)
   - Example: "Hello, this is a test"

2. **Check Vercel Logs**:
   - Go to Vercel dashboard → Your project → "Logs"
   - You should see:
     - Webhook POST request received
     - Message data logged
     - ✅ Success!

3. **Verify in Code**:
   - Check your server logs
   - Message should be processed and logged

## Quick Checklist

- [ ] Meta App created (Business type)
- [ ] WhatsApp product added
- [ ] Test credentials copied (Phone Number ID, WABA ID, Token)
- [ ] Your phone added as test recipient
- [ ] Verify token chosen
- [ ] Code deployed to Vercel
- [ ] Webhook URL obtained
- [ ] Webhook registered in Meta
- [ ] Webhook verified ✅
- [ ] Events subscribed (messages)
- [ ] Test message sent
- [ ] Logs checked - message received ✅

## Troubleshooting

**Webhook verification fails?**
- Check verify token matches exactly
- Ensure endpoint returns challenge correctly
- Check Vercel logs for errors

**No messages received?**
- Verify your phone is added as test recipient
- Check you're messaging Meta's test number (not your own)
- Verify events are subscribed
- Check Vercel logs for incoming requests

**Vercel deployment issues?**
- Ensure `vercel.json` is configured correctly
- Check build settings in Vercel
- Verify environment variables are set

## Next Steps After Step 1 Complete

Once webhook is working:
- Process incoming messages
- Send replies via WhatsApp API
- Implement classification
- Add extraction logic
- Connect to Google Sheets

