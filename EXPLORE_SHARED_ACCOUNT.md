# 🚀 Exploring the Shared Meta Account Implementation

## 📋 Complete Message Flow

### Incoming Message Flow

```
1. WhatsApp Message Sent
   ↓
2. Meta Webhook → /api/webhook/whatsapp
   ↓
3. Extract phone_number_id from webhook metadata
   ↓
4. Lookup store by whatsappPhoneNumberId
   ↓
5. Queue message with storeId
   ↓
6. Process message (classify, extract, confirm)
   ↓
7. Send response using store's phone number
```

### Outgoing Message Flow

```
1. System needs to send message
   ↓
2. Call sendWhatsAppMessage(to, message, storeId)
   ↓
3. Lookup store's whatsappPhoneNumberId
   ↓
4. Use store's phone number ID in API call
   ↓
5. Message sent from correct store number
```

## 🔍 Key Components Explained

### 1. Webhook Handler (`src/controllers/whatsappController.ts`)

**What it does:**
- Receives webhook from Meta
- Extracts `phone_number_id` from `value.metadata.phone_number_id`
- Routes message to correct store

**Key Code:**
```typescript
const phoneNumberId = value?.metadata?.phone_number_id || null;
const store = await prisma.storeConfig.findFirst({
  where: { whatsappPhoneNumberId: phoneNumberId }
});
```

### 2. WhatsApp Bot Service (`src/services/whatsappBot.ts`)

**What it does:**
- Sends messages using store-specific phone numbers
- Falls back to env var if store doesn't have one

**Key Code:**
```typescript
if (storeId) {
  phoneNumberId = await getStorePhoneNumberId(storeId);
}
// Uses store's phone number ID to send
```

### 3. Admin API (`src/routes/admin.ts`)

**What it does:**
- Manages phone number assignments
- Lists available numbers from Meta
- Assigns/removes phone numbers from stores

## 🧪 Testing the Implementation

### Step 1: Check Current Setup

```bash
# Check if server is running
curl http://localhost:3000/health

# Check admin routes are registered
curl http://localhost:3000/api/admin/phone-numbers
```

### Step 2: List Available Phone Numbers

```bash
curl http://localhost:3000/api/admin/phone-numbers \
  -H "Authorization: Bearer YOUR_TOKEN"  # If auth is enabled
```

**Expected Response:**
```json
{
  "success": true,
  "phoneNumbers": [
    {
      "phoneNumberId": "123456789012345",
      "displayNumber": "+1234567890",
      "verifiedName": "Your Business",
      "verificationStatus": "VERIFIED"
    }
  ]
}
```

### Step 3: Assign Phone Number to Store

```bash
curl -X POST http://localhost:3000/api/admin/stores/S001/phone-number \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumberId": "123456789012345",
    "displayNumber": "+1234567890"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "store": {
    "storeId": "S001",
    "storeName": "Store 1",
    "whatsappPhoneNumberId": "123456789012345",
    "whatsappDisplayNumber": "+1234567890"
  }
}
```

### Step 4: Verify Assignment

```bash
curl http://localhost:3000/api/admin/stores/S001/phone-number
```

### Step 5: Test Webhook (Mock)

Create a test webhook payload:

```bash
curl -X POST http://localhost:3000/api/webhook/whatsapp \
  -H "Content-Type: application/json" \
  -d '{
    "object": "whatsapp_business_account",
    "entry": [{
      "changes": [{
        "value": {
          "metadata": {
            "phone_number_id": "123456789012345"
          },
          "messages": [{
            "from": "1234567890",
            "id": "wamid.test123",
            "type": "text",
            "text": {
              "body": "Sales: Cash 1000 Card 500"
            }
          }]
        }
      }]
    }]
  }'
```

**Check logs** - you should see:
```
📱 WhatsApp Message Received {
  phoneNumberId: "123456789012345",
  storeId: "S001",  // ✅ Correctly resolved!
  ...
}
```

## 📊 Database Schema

