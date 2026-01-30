# Audit Event Field Consistency Update

## Summary

Updated the emergency MFA service to use the correct field name `metadata` instead of `details` when creating audit events, ensuring consistency with the database schema and audit service implementation.

## Changes Made

### 1. Code Change
- **File**: `src/auth/services/emergency-mfa.service.ts`
- **Change**: Line 90 - Changed `details:` to `metadata:` in audit event creation
- **Impact**: Aligns with the actual database schema field name

### 2. Documentation Update
- **File**: `docs/api/README.md`
- **Change**: Updated audit event example response to show `metadata` instead of `details`
- **Impact**: API documentation now accurately reflects the actual response structure

## Technical Context

### Database Schema
The `AuditEvent` model in `prisma/schema.prisma` defines the field as:
```prisma
model AuditEvent {
  // ... other fields
  metadata     Json?
  // ... other fields
}
```

### Audit Service Implementation
The `AuditService` consistently uses `metadata` throughout:
- Creates audit events with `metadata` field
- Processes and redacts `metadata` content
- Returns `metadata` in API responses

### Emergency MFA Service
The service was inconsistently using `details` in one location while the rest of the codebase uses `metadata`. This change ensures:
- Consistency with database schema
- Consistency with audit service patterns
- Proper data storage and retrieval

## Impact Assessment

### ✅ Positive Impacts
- **Data Consistency**: All audit events now use the same field structure
- **API Consistency**: Documentation matches actual implementation
- **Code Maintainability**: Eliminates confusion between field names

### ⚠️ Considerations
- **Backward Compatibility**: This is an internal field name change that doesn't affect external APIs
- **Existing Data**: No migration needed as this was a code-level inconsistency, not a schema change

## Verification

The change has been verified to:
1. Match the Prisma schema definition
2. Align with the AuditService implementation patterns
3. Maintain the same data structure and content
4. Update corresponding documentation

## Related Files

- `src/auth/services/emergency-mfa.service.ts` - Primary change
- `docs/api/README.md` - Documentation update
- `prisma/schema.prisma` - Reference schema
- `src/audit/audit.service.ts` - Reference implementation

This change improves code consistency and maintainability without affecting functionality or breaking existing features.