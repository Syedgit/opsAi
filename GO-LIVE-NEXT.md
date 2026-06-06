# opsAi — Go-live notes & next to-do

_Last updated: session wrap-up. Path A (manual WhatsApp groups, one shared number)._

## Done this session

- [x] Path A: manual groups (`WHATSAPP_GROUP_AUTO_PROVISION=false`)
- [x] Store routing default: `WHATSAPP_STORE_ROUTING=group`
- [x] Security: JWT, admin API key, store access, webhook signature
- [x] Auto-link group on first message from registered owner phone
- [x] Onboarding + dashboard manual setup UI
- [x] Local `.env`: JWT_SECRET, ADMIN_API_KEY, STORE_LINK_INVITE_CODE, OPS display number
- [x] 27 unit tests passing

## Next to-do (priority order)

### P0 — before real go-live test

- [ ] **Facebook password** → Meta → App settings → Basic → Show **App secret** → add `WHATSAPP_APP_SECRET` to `.env` + Vercel → redeploy
- [ ] **Fix Supabase DB** — project `ebwfscbotapifxeqzhxu` not connecting (`tenant/user not found`). Refresh `DATABASE_URL` + `DIRECT_URL`, run SQL scripts if new DB
- [ ] **Sync all env vars to Vercel** (local `.env` is not deployed automatically)
- [ ] **Meta webhook**: URL → `/api/webhook/whatsapp`, verify token matches, subscribe to **messages** only (Path A)
- [ ] **Deploy** latest code to Vercel (many uncommitted changes)
- [ ] Hit `GET /api/setup/readiness` → `readyForProduction: true` + `database.connected: true`

### P1 — first live test (Path A)

1. Signup → create store with owner WhatsApp number
2. Create WhatsApp group on phone → add opsAi number `+1 415-523-8886`
3. Message `hello` from registered phone → expect “group connected”
4. Message `Sales cash 100 card 200` → reply `OK` → confirmed
5. Dashboard → WhatsApp card shows **Connected**

### P2 — later / phase 2

- [ ] Meta Groups API + OBA → set `WHATSAPP_GROUP_AUTO_PROVISION=true`
- [ ] Per-store invite codes (instead of one global `STORE_LINK_INVITE_CODE`)
- [ ] Staff phone registration from dashboard
- [ ] Receipt OCR / AI extraction on Vercel pipeline
- [ ] Google Sheets on OK (optional — `GOOGLE_SHEETS_*`)

## Env reference (one-time per deployment)

| Variable | Purpose |
|----------|---------|
| `JWT_SECRET` | User login tokens |
| `ADMIN_API_KEY` | Your admin API only (`/api/admin/*`) |
| `STORE_LINK_INVITE_CODE` | Staff joining existing store (`opsAi-59fa916816cf1e9f` locally) |
| `WHATSAPP_*` | Cloud API + webhook |
| `DATABASE_URL` / `DIRECT_URL` | PostgreSQL (Supabase) |
| `OPS_WHATSAPP_DISPLAY_NUMBER` | Shown to owners: `+14155238886` |

## Optional (not blocking launch)

- OpenAI → dashboard AI Summary only
- Google OAuth → Sign in with Google
- Redis → local Express only, not Vercel

## Useful commands

```bash
npm test
npm run type-check
curl https://YOUR-DOMAIN/api/setup/readiness
```
