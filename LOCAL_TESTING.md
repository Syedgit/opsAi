# Local Testing Guide

## Step 1: Install ngrok

**Option A: Using Homebrew (macOS)**
```bash
brew install ngrok
```

**Option B: Download from website**
1. Go to https://ngrok.com/download
2. Download for macOS
3. Extract and add to PATH

**Option C: Using npm**
```bash
npm install -g ngrok
```

## Step 2: Start Local Server

In your project directory:
```bash
npm run dev
```

Server should start on `http://localhost:3000`

## Step 3: Start ngrok Tunnel

In a **new terminal window**:
```bash
ngrok http 3000
```

You'll see output like:
```
Forwarding  https://xxxxx.ngrok.io -> http://localhost:3000
```

Copy the **HTTPS URL** (e.g., `https://xxxxx.ngrok.io`)

## Step 4: Configure Webhook in Meta

1. Go to your Meta App → **WhatsApp** → **Configuration**
2. Under "Webhook", click "Edit"
3. Enter:
   - **Callback URL**: `https://xxxxx.ngrok.io/api/webhook/whatsapp`
   - **Verify Token**: `syed_whatsapp_poc_2026` (or your chosen token)
4. Click **"Verify and Save"**
5. ✅ Meta will send a GET request to verify - you should see it in your server logs!

## Step 5: Subscribe to Events

1. In **WhatsApp** → **Configuration** → **Webhook**
2. Click "Manage" next to Webhook fields
3. Subscribe to:
   - ✅ `messages`
4. Click "Save"

## Step 6: Test!

1. **Send a test message**:
   - Open WhatsApp on your phone
   - Send a message to Meta's test number: `+1 555 140 3326`
   - Example: "Hello, this is a test"

2. **Check your server logs**:
   - You should see the webhook POST request
   - Message details logged
   - ✅ Success!

## Troubleshooting

**ngrok not working?**
- Make sure local server is running on port 3000
- Check ngrok is pointing to correct port
- Try restarting ngrok

**Webhook verification fails?**
- Check verify token matches exactly
- Ensure server is running
- Check ngrok URL is correct (must be HTTPS)
- Look at server logs for errors

**No messages received?**
- Verify your phone is added as test recipient
- Check you're messaging the test number (+1 555 140 3326)
- Verify events are subscribed in Meta
- Check server logs for incoming requests

## Quick Commands

```bash
# Terminal 1: Start server
npm run dev

# Terminal 2: Start ngrok
ngrok http 3000

# Then use the ngrok HTTPS URL in Meta webhook config
```

## Notes

- **ngrok free tier**: URLs change on restart (use paid for permanent)
- **Keep both terminals open**: Server + ngrok must run simultaneously
- **Check logs**: Server logs will show all webhook requests

