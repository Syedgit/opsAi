#!/bin/bash

# Test script to send WhatsApp messages locally
# Usage: ./scripts/test-whatsapp-local.sh <phone_number> [message]

PHONE_NUMBER=${1:-"+17329397703"}
MESSAGE=${2:-"Hello! This is a test message from opsAi (local test)."}

echo "📱 Testing WhatsApp message sending..."
echo "To: $PHONE_NUMBER"
echo "Message: $MESSAGE"
echo ""

curl -X POST http://localhost:3000/api/test/send-message \
  -H "Content-Type: application/json" \
  -d "{
    \"to\": \"$PHONE_NUMBER\",
    \"message\": \"$MESSAGE\"
  }" | jq '.'

echo ""
echo "✅ Done!"
