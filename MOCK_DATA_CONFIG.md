# Mock Data Configuration

## Current Status: ✅ Mock Data Enabled

Mock data is **currently enabled by default** and will be used until Facebook verification is complete.

## How It Works

### Configuration Flag
In `public/dashboard.html`, there's a configuration flag at the top of the script:

```javascript
const USE_MOCK_DATA = true; // Set to false when ready for real data
```

### What This Means

- **`USE_MOCK_DATA = true`** (Current): All API calls use mock data
  - `/api/stores?mock=true`
  - `/api/stores/dashboard?storeId=S001&mock=true`
  - `/api/stores/data?storeId=S001&type=sales&mock=true`
  - `/api/stores/detail?storeId=S001&type=sales&id=1&mock=true`

- **`USE_MOCK_DATA = false`** (After verification): All API calls use real database data
  - `/api/stores`
  - `/api/stores/dashboard?storeId=S001`
  - `/api/stores/data?storeId=S001&type=sales`
  - `/api/stores/detail?storeId=S001&type=sales&id=1`

### Fallback Behavior

The frontend has intelligent fallback:
1. First tries the configured mode (mock or real)
2. If that fails, automatically tries the opposite mode
3. If both fail, uses hardcoded fallback data

This ensures the app always works, even during transitions.

## Switching to Real Data

When Facebook verification is complete and you're ready to use real data:

1. Open `public/dashboard.html`
2. Find the configuration flag (line ~653)
3. Change: `const USE_MOCK_DATA = true;` → `const USE_MOCK_DATA = false;`
4. Save and redeploy

That's it! The app will automatically switch to using real database data.

## Mock Data Available

All mock data includes:
- ✅ 4 stores (S001, S002, S003, S004)
- ✅ Sales data for each store
- ✅ Invoices data for each store
- ✅ Expenses data for each store
- ✅ Fuel sales data for each store
- ✅ Paid outs data for each store
- ✅ Orders data for each store
- ✅ Dashboard statistics for each store

## Benefits

1. **No database needed** - Works immediately without database setup
2. **Full functionality** - All features work with mock data
3. **Easy testing** - Test the entire app without real data
4. **Smooth transition** - One flag to switch to real data when ready
