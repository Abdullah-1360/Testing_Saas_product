const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function verifyEngineer() {
  try {
    const user = await prisma.user.findUnique({
      where: { email: 'engineer@wp-autohealer.local' }
    });
    
    if (!user) {
      console.log('❌ User not found');
      return;
    }
    
    const testPassword = 'engineer123!';
    const isValid = await bcrypt.compare(testPassword, user.passwordHash);
    
    console.log(`📧 Email: ${user.email}`);
    console.log(`🔑 Password 'engineer123!' valid: ${isValid ? '✅ YES' : '❌ NO'}`);
    console.log(`✅ Active: ${user.isActive}`);
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

verifyEngineer();