#!/bin/bash

# Security Testing Script for WP-AutoHealer
# This script performs comprehensive security testing of the deployed application

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
TARGET_URL="${TARGET_URL:-https://localhost}"
API_BASE="${API_BASE:-$TARGET_URL/api/v1}"
TIMEOUT="${TIMEOUT:-10}"
VERBOSE="${VERBOSE:-false}"

# Test results
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_TOTAL=0

echo -e "${BLUE}🔒 WP-AutoHealer Security Testing Suite${NC}"
echo "========================================"
echo "Target URL: $TARGET_URL"
echo "API Base: $API_BASE"
echo "Timeout: ${TIMEOUT}s"
echo

# Function to run a test
run_test() {
    local test_name="$1"
    local test_command="$2"
    local expected_result="$3"
    
    ((TESTS_TOTAL++))
    
    if [[ "$VERBOSE" == "true" ]]; then
        echo -e "${BLUE}Running: $test_name${NC}"
        echo "Command: $test_command"
    fi
    
    if eval "$test_command" >/dev/null 2>&1; then
        local result="PASS"
        if [[ "$expected_result" == "FAIL" ]]; then
            result="FAIL"
        fi
    else
        local result="FAIL"
        if [[ "$expected_result" == "FAIL" ]]; then
            result="PASS"
        fi
    fi
    
    if [[ "$result" == "PASS" ]]; then
        echo -e "${GREEN}✅ $test_name${NC}"
        ((TESTS_PASSED++))
    else
        echo -e "${RED}❌ $test_name${NC}"
        ((TESTS_FAILED++))
    fi
}

# Function to test SSL/TLS configuration
test_ssl_tls() {
    echo -e "${BLUE}🔐 Testing SSL/TLS Configuration${NC}"
    echo "--------------------------------"
    
    # Test HTTPS redirect
    run_test "HTTP to HTTPS redirect" \
        "curl -s -o /dev/null -w '%{http_code}' --max-time $TIMEOUT http://localhost | grep -q '^30[1-8]$'" \
        "PASS"
    
    # Test SSL certificate
    run_test "SSL certificate validity" \
        "curl -s --max-time $TIMEOUT --cacert <(openssl s_client -connect localhost:443 -servername localhost </dev/null 2>/dev/null | openssl x509) $TARGET_URL/health" \
        "PASS"
    
    # Test TLS version
    run_test "TLS 1.2+ only" \
        "openssl s_client -connect localhost:443 -tls1_1 </dev/null 2>&1 | grep -q 'handshake failure'" \
        "PASS"
    
    # Test strong ciphers
    run_test "Strong cipher suites" \
        "nmap --script ssl-enum-ciphers -p 443 localhost 2>/dev/null | grep -q 'TLS_'" \
        "PASS"
    
    echo
}

# Function to test security headers
test_security_headers() {
    echo -e "${BLUE}🛡️  Testing Security Headers${NC}"
    echo "-----------------------------"
    
    # Get headers
    local headers=$(curl -s -I --max-time $TIMEOUT "$TARGET_URL" 2>/dev/null || echo "")
    
    # Test HSTS
    run_test "HSTS header present" \
        "echo '$headers' | grep -qi 'strict-transport-security'" \
        "PASS"
    
    # Test CSP
    run_test "Content Security Policy header" \
        "echo '$headers' | grep -qi 'content-security-policy'" \
        "PASS"
    
    # Test X-Frame-Options
    run_test "X-Frame-Options header" \
        "echo '$headers' | grep -qi 'x-frame-options'" \
        "PASS"
    
    # Test X-Content-Type-Options
    run_test "X-Content-Type-Options header" \
        "echo '$headers' | grep -qi 'x-content-type-options'" \
        "PASS"
    
    # Test X-XSS-Protection
    run_test "X-XSS-Protection header" \
        "echo '$headers' | grep -qi 'x-xss-protection'" \
        "PASS"
    
    # Test Referrer-Policy
    run_test "Referrer-Policy header" \
        "echo '$headers' | grep -qi 'referrer-policy'" \
        "PASS"
    
    echo
}

