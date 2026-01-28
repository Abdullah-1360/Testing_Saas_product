import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function testLogin() {
  const email = 'abdullahshahid906@gmail.com';
  const password = 'Abc@123456';

  console.log(`\n🔐 Testing login for: ${email}`);
  console.log('━'.repeat(50));

  try {
    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      console.log('❌ User not found');
      return;
    }

    console.log('✅ User found in database');
    console.log(`   ID: ${user.id}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Role: ${user.role}`);
    console.log(`   MFA Enabled: ${user.mfaEnabled}`);
    console.log(`   Created: ${user.createdAt}`);

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (isPasswordValid) {
      console.log('\n✅ Password is correct!');
      console.log('🎉 Login successful!');
    } else {
      console.log('\n❌ Password is incorrect');
    }
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testLogin();
