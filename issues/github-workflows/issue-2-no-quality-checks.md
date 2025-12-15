# Issue: No Code Quality Checks

**Severity:** 2 (High - Could deploy broken or poor-quality code)

## Problem
The workflow only builds and deploys the application without running any code quality checks. This means linting errors, failing tests, or broken code could be deployed to production.

## Current Behavior
The workflow only has two steps:
1. Checkout code
2. Build and deploy

**Missing Checks:**
- ❌ No ESLint run (project has `eslint.config.js`)
- ❌ No tests run (project has tests in `test/` folder)
- ❌ No build verification (assumes build always succeeds)
- ❌ No type checking
- ❌ No security scanning

## Impact
- **Broken code can be deployed** - Tests might fail but still deploy
- **Style inconsistencies** - ESLint rules aren't enforced
- **Regression bugs** - Changes that break existing features aren't caught
- **Security vulnerabilities** - No automated security checks

## Recommended Additions

### 1. Run ESLint Before Deploy
```yaml
- name: Run Lint
  run: npm run lint
  # or: npx eslint . --ext .js,.jsx
```

### 2. Run Tests Before Deploy
```yaml
- name: Run Tests
  run: npm test
```

**Note:** Currently `package.json` shows:
```json
"test": "echo \"Error: no test run specified\" && exit 1"
```
Need to configure a proper test runner first.

### 3. Verify Build Success
Add explicit build step before deploy:
```yaml
- name: Build App
  run: npm run build
```

### 4. Add Security Scanning (Optional)
Use GitHub's built-in security features or third-party actions.

## Benefits
- **Catch bugs early** - Before they reach production
- **Maintain code quality** - Enforce consistent style
- **Prevent regressions** - Tests validate existing functionality
- **Faster debugging** - Know exactly which commit broke things

## Implementation Priority
1. **ESLint** (Quick win - already configured)
2. **Build verification** (Ensures deployment readiness)
3. **Tests** (Requires test runner setup first)
4. **Security scanning** (Nice to have)

## Related Files
- `.github/workflows/azure-static-web-apps-lemon-wave-0e6c61303.yml`
- `package.json` (test script needs configuration)
- `eslint.config.js` (already configured)
- `test/` folder (has test files)
