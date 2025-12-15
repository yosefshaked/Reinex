# Issue: PR Comment Spam

**Severity:** 2 (High - Affects workflow and creates clutter)

## Problem
The Azure Static Web Apps deploy action posts a new comment on every build, spamming the PR with duplicate preview URL comments. Each push to a PR branch creates another comment instead of updating the existing one.

## Current Behavior
- Every commit triggers a new build
- Every build adds a new comment to the PR
- PRs with many commits end up with dozens of identical comments

## Root Cause
Line 27 in `.github/workflows/azure-static-web-apps-lemon-wave-0e6c61303.yml`:
```yaml
repo_token: ${{ secrets.GITHUB_TOKEN }} # Used for Github integrations (i.e. PR comments)
```

This enables the Azure action to post comments, but the action doesn't update existing comments - it creates new ones.

## Solution Options

### Option A: Remove PR Comments Entirely (Simplest)
Remove the `repo_token` line completely.
- **Pros:** Immediate fix, no spam
- **Cons:** Lose automatic preview URL comments (can still find URLs in Actions tab)

### Option B: Update to Latest Action Version
Change `Azure/static-web-apps-deploy@v1` to the latest version.
- **Pros:** May have built-in comment update logic
- **Cons:** Need to check if newer version exists and test compatibility

### Option C: Custom Comment Management (Advanced)
Remove `repo_token` from Azure action and add a separate step using:
- `peter-evans/find-comment@v2` to find existing comment
- `peter-evans/create-or-update-comment@v3` to update it
- **Pros:** Full control, updates instead of creating new comments
- **Cons:** More complex, requires additional workflow steps

## Recommended Approach
Start with **Option A** for immediate relief, or **Option B** if preview URL comments are valuable.

## Related Files
- `.github/workflows/azure-static-web-apps-lemon-wave-0e6c61303.yml`
