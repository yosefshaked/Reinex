# API Endpoint Validation Tool

## Purpose
Validates all API endpoints for common configuration and import issues before deployment, catching multiple errors at once instead of discovering them one-by-one in production.

## Usage
```bash
npm run validate:api
```

## What It Checks

### Critical Errors (Will fail deployment)

#### Azure Functions Configuration
1. **function.json Existence**
   - Every endpoint directory must have a `function.json` file
   - Azure Functions ignores directories without this config
   - Example: If `api/my-endpoint/index.js` exists but no `function.json`, Azure won't recognize it

2. **scriptFile Alignment**
   - If `function.json` specifies `scriptFile`, that file must exist
   - Default is `index.js` when not specified
   - Example: `"scriptFile": "./main.js"` requires `main.js` to exist, or deployment fails silently

3. **Valid JSON**
   - Validates `function.json` contains valid JSON syntax
   - Detects trailing commas, missing quotes, etc.
   - Example: Catches `{ "methods": ["get"], }` (trailing comma causes silent failure)

4. **HTTP Bindings**
   - Ensures `httpTrigger` binding exists with methods defined
   - Ensures matching `http` output binding is present
   - Missing either causes endpoint to not respond to HTTP requests

#### Import/Export Validation
5. **Import/Export Mismatches**
   - Validates that imported functions actually exist in the source module
   - Dynamically reads actual exports from `api/_shared/org-bff.js` and other shared modules
   - Example: Catches `import { checkOrgMembership }` when the actual export is `ensureMembership`

6. **Handler Signatures**
   - Ensures Azure Functions v4 handlers use correct parameter order: `(context, req)`
   - Example: Catches `function handler(req, context)` which causes runtime errors

7. **Deprecated Imports**
   - Detects usage of deprecated functions and modules
   - `checkOrgMembership` → Use `ensureMembership` instead
   - `../_shared/supabase-tenant.js` → Use `resolveTenantClient` from `org-bff.js`
   - `_shared/storage-drivers` → Use `../cross-platform/storage-drivers/index.js`

8. **Incorrect ensureMembership Usage**
   - Catches code expecting `{ role: string }` object when it returns role string directly
   - Example: `membership.role` should be just the `role` variable

9. **CommonJS/ESM Import Conflicts**
   - Detects incorrect named imports from CommonJS modules
   - Example: `import { parseMultipartData } from 'parse-multipart-data'` → should use default import
   - Provides correct fix: `import pkg from 'parse-multipart-data'; const { parseMultipartData } = pkg;`
   - Prevents Azure Functions runtime errors: "Named export not found"

10. **Storage Driver Paths**
    - Validates correct import path for storage drivers
    - Must use: `../cross-platform/storage-drivers/index.js`

### Warnings (Should review but not blocking)
1. **Missing Try-Catch**
   - `ensureMembership` calls should be wrapped in try-catch for error handling

2. **crypto.randomUUID() Usage**
   - Suggests using database `DEFAULT gen_random_uuid()` instead

3. **Response Format**
   - Suggests including explicit status codes in response objects

4. **Single-Parameter Handlers**
   - Some legacy handlers may only take one parameter

5. **Missing HTTP Route**
   - HTTP trigger defined but no route specified (will use Azure default)

## Common Issues Detected

### Issue: Missing function.json
**Error Message:**
```
api/my-endpoint/: Missing function.json. Azure will ignore this endpoint.
```

**Fix:**
Create `function.json` with HTTP bindings:
```json
{
  "bindings": [
    {
      "authLevel": "anonymous",
      "type": "httpTrigger",
      "direction": "in",
      "name": "req",
      "methods": ["get", "post"],
      "route": "my-endpoint"
    },
    {
      "type": "http",
      "direction": "out",
      "name": "res"
    }
  ]
}
```

### Issue: Invalid JSON in function.json
**Error Message:**
```
api/my-endpoint/function.json: Invalid JSON - Expected double-quoted property name in JSON at position 129. Check for trailing commas or syntax errors.
```

**Fix:**
Remove trailing commas and ensure valid JSON syntax:
```json
// ❌ Invalid (trailing comma)
{
  "methods": ["get"],
}

// ✅ Valid
{
  "methods": ["get"]
}
```

