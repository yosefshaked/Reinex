# API Validation Quick Reference

## Pre-Deployment Checklist

```bash
# Run BOTH validation tools before deploying
npm run lint:api && node scripts/validate-api-endpoints.js
```

## What Gets Validated

### ✅ Azure Functions Configuration
- [ ] `function.json` exists in every endpoint directory
- [ ] JSON syntax is valid (no trailing commas)
- [ ] `scriptFile` points to existing file (or defaults to index.js)
- [ ] HTTP trigger binding defined with methods
- [ ] HTTP output binding present

### ✅ Code Quality
- [ ] Import/export names match
- [ ] Handler signature: `(context, req)` not `(req, context)`
- [ ] No deprecated imports (checkOrgMembership, old storage paths)
- [ ] CommonJS modules use default import
- [ ] No undefined variables or unused imports

## Common Fixes

### Missing function.json
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

### Invalid JSON (Trailing Comma)
```json
// ❌ Invalid
{ "methods": ["get"], }

// ✅ Valid
{ "methods": ["get"] }
```

### scriptFile Mismatch
```json
// Option 1: Remove scriptFile (defaults to index.js)
{
  "bindings": [...]
}

// Option 2: Specify correct file
{
  "scriptFile": "./index.js",
  "bindings": [...]
}
```

### CommonJS Import
```javascript
// ❌ Wrong (causes runtime error)
import { parseMultipartData } from 'parse-multipart-data';

// ✅ Correct
import pkg from 'parse-multipart-data';
const { parseMultipartData } = pkg;
```

### Handler Signature
```javascript
// ❌ Wrong order
export default async function (req, context) { }

// ✅ Correct order
export default async function (context, req) { }
```

## Exit Codes

- `0` = All checks passed (or warnings only)
- `1` = Critical errors found, must fix before deploying

## Error Priority

1. **CRITICAL** (Red ❌): Fix immediately, will break deployment
   - Missing function.json
   - Invalid JSON
   - scriptFile not found
   - Import/export mismatches
   - Wrong handler signature

2. **WARNINGS** (Yellow ⚠️): Review but not blocking
   - Missing try-catch
   - crypto.randomUUID usage
   - Response format suggestions
   - Missing route definition

## Integration

### Manual (Before Each Deploy)
```bash
npm run lint:api && node scripts/validate-api-endpoints.js
```

### Git Pre-Commit Hook (Future)
```bash
# .git/hooks/pre-commit
npm run lint:api && node scripts/validate-api-endpoints.js || exit 1
```

### CI/CD Pipeline (Future)
```yaml
- name: Validate API
  run: npm run lint:api && node scripts/validate-api-endpoints.js
```

## Need Help?

See full documentation: `docs/api-validation-tool.md`
