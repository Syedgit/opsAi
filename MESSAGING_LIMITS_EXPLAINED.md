# 📊 WhatsApp Messaging Limits Explained

## Understanding Portfolio-Based Limits (2025)

### ⚠️ IMPORTANT: YES, They Share the Limit!

**The 100K limit is SHARED across ALL phone numbers in your WABA:**
- **100,000 unique users per day** for OUTBOUND messages across ALL stores combined
- NOT 100K per phone number
- NOT 100K per store
- **YES, it's a combined/portfolio limit**

### What Counts Against the Limit

**OUTBOUND messages (you initiate):**
- ✅ Template messages starting NEW conversations
- ✅ Messages to users you haven't contacted in 24 hours
- ❌ **These count toward the shared 100K limit**

**INBOUND messages (customers message you):**
- ✅ Customers sending messages to stores
- ✅ Replies within 24-hour customer service window
- ❌ **These DON'T count against the limit**

### How It Works

#### Example Scenario: 120 Stores, Tier 3 Limit (100K unique users/day)

```
WABA (WhatsApp Business Account) - SHARED 100K Limit
├── Phone Number 1 (Store S001)
│   └── Uses 500 unique users/day from shared pool
├── Phone Number 2 (Store S002)  
│   └── Uses 1,000 unique users/day from shared pool
├── Phone Number 3 (Store S003)
│   └── Uses 800 unique users/day from shared pool
...
└── Phone Number 120 (Store S120)
    └── Uses 300 unique users/day from shared pool

Total Used: 500 + 1,000 + 800 + ... + 300 = Must stay under 100K total
```

### Key Points

1. **All stores SHARE the 100K limit** ⚠️
   - Store S001 uses 500 from the shared 100K pool
   - Store S002 uses 1,000 from the shared 100K pool
   - Total across all stores must stay under 100K/day
   - **This is a portfolio-wide limit, not per-number**

2. **The limit is per unique user, not per message**
   - You can send multiple messages to the same user
   - The limit counts unique phone numbers you message OUTBOUND
   - Example: Messaging the same customer 10 times = 1 unique user
   - **Only counts NEW outbound conversations**

3. **INBOUND messages don't count** ✅
   - Customers messaging stores = Unlimited
   - Store replies within 24 hours = Unlimited
   - Only OUTBOUND template messages count

## Real-World Example

### Scenario: 50 Convenience Stores

**Each store:**
- Has 1 phone number
- Receives messages from ~500 customers/day (INBOUND - doesn't count)
- Sends confirmations/responses to those customers (within 24h - doesn't count)
- Sends outbound notifications to ~100 new customers/day (OUTBOUND - counts)

**With Tier 3 (100K unique users/day SHARED):**
- Store S001: Uses 100 unique users/day from shared pool
- Store S002: Uses 150 unique users/day from shared pool
- Store S050: Uses 80 unique users/day from shared pool
- **Total:** 50 stores × ~100 = ~5,000 unique users/day

**Result:** You're using only 5% of your shared 100K limit! ✅

### If You Need More Outbound Capacity

**Option 1: Multiple WABAs**
- WABA 1: Stores 1-60 (100K shared limit)
- WABA 2: Stores 61-120 (100K shared limit)
- Total: 200K unique users/day

**Option 2: Optimize Outbound Usage**
- Only send outbound to new customers
- Use inbound replies for confirmations (unlimited)
- Result: Minimal outbound usage

## Messaging Tiers Explained

### Tier 1: 1,000 unique users/day
- **Per phone number**: Each number can message 1,000 unique users/day
- **Total capacity**: 120 numbers × 1,000 = 120,000 unique users/day
- **Good for**: Small stores, testing, low volume

### Tier 2: 10,000 unique users/day
- **Per phone number**: Each number can message 10,000 unique users/day
- **Total capacity**: 120 numbers × 10,000 = 1.2 million unique users/day
- **Good for**: Medium stores, growing businesses

### Tier 3: 100,000 unique users/day
- **Per phone number**: Each number can message 100,000 unique users/day
- **Total capacity**: 120 numbers × 100,000 = 12 million unique users/day
- **Good for**: Large stores, high-volume operations

### Tier 4: Unlimited
- **Per phone number**: Unlimited unique users/day
- **Requires**: Meta approval, proven high volume
- **Good for**: Enterprise-level operations

## What This Means for Your Platform

### For Convenience Stores

**Typical usage per store:**
- 100-1,000 customers sending messages
- Store responds to each customer
- = 100-1,000 unique users/day per store

**With 120 stores:**
- **Worst case (Tier 1)**: Each store can handle 1,000 unique users/day
- **Most stores**: Each store can handle 10,000-100,000 unique users/day
- **Your usage**: ~500 unique users/store/day

**Conclusion:** Even with Tier 1, you have plenty of capacity! ✅

## Important Clarifications

### ❌ Common Misconceptions

1. **"120 stores share 100K limit"**
   - ❌ WRONG: Each store gets 100K limit
   - ✅ CORRECT: All stores share the same tier (100K), but each gets the full limit

2. **"100K total messages per day"**
   - ❌ WRONG: It's 100K unique users, not messages
   - ✅ CORRECT: You can send unlimited messages, but to max 100K unique users/day

3. **"I need to split the limit between stores"**
   - ❌ WRONG: No splitting needed
   - ✅ CORRECT: Each store operates independently with full limit

### ✅ What Actually Happens

- **Store S001** messages 500 unique customers → Uses 500/100K (0.5%)
- **Store S002** messages 1,000 unique customers → Uses 1K/100K (1%)
- **Store S120** messages 200 unique customers → Uses 200/100K (0.2%)
- **Total**: All stores operate independently ✅

## Monitoring Your Usage

### Check Current Tier

```bash
# Use Meta Graph API to check your WABA tier
curl -X GET \
  "https://graph.facebook.com/v22.0/{WABA_ID}?fields=messaging_product,account_review_status" \
  -H "Authorization: Bearer {ACCESS_TOKEN}"
```

### Track Per-Store Usage

Each store's phone number tracks its own unique users. You can monitor:
- Unique users messaged per day per store
- Message volume per store
- Tier status per WABA (shared across all numbers)

## Summary

**Question:** "Will 120 stores share a combined 100K limit?"

**Answer:** **YES!** ⚠️

- All 120 stores SHARE a combined 100K unique users/day limit
- This is for OUTBOUND messages only (you initiate)
- INBOUND messages (customers messaging stores) are UNLIMITED ✅
- Replies within 24 hours are UNLIMITED ✅

**For your convenience store platform:**

**Good News:** 
- Most messages are INBOUND (customers sending data) = Unlimited ✅
- Store confirmations are replies = Unlimited ✅
- Only outbound notifications count toward limit

**Typical Usage:**
- 120 stores × ~50 outbound notifications/day = ~6,000 unique users/day
- Well under the 100K shared limit ✅

**If You Need More:**
- Request Tier 4 (unlimited) from Meta
- Or use multiple WABAs (each gets 100K limit)
