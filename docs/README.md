# WP-AutoHealer Documentation

Welcome to the WP-AutoHealer documentation. This comprehensive guide covers everything you need to know about deploying, configuring, and using the WP-AutoHealer system.

## 📚 Documentation Structure

### Getting Started
- [System Overview](./overview.md) - Introduction to WP-AutoHealer and its capabilities
- [Architecture Guide](./architecture.md) - System architecture and component overview
- [Quick Start Guide](./quick-start.md) - Get up and running in 15 minutes

### Deployment & Configuration
- [Deployment Guide](./deployment/README.md) - Complete deployment instructions
- [Configuration Guide](./configuration/README.md) - System configuration and settings
- [Security Setup](./security/README.md) - Security hardening and best practices

### User Guides
- [Control Panel Manual](./user-guide/README.md) - Complete user interface guide
- [API Documentation](./api/README.md) - REST API reference and examples
- [CLI Tools](./cli/README.md) - Command-line utilities and scripts

### Operations & Maintenance
- [Troubleshooting Guide](./troubleshooting/README.md) - Common issues and solutions
- [Monitoring & Alerting](./monitoring/README.md) - System monitoring setup
- [Backup & Recovery](./backup-recovery/README.md) - Data protection strategies

### Development
- [Development Setup](./development/README.md) - Local development environment
- [Testing Guide](./development/testing.md) - Testing strategies and frameworks
- [Contributing](./development/contributing.md) - How to contribute to the project

## 🚀 Quick Navigation

| I want to... | Go to... |
|---------------|----------|
| Deploy WP-AutoHealer | [Deployment Guide](./deployment/README.md) |
| Learn the control panel | [User Guide](./user-guide/README.md) |
| Use the API | [API Documentation](./api/README.md) |
| Fix an issue | [Troubleshooting Guide](./troubleshooting/README.md) |
| Set up monitoring | [Monitoring Guide](./monitoring/README.md) |

## 🛡️ About WP-AutoHealer

WP-AutoHealer is a production-grade WordPress self-healing system that functions as an autonomous Level-1.5 SRE/Support Engineer. The system automatically diagnoses and remediates WordPress website errors on Linux servers via SSH, using conservative minimal reversible changes while preserving all existing business, SEO, content, and behavioral characteristics.

### Key Features

- **Autonomous Healing**: Automatically detects and fixes WordPress issues
- **Conservative Approach**: Minimal, reversible changes with comprehensive backups
- **Complete Audit Trail**: Every operation is logged and traceable
- **Multi-Environment Support**: Works with cPanel, Plesk, DirectAdmin, CyberPanel, and raw VPS
- **Security First**: End-to-end encryption, strict SSH verification, and RBAC
- **Real-time Monitoring**: Live incident tracking and status updates

### System Requirements

- **Operating System**: Linux (Ubuntu 20.04+ recommended)
- **Node.js**: 18.x or higher
- **Database**: PostgreSQL 14+ 
- **Cache**: Redis 6+
- **Memory**: 4GB RAM minimum (8GB recommended)
- **Storage**: 50GB minimum (SSD recommended)

## 📞 Support & Community

- **Documentation Issues**: [GitHub Issues](https://github.com/wp-autohealer/wp-autohealer/issues)
- **Security Issues**: security@wp-autohealer.com
- **General Support**: support@wp-autohealer.com

---

*Last updated: January 2024*