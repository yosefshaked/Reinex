# Invitation Expiry Smart Configuration

## Overview
Invitation links now automatically calculate their expiration timestamp using a smart precedence system that syncs with Supabase's OTP token expiry configuration while allowing a global control-level override.

## How It Works

### Precedence Order
When creating a new invitation, the system determines `expires_at` using this hierarchy:

1. **Client-provided expiration** (highest priority)
   - If the API request includes `expiresAt` or `expires_at`, use that value
   - Allows programmatic control for special cases

2. **Global registry override**
  - Read `permission_registry.invitation_expiry_seconds` (integer, seconds)
  - Applies to all organizations uniformly
  - Does not require changing Supabase auth config

3. **Supabase auth config**
   - Read `MAILER_OTP_EXP` from `auth.config` table
  - Stored in seconds (no conversion necessary)
   - Default is 86400 seconds (24 hours) in Supabase

4. **Hardcoded fallback** (lowest priority)
   - 24 hours if all above fail
   - Ensures invitations always have a reasonable expiry

### Database Functions

#### `get_auth_otp_expiry_seconds()`
- Security definer function that reads Supabase auth config
- Returns `MAILER_OTP_EXP` value in seconds
- Falls back to 86400 (24h) if config not found

#### `calculate_invitation_expiry(org_id UUID)`
- Security definer function that implements the precedence logic
- Takes organization ID, returns calculated `TIMESTAMPTZ`
- Checks global registry override (seconds) → auth config (seconds) → hardcoded default (86400)

## Deployment

### 1. Update Permission Registry
```sql
-- Add invitation_expiry_seconds permission (already in control-db-permissions-table.sql)
-- Run the full script or just insert the new permission:
INSERT INTO public.permission_registry (
  permission_key,
  display_name_en,
  display_name_he,
  description_en,
  description_he,
  default_value,
  category,
  requires_approval
) VALUES (
  'invitation_expiry_seconds',
  'Invitation Expiry Seconds',
  'שניות תוקף הזמנה',
  'Number of seconds until invitation links expire (global). Overrides Supabase auth config if set.',
  'מספר שניות עד פקיעת קישורי הזמנה (גלובלי). דורס את הגדרת Supabase אם מוגדר.',
  'null'::jsonb,
  'features',
  false
) ON CONFLICT (permission_key) DO NOTHING;
```

### 2. Deploy RPC Functions
Run `scripts/control-db-invitation-expiry.sql` in the control database:
```bash
# Via Supabase SQL editor or psql
psql $CONTROL_DB_URL -f scripts/control-db-invitation-expiry.sql
```

### 3. Initialize Org Permissions
No per-organization permission is required for expiry. This system uses a global registry value.

## Configuration

### Global Override
To set a system-wide expiry period in seconds (e.g., 72 hours = 259200 seconds):

```sql
INSERT INTO public.permission_registry (
  permission_key, display_name_en, display_name_he, description_en, description_he, default_value, category, requires_approval
) VALUES (
  'invitation_expiry_seconds', 'Invitation Expiry Seconds', 'שניות תוקף הזמנה', 'Global invitation expiry in seconds', 'תוקף הזמנה גלובלי בשניות', '259200'::jsonb, 'features', false
)
ON CONFLICT (permission_key) DO UPDATE SET default_value = EXCLUDED.default_value, updated_at = NOW();
```

### Viewing Current Configuration
```sql
-- Check Supabase auth config (in seconds)
SELECT config->'MAILER_OTP_EXP' as otp_expiry_seconds
FROM auth.config
WHERE id = 1;

-- Test the calculation for an org
SELECT calculate_invitation_expiry('your-org-uuid') as calculated_expiry;
```

## API Behavior

### Creating Invitations

**Automatic expiration** (recommended):
```javascript
POST /api/invitations
{
  "orgId": "uuid",
  "email": "user@example.com"
  // expires_at is calculated automatically
}
```

**Explicit expiration** (override):
```javascript
POST /api/invitations
{
  "orgId": "uuid",
  "email": "user@example.com",
  "expiresAt": "2025-11-11T12:00:00Z"  // specific timestamp
}
```

### Response
All invitations now have `expires_at` populated:
```json
{
  "invitation": {
    "id": "uuid",
    "email": "user@example.com",
    "expires_at": "2025-11-05T12:00:00Z",
    "status": "pending"
  }
}
```

## Benefits

1. **Automatic sync**: Invitation expiry stays aligned with Supabase OTP token expiry
2. **Flexibility**: Organizations can override with custom periods without touching Supabase config
3. **Fallback safety**: Always has a reasonable default even if config reads fail
4. **Observability**: Expiry timestamps are always set, making it easy to audit and track
5. **Consistency**: Both control DB invitation records and Supabase OTP tokens expire in harmony

## Troubleshooting

### Invitations expiring before OTP tokens
- Check if org has a custom `invitation_expiry_hours` that's shorter than Supabase's `MAILER_OTP_EXP`
- Users will see "expired" on the invitation record but may still be able to complete Supabase OTP flow if it's still valid
- Solution: Align the values or remove the org override

### OTP tokens expiring before invitations
- Supabase OTP will fail even if invitation record shows as not expired
- User will see "Email link is invalid or expired" from Supabase
- Solution: Increase Supabase `MAILER_OTP_EXP` to match or exceed org's custom hours

### RPC function fails
- Backend logs warning and falls back to 24h default
- Check control DB logs for permission errors or missing auth schema access
- Verify `search_path` includes both `public` and `auth` schemas

## Testing

```javascript
// Test automatic calculation
const response = await fetch('/api/invitations', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <token>',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    orgId: 'test-org-uuid',
    email: 'test@example.com'
  })
});
const data = await response.json();
console.log('Calculated expiry:', data.invitation.expires_at);

// Verify it's ~24h (or custom hours) from now
const expiryDate = new Date(data.invitation.expires_at);
const hoursUntilExpiry = (expiryDate - new Date()) / (1000 * 60 * 60);
console.log('Hours until expiry:', hoursUntilExpiry);
```

## Migration Notes

- **No breaking changes**: Existing API clients continue to work
- **No data migration needed**: Only affects new invitations created after deployment
- **Backward compatible**: Clients can still provide explicit `expiresAt` to override
- **Existing invitations**: Keep their original `expires_at` (or null); not retroactively updated