### StoreConfig Table

```sql
SELECT 
  store_id,
  store_name,
  whatsapp_phone_number_id,
  whatsapp_display_number
FROM store_config;
```

**Example Data:**
```
store_id | store_name | whatsapp_phone_number_id | whatsapp_display_number
---------|------------|-------------------------|------------------------
S001     | Store 1    | 123456789012345         | +1234567890
S002     | Store 2    | 987654321098765         | +1987654321
```

## 🔄 Complete Example Scenario

### Scenario: Two Stores, Two Phone Numbers

**Setup:**
1. Store S001 → Phone +1234567890 (ID: 123456789012345)
2. Store S002 → Phone +1987654321 (ID: 987654321098765)

**Flow:**

1. **Client sends message to Store 1:**
   ```
   From: +15551234567
   To: +1234567890
   Message: "Sales: Cash 2000"
   ```

2. **Meta webhook arrives:**
   ```json
   {
     "value": {
       "metadata": {
         "phone_number_id": "123456789012345"  // Store 1's number
       },
       "messages": [{
         "from": "15551234567",
         "text": { "body": "Sales: Cash 2000" }
       }]
     }
   }
   ```

3. **System resolves:**
   - Finds `phone_number_id = "123456789012345"`
   - Looks up store: `WHERE whatsappPhoneNumberId = "123456789012345"`
   - Finds: `storeId = "S001"` ✅

4. **Processes message:**
   - Classifies as STORE_SALES
   - Extracts: cash=2000
   - Creates pending action for S001

5. **Sends confirmation:**
   - Uses Store 1's phone number ID
   - Message appears from +1234567890 ✅

## 🛠️ Debugging Tips

### Check Store Assignment

```sql
-- See all store phone assignments
SELECT 
  store_id,
  store_name,
  whatsapp_phone_number_id,
  whatsapp_display_number
FROM store_config
WHERE whatsapp_phone_number_id IS NOT NULL;
```

### Check Webhook Logs

Look for these log entries:
```
📱 WhatsApp Message Received {
  phoneNumberId: "...",
  storeId: "S001",  // Should be set if routing works
  ...
}
```

### Test Phone Number Lookup

```typescript
// In Node.js console or test script
const store = await prisma.storeConfig.findFirst({
  where: { whatsappPhoneNumberId: "123456789012345" }
});
console.log(store?.storeId); // Should return "S001"
```

## 🎯 Common Issues & Solutions

### Issue: `storeId` is null in logs

**Cause:** Phone number ID not found in database

**Solution:**
1. Check webhook has `metadata.phone_number_id`
2. Verify store has `whatsappPhoneNumberId` set
3. Ensure IDs match exactly (case-sensitive)

### Issue: Messages sent from wrong number

**Cause:** `storeId` not passed to `sendWhatsAppMessage()`

**Solution:**
- Ensure all calls include `storeId`:
  ```typescript
  await sendWhatsAppMessage(phone, message, storeId); // ✅
  await sendWhatsAppMessage(phone, message); // ❌ Uses fallback
  ```

### Issue: Admin API returns 400

**Cause:** Missing environment variables

**Solution:**
```bash
# Check .env has:
WHATSAPP_ACCESS_TOKEN=...
WHATSAPP_BUSINESS_ACCOUNT_ID=...
```

## 📝 Next Steps

1. ✅ **Run migration** to add phone number fields
2. ✅ **Set environment variables** (especially `WHATSAPP_BUSINESS_ACCOUNT_ID`)
3. ✅ **Assign phone numbers** to existing stores
4. ✅ **Test with real webhook** from Meta
5. ✅ **Monitor logs** to verify routing works

## 🔗 Related Files

- `src/controllers/whatsappController.ts` - Webhook handler
- `src/services/whatsappBot.ts` - Message sending
- `src/routes/admin.ts` - Phone number management
- `src/jobs/processMessage.ts` - Message processing
- `prisma/schema.prisma` - Database schema
