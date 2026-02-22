# Shared Meta Account Implementation (Option 4)

## Overview

This implementation enables **Option 4: Shared Meta Account** where you (the platform) maintain one Meta Business Account, and each client store gets its own phone number under that account. This eliminates the need for clients to set up their own Meta accounts.

## Architecture

### How It Works

1. **Single Meta Business Account**: You maintain one Meta Business Account with multiple phone numbers
2. **Store-to-Phone Mapping**: Each store in your system gets assigned a unique phone number ID
3. **Automatic Routing**: Incoming WhatsApp messages are automatically routed to the correct store based on the `phone_number_id` in the webhook payload
4. **Outgoing Messages**: Messages sent from your system use the store's assigned phone number ID

### Key Components

#### 1. Database Schema (`prisma/schema.prisma`)

Added two new fields to `StoreConfig`:
- `whatsappPhoneNumberId`: Meta's phone number ID for this store
- `whatsappDisplayNumber`: Human-readable phone number (e.g., +1234567890)

#### 2. Webhook Handler (`src/controllers/whatsappController.ts`)

Updated to extract `phone_number_id` from webhook metadata and resolve the store:
```typescript
const phoneNumberId = value?.metadata?.phone_number_id || null;
// Resolve store from phone number ID
const store = await prisma.storeConfig.findFirst({
  where: { whatsappPhoneNumberId: phoneNumberId }
});
```

#### 3. WhatsApp Bot Service (`src/services/whatsappBot.ts`)

Updated `sendWhatsAppMessage()` to accept `storeId` parameter and look up the store's phone number ID:
```typescript
export async function sendWhatsAppMessage(
  to: string,
  message: string,
  storeId?: string  // New parameter
): Promise<boolean>
```

#### 4. Admin API (`src/routes/admin.ts`)

New endpoints for managing phone number assignments:

- **GET `/api/admin/phone-numbers`**: List all available phone numbers from your Meta account
- **POST `/api/admin/stores/:storeId/phone-number`**: Assign a phone number to a store
- **GET `/api/admin/stores/:storeId/phone-number`**: Get phone number assignment for a store
- **DELETE `/api/admin/stores/:storeId/phone-number`**: Remove phone number assignment

## Setup Instructions

### 1. Database Migration

Run the migration to add the new fields:
```bash
# Option A: Using Prisma Migrate
npx prisma migrate dev --name add_whatsapp_phone_number_fields

# Option B: Manual SQL (if migrate fails)
psql $DATABASE_URL < prisma/migrations/add_whatsapp_phone_number_fields.sql
```

### 2. Environment Variables

Update your `.env` file with the shared account credentials:

```env
# WhatsApp Business API (Shared Meta Account)
WHATSAPP_ACCESS_TOKEN=your_shared_access_token
WHATSAPP_BUSINESS_ACCOUNT_ID=your_business_account_id
WHATSAPP_PHONE_NUMBER_ID=default_fallback_phone_id  # Optional, for backward compatibility
WHATSAPP_APP_SECRET=your_app_secret
WHATSAPP_WEBHOOK_VERIFY_TOKEN=your_webhook_token
```

**Important**: 
- `WHATSAPP_ACCESS_TOKEN`: One token for all stores (shared account)
- `WHATSAPP_BUSINESS_ACCOUNT_ID`: Your Meta Business Account ID (needed for phone number management)

### 3. Provision Phone Numbers

#### Step 1: Get Available Phone Numbers

```bash
curl http://localhost:3000/api/admin/phone-numbers
```

Response:
```json
{
  "success": true,
  "phoneNumbers": [
    {
      "phoneNumberId": "123456789012345",
      "displayNumber": "+1234567890",
      "verifiedName": "Your Business Name",
      "verificationStatus": "VERIFIED"
    }
  ]
}
```

#### Step 2: Assign Phone Number to Store

