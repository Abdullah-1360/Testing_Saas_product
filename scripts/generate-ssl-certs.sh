#!/bin/bash

# SSL Certificate Generation Script for WP-AutoHealer
# This script generates self-signed certificates for development and provides instructions for production

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SSL_DIR="$PROJECT_ROOT/docker/nginx/ssl"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔒 WP-AutoHealer SSL Certificate Setup${NC}"
echo "=================================================="

# Create SSL directory if it doesn't exist
mkdir -p "$SSL_DIR"

# Function to generate self-signed certificates for development
generate_self_signed() {
    echo -e "${YELLOW}Generating self-signed certificates for development...${NC}"
    
    # Generate private key
    openssl genrsa -out "$SSL_DIR/private.key" 2048
    
    # Generate certificate signing request
    openssl req -new -key "$SSL_DIR/private.key" -out "$SSL_DIR/cert.csr" \
        -subj "/C=US/ST=Development/L=Development/O=WP-AutoHealer/OU=Development/CN=localhost"
    
    # Generate self-signed certificate
    openssl x509 -req -days 365 -in "$SSL_DIR/cert.csr" -signkey "$SSL_DIR/private.key" \
        -out "$SSL_DIR/cert.pem" \
        -extensions v3_req -extfile <(cat <<EOF
[v3_req]
keyUsage = keyEncipherment, dataEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
DNS.2 = *.localhost
IP.1 = 127.0.0.1
IP.2 = ::1
EOF
)
    
    # Generate DH parameters for enhanced security
    echo -e "${YELLOW}Generating DH parameters (this may take a while)...${NC}"
    openssl dhparam -out "$SSL_DIR/dhparam.pem" 2048
    
    # Set proper permissions
    chmod 600 "$SSL_DIR/private.key"
    chmod 644 "$SSL_DIR/cert.pem"
    chmod 644 "$SSL_DIR/dhparam.pem"
    
    # Clean up CSR
    rm -f "$SSL_DIR/cert.csr"
    
    echo -e "${GREEN}✅ Self-signed certificates generated successfully!${NC}"
    echo -e "${YELLOW}⚠️  These certificates are for development only!${NC}"
}

# Function to provide production certificate instructions
production_instructions() {
    echo -e "\n${BLUE}📋 Production SSL Certificate Setup Instructions${NC}"
    echo "=================================================="
    echo
    echo -e "${YELLOW}For production deployment, you need valid SSL certificates.${NC}"
    echo "Here are the recommended options:"
    echo
    echo -e "${GREEN}1. Let's Encrypt (Free, Automated)${NC}"
    echo "   - Use Certbot to obtain free SSL certificates"
    echo "   - Automatic renewal every 90 days"
    echo "   - Command: certbot certonly --webroot -w /var/www/html -d yourdomain.com"
    echo
    echo -e "${GREEN}2. Commercial SSL Certificate${NC}"
    echo "   - Purchase from a trusted CA (DigiCert, GlobalSign, etc.)"
    echo "   - Extended validation available"
    echo "   - Wildcard certificates for subdomains"
    echo
    echo -e "${GREEN}3. Cloud Provider SSL${NC}"
    echo "   - AWS Certificate Manager (ACM)"
    echo "   - Cloudflare SSL"
    echo "   - Google Cloud SSL"
    echo
    echo -e "${BLUE}Required files for production:${NC}"
    echo "   - $SSL_DIR/cert.pem (Certificate chain)"
    echo "   - $SSL_DIR/private.key (Private key)"
    echo "   - $SSL_DIR/dhparam.pem (DH parameters)"
    echo
    echo -e "${RED}⚠️  Security Requirements:${NC}"
    echo "   - Private key must be kept secure (chmod 600)"
    echo "   - Use strong DH parameters (2048-bit minimum)"
    echo "   - Enable HSTS and proper security headers"
    echo "   - Regular certificate renewal (Let's Encrypt: 90 days)"
}

