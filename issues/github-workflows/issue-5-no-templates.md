# Issue: No PR and Issue Templates

**Severity:** 5 (Low - Nice to have for better collaboration and consistency)

## Problem
The repository has no Pull Request or Issue templates. This leads to inconsistent bug reports, feature requests, and PR descriptions, making it harder to understand context and track changes.

## Current Situation
When creating PRs or issues:
- Empty description fields
- No structured information
- Missing reproduction steps for bugs
- Unclear acceptance criteria
- No checklist for PR reviews

## Impact on Development

### For Bug Reports
Without template, you often miss:
- Steps to reproduce
- Expected vs actual behavior
- Environment details (browser, OS)
- Screenshots or error messages
- Related issues or PRs

### For Feature Requests
Without template, you often miss:
- User story or use case
- Proposed solution
- Alternative approaches considered
- Implementation scope

### For Pull Requests
Without template, you often miss:
- What changed and why
- Testing performed
- Breaking changes
- Related issues
- Screenshots of UI changes

## Solution: Add GitHub Templates

### Create PR Template
**File:** `.github/pull_request_template.md`

Example structure:
```markdown
## Description
<!-- Brief description of changes -->

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Related Issues
Fixes #

## Testing
- [ ] Tested locally
- [ ] Added/updated tests
- [ ] Checked console for errors

## Screenshots (if applicable)

## Checklist
- [ ] Code follows project style
- [ ] Self-reviewed code
- [ ] Updated documentation
- [ ] No new warnings
```

### Create Issue Templates

**Bug Report:** `.github/ISSUE_TEMPLATE/bug_report.md`
**Feature Request:** `.github/ISSUE_TEMPLATE/feature_request.md`

## Benefits
✅ **Better documentation** - Clear record of what and why  
✅ **Faster reviews** - Reviewers understand context immediately  
✅ **Consistent format** - Easy to scan and compare issues  
✅ **Reduced back-and-forth** - All info provided upfront  
✅ **Better project tracking** - Linked issues and clear progress  
✅ **Professional appearance** - Shows attention to detail  

## Usage Examples

### Good PR with Template
```
## Description
Fixed session form versioning to preserve history

## Type of Change
- [x] Bug fix

## Related Issues
Fixes #42

## Testing
- [x] Tested save/load cycle
- [x] Verified version history accumulates
- [x] Checked backward compatibility

## Screenshots
[Before/After comparison]
```

### Good Bug Report with Template
```
## Bug Description
Settings page shows [object Object] in database

## Steps to Reproduce
1. Go to Settings
2. Add a question
3. Click Save
4. Check database

## Expected Behavior
Questions saved as readable JSON

## Actual Behavior
Shows "[object Object]"

## Environment
- Browser: Chrome 118
- OS: Windows 11
```

## Implementation Priority
**Low** - Works without templates, but improves quality of life over time.

## Recommended Templates to Add
1. **Pull Request template** (most valuable)
2. **Bug report template**
3. **Feature request template**
4. **Documentation template** (optional)

## Related Files
- None currently - needs `.github/` templates to be created
- Would create:
  - `.github/pull_request_template.md`
  - `.github/ISSUE_TEMPLATE/bug_report.md`
  - `.github/ISSUE_TEMPLATE/feature_request.md`