```bash
curl -X POST http://localhost:3000/api/admin/stores/S001/phone-number \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumberId": "123456789012345",
    "displayNumber": "+1234567890"
  }'
```

#### Step 3: Verify Assignment

```bash
curl http://localhost:3000/api/admin/stores/S001/phone-number
```

## Client Onboarding Flow

### Simplified Process

1. **You create the store** in your system (via dashboard or API)
2. **You assign a phone number** from your Meta account to the store
3. **Client receives instructions**:
   - "Your WhatsApp number is: +1234567890"
   - "Send your data to this number"
   - No Meta account setup required!

### What Clients Need to Do

- **Nothing!** They just send WhatsApp messages to their assigned number
- No Meta Business Account setup
- No phone number verification
- No webhook configuration

## Benefits

✅ **Zero client setup** - Clients just send messages  
✅ **Centralized management** - You control all phone numbers  
✅ **Easier support** - You can troubleshoot issues directly  
✅ **Cost efficiency** - One Meta account, multiple stores  
✅ **Faster onboarding** - Minutes instead of hours

## Phone Number Limits

**Important:** Meta limits the number of phone numbers per WhatsApp Business Account:

- **Default**: 25 phone numbers per WABA
- **Initial**: Only 2 numbers during registration period
- **Maximum**: Up to 120 numbers (with Meta approval)
- **Easy Increase**: Up to 20 numbers with basic justification

See `PHONE_NUMBER_LIMITS.md` for detailed information and how to request limit increases.  

## API Endpoints

### Admin Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/phone-numbers` | List available phone numbers |
| POST | `/api/admin/stores/:storeId/phone-number` | Assign phone number to store |
| GET | `/api/admin/stores/:storeId/phone-number` | Get store's phone number |
| DELETE | `/api/admin/stores/:storeId/phone-number` | Remove phone number assignment |

### Example: Assign Phone Number

```bash
POST /api/admin/stores/S001/phone-number
Content-Type: application/json

{
  "phoneNumberId": "123456789012345",
  "displayNumber": "+1234567890"  // Optional, will be fetched if not provided
}
```

## Testing

### Test Webhook with Phone Number ID

The webhook payload from Meta includes `metadata.phone_number_id`:

```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "changes": [{
      "value": {
        "metadata": {
          "phone_number_id": "123456789012345"
        },
        "messages": [{
          "from": "1234567890",
          "id": "wamid.xxx",
          "text": { "body": "Sales: Cash 1000" }
        }]
      }
    }]
  }]
}
```

The system automatically routes this message to the store with `whatsappPhoneNumberId = "123456789012345"`.

## Migration from Single Phone Number

If you're migrating from a single phone number setup:

1. Run the database migration
2. Assign your existing phone number to stores:
   ```bash
   curl -X POST /api/admin/stores/S001/phone-number \
     -d '{"phoneNumberId": "your_existing_phone_id"}'
   ```
3. Update environment variables (add `WHATSAPP_BUSINESS_ACCOUNT_ID`)
4. Test with a message to verify routing works

## Troubleshooting

### Phone Number Not Resolved

If messages aren't being routed correctly:
1. Check webhook logs for `phoneNumberId` value
2. Verify store has `whatsappPhoneNumberId` set:
   ```bash
   curl /api/admin/stores/S001/phone-number
   ```
3. Ensure phone number ID matches exactly (case-sensitive)

### Messages Not Sending

If outgoing messages fail:
1. Verify `WHATSAPP_ACCESS_TOKEN` is set
2. Check store has `whatsappPhoneNumberId` assigned
3. Review logs for specific error messages

## Next Steps

1. ✅ Database schema updated
2. ✅ Webhook routing implemented
3. ✅ Admin API created
4. ⏭️ Run database migration
5. ⏭️ Assign phone numbers to existing stores
6. ⏭️ Test with real WhatsApp messages
7. ⏭️ Update client onboarding documentation
