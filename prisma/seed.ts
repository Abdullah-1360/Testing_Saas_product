import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // Check if roles already exist
  const existingRoles = await prisma.role.count();
  if (existingRoles > 0) {
    console.log('✅ Roles already exist, skipping role creation');
  } else {
    console.log('📝 Creating default roles...');
    
    // Create roles
    const roles = [
      {
        id: 'role_super_admin',
        name: 'SUPER_ADMIN',
        displayName: 'Super Administrator',
        description: 'Full system access with all permissions',
        isSystem: true,
      },
      {
        id: 'role_admin',
        name: 'ADMIN',
        displayName: 'Administrator',
        description: 'Administrative access to manage users, servers, and sites',
        isSystem: true,
      },
      {
        id: 'role_engineer',
        name: 'ENGINEER',
        displayName: 'Engineer',
        description: 'Engineering access to manage incidents and view system data',
        isSystem: true,
      },
      {
        id: 'role_viewer',
        name: 'VIEWER',
        displayName: 'Viewer',
        description: 'Read-only access to system data',
        isSystem: true,
      },
    ];

    for (const role of roles) {
      await prisma.role.create({ data: role });
      console.log(`  ✅ Created role: ${role.displayName}`);
    }

    // Create permissions
    console.log('🔐 Creating permissions...');
    
    const permissions = [
      // SUPER_ADMIN permissions (all permissions)
      { roleId: 'role_super_admin', resource: 'users', action: 'create' },
      { roleId: 'role_super_admin', resource: 'users', action: 'read' },
      { roleId: 'role_super_admin', resource: 'users', action: 'update' },
      { roleId: 'role_super_admin', resource: 'users', action: 'delete' },
      { roleId: 'role_super_admin', resource: 'roles', action: 'read' },
      { roleId: 'role_super_admin', resource: 'servers', action: 'create' },
      { roleId: 'role_super_admin', resource: 'servers', action: 'read' },
      { roleId: 'role_super_admin', resource: 'servers', action: 'update' },
      { roleId: 'role_super_admin', resource: 'servers', action: 'delete' },
      { roleId: 'role_super_admin', resource: 'sites', action: 'create' },
      { roleId: 'role_super_admin', resource: 'sites', action: 'read' },
      { roleId: 'role_super_admin', resource: 'sites', action: 'update' },
      { roleId: 'role_super_admin', resource: 'sites', action: 'delete' },
      { roleId: 'role_super_admin', resource: 'incidents', action: 'create' },
      { roleId: 'role_super_admin', resource: 'incidents', action: 'read' },
      { roleId: 'role_super_admin', resource: 'incidents', action: 'update' },
      { roleId: 'role_super_admin', resource: 'incidents', action: 'delete' },
      { roleId: 'role_super_admin', resource: 'settings', action: 'read' },
      { roleId: 'role_super_admin', resource: 'settings', action: 'update' },
      { roleId: 'role_super_admin', resource: 'audit', action: 'read' },

      // ADMIN permissions
      { roleId: 'role_admin', resource: 'users', action: 'create' },
      { roleId: 'role_admin', resource: 'users', action: 'read' },
      { roleId: 'role_admin', resource: 'users', action: 'update' },
      { roleId: 'role_admin', resource: 'servers', action: 'create' },
      { roleId: 'role_admin', resource: 'servers', action: 'read' },
      { roleId: 'role_admin', resource: 'servers', action: 'update' },
      { roleId: 'role_admin', resource: 'servers', action: 'delete' },
      { roleId: 'role_admin', resource: 'sites', action: 'create' },
      { roleId: 'role_admin', resource: 'sites', action: 'read' },
      { roleId: 'role_admin', resource: 'sites', action: 'update' },
      { roleId: 'role_admin', resource: 'sites', action: 'delete' },
      { roleId: 'role_admin', resource: 'incidents', action: 'create' },
      { roleId: 'role_admin', resource: 'incidents', action: 'read' },
      { roleId: 'role_admin', resource: 'incidents', action: 'update' },
      { roleId: 'role_admin', resource: 'incidents', action: 'delete' },
      { roleId: 'role_admin', resource: 'settings', action: 'read' },
      { roleId: 'role_admin', resource: 'settings', action: 'update' },
      { roleId: 'role_admin', resource: 'audit', action: 'read' },

      // ENGINEER permissions
      { roleId: 'role_engineer', resource: 'incidents', action: 'create' },
      { roleId: 'role_engineer', resource: 'incidents', action: 'read' },
      { roleId: 'role_engineer', resource: 'incidents', action: 'update' },
      { roleId: 'role_engineer', resource: 'incidents', action: 'delete' },
      { roleId: 'role_engineer', resource: 'sites', action: 'read' },
      { roleId: 'role_engineer', resource: 'servers', action: 'read' },
      { roleId: 'role_engineer', resource: 'audit', action: 'read' },

      // VIEWER permissions
      { roleId: 'role_viewer', resource: 'users', action: 'read' },
      { roleId: 'role_viewer', resource: 'servers', action: 'read' },
      { roleId: 'role_viewer', resource: 'sites', action: 'read' },
      { roleId: 'role_viewer', resource: 'incidents', action: 'read' },
      { roleId: 'role_viewer', resource: 'audit', action: 'read' },
    ];

    for (const permission of permissions) {
      await prisma.permission.create({
        data: {
          id: crypto.randomUUID(),
          ...permission,
        },
      });
    }
    console.log(`  ✅ Created ${permissions.length} permissions`);
  }

  // Create default retention policies
  console.log('📋 Creating default retention policies...');
  
  const defaultRetentionPolicy = await prisma.retentionPolicy.upsert({
    where: { policyName: 'default' },
    update: {},
    create: {
      policyName: 'default',
      retentionDays: 3,
      appliesTo: 'all_incident_data',
      isActive: true,
    },
  });

  const auditRetentionPolicy = await prisma.retentionPolicy.upsert({
    where: { policyName: 'audit_logs' },
    update: {},
    create: {
      policyName: 'audit_logs',
      retentionDays: 7,
      appliesTo: 'audit_events',
      isActive: true,
    },
  });

  console.log('✅ Created retention policies:', {
    default: defaultRetentionPolicy.id,
    audit: auditRetentionPolicy.id,
  });

  // Check if admin user already exists
  const existingAdmin = await prisma.user.findFirst({
    where: { roleId: 'role_super_admin' },
  });

  if (existingAdmin) {
    console.log('✅ Super admin user already exists');
    console.log(`   Email: ${existingAdmin.email}`);
    console.log(`   Username: ${existingAdmin.username}`);
  } else {
    console.log('👤 Creating default super admin user...');
    
    // Generate secure password
    const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || generateSecurePassword();
    const passwordHash = await bcrypt.hash(defaultPassword, 12);
    
    const adminEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@wp-autohealer.local';
    const adminUsername = process.env.DEFAULT_ADMIN_USERNAME || 'admin';

    const adminUser = await prisma.user.create({
      data: {
        email: adminEmail,
        username: adminUsername,
        passwordHash,
        roleId: 'role_super_admin',
        firstName: 'System',
        lastName: 'Administrator',
        isActive: true,
        mustChangePassword: true,
        passwordChangedAt: new Date(),
      },
    });

    console.log('🎉 Super admin user created successfully!');
    console.log('');
    console.log('='.repeat(60));
    console.log('🔐 IMPORTANT: Save these credentials securely!');
    console.log('='.repeat(60));
    console.log(`Email:    ${adminEmail}`);
    console.log(`Username: ${adminUsername}`);
    console.log(`Password: ${defaultPassword}`);
    console.log('='.repeat(60));
    console.log('⚠️  You MUST change this password on first login!');
    console.log('');

    // Create audit log for user creation
    await prisma.auditEvent.create({
      data: {
        userId: adminUser.id,
        actorType: 'SYSTEM',
        action: 'user_created',
        resource: 'users',
        resourceId: adminUser.id,
        description: 'Initial super admin user created during system setup',
        severity: 'INFO',
        metadata: {
          email: adminEmail,
          username: adminUsername,
          role: 'SUPER_ADMIN',
          createdBy: 'system_seed',
        },
      },
    });
  }

  // Create sample users for testing
  console.log('👥 Creating sample users for testing...');
  
  const sampleUsers = [
    {
      email: 'engineer@wp-autohealer.local',
      username: 'engineer',
      password: 'engineer123!',
      roleId: 'role_engineer',
      firstName: 'Test',
      lastName: 'Engineer',
    },
    {
      email: 'viewer@wp-autohealer.local',
      username: 'viewer',
      password: 'viewer123!',
      roleId: 'role_viewer',
      firstName: 'Test',
      lastName: 'Viewer',
    },
    {
      email: 'abdullahshahid906@gmail.com',
      username: 'abdullah',
      password: 'Abc@123456',
      roleId: 'role_super_admin',
      firstName: 'Abdullah',
      lastName: 'Shahid',
    },
  ];

  for (const userData of sampleUsers) {
    const existingUser = await prisma.user.findUnique({
      where: { email: userData.email },
    });

    if (!existingUser) {
      const passwordHash = await bcrypt.hash(userData.password, 12);
      
      await prisma.user.create({
        data: {
          email: userData.email,
          username: userData.username,
          passwordHash,
          roleId: userData.roleId,
          firstName: userData.firstName,
          lastName: userData.lastName,
          isActive: true,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
        },
      });
      
      console.log(`  ✅ Created user: ${userData.email}`);
    } else {
      console.log(`  ⏭️  User already exists: ${userData.email}`);
    }
  }

  console.log('✅ Database seed completed successfully!');
  console.log('');
  console.log('📝 Sample users available:');
  console.log('  Super Admin: admin@wp-autohealer.local / [generated password]');
  console.log('  Engineer: engineer@wp-autohealer.local / engineer123!');
  console.log('  Viewer: viewer@wp-autohealer.local / viewer123!');
  console.log('  Custom Admin: abdullahshahid906@gmail.com / Abc@123456');
  console.log('');
  console.log('⚠️  Remember to change default passwords in production!');
}

function generateSecurePassword(): string {
  const length = 24;
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
  let password = '';
  
  // Ensure at least one character from each required category
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const numbers = '0123456789';
  const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';
  
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += symbols[Math.floor(Math.random() * symbols.length)];
  
  // Fill the rest randomly
  for (let i = 4; i < length; i++) {
    password += charset[Math.floor(Math.random() * charset.length)];
  }
  
  // Shuffle the password
  return password.split('').sort(() => Math.random() - 0.5).join('');
}

main()
  .catch((e) => {
    console.error('❌ Error during seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });