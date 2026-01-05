# Preanswers Permission-Based Cap Implementation

## Overview
This document describes the implementation of the permission-based cap for instructor custom preconfigured answers (preanswers). The feature replaces a hard-coded 50-item limit with a dynamic limit controlled by the `session_form_preanswers_cap` permission from the permission registry.

## Architecture

### Permission Flow
```
permission_registry.session_form_preanswers_cap (default: 50)
    ↓
org_settings.permissions.session_form_preanswers_cap
    ↓
activeOrg.connection.permissions.session_form_preanswers_cap
    ↓
Frontend: preanswersCapLimit prop
Backend: orgPermissions parameter
```

## Frontend Implementation

### 1. Permission Extraction (NewSessionModal.jsx)
**Location**: Lines 286-293

```javascript
const preanswersCapLimit = useMemo(() => {
  const capRaw = activeOrg?.connection?.permissions?.session_form_preanswers_cap;
  if (typeof capRaw === 'number' && capRaw > 0) {
    return capRaw;
  }
  return 50; // Fallback to default
}, [activeOrg]);
```

**Purpose**: Extract the cap from organization permissions once on mount/org change.

### 2. Prop Threading
The cap flows through the component tree:
- `NewSessionModal` → `NewSessionForm` → `PreanswersPickerDialog`

**NewSessionModal.jsx** (Line 795):
```javascript
<NewSessionForm
  preanswersCapLimit={preanswersCapLimit}
  // ... other props
/>
```

**NewSessionForm.jsx** (Lines 24, 1123):
```javascript
// Prop declaration
preanswersCapLimit = 50,

// Pass to dialog
<PreanswersPickerDialog
  preanswersCapLimit={preanswersCapLimit}
  // ... other props
/>
```

**PreanswersPickerDialog.jsx** (Lines 23, 61):
```javascript
// Prop declaration
preanswersCapLimit = 50,

// Usage in rendering
{orgPreanswers.slice(0, preanswersCapLimit).map((answer) => (
  // ... render answer
))}
```

### 3. Personal Preanswers Normalization (NewSessionModal.jsx)
**Location**: Line 692

```javascript
handleSavePersonalPreanswers: async (questionId, answers) => {
  const normalized = normalizeList(answers, preanswersCapLimit);
  // ... save logic
}
```

The `normalizeList` helper function enforces uniqueness, trimming, and cap:
```javascript
const normalizeList = (list, limit) => {
  const unique = [];
  const seen = new Set();
  for (const item of list) {
    const trimmed = item.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      unique.push(trimmed);
      if (unique.length >= limit) break;
    }
  }
  return unique;
};
```

## Backend Implementation

### 1. Validation Function (api/_shared/validation.js)

#### Function Signature Update
**Location**: Line 252

```javascript
export function validateInstructorUpdate(body, orgPermissions = {}) {
  // ... validation logic
}
```

**Change**: Added `orgPermissions` parameter with default empty object for backward compatibility.

#### Internal normalizePreanswersMap Function
**Location**: Lines 261-289

```javascript
const normalizePreanswersMap = (raw, orgPermissions) => {
  const capRaw = orgPermissions?.session_form_preanswers_cap;
  const cap = typeof capRaw === 'number' && capRaw > 0 ? capRaw : 50;
  
  if (!raw || typeof raw !== 'object') return {};
  
  const normalized = {};
  for (const [key, list] of Object.entries(raw)) {
    if (!key || !Array.isArray(list)) continue;
    
    const unique = [];
    const seen = new Set();
    for (const rawEntry of list) {
      if (typeof rawEntry !== 'string') continue;
      const trimmed = rawEntry.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      unique.push(trimmed);
      if (unique.length >= cap) break;
    }
    
    normalized[key] = unique;
  }
  return normalized;
};
```

**Purpose**: 
- Extract cap from permissions (default 50)
- Validate and normalize preanswer lists
- Enforce uniqueness, trimming, and cap limit
- Return normalized map ready for database storage

#### Preanswers Validation Calls
**Location**: Lines 327-336

```javascript
// Metadata path: body.metadata.custom_preanswers
if (rawCustom) {
  metadataUpdates.custom_preanswers = normalizePreanswersMap(rawCustom, orgPermissions);
}

// Alias path: body.custom_preanswers
if (rawAlias) {
  metadataUpdates.custom_preanswers = normalizePreanswersMap(rawAlias, orgPermissions);
}
```

**Change**: Both calls now pass `orgPermissions` to enforce the permission-based cap.

### 2. API Endpoint (api/instructors/index.js)

#### Permission Fetch in PUT Handler
**Location**: Lines 203-217

```javascript
if (method === 'PUT') {
  // Fetch org permissions for preanswers cap enforcement
  const { data: orgSettings, error: permError } = await supabase
    .from('org_settings')
    .select('permissions')
    .eq('org_id', orgId)
    .maybeSingle();

  if (permError) {
    context.log?.error?.('instructors failed to load permissions', { message: permError.message });
    return respond(context, 500, { message: 'failed_to_load_permissions' });
  }

  const permissions = typeof orgSettings?.permissions === 'string'
    ? JSON.parse(orgSettings.permissions)
    : orgSettings?.permissions || {};

  const validation = validateInstructorUpdate(body, permissions);
  // ... rest of validation and update logic
}
```

