const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function resetEngineerPassword() {
  try {
    console.log('🔧 Resetting engineer user password...\n');
    
    const email = 'engineer@wp-autohealer.local';
    const newPassword = 'engineer123!';
    
    // Find the user
    const user = await prisma.user.findUnique({
      where: { email }
    });
    
    if (!user) {
      console.log('❌ Engineer user not found');
      return;
    }
    
    console.log(`📧 Found user: ${user.email}`);
    console.log(`👤 Username: ${user.username}`);
    
    // Hash the new password
    const saltRounds = 12;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);
    
    // Update the user's password
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newPasswordHash,
        passwordChangedAt: new Date(),
      }
    });
    
    console.log('✅ Password updated successfully!');
    
    // Verify the new password works
    const isValid = await bcrypt.compare(newPassword, newPasswordHash);
    console.log(`🔑 Password verification: ${isValid ? 'PASS' : 'FAIL'}`);
    
    console.log('\n📝 Updated credentials:');
    console.log(`Email: ${email}`);
    console.log(`Password: ${newPassword}`);
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

resetEngineerPassword();