### Issue: scriptFile Mismatch
**Error Message:**
```
api/my-endpoint/function.json: scriptFile "./main.js" not found. Expected file at api/my-endpoint/./main.js
```

**Fix Option 1:** Rename your file to match scriptFile:
```bash
mv api/my-endpoint/index.js api/my-endpoint/main.js
```

**Fix Option 2:** Update function.json to match existing file:
```json
{
  "scriptFile": "./index.js",
  "bindings": [...]
}
```

**Fix Option 3:** Remove scriptFile (defaults to index.js):
```json
{
  "bindings": [...]
}
```

## Example Output

### Success
```
🔍 Validating API endpoints...

📊 Validation Results:

✅ All checks passed! No issues found.

Validated:
  ✓ Import paths and exports
  ✓ Handler signatures
  ✓ function.json configuration
  ✓ scriptFile alignment
  ✓ JSON validity
  ✓ HTTP bindings
```

### With Errors
```
🔍 Validating API endpoints...

📊 Validation Results:

❌ ERRORS (3):
  1. api/test-missing-config/: Missing function.json. Azure will ignore this endpoint.
  2. api/test-invalid-json/function.json: Invalid JSON - Expected double-quoted property name in JSON at position 129. Check for trailing commas or syntax errors.
  3. api/test-wrong-scriptfile/function.json: scriptFile "./main.js" not found. Expected file at api/test-wrong-scriptfile/./main.js

⚠️  WARNINGS (2):
  1. api\instructor-files\index.js: Uses crypto.randomUUID(). Consider using database DEFAULT gen_random_uuid() instead
  2. api\org-documents\index.js: ensureMembership call not wrapped in try-catch for error handling

❌ Validation failed. Fix errors before deploying.

Common fixes:
  • Missing function.json: Create function.json with HTTP bindings
  • Invalid JSON: Remove trailing commas, check syntax
  • scriptFile mismatch: Rename file or update function.json
  • Missing bindings: Add httpTrigger and http output bindings
```

## How It Works

1. **Azure Functions Configuration Validation**
   - Scans all endpoint directories for `function.json` files
   - Parses JSON and validates syntax (catches trailing commas, etc.)
   - Verifies `scriptFile` points to an existing file
   - Checks for required HTTP bindings (trigger + output)
   - Validates methods array and route configuration

2. **Dynamic Export Detection**
   - Reads actual exports from shared modules at runtime
   - Extracts `export function`, `export const`, and `export { ... }` declarations
   - No hardcoded list to maintain

3. **Pattern Matching**
   - Uses regex to parse import statements and handler signatures
   - Detects CommonJS `require()` usage in ES modules
   - Identifies deprecated patterns

4. **Comprehensive Scanning**
   - Recursively scans all `/api/**` directories
   - Validates every `index.js` endpoint file
   - Checks critical shared modules exist

## Integration in Workflow

### Before Deployment
```bash
# Check for API issues
npm run validate:api

# If errors found, fix them first
# If only warnings, review and deploy if acceptable

# Deploy
git push
```

### In CI/CD (Future)
Add to GitHub Actions or Azure Pipelines:
```yaml
- name: Validate API Endpoints
  run: npm run validate:api
```

## Benefits

1. **Catch Multiple Issues At Once**
   - No more fix-deploy-fail-fix-deploy cycle
   - See all problems in one run

2. **Prevent Silent Deployment Failures**
   - Missing `function.json` → Azure ignores endpoint silently
   - Invalid JSON → Deployment succeeds but endpoint fails at runtime
   - scriptFile mismatch → Function crashes on first invocation
   - All caught before you push to Azure

3. **Prevent Production Errors**
   - Import errors caught before Azure deployment
   - Parameter order issues detected locally
   - CommonJS/ESM conflicts identified early

4. **Enforce Best Practices**
   - Warnings guide developers to better patterns
   - Deprecation notices prevent technical debt

5. **Fast Feedback**
   - Runs in seconds locally
   - No need to deploy to discover issues
   - Complete error list in single run

## Future Enhancements

- [ ] Validate RLS policy references in tenant client usage
- [ ] Check for missing audit logging on admin actions
- [ ] Validate environment variable usage
- [ ] Check for proper error handling patterns
- [ ] Integrate with pre-commit hooks
