# opsAi — Go-live checklist

Phase 1: one shared opsAi WhatsApp number **(732) 642-2700**. Owners sign up on the web; each store connects its own ops group (Path A). 1:1 from the owner’s registered phone also routes once onboarding has saved that number.

Owner product flow (signup → store → WhatsApp → dashboard): see [`README.md`](README.md).

**Now:** number is registered on the WABA (Phone Number ID `1491611584024784`). Display name **OpsAi Store Management** was still pending review — inbound consumer chats often show Invite and never hit the webhook until Meta marks it Approved.

**This working tree is ahead of production.** Live `opsai.us` still has Google on login, short onboarding, and no `/tasks` page. Deploy after commit. Readiness on production: DB connected, WhatsApp secrets set; still missing `ADMIN_API_KEY` and `STORE_LINK_INVITE_CODE`.

## Do these in order

### 1. Rotate the invite code (security)
`STORE_LINK_INVITE_CODE` was committed in an earlier version of this file, so it is in git history.
Generate a new one (`openssl rand -hex 12`), put it in `.env` and Vercel, and never write its value in a doc.

### 2. Database (Supabase)
- [ ] Make sure the app can connect (refresh `DATABASE_URL` and `DIRECT_URL`; the old project returned `tenant/user not found`).
- [ ] Run `scripts/add-store-profile.sql` in the Supabase SQL editor. **Do this before deploying.** The new code reads `store_config.profile_json`, and store lookups fail without the column.
- [ ] Run `scripts/add-tasks.sql` (shift tasks and alerts). Safe to run twice. Without it the tasks page shows an error; messaging is unaffected.

### 3. Environment variables (local `.env` and Vercel)
| Variable | Notes |
|----------|-------|
| `JWT_SECRET`, `ADMIN_API_KEY`, `STORE_LINK_INVITE_CODE` | Required. Long random values. |
| `WHATSAPP_APP_SECRET` | **Required in production.** Meta → App settings → Basic → App secret. Webhooks are rejected without it. |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Required. Use a permanent system-user token, not the 24h test token. |
| `DATABASE_URL`, `DIRECT_URL` | Required. |
| `OPENAI_API_KEY`, `OPENAI_EXTRACTION_MODEL` | Turns on photo and text understanding. Needs billing credits. |
| `OPENAI_TEXT_MODEL` (optional) | Cheaper model for typed text only. |
| `MAX_AI_MESSAGES_PER_STORE_PER_DAY` (optional) | AI cost cap per store, default 60. |
| `MAX_TASK_PHOTO_CHECKS_PER_STORE_PER_DAY` (optional) | Cap on AI photo checks of task proof photos per store, default 40. |
| `AI_UNDERSTANDING=off` | Emergency switch: back to the built-in text rules. |
| `CRON_SECRET` | Needed for task alerts: 16+ random characters. The scheduler sends it as `Authorization: Bearer ...`. |
| `MAX_MESSAGES_PER_HOUR` | Per-phone cap, default 60. |
| `MAX_STORES_PER_OWNER` | Default 50. |
| `OPS_WHATSAPP_DISPLAY_NUMBER` | Shown to owners. |

### 4. Meta
- [ ] Webhook URL `https://<your-domain>/api/webhook/whatsapp`, verify token matches, subscribed to **messages**.
- [ ] Production number (not the test number), Business Verification, display name approved.
- [ ] Message templates for anything sent outside the 24-hour window (reminders, summaries).

### 4b. Task scheduler (only if you use shift tasks)
Something must call `GET https://<your-domain>/api/cron/tasks` with `Authorization: Bearer <CRON_SECRET>` about every 5 minutes. Pick one: Supabase `pg_cron` + `pg_net` (free), an outside cron service, or Vercel Pro cron. Do not add `crons` to `vercel.json` on the Hobby plan: more than once a day fails the deploy.

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