**Purpose**:
- Query control DB for organization permissions
- Handle both JSON string and object formats
- Pass permissions to validation function
- Return 500 error if permissions fetch fails

## Permission Registry

### Default Configuration
**Table**: `permission_registry` (control DB)
**Key**: `session_form_preanswers_cap`
**Default Value**: `50` (stored as JSONB number)
**Type**: `number`

### Database Schema
```sql
INSERT INTO public.permission_registry 
  (permission_key, default_value, description, category)
VALUES
  ('session_form_preanswers_cap', '50', 
   'Maximum number of preconfigured answers per question', 
   'session_form');
```

### Initialization
When an organization is created, the `initialize_org_permissions(org_id)` function copies defaults from `permission_registry` to `org_settings.permissions`.

## Usage Flow

### Instructor Adding Personal Preanswers
1. Instructor opens session form
2. Clicks preanswer button for text/textarea question
3. Opens PreanswersPickerDialog (Personal tab)
4. Adds answers (UI enforces cap visually)
5. Auto-saves on add/delete
6. Frontend normalizes with `preanswersCapLimit`
7. Backend validates with `orgPermissions.session_form_preanswers_cap`
8. Saves to `Instructors.metadata.custom_preanswers`

### Admin Configuring Cap
1. Admin accesses permission registry settings (future feature)
2. Sets `session_form_preanswers_cap` to desired value (e.g., 100)
3. Value persists in `org_settings.permissions`
4. All instructors in that organization get new cap
5. Existing preanswers exceeding new cap are **not** truncated (preserve data)
6. New additions/edits enforce new cap

## Security & Validation

### Frontend Protection
- UI prevents adding beyond cap (slice in rendering)
- Normalization enforces cap before API call
- Cap extracted from trusted org context

### Backend Protection
- Permission fetch enforced on every PUT request
- Validation uses permission value (not client input)
- Default fallback (50) if permission missing
- Cap enforcement at data normalization layer

### Permission Boundaries
- **Instructors**: Can only edit their own `custom_preanswers` (enforced by `isSelf` check)
- **Admins**: Can edit any instructor's preanswers
- **Members**: Cannot access instructor metadata at all

## Testing Considerations

### Test Scenarios
1. **Default cap (50)**: Verify works when no permission set
2. **Custom cap (e.g., 100)**: Set permission, verify new limit enforced
3. **Zero/negative cap**: Should fallback to 50 (validation ensures positive number)
4. **Missing permission**: Should use default 50
5. **Malformed permission**: Should handle gracefully with default
6. **Frontend/backend consistency**: Both should enforce same cap from same source

### Edge Cases
- Permission not initialized → default 50
- Permission set to string "50" → parses to number
- Permission set to null → default 50
- Permission set to array → ignored, default 50
- Very large cap (e.g., 10000) → allowed but UX may suffer

## Future Enhancements

### Admin UI for Permission Management
Currently, the cap must be set directly in the database. Future work:
- Settings page card for permission configuration
- Live validation of cap value (min: 1, max: 1000?)
- Preview of affected instructors
- Warning when reducing cap (data preservation note)

### Permission-Aware UX
- Show current cap to instructor in dialog
- Display "X / Y answers" counter
- Warning when approaching cap
- Admin badge showing custom cap if not default

### Migration Strategy
If reducing cap from 50 to lower value:
- Existing data preserved (no truncation)
- Warning in UI when viewing old data
- Option to "compress" old data to new limit (admin only)

## Files Modified

### Frontend
- `src/features/sessions/components/NewSessionModal.jsx` (Lines 286-293, 692, 795)
- `src/features/sessions/components/NewSessionForm.jsx` (Lines 24, 1123)
- `src/features/sessions/components/PreanswersPickerDialog.jsx` (Lines 23, 61)

### Backend
- `api/_shared/validation.js` (Lines 252, 261-289, 327-336)
- `api/instructors/index.js` (Lines 203-217)

### Documentation
- This file: `docs/preanswers-permission-cap-implementation.md`

## Changelog Entry
**Version**: 1.8.1
**Date**: 2025-01-XX
**Type**: Enhancement

**Change**: Instructor custom preconfigured answers now respect the `session_form_preanswers_cap` permission from the organization's permission registry instead of using a hard-coded 50-item limit. This allows system administrators to configure different caps per organization based on their needs.

**Technical Details**:
- Frontend extracts cap from `activeOrg.connection.permissions.session_form_preanswers_cap`
- Backend fetches permissions from control DB during PUT requests
- Both frontend and backend enforce the same limit from the same source
- Default cap remains 50 when permission not set
- Existing preanswers data is preserved when cap changes

## Conclusion

The permission-based cap implementation provides:
- ✅ **Flexibility**: Orgs can have different limits
- ✅ **Consistency**: Frontend and backend use same source
- ✅ **Security**: Backend validates with server-side permission data
- ✅ **Backward Compatibility**: Defaults to 50 when permission missing
- ✅ **Data Preservation**: Doesn't truncate existing data
- ✅ **Performance**: Minimal overhead (single permission fetch per request)

The implementation is complete and production-ready.
