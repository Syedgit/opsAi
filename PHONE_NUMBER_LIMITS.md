# 📱 WhatsApp Business Account Phone Number Limits

## Default Limits

### Initial Registration Period
- **2 phone numbers** per WhatsApp Business Account (WABA)
- This is the limit during the initial setup phase

### Standard Limit (After Verification)
- **25 phone numbers** per WhatsApp Business Account
- This is the default limit once your account is verified

## Increasing the Limit

### Easy Increase
- **Up to 20 phone numbers**: Can be easily approved with basic business justification
- Submit request through Meta Business Support

### Maximum Possible
- **Up to 120 phone numbers** per WABA
- Requires repeated requests with strong business cases
- Each increase needs approval from Meta

## How to Request Limit Increase

### Process:
1. Go to [Meta Business Support](https://business.facebook.com/support)
2. Submit a request explaining:
   - Why you need additional phone numbers
   - Business use case (e.g., "One number per store location")
   - Expected message volume per number
3. Wait for Meta's approval

### Example Justification:
```
"We operate multiple convenience store locations and need a dedicated 
WhatsApp number for each store to provide localized customer support 
and receive operational data. Each store handles 500-1000 messages 
per day."
```

## Portfolio-Based Messaging Limits (2025 Update)

**Important:** As of October 2025, Meta uses a **portfolio-based messaging limit** system:

- All phone numbers under one WABA **share the same messaging limit**
- If one number has a 100K limit and another has 10K, the entire portfolio gets upgraded to 100K
- New phone numbers immediately inherit the portfolio's current limit

### Messaging Tiers:
- **Tier 1**: 1,000 unique users daily
- **Tier 2**: 10,000 unique users daily  
- **Tier 3**: 100,000 unique users daily
- **Tier 4**: Unlimited (with approval)

## Implications for Your Implementation

### Scenario Planning

#### Small Scale (2-25 stores)
✅ **No action needed** - Default limit covers you

#### Medium Scale (26-120 stores)
⚠️ **Request limit increase** - Submit business case to Meta

#### Large Scale (120+ stores)
🔀 **Options:**
1. **Multiple WABAs**: Create multiple WhatsApp Business Accounts
   - Each WABA can have up to 120 numbers
   - Requires managing multiple access tokens
   - More complex but scalable

2. **Phone Number Pooling**: Share numbers across stores
   - Use message content to route (store ID in message)
   - Less ideal but works within limits

3. **Hybrid Approach**: 
   - Dedicated numbers for high-volume stores
   - Shared numbers for low-volume stores

## Recommendations

### For Your Use Case (Convenience Stores)

**Start with default limit (25 numbers):**
- Assign one number per store
- Monitor usage and message volume
- Request increases as you grow

**When approaching 25 stores:**
- Submit request for increase to 50-100 numbers
- Justification: "Multi-location convenience store chain with dedicated numbers per location"

**If you exceed 120 stores:**
- Consider multiple WABAs (one per region/state)
- Or implement number pooling for low-volume stores

## Cost Considerations

- **Phone numbers**: Usually free (included in Meta Business Account)
- **Messaging costs**: Based on conversation-based pricing
- **API calls**: No additional cost for multiple numbers

## Monitoring Your Usage

### Check Current Limit:
```bash
# Use Meta Graph API
curl -X GET \
  "https://graph.facebook.com/v22.0/{WABA_ID}/phone_numbers" \
  -H "Authorization: Bearer {ACCESS_TOKEN}"
```

### Check Limit Status:
- Go to Meta Business Manager
- Navigate to WhatsApp > Phone Numbers
- View current count vs. limit

## Best Practices

1. **Start Small**: Begin with 2-5 numbers, prove value
2. **Request Early**: Submit limit increase requests before hitting limits
3. **Document Use Cases**: Keep records of why each number is needed
4. **Monitor Usage**: Track message volume per number
5. **Plan Ahead**: Request increases before you need them (approval takes time)

## References

- [Meta WhatsApp Business Accounts Documentation](https://developers.facebook.com/docs/whatsapp/overview/business-accounts/)
- [Phone Number Management](https://developers.facebook.com/docs/whatsapp/cloud-api/phone-numbers/)
- [Messaging Limits](https://developers.facebook.com/docs/whatsapp/messaging-limits/)
