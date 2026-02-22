#!/usr/bin/env tsx
/**
 * Test script for Shared Meta Account implementation
 * 
 * Usage:
 *   npx tsx scripts/test-shared-account.ts
 * 
 * This script helps you explore and test the shared account setup
 */

import axios from 'axios';
import { prisma } from '../src/config/database';

const BASE_URL = process.env.APP_URL || 'http://localhost:3000';
const API_BASE = `${BASE_URL}/api/admin`;

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
};

function log(message: string, color: keyof typeof colors = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testListPhoneNumbers() {
  log('\n📱 Testing: List Available Phone Numbers', 'blue');
  log('─'.repeat(50), 'blue');
  
  try {
    const response = await axios.get(`${API_BASE}/phone-numbers`);
    
    if (response.data.success) {
      const phones = response.data.phoneNumbers;
      log(`✅ Found ${phones.length} phone number(s)`, 'green');
      
      phones.forEach((phone: any, index: number) => {
        log(`\n  Phone ${index + 1}:`, 'bright');
        log(`    ID: ${phone.phoneNumberId}`);
        log(`    Number: ${phone.displayNumber || 'N/A'}`);
        log(`    Verified Name: ${phone.verifiedName || 'N/A'}`);
        log(`    Status: ${phone.verificationStatus || 'N/A'}`);
      });
      
      return phones;
    } else {
      log('❌ Failed to list phone numbers', 'red');
      return [];
    }
  } catch (error: any) {
    if (error.response?.status === 400) {
      log('⚠️  Missing configuration:', 'yellow');
      log(`   ${error.response.data.details || error.response.data.error}`);
      log('\n   Make sure .env has:', 'yellow');
      log('   - WHATSAPP_ACCESS_TOKEN');
      log('   - WHATSAPP_BUSINESS_ACCOUNT_ID');
    } else {
      log(`❌ Error: ${error.message}`, 'red');
    }
    return [];
  }
}

async function testGetStorePhoneNumber(storeId: string) {
  log(`\n🏪 Testing: Get Phone Number for Store ${storeId}`, 'blue');
  log('─'.repeat(50), 'blue');
  
  try {
    const response = await axios.get(`${API_BASE}/stores/${storeId}/phone-number`);
    
    if (response.data.success) {
      const store = response.data.store;
      log('✅ Store phone number found:', 'green');
      log(`   Store ID: ${store.storeId}`);
      log(`   Store Name: ${store.storeName}`);
      log(`   Phone Number ID: ${store.whatsappPhoneNumberId || 'Not assigned'}`);
      log(`   Display Number: ${store.whatsappDisplayNumber || 'N/A'}`);
      return store;
    } else {
      log('❌ Failed to get store phone number', 'red');
      return null;
    }
  } catch (error: any) {
    if (error.response?.status === 404) {
      log(`⚠️  Store ${storeId} not found`, 'yellow');
    } else {
      log(`❌ Error: ${error.message}`, 'red');
    }
    return null;
  }
}

async function testAssignPhoneNumber(storeId: string, phoneNumberId: string, displayNumber?: string) {
  log(`\n🔗 Testing: Assign Phone Number to Store ${storeId}`, 'blue');
  log('─'.repeat(50), 'blue');
  
  try {
    const payload: any = { phoneNumberId };
    if (displayNumber) {
      payload.displayNumber = displayNumber;
    }
    
    const response = await axios.post(
      `${API_BASE}/stores/${storeId}/phone-number`,
      payload
    );
    
    if (response.data.success) {
      const store = response.data.store;
      log('✅ Phone number assigned successfully!', 'green');
      log(`   Store: ${store.storeName} (${store.storeId})`);
      log(`   Phone Number ID: ${store.whatsappPhoneNumberId}`);
      log(`   Display Number: ${store.whatsappDisplayNumber || 'N/A'}`);
      return store;
    } else {
      log('❌ Failed to assign phone number', 'red');
      return null;
    }
  } catch (error: any) {
    if (error.response?.status === 400) {
      log('⚠️  Assignment failed:', 'yellow');
      log(`   ${error.response.data.details || error.response.data.error}`);
    } else if (error.response?.status === 404) {
      log(`⚠️  Store ${storeId} not found`, 'yellow');
    } else {
      log(`❌ Error: ${error.message}`, 'red');
      if (error.response?.data) {
        log(`   Details: ${JSON.stringify(error.response.data, null, 2)}`);
      }
    }
    return null;
  }
}

async function testListAllStores() {
  log('\n📋 Testing: List All Stores', 'blue');
  log('─'.repeat(50), 'blue');
  
  try {
    const stores = await prisma.storeConfig.findMany({
      select: {
        storeId: true,
        storeName: true,
        whatsappPhoneNumberId: true,
        whatsappDisplayNumber: true,
        active: true,
      },
      orderBy: { storeId: 'asc' },
    });
    
    if (stores.length === 0) {
      log('⚠️  No stores found in database', 'yellow');
      return [];
    }
    
    log(`✅ Found ${stores.length} store(s)`, 'green');
    stores.forEach((store) => {
      log(`\n  ${store.storeId}: ${store.storeName}`, 'bright');
      log(`    Phone Number ID: ${store.whatsappPhoneNumberId || 'Not assigned'}`);
      log(`    Display Number: ${store.whatsappDisplayNumber || 'N/A'}`);
      log(`    Active: ${store.active ? 'Yes' : 'No'}`);
    });
    
    return stores;
  } catch (error: any) {
    log(`❌ Error: ${error.message}`, 'red');
    return [];
  }
}

async function testWebhookRouting(phoneNumberId: string) {
  log(`\n🔀 Testing: Webhook Routing for Phone Number ID`, 'blue');
  log('─'.repeat(50), 'blue');
  
  try {
    const store = await prisma.storeConfig.findFirst({
      where: { whatsappPhoneNumberId: phoneNumberId },
      select: {
        storeId: true,
        storeName: true,
        whatsappDisplayNumber: true,
      },
    });
    
    if (store) {
      log('✅ Phone number routes to:', 'green');
      log(`   Store ID: ${store.storeId}`);
      log(`   Store Name: ${store.storeName}`);
      log(`   Display Number: ${store.whatsappDisplayNumber || 'N/A'}`);
      return store;
    } else {
      log(`⚠️  Phone number ID "${phoneNumberId}" not assigned to any store`, 'yellow');
      return null;
    }
  } catch (error: any) {
    log(`❌ Error: ${error.message}`, 'red');
    return null;
  }
}

async function main() {
  log('\n🚀 Shared Meta Account Test Suite', 'bright');
  log('='.repeat(50), 'bright');
  
  // Test 1: List all stores
  const stores = await testListAllStores();
  
  // Test 2: List available phone numbers
  const phoneNumbers = await testListPhoneNumbers();
  
  // Test 3: Check store assignments
  if (stores.length > 0) {
    log('\n📊 Current Store Assignments:', 'bright');
    for (const store of stores) {
      if (store.whatsappPhoneNumberId) {
        await testGetStorePhoneNumber(store.storeId);
      }
    }
  }
  
  // Test 4: Test routing
  if (phoneNumbers.length > 0 && stores.length > 0) {
    log('\n🔀 Testing Routing:', 'bright');
    for (const phone of phoneNumbers) {
      await testWebhookRouting(phone.phoneNumberId);
    }
  }
  
  // Interactive mode
  log('\n💡 Interactive Mode', 'bright');
  log('─'.repeat(50), 'blue');
  log('To assign a phone number to a store, use:', 'yellow');
  log(`  curl -X POST ${API_BASE}/stores/S001/phone-number \\`, 'yellow');
  log(`    -H "Content-Type: application/json" \\`, 'yellow');
  log(`    -d '{"phoneNumberId": "YOUR_PHONE_ID"}'`, 'yellow');
  
  log('\n✅ Test suite completed!', 'green');
}

// Run if executed directly
if (require.main === module) {
  main()
    .catch((error) => {
      log(`\n❌ Fatal error: ${error.message}`, 'red');
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

export { testListPhoneNumbers, testAssignPhoneNumber, testGetStorePhoneNumber, testListAllStores };