# Function to test rate limiting
test_rate_limiting() {
    echo -e "${BLUE}⚡ Testing Rate Limiting${NC}"
    echo "------------------------"
    
    # Test global rate limiting
    run_test "Global rate limiting active" \
        "for i in {1..50}; do curl -s --max-time 1 $TARGET_URL/health >/dev/null; done; curl -s -o /dev/null -w '%{http_code}' --max-time $TIMEOUT $TARGET_URL/health | grep -q '429'" \
        "PASS"
    
    # Test API rate limiting
    run_test "API rate limiting active" \
        "for i in {1..30}; do curl -s --max-time 1 $API_BASE/health >/dev/null; done; curl -s -o /dev/null -w '%{http_code}' --max-time $TIMEOUT $API_BASE/health | grep -q '429'" \
        "PASS"
    
    echo
}

# Function to test input validation
test_input_validation() {
    echo -e "${BLUE}🔍 Testing Input Validation${NC}"
    echo "---------------------------"
    
    # Test SQL injection protection
    run_test "SQL injection protection" \
        "curl -s -o /dev/null -w '%{http_code}' --max-time $TIMEOUT '$API_BASE/users?id=1%27%20OR%201=1--' | grep -q '^4'" \
        "PASS"
    
    # Test XSS protection
    run_test "XSS protection" \
        "curl -s -o /dev/null -w '%{http_code}' --max-time $TIMEOUT -H 'Content-Type: application/json' -d '{\"name\":\"<script>alert(1)</script>\"}' $API_BASE/users | grep -q '^4'" \
        "PASS"
    
    # Test directory traversal protection
    run_test "Directory traversal protection" \
        "curl -s -o /dev/null -w '%{http_code}' --max-time $TIMEOUT '$TARGET_URL/../../../etc/passwd' | grep -q '^4'" \
        "PASS"
    
    # Test command injection protection
    run_test "Command injection protection" \
        "curl -s -o /dev/null -w '%{http_code}' --max-time $TIMEOUT -H 'Content-Type: application/json' -d '{\"command\":\"; cat /etc/passwd\"}' $API_BASE/servers | grep -q '^4'" \
        "PASS"
    
    echo
}

# Function to test authentication security
test_authentication() {
    echo -e "${BLUE}🔑 Testing Authentication Security${NC}"
    echo "--------------------------------"
    
    # Test unauthorized access
    run_test "Unauthorized API access blocked" \
        "curl -s -o /dev/null -w '%{http_code}' --max-time $TIMEOUT $API_BASE/users | grep -q '^401'" \
        "PASS"
    
    # Test invalid token
    run_test "Invalid token rejected" \
        "curl -s -o /dev/null -w '%{http_code}' --max-time $TIMEOUT -H 'Authorization: Bearer invalid_token' $API_BASE/users | grep -q '^401'" \
        "PASS"
    
    # Test brute force protection (multiple failed attempts)
    run_test "Brute force protection active" \
        "for i in {1..10}; do curl -s --max-time 1 -H 'Content-Type: application/json' -d '{\"email\":\"test@test.com\",\"password\":\"wrong\"}' $API_BASE/auth/login >/dev/null; done; curl -s -o /dev/null -w '%{http_code}' --max-time $TIMEOUT -H 'Content-Type: application/json' -d '{\"email\":\"test@test.com\",\"password\":\"wrong\"}' $API_BASE/auth/login | grep -q '429'" \
        "PASS"
    
    echo
}

# Function to test file access security
test_file_access() {
    echo -e "${BLUE}📁 Testing File Access Security${NC}"
    echo "-------------------------------"
    
    # Test sensitive file access
    run_test "Environment file access blocked" \
        "curl -s -o /dev/null -w '%{http_code}' --max-time $TIMEOUT '$TARGET_URL/.env' | grep -q '^4'" \
        "PASS"
    
    # Test config file access
    run_test "Config file access blocked" \
        "curl -s -o /dev/null -w '%{http_code}' --max-time $TIMEOUT '$TARGET_URL/config.json' | grep -q '^4'" \
        "PASS"
    
    # Test log file access
    run_test "Log file access blocked" \
        "curl -s -o /dev/null -w '%{http_code}' --max-time $TIMEOUT '$TARGET_URL/logs/app.log' | grep -q '^4'" \
        "PASS"
    
    # Test backup file access
    run_test "Backup file access blocked" \
        "curl -s -o /dev/null -w '%{http_code}' --max-time $TIMEOUT '$TARGET_URL/backup.sql' | grep -q '^4'" \
        "PASS"
    
    echo
}

