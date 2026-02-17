# Vercel Function Limit - Solutions

## The Problem

You have **17 serverless functions** but Vercel Hobby plan only allows **12 functions** per deployment.

## Current Functions Count

1. `/api/index.ts` - Landing page
2. `/api/dashboard.ts` - Dashboard page
3. `/api/privacy-policy.ts` - Privacy policy page
4. `/api/terms-of-service.ts` - Terms of service page
5. `/api/health.ts` - Health check
6. `/api/webhook/whatsapp.ts` - WhatsApp webhook
7. `/api/stores.ts` - Stores list
8. `/api/stores/mock.ts` - Mock stores
9. `/api/stores/dashboard.ts` - Store dashboard data
10. `/api/stores/mock-dashboard.ts` - Mock dashboard data
11. `/api/stores/data.ts` - Store data
12. `/api/stores/mock-data.ts` - Mock store data
13. `/api/stores/detail.ts` - Store detail
14. `/api/stores/mock-detail.ts` - Mock store detail
15. `/api/test/send-message.ts` - Test send message
16. `/api/test/mock-webhook.ts` - Test mock webhook
17. `/api/test/mock-data.ts` - Test mock data

**Total: 17 functions** ❌ (Limit: 12)

## Solutions

### Option 1: Combine Functions (Recommended)

Combine related functions into single handlers with routing:

#### Combine Store API Functions
- Merge `/api/stores.ts`, `/api/stores/mock.ts` into one handler
- Merge `/api/stores/dashboard.ts`, `/api/stores/mock-dashboard.ts` into one handler
- Merge `/api/stores/data.ts`, `/api/stores/mock-data.ts` into one handler
- Merge `/api/stores/detail.ts`, `/api/stores/mock-detail.ts` into one handler

This reduces 8 functions to 4 functions.

#### Remove Test Functions from Production
- Move `/api/test/*` functions to a separate branch or exclude from production
- Or combine all test functions into one `/api/test/index.ts` handler

This reduces 3 functions to 0 or 1 function.

**Result: 17 → 9 functions** ✅

### Option 2: Use Static Files for Pages

Convert HTML pages to static files instead of serverless functions:
- Move `index.html`, `dashboard.html`, `privacy-policy.html`, `terms-of-service.html` to `public/`
- Use Vercel rewrites to serve them directly

This reduces 4 functions to 0.

**Result: 17 → 13 functions** (Still need to combine more)

### Option 3: Upgrade to Pro Plan

- **Pro Plan**: $20/month per user
- Unlimited serverless functions
- Better performance
- More features

### Option 4: Hybrid Approach (Best)

Combine Option 1 + Option 2:
- Use static files for HTML pages (4 functions → 0)
- Combine store API functions (8 functions → 4)
- Remove or combine test functions (3 functions → 0 or 1)

**Result: 17 → 4-5 functions** ✅✅✅

## Recommended Implementation

I'll implement Option 4 (Hybrid Approach) which will:
1. ✅ Convert HTML pages to static files
2. ✅ Combine store API functions
3. ✅ Remove test functions from production build

This will bring you well under the 12 function limit while maintaining all functionality.
