# Guardian API Pattern Fixes - Summary

## Overview
Proactive comparison of `api/guardians/index.js` against production-stable `api/instructors/index.js` reference endpoint identified 5 critical pattern differences that could cause runtime errors.

## Fixes Applied (2025-01)

### 1. ✅ Cache Control Headers
**Issue**: Guardians endpoint missing cache control headers on Supabase client
**Risk**: Could cause stale data issues or caching-related bugs
**Fix**: Added cache control options to `createSupabaseAdminClient`:
```javascript
const supabase = createSupabaseAdminClient(adminConfig, {
  global: { headers: { 'Cache-Control': 'no-store' } }
});
```

### 2. ✅ Auth Error Handling
**Issue**: `auth.getUser()` call not wrapped in try-catch
**Risk**: Uncaught exceptions could crash the function on network/auth errors
**Fix**: Wrapped in try-catch with error logging:
```javascript
let authResult;
try {
  authResult = await supabase.auth.getUser(token);
} catch (authError) {
  context.log?.error?.('guardians auth.getUser failed', { message: authError.message });
  return respond(context, 401, { message: 'invalid_token' });
}
```

### 3. ✅ Membership Verification Error Handling
**Issue**: `ensureMembership()` call not wrapped in try-catch
**Risk**: Uncaught exceptions could crash the function on database/network errors
**Fix**: Wrapped in try-catch with specific error message:
```javascript
let role;
try {
  role = await ensureMembership(supabase, orgId, userId);
} catch (membershipError) {
  context.log?.error?.('guardians ensureMembership failed', {
    message: membershipError.message,
    userId,
    orgId
  });
  return respond(context, 500, { message: 'failed_to_verify_membership' });
}
```

### 4. ✅ Tenant Client Result Destructuring
**Issue**: Using property access (`tenantResult.client`, `tenantResult.error`) instead of destructuring
**Risk**: Inconsistent pattern with other endpoints, harder to maintain
**Fix**: Changed to destructuring pattern:
```javascript
// Before:
const tenantResult = await resolveTenantClient(context, supabase, env, orgId);
if (tenantResult.error) { ... }
const tenantClient = tenantResult.client;

// After:
const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId);
if (tenantError) { ... }
```

### 5. ✅ Error Response Format
**Issue**: Constructing custom error response instead of using error object properties
**Risk**: Inconsistent error format, potentially losing error details
**Fix**: Changed to use error object properties directly:
```javascript
// Before:
if (tenantResult.error) {
  return respond(context, 403, { error: 'access_denied', details: tenantResult.error.message });
}

// After:
if (tenantError) {
  return respond(context, tenantError.status, tenantError.body);
}
```

## Verification

### ESLint
```bash
npx eslint api/guardians/index.js
```
✅ **PASSED** - No syntax errors

### Pattern Alignment
- ✅ Cache control headers match instructors pattern
- ✅ Auth error handling matches instructors pattern
- ✅ Membership error handling matches instructors pattern  
- ✅ Tenant client destructuring matches instructors pattern
- ✅ Error response format matches instructors pattern

## Deployment Checklist

Before deploying:
- [x] All 5 pattern fixes applied
- [x] ESLint validation passes
- [ ] Deploy to Azure Functions
- [ ] Clear function app caches if needed
- [ ] Verify no startup errors in Azure logs
- [ ] Test GET /api/guardians (list)
- [ ] Test POST /api/guardians (create with validation)
- [ ] Test PUT /api/guardians/:id (update)
- [ ] Test DELETE /api/guardians/:id (soft delete with student check)
- [ ] Verify guardians appear in student form dropdown
- [ ] End-to-end test: Create student with guardian assignment

## Previous Deployment Issues (Context)

**Deployment Cycle 1**: `getTenantClient` import error (function doesn't exist)
- Fixed: Changed to `resolveTenantClient` with correct signature

**Deployment Cycle 2**: `respond` import error (wrong module)
- Fixed: Changed from `http.js` to `org-bff.js`

**Deployment Cycle 3**: Missing Supabase admin credentials
- Fixed: Added `readEnv(context)` and `readSupabaseAdminConfig(env)` calls

**Current (Cycle 4)**: Proactive pattern validation before deployment
- Applied all 5 identified pattern improvements from reference endpoint

## Benefits

1. **Defensive Error Handling**: Try-catch blocks prevent function crashes on auth/network errors
2. **Consistent Patterns**: Matches production-stable instructors endpoint patterns
3. **Better Logging**: Structured error logging helps debug production issues
4. **Cache Prevention**: Cache control headers prevent stale data bugs
5. **Maintainability**: Consistent destructuring and error handling patterns across endpoints

## Reference

- Reference Endpoint: `api/instructors/index.js`
- Documentation: [AGENTS.md](../AGENTS.md) - Azure Functions patterns
- Validation Tool: ESLint with project config