# Function to validate existing certificates
validate_certificates() {
    echo -e "${BLUE}🔍 Validating existing certificates...${NC}"
    
    if [[ -f "$SSL_DIR/cert.pem" && -f "$SSL_DIR/private.key" ]]; then
        # Check certificate validity
        if openssl x509 -in "$SSL_DIR/cert.pem" -noout -checkend 86400 > /dev/null 2>&1; then
            echo -e "${GREEN}✅ Certificate is valid and not expiring within 24 hours${NC}"
            
            # Show certificate details
            echo -e "\n${BLUE}Certificate Details:${NC}"
            openssl x509 -in "$SSL_DIR/cert.pem" -noout -subject -issuer -dates
            
            # Check if it's self-signed
            if openssl verify -CAfile "$SSL_DIR/cert.pem" "$SSL_DIR/cert.pem" > /dev/null 2>&1; then
                echo -e "${YELLOW}⚠️  This is a self-signed certificate (development only)${NC}"
            fi
        else
            echo -e "${RED}❌ Certificate is invalid or expiring soon${NC}"
            return 1
        fi
        
        # Check private key
        if openssl rsa -in "$SSL_DIR/private.key" -check > /dev/null 2>&1; then
            echo -e "${GREEN}✅ Private key is valid${NC}"
        else
            echo -e "${RED}❌ Private key is invalid${NC}"
            return 1
        fi
        
        # Check if certificate and key match
        cert_modulus=$(openssl x509 -noout -modulus -in "$SSL_DIR/cert.pem" | openssl md5)
        key_modulus=$(openssl rsa -noout -modulus -in "$SSL_DIR/private.key" | openssl md5)
        
        if [[ "$cert_modulus" == "$key_modulus" ]]; then
            echo -e "${GREEN}✅ Certificate and private key match${NC}"
        else
            echo -e "${RED}❌ Certificate and private key do not match${NC}"
            return 1
        fi
        
        return 0
    else
        echo -e "${RED}❌ Certificate files not found${NC}"
        return 1
    fi
}

# Function to setup Let's Encrypt certificates
setup_letsencrypt() {
    local domain="$1"
    
    if [[ -z "$domain" ]]; then
        echo -e "${RED}❌ Domain name is required for Let's Encrypt setup${NC}"
        return 1
    fi
    
    echo -e "${BLUE}🔒 Setting up Let's Encrypt certificate for $domain${NC}"
    
    # Check if certbot is installed
    if ! command -v certbot &> /dev/null; then
        echo -e "${YELLOW}Installing certbot...${NC}"
        
        # Install certbot based on OS
        if [[ "$OSTYPE" == "linux-gnu"* ]]; then
            if command -v apt-get &> /dev/null; then
                sudo apt-get update && sudo apt-get install -y certbot
            elif command -v yum &> /dev/null; then
                sudo yum install -y certbot
            else
                echo -e "${RED}❌ Unable to install certbot automatically. Please install manually.${NC}"
                return 1
            fi
        else
            echo -e "${RED}❌ Automatic certbot installation not supported on this OS${NC}"
            echo "Please install certbot manually: https://certbot.eff.org/"
            return 1
        fi
    fi
    
    # Generate certificate
    echo -e "${YELLOW}Generating Let's Encrypt certificate...${NC}"
    sudo certbot certonly --standalone -d "$domain" --non-interactive --agree-tos --email admin@"$domain"
    
    # Copy certificates to our SSL directory
    sudo cp "/etc/letsencrypt/live/$domain/fullchain.pem" "$SSL_DIR/cert.pem"
    sudo cp "/etc/letsencrypt/live/$domain/privkey.pem" "$SSL_DIR/private.key"
    
    # Set proper permissions
    sudo chown $(whoami):$(whoami) "$SSL_DIR/cert.pem" "$SSL_DIR/private.key"
    chmod 644 "$SSL_DIR/cert.pem"
    chmod 600 "$SSL_DIR/private.key"
    
    echo -e "${GREEN}✅ Let's Encrypt certificate installed successfully!${NC}"
    echo -e "${BLUE}💡 Set up automatic renewal with: sudo crontab -e${NC}"
    echo "Add this line: 0 12 * * * /usr/bin/certbot renew --quiet"
}

# Main script logic
case "${1:-}" in
    "dev"|"development")
        generate_self_signed
        ;;
    "validate"|"check")
        validate_certificates
        ;;
    "letsencrypt")
        setup_letsencrypt "$2"
        ;;
    "production"|"prod")
        production_instructions
        ;;
    *)
        echo "Usage: $0 {dev|validate|letsencrypt <domain>|production}"
        echo
        echo "Commands:"
        echo "  dev          - Generate self-signed certificates for development"
        echo "  validate     - Validate existing certificates"
        echo "  letsencrypt  - Setup Let's Encrypt certificate for specified domain"
        echo "  production   - Show production certificate setup instructions"
        echo
        echo "Examples:"
        echo "  $0 dev                              # Generate dev certificates"
        echo "  $0 letsencrypt example.com          # Setup Let's Encrypt for example.com"
        echo "  $0 validate                         # Check existing certificates"
        echo "  $0 production                       # Show production instructions"
        exit 1
        ;;
esac