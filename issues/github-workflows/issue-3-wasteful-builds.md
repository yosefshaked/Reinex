# Issue: Wasteful Build Triggers

**Severity:** 3 (Medium - Wastes resources but doesn't break functionality)

## Problem
The workflow builds on every push to main branch and on all PR events, even when builds aren't necessary. This wastes GitHub Actions minutes and Azure deployment resources.

## Current Behavior
```yaml
on:
  push:
    branches:
      - main
  pull_request:
    types: [opened, synchronize, reopened, closed]
    branches:
      - main
```

**Issues:**
1. **Redundant main branch builds** - Code was already validated in PR before merge
2. **Builds on draft PRs** - Work-in-progress code that's not ready for review
3. **Builds on documentation changes** - No code changed, but still rebuilds entire app

## Impact
- Slower CI/CD feedback (queue waiting times)
- Wasted GitHub Actions minutes (costs money on paid plans)
- Unnecessary Azure deployments
- Cluttered deployment history

## Recommendations

### 1. Skip Main Branch Pushes (If PRs are required)
If you enforce PR merges, remove the push trigger:
```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, closed]
    branches:
      - main
```

### 2. Skip Draft PRs
Add condition to main job:
```yaml
jobs:
  build_and_deploy_job:
    if: github.event.pull_request.draft == false
```

### 3. Add Path Filters
Don't rebuild for documentation-only changes:
```yaml
on:
  pull_request:
    branches:
      - main
    paths-ignore:
      - '**.md'
      - 'docs/**'
      - 'ProjectDoc/**'
      - 'LICENSE'
```

## Estimated Savings
- **~50% fewer builds** by skipping main pushes (if using PRs)
- **~20-30% fewer builds** by skipping drafts and docs-only changes
- **Faster feedback** for important builds (less queue time)

## Related Files
- `.github/workflows/azure-static-web-apps-lemon-wave-0e6c61303.yml`