# Function to test admin panel security
test_admin_security() {
    echo -e "${BLUE}👤 Testing Admin Panel Security${NC}"
    echo "-------------------------------"
    
    # Test admin panel access
    run_test "Admin panel access blocked" \
        "curl -s -o /dev/null -w '%{http_code}' --max-time $TIMEOUT '$TARGET_URL/admin' | grep -q '^4'" \
        "PASS"
    
    # Test wp-admin access
    run_test "WordPress admin access blocked" \
        "curl -s -o /dev/null -w '%{http_code}' --max-time $TIMEOUT '$TARGET_URL/wp-admin' | grep -q '^4'" \
        "PASS"
    
    # Test phpmyadmin access
    run_test "phpMyAdmin access blocked" \
        "curl -s -o /dev/null -w '%{http_code}' --max-time $TIMEOUT '$TARGET_URL/phpmyadmin' | grep -q '^4'" \
        "PASS"
    
    echo
}

# Function to test information disclosure
test_information_disclosure() {
    echo -e "${BLUE}ℹ️  Testing Information Disclosure${NC}"
    echo "--------------------------------"
    
    # Test server information hiding
    run_test "Server header hidden/modified" \
        "curl -s -I --max-time $TIMEOUT $TARGET_URL | grep -i server | grep -qv 'nginx\\|apache'" \
        "PASS"
    
    # Test version information hiding
    run_test "Version information hidden" \
        "curl -s -I --max-time $TIMEOUT $TARGET_URL | grep -qv 'X-Powered-By'" \
        "PASS"
    
    # Test error page information
    run_test "Error pages don't reveal sensitive info" \
        "curl -s --max-time $TIMEOUT '$TARGET_URL/nonexistent' | grep -qv 'nginx\\|apache\\|server'" \
        "PASS"
    
    echo
}

# Function to test monitoring and logging
test_monitoring() {
    echo -e "${BLUE}📊 Testing Security Monitoring${NC}"
    echo "------------------------------"
    
    # Test health endpoint
    run_test "Health endpoint accessible" \
        "curl -s --max-time $TIMEOUT $TARGET_URL/health | grep -q 'healthy\\|ok'" \
        "PASS"
    
    # Test metrics endpoint (should be protected)
    run_test "Metrics endpoint protected" \
        "curl -s -o /dev/null -w '%{http_code}' --max-time $TIMEOUT $API_BASE/metrics | grep -q '^401'" \
        "PASS"
    
    # Test security metrics endpoint (should be protected)
    run_test "Security metrics endpoint protected" \
        "curl -s -o /dev/null -w '%{http_code}' --max-time $TIMEOUT $API_BASE/security/metrics | grep -q '^401'" \
        "PASS"
    
    echo
}

# Function to run vulnerability scans
test_vulnerabilities() {
    echo -e "${BLUE}🔍 Testing for Known Vulnerabilities${NC}"
    echo "-----------------------------------"
    
    # Test for common vulnerabilities (if tools are available)
    if command -v nmap &> /dev/null; then
        run_test "No common vulnerable services" \
            "nmap -sV --script vuln localhost 2>/dev/null | grep -q 'VULNERABLE'" \
            "FAIL"
    else
        echo -e "${YELLOW}⚠️  nmap not available, skipping vulnerability scan${NC}"
    fi
    
    # Test for weak SSL/TLS configuration
    if command -v testssl.sh &> /dev/null; then
        run_test "Strong SSL/TLS configuration" \
            "testssl.sh --quiet --severity MEDIUM localhost 2>/dev/null | grep -q 'MEDIUM\\|HIGH\\|CRITICAL'" \
            "FAIL"
    else
        echo -e "${YELLOW}⚠️  testssl.sh not available, skipping SSL test${NC}"
    fi
    
    echo
}

