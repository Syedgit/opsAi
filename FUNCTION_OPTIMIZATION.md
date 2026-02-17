# Function Optimization Summary

## Problem
Vercel Hobby plan limits deployments to **12 serverless functions**, but we had **17 functions**.

## Solution Implemented

### 1. Converted HTML Pages to Static Files (4 → 0 functions)
- ✅ Removed `/api/index.ts` - Now served as `/index.html` (static)
- ✅ Removed `/api/dashboard.ts` - Now served as `/dashboard.html` (static)
- ✅ Removed `/api/privacy-policy.ts` - Now served as `/privacy-policy.html` (static)
- ✅ Removed `/api/terms-of-service.ts` - Now served as `/terms-of-service.html` (static)

**Result: -4 functions**

### 2. Combined Store API Functions (8 → 4 functions)
- ✅ Combined `/api/stores.ts` + `/api/stores/mock.ts` → `/api/stores.ts` (unified with `?mock=true`)
- ✅ Combined `/api/stores/dashboard.ts` + `/api/stores/mock-dashboard.ts` → `/api/stores/dashboard.ts` (unified)
- ✅ Combined `/api/stores/data.ts` + `/api/stores/mock-data.ts` → `/api/stores/data.ts` (unified)
- ✅ Combined `/api/stores/detail.ts` + `/api/stores/mock-detail.ts` → `/api/stores/detail.ts` (unified)

**Result: -4 functions**

### 3. Excluded Test Functions from Production
- ✅ Added `/api/test/*` to `.vercelignore`
- Test functions remain available for local development but excluded from Vercel deployment

**Result: -3 functions (in production)**

## Final Function Count

### Production Functions (6 total) ✅
1. `/api/webhook/whatsapp.ts` - WhatsApp webhook handler
2. `/api/health.ts` - Health check endpoint
3. `/api/stores.ts` - Unified stores endpoint (real + mock)
4. `/api/stores/dashboard.ts` - Unified dashboard endpoint (real + mock)
5. `/api/stores/data.ts` - Unified data endpoint (real + mock)
6. `/api/stores/detail.ts` - Unified detail endpoint (real + mock)

### Excluded from Production
- `/api/test/*` - Test functions (3 functions, excluded via .vercelignore)
- Old mock files (deleted)
- Old HTML server functions (deleted)

## How It Works

### Unified Endpoints
All store API endpoints now support a `?mock=true` query parameter:

- **Mock data**: `/api/stores?mock=true`
- **Real data**: `/api/stores`
- **Mock dashboard**: `/api/stores/dashboard?storeId=S001&mock=true`
- **Real dashboard**: `/api/stores/dashboard?storeId=S001`

### Static Files
HTML pages are now served directly from the `public/` directory:
- `/` → `public/index.html`
- `/dashboard` → `public/dashboard.html`
- `/privacy-policy.html` → `public/privacy-policy.html`
- `/terms-of-service.html` → `public/terms-of-service.html`

## Benefits

1. ✅ **Under 12 function limit** - Only 6 functions in production
2. ✅ **Same functionality** - All features work exactly the same
3. ✅ **Better performance** - Static files are faster than serverless functions
4. ✅ **Easier maintenance** - Unified endpoints reduce code duplication
5. ✅ **Cost savings** - Fewer functions = lower execution costs

## Migration Notes

The frontend automatically tries mock endpoints first, then falls back to real endpoints. This ensures smooth operation during the transition period.

All API calls have been updated to use the unified endpoints with `?mock=true` parameter for mock data.
