#!/bin/bash

# Kiro Configuration Migration Script
# This script ensures all Kiro-specific configurations are properly transferred

set -e

TARGET_SERVER="$1"
USERNAME="$2"

if [ -z "$TARGET_SERVER" ] || [ -z "$USERNAME" ]; then
    echo "Usage: $0 <target-server-ip> <username>"
    exit 1
fi

echo "🔧 Migrating Kiro configurations to $TARGET_SERVER"

# Create Kiro configuration package
echo "📦 Creating Kiro configuration package..."
tar -czf kiro-config.tar.gz .kiro/

# Transfer Kiro configurations
echo "🚀 Transferring Kiro configurations..."
scp kiro-config.tar.gz "$USERNAME@$TARGET_SERVER:~/"

# Create Kiro setup script for target server
cat > setup-kiro-on-target.sh << 'EOF'
#!/bin/bash
set -e

echo "🔧 Setting up Kiro configurations..."

# Extract Kiro configurations
if [ -f "kiro-config.tar.gz" ]; then
    cd wp-autohealer
    tar -xzf ../kiro-config.tar.gz
    echo "✅ Kiro configurations extracted"
else
    echo "❌ Kiro configuration file not found"
    exit 1
fi

# Verify Kiro directory structure
echo "📋 Verifying Kiro directory structure..."
if [ -d ".kiro" ]; then
    echo "✅ .kiro directory exists"
    
    if [ -d ".kiro/hooks" ]; then
        echo "✅ Hooks directory exists with $(ls .kiro/hooks/*.hook 2>/dev/null | wc -l) hooks"
    fi
    
    if [ -d ".kiro/specs" ]; then
        echo "✅ Specs directory exists"
    fi
    
    if [ -d ".kiro/steering" ]; then
        echo "✅ Steering directory exists with $(ls .kiro/steering/*.md 2>/dev/null | wc -l) files"
    fi
    
    if [ -d ".kiro/settings" ]; then
        echo "✅ Settings directory exists"
    else
        echo "ℹ️  Settings directory not found (this is normal if no MCP servers are configured)"
    fi
else
    echo "❌ .kiro directory not found"
    exit 1
fi

# Set proper permissions
chmod -R 755 .kiro/

echo "✅ Kiro configuration setup completed!"
echo "📋 Summary:"
echo "   - Hooks: $(ls .kiro/hooks/*.hook 2>/dev/null | wc -l) files"
echo "   - Steering: $(ls .kiro/steering/*.md 2>/dev/null | wc -l) files"
echo "   - Specs: Available in .kiro/specs/"

EOF

scp setup-kiro-on-target.sh "$USERNAME@$TARGET_SERVER:~/"

echo "✅ Kiro configuration transfer completed!"
echo "🔧 After running the main migration, also run on target server:"
echo "   chmod +x setup-kiro-on-target.sh"
echo "   ./setup-kiro-on-target.sh"

# Cleanup
rm -f kiro-config.tar.gz setup-kiro-on-target.sh