# Function to generate security report
generate_report() {
    echo -e "${BLUE}📋 Security Test Report${NC}"
    echo "======================"
    echo
    echo "Test Results:"
    echo "- Total Tests: $TESTS_TOTAL"
    echo "- Passed: $TESTS_PASSED"
    echo "- Failed: $TESTS_FAILED"
    echo "- Success Rate: $(( TESTS_PASSED * 100 / TESTS_TOTAL ))%"
    echo
    
    if [[ $TESTS_FAILED -eq 0 ]]; then
        echo -e "${GREEN}🎉 All security tests passed!${NC}"
        echo "The application appears to be properly secured."
    else
        echo -e "${RED}⚠️  Some security tests failed.${NC}"
        echo "Please review the failed tests and address any security issues."
    fi
    
    echo
    echo "Recommendations:"
    echo "1. Review failed tests and implement necessary fixes"
    echo "2. Run regular security scans and penetration tests"
    echo "3. Keep dependencies and base images updated"
    echo "4. Monitor security logs and alerts"
    echo "5. Implement additional security measures as needed"
    
    # Save report to file
    local report_file="$PROJECT_ROOT/security-test-report-$(date +%Y%m%d-%H%M%S).txt"
    {
        echo "WP-AutoHealer Security Test Report"
        echo "Generated: $(date)"
        echo "Target: $TARGET_URL"
        echo
        echo "Results: $TESTS_PASSED/$TESTS_TOTAL tests passed"
        echo "Success Rate: $(( TESTS_PASSED * 100 / TESTS_TOTAL ))%"
    } > "$report_file"
    
    echo
    echo "Report saved to: $report_file"
}

# Main execution
main() {
    echo "Starting security tests..."
    echo
    
    # Check if target is accessible
    if ! curl -s --max-time $TIMEOUT "$TARGET_URL/health" >/dev/null 2>&1; then
        echo -e "${RED}❌ Target URL is not accessible: $TARGET_URL${NC}"
        echo "Please ensure the application is running and accessible."
        exit 1
    fi
    
    # Run all test suites
    test_ssl_tls
    test_security_headers
    test_rate_limiting
    test_input_validation
    test_authentication
    test_file_access
    test_admin_security
    test_information_disclosure
    test_monitoring
    test_vulnerabilities
    
    # Generate final report
    generate_report
    
    # Exit with appropriate code
    if [[ $TESTS_FAILED -eq 0 ]]; then
        exit 0
    else
        exit 1
    fi
}

# Handle script arguments
case "${1:-}" in
    "ssl")
        test_ssl_tls
        ;;
    "headers")
        test_security_headers
        ;;
    "rate-limit")
        test_rate_limiting
        ;;
    "input")
        test_input_validation
        ;;
    "auth")
        test_authentication
        ;;
    "files")
        test_file_access
        ;;
    "admin")
        test_admin_security
        ;;
    "info")
        test_information_disclosure
        ;;
    "monitoring")
        test_monitoring
        ;;
    "vuln")
        test_vulnerabilities
        ;;
    "help"|"-h"|"--help")
        echo "Usage: $0 [test-suite]"
        echo
        echo "Test suites:"
        echo "  ssl         - SSL/TLS configuration tests"
        echo "  headers     - Security headers tests"
        echo "  rate-limit  - Rate limiting tests"
        echo "  input       - Input validation tests"
        echo "  auth        - Authentication security tests"
        echo "  files       - File access security tests"
        echo "  admin       - Admin panel security tests"
        echo "  info        - Information disclosure tests"
        echo "  monitoring  - Security monitoring tests"
        echo "  vuln        - Vulnerability scanning tests"
        echo
        echo "Environment variables:"
        echo "  TARGET_URL  - Target URL to test (default: https://localhost)"
        echo "  TIMEOUT     - Request timeout in seconds (default: 10)"
        echo "  VERBOSE     - Enable verbose output (default: false)"
        echo
        echo "Examples:"
        echo "  $0                                    # Run all tests"
        echo "  $0 ssl                               # Run only SSL tests"
        echo "  TARGET_URL=https://example.com $0    # Test different URL"
        echo "  VERBOSE=true $0                      # Enable verbose output"
        ;;
    *)
        main
        ;;
esac