import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function listUsers() {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        provider: true,
        isActive: true,
        createdAt: true,
        stores: {
          select: {
            storeId: true,
            role: true,
            store: {
              select: {
                storeName: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    console.log('\n📋 Users in Database:\n');
    console.log('=' .repeat(80));

    if (users.length === 0) {
      console.log('No users found in database.');
      console.log('\n💡 To create a test user, use:');
      console.log('   curl -X POST http://localhost:3000/api/auth/signup \\');
      console.log('     -H "Content-Type: application/json" \\');
      console.log('     -d \'{"email":"test@example.com","password":"test123456","name":"Test User"}\'');
    } else {
      users.forEach((user, index) => {
        console.log(`\n${index + 1}. ${user.name || 'No name'} (${user.email})`);
        console.log(`   ID: ${user.id}`);
        console.log(`   Provider: ${user.provider || 'email'}`);
        console.log(`   Active: ${user.isActive ? '✅' : '❌'}`);
        console.log(`   Created: ${user.createdAt.toLocaleString()}`);
        
        if (user.stores.length > 0) {
          console.log(`   Stores:`);
          user.stores.forEach((us) => {
            console.log(`     - ${us.store.storeName} (${us.storeId}) - ${us.role}`);
          });
        } else {
          console.log(`   Stores: None`);
        }
        console.log('-'.repeat(80));
      });
    }

    console.log('\n');
  } catch (error) {
    console.error('Error listing users:', error);
  } finally {
    await prisma.$disconnect();
  }
}

listUsers();
