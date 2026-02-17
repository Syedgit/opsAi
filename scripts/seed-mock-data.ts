import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';

dotenv.config();

// Use DIRECT_URL for seeding (bypasses connection pooling)
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

async function seedMockData() {
  console.log('🌱 Seeding mock data...');

  try {
    // Create a test store
    const store = await prisma.storeConfig.upsert({
      where: { storeId: 'S001' },
      update: {},
      create: {
        storeId: 'S001',
        storeName: 'Main Street Store',
        sheetId: 'mock-sheet-id-123',
        timezone: 'America/New_York',
        active: true,
      },
    });

    console.log('✅ Store created:', store.storeId);

    // Create a test user
    await prisma.userDirectory.upsert({
      where: { phoneE164: '+17329397703' },
      update: {},
      create: {
        phoneE164: '+17329397703',
        name: 'Test User',
        role: 'STAFF',
        storeId: 'S001',
        isActive: true,
      },
    });

    console.log('✅ User created');

    // Create mock store sales
    const salesDates = [
      new Date('2026-01-14'),
      new Date('2026-01-13'),
      new Date('2026-01-12'),
      new Date('2026-01-11'),
      new Date('2026-01-10'),
    ];

    for (const date of salesDates) {
      await prisma.pendingActions.create({
        data: {
          actionId: uuidv4(),
          phoneE164: '+17329397703',
          storeId: 'S001',
          type: 'STORE_SALES',
          payloadJson: {
            date: date.toISOString().split('T')[0],
            cash: Math.floor(Math.random() * 2000) + 1500,
            card: Math.floor(Math.random() * 5000) + 4000,
            tax: Math.floor(Math.random() * 500) + 200,
            total_inside: Math.floor(Math.random() * 7000) + 6000,
          },
          confidence: 0.9,
          status: 'CONFIRMED',
          messageIdInbound: `msg_${uuidv4()}`,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
    }

    console.log('✅ Store sales created');

    // Create mock invoices
    const vendors = ['HLA', 'Pepsi', 'Coca-Cola', 'Frito-Lay'];
    for (let i = 0; i < 5; i++) {
      await prisma.pendingActions.create({
        data: {
          actionId: uuidv4(),
          phoneE164: '+17329397703',
          storeId: 'S001',
          type: 'INVOICE_EXPENSE',
          payloadJson: {
            vendor: vendors[Math.floor(Math.random() * vendors.length)],
            amount: Math.floor(Math.random() * 2000) + 500,
            invoice_date: salesDates[i].toISOString().split('T')[0],
            invoice_number: `INV-${Math.floor(Math.random() * 10000)}`,
            category: 'Inventory',
            paid: Math.random() > 0.5 ? 'Y' : 'N',
          },
          confidence: 0.85,
          status: 'CONFIRMED',
          messageIdInbound: `msg_${uuidv4()}`,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
    }

    console.log('✅ Invoices created');

    // Create mock fuel sales
    for (let i = 0; i < 3; i++) {
      await prisma.pendingActions.create({
        data: {
          actionId: uuidv4(),
          phoneE164: '+17329397703',
          storeId: 'S001',
          type: 'FUEL_SALES',
          payloadJson: {
            date: salesDates[i].toISOString().split('T')[0],
            gallons: Math.floor(Math.random() * 5000) + 2000,
            fuel_sales: Math.floor(Math.random() * 15000) + 10000,
            fuel_gp: Math.floor(Math.random() * 1000) + 300,
          },
          confidence: 0.9,
          status: 'CONFIRMED',
          messageIdInbound: `msg_${uuidv4()}`,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
    }

    console.log('✅ Fuel sales created');

    // Create mock paid outs
    const employees = ['John', 'Sarah', 'Mike'];
    for (let i = 0; i < 4; i++) {
      await prisma.pendingActions.create({
        data: {
          actionId: uuidv4(),
          phoneE164: '+17329397703',
          storeId: 'S001',
          type: 'PAID_OUT',
          payloadJson: {
            date: salesDates[i].toISOString().split('T')[0],
            amount: Math.floor(Math.random() * 200) + 50,
            reason: ['Cleaning supplies', 'Office supplies', 'Refund', 'Misc'][i % 4],
            employee: employees[Math.floor(Math.random() * employees.length)],
          },
          confidence: 0.8,
          status: 'CONFIRMED',
          messageIdInbound: `msg_${uuidv4()}`,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
    }

    console.log('✅ Paid outs created');

    // Create mock orders
    for (let i = 0; i < 3; i++) {
      await prisma.pendingActions.create({
        data: {
          actionId: uuidv4(),
          phoneE164: '+17329397703',
          storeId: 'S001',
          type: 'ORDER_REQUEST',
          payloadJson: {
            order_batch_id: uuidv4(),
            vendor_groups: [
              {
                vendor: 'HLA',
                items: [
                  { name: 'Marlboro Red King', qty: 3, unit: 'carton' },
                  { name: 'Camel Blue', qty: 2, unit: 'carton' },
                ],
              },
              {
                vendor: 'Pepsi',
                items: [
                  { name: 'Pepsi 12oz', qty: 10, unit: 'case' },
                  { name: 'Mountain Dew', qty: 5, unit: 'case' },
                ],
              },
            ],
          },
          confidence: 0.9,
          status: 'CONFIRMED',
          messageIdInbound: `msg_${uuidv4()}`,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
    }

    console.log('✅ Orders created');

    // Create some pending actions
    await prisma.pendingActions.create({
      data: {
        actionId: uuidv4(),
        phoneE164: '+17329397703',
        storeId: 'S001',
        type: 'STORE_SALES',
        payloadJson: {
          date: new Date().toISOString().split('T')[0],
          cash: 2100,
          card: 5400,
          tax: 320,
          total_inside: 7820,
        },
        confidence: 0.75,
        status: 'PENDING',
        messageIdInbound: `msg_${uuidv4()}`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    console.log('✅ Pending action created');

    console.log('\n🎉 Mock data seeded successfully!');
    console.log('\n📊 Dashboard should now show:');
    console.log('  - Store: S001 - Main Street Store');
    console.log('  - 5 Store Sales entries');
    console.log('  - 5 Invoice/Expense entries');
    console.log('  - 3 Fuel Sales entries');
    console.log('  - 4 Paid Out entries');
    console.log('  - 3 Order entries');
    console.log('  - 1 Pending action');
  } catch (error) {
    console.error('❌ Error seeding data:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

seedMockData();
