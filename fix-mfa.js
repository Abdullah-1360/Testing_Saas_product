const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * Utility script to disable MFA for a user account
 * This should only be used for emergency access recovery
 * 
 * Usage: node fix-mfa.js [email]
 * Example: node fix-mfa.js user@example.com
 */
async function disableMfaForUser(email) {
  const startTime = Date.now();
  
  try {
    console.log(`🔧 Disabling MFA for user: ${email}...`);
    console.log(`⏰ Started at: ${new Date().toISOString()}`);
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new Error('Invalid email format');
    }
    
    // Find the user with role information
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        role: true
      }
    });
    
    if (!user) {
      console.log('❌ User not found');
      process.exit(1);
    }
    
    console.log(`👤 Found user: ${user.email}`);
    console.log(`🏷️  Username: ${user.username}`);
    console.log(`🎭 Role: ${user.role?.name || 'Unknown'}`);
    console.log(`🔐 Current MFA status: ${user.mfaEnabled ? 'ENABLED' : 'DISABLED'}`);
    console.log(`✅ Account active: ${user.isActive}`);
    
    if (!user.mfaEnabled) {
      console.log('ℹ️  MFA is already disabled for this user');
      return;
    }
    
    // Perform the MFA disable operation in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Disable MFA and clear related data
      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data: {
          mfaEnabled: false,
          mfaSecret: null,
          mfaBackupCodes: [] // Use empty array instead of null for consistency
        }
      });
      
      // Create audit log entry
      await tx.auditEvent.create({
        data: {
          userId: user.id, // Self-operation
          action: 'mfa_disabled_emergency',
          resource: 'user',
          resourceId: user.id,
          details: {
            email: user.email,
            username: user.username,
            reason: 'emergency_script',
            executedBy: 'system_admin',
            timestamp: new Date().toISOString()
          },
          ipAddress: '127.0.0.1', // Local script execution
          userAgent: 'fix-mfa-script'
        }
      });
      
      return updatedUser;
    });
    
    const duration = Date.now() - startTime;
    
    console.log('✅ MFA successfully disabled');
    console.log(`🔐 New MFA status: ${result.mfaEnabled ? 'ENABLED' : 'DISABLED'}`);
    console.log(`📝 Audit log created for compliance`);
    console.log(`⏱️  Operation completed in ${duration}ms`);
    console.log('');
    console.log('🎉 User can now log in without MFA');
    console.log(`   Email: ${email}`);
    console.log('   (Use existing password - not displayed for security)');
    console.log('');
    console.log('⚠️  SECURITY REMINDER:');
    console.log('   - This operation has been logged for audit purposes');
    console.log('   - Consider re-enabling MFA after user regains access');
    console.log('   - Review account security settings');
    
  } catch (error) {
    console.error('❌ Operation failed:', error.message);
    
    // Log specific error types
    if (error.code === 'P2002') {
      console.error('   Database constraint violation');
    } else if (error.code === 'P2025') {
      console.error('   Record not found or already updated');
    } else if (error.message.includes('Invalid email')) {
      console.error('   Please provide a valid email address');
    }
    
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Main execution
async function main() {
  const email = process.argv[2];
  
  if (!email) {
    console.log('❌ Usage: node fix-mfa.js <email>');
    console.log('   Example: node fix-mfa.js user@example.com');
    process.exit(1);
  }
  
  // Confirmation prompt for safety
  console.log('⚠️  WARNING: This will disable MFA for the specified user');
  console.log(`   Target user: ${email}`);
  console.log('   This operation will be logged for audit purposes');
  console.log('');
  
  // In a production environment, you might want to add an interactive confirmation
  // For now, proceeding directly as this is an emergency utility
  
  await disableMfaForUser(email);
}

main().catch(console.error);