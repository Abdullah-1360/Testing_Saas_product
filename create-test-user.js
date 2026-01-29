const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function createTestUser() {
  try {
    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: 'admin@wp-autohealer.com' }
    });

    if (existingUser) {
      console.log('Test user already exists!');
      console.log('Email: admin@wp-autohealer.com');
      console.log('Password: admin123');
      return;
    }

    // Find or create SUPER_ADMIN role
    let superAdminRole = await prisma.role.findUnique({
      where: { name: 'SUPER_ADMIN' }
    });

    if (!superAdminRole) {
      superAdminRole = await prisma.role.create({
        data: {
          name: 'SUPER_ADMIN',
          displayName: 'Super Administrator',
          description: 'Full system access',
          isSystem: true,
        }
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash('admin123', 12);

    // Create test user
    const user = await prisma.user.create({
      data: {
        email: 'admin@wp-autohealer.com',
        username: 'admin',
        firstName: 'Admin',
        lastName: 'User',
        passwordHash: hashedPassword,
        roleId: superAdminRole.id,
        isActive: true,
        emailVerifiedAt: new Date(),
        mustChangePassword: false,
      }
    });

    console.log('✅ Test user created successfully!');
    console.log('Email: admin@wp-autohealer.com');
    console.log('Password: admin123');
    console.log('Role: SUPER_ADMIN');
    
  } catch (error) {
    console.error('❌ Error creating test user:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createTestUser();