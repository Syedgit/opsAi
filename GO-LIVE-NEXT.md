# opsAi — Go-live checklist

Phase 1: private 1:1 chats with one shared opsAi WhatsApp number. Staff and owners message it; owners review the dashboard.

## Do these in order

### 1. Rotate the invite code (security)
`STORE_LINK_INVITE_CODE` was committed in an earlier version of this file, so it is in git history.
Generate a new one (`openssl rand -hex 12`), put it in `.env` and Vercel, and never write its value in a doc.

### 2. Database (Supabase)
- [ ] Make sure the app can connect (refresh `DATABASE_URL` and `DIRECT_URL`; the old project returned `tenant/user not found`).
- [ ] Run `scripts/add-store-profile.sql` in the Supabase SQL editor. **Do this before deploying.** The new code reads `store_config.profile_json`, and store lookups fail without the column.

### 3. Environment variables (local `.env` and Vercel)
| Variable | Notes |
|----------|-------|
| `JWT_SECRET`, `ADMIN_API_KEY`, `STORE_LINK_INVITE_CODE` | Required. Long random values. |
| `WHATSAPP_APP_SECRET` | **Required in production.** Meta → App settings → Basic → App secret. Webhooks are rejected without it. |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Required. Use a permanent system-user token, not the 24h test token. |
| `DATABASE_URL`, `DIRECT_URL` | Required. |
| `OPENAI_API_KEY`, `OPENAI_EXTRACTION_MODEL` | Turns on photo and text understanding. Needs billing credits. |
| `OPENAI_TRANSCRIPTION_MODEL` | Turns on voice notes. |
| `AI_UNDERSTANDING=off` | Emergency switch: back to the built-in text rules. |
| `MAX_MESSAGES_PER_HOUR` | Per-phone cap, default 60. |
| `MAX_STORES_PER_OWNER` | Default 50. |
| `OPS_WHATSAPP_DISPLAY_NUMBER` | Shown to owners. |

### 4. Meta
- [ ] Webhook URL `https://<your-domain>/api/webhook/whatsapp`, verify token matches, subscribed to **messages**.
- [ ] Production number (not the test number), Business Verification, display name approved.
- [ ] Message templates for anything sent outside the 24-hour window (reminders, summaries).

### 5. Deploy and verify
- [ ] Vercel plan allows `maxDuration` of 60 s (set for the webhook in `vercel.json`; AI calls on photos can take 10-20 s).
- [ ] Deploy, then open `GET /api/setup/readiness`. You want `readyForProduction: true`, `database.connected: true`, `schema.profileJsonColumn: true`, `ai.understanding: true`.
- [ ] Send yourself a real close report, a photo and a voice note. Reply OK. Check the dashboard.
- [ ] `npm run simulate -- photos` (needs OpenAI credits) to measure real model accuracy on the sample photos.

## What protects production now
- Webhook signature is checked against the raw request body (production refuses unsigned traffic).
- Each WhatsApp message is claimed atomically, so Meta retries and duplicate deliveries are processed once.
- Replies go out after the webhook has answered Meta, and the function stays alive until processing finishes.
- Strangers get one "not linked" reply per day; each phone is capped per hour.
- `?mock=true` and `/api/test/*` are disabled in production. The dashboard never shows made-up data.
- All message-derived text on the dashboard is HTML-escaped (guarded by a test).
- CI (`.github/workflows/ci.yml`) runs type-check, lint and tests on every push.

## Later
- Reminders and an obligations calendar (next-day deposit, bills, invoices due, licences, inspections).
- START/JOIN invite flow for staff, per-store invite codes.
- Groups (needs an Official Business Account).
- Rotate any secret that has ever been pasted into chat or committed.
