# Deployment Verification Checklist

After rolling back commit 107a854, please verify the following to resolve the 500 error on the students admin page:

## 1. Verify Azure Deployment Status

Check if the deployment has completed successfully:
- Go to Azure Portal → Static Web Apps → Your app → Deployments
- Confirm the latest deployment shows the rolled-back commit (d4e79a3)
- Wait for deployment to complete (usually 5-10 minutes)

## 2. Verify Environment Variables

Ensure these environment variables are set in Azure Static Web App Configuration:

### Control DB (Required for all endpoints):
- `APP_CONTROL_DB_URL` or `SUPABASE_URL` - Control database URL
- `APP_CONTROL_DB_SERVICE_ROLE_KEY` or `SUPABASE_SERVICE_ROLE_KEY` - Service role key

### Encryption (Required for tenant access):
- `APP_ORG_CREDENTIALS_ENCRYPTION_KEY` - 32-byte encryption key for decrypting tenant credentials

## 3. Verify Tenant Database Schema

Connect to your tenant database and verify:

```sql
-- Check if Students table exists in tuttiud schema
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'tuttiud' 
  AND table_name = 'Students'
);

-- Check if required columns exist
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_schema = 'tuttiud' 
AND table_name = 'Students';

-- Expected columns:
-- id (uuid)
-- name (text)
-- national_id (text, nullable)
-- contact_info (text, nullable)
-- contact_name (text, nullable)
-- contact_phone (text, nullable)
-- assigned_instructor_id (uuid, nullable)
-- default_day_of_week (integer, nullable)
-- default_session_time (time, nullable)
-- default_service (text, nullable)
-- notes (text, nullable)
-- tags (text[], nullable)
-- is_active (boolean, default true)
-- files (jsonb, nullable)
-- metadata (jsonb, nullable)
-- created_at (timestamptz)
-- updated_at (timestamptz)
```

## 4. Verify RLS Policies

The Students table should have proper RLS policies that allow:
- Service role key to bypass RLS (or)
- Authenticated users with dedicated key to read/write

```sql
-- Check RLS status
SELECT schemaname, tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'tuttiud' AND tablename = 'Students';

-- List RLS policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE schemaname = 'tuttiud' AND tablename = 'Students';
```

## 5. Verify Control DB Schema

Connect to your control database and verify:

```sql
-- Check org_memberships table
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'org_memberships'
);

-- Check org_settings table
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'org_settings'
);

-- Check organizations table
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'organizations'
);

-- Verify your test org has proper credentials
SELECT 
  o.id,
  o.name,
  o.dedicated_key_encrypted IS NOT NULL as has_encrypted_key,
  s.supabase_url IS NOT NULL as has_url,
  s.anon_key IS NOT NULL as has_anon_key
FROM organizations o
LEFT JOIN org_settings s ON s.org_id = o.id
WHERE o.id = 'YOUR_ORG_ID_HERE';
```

## 6. Test API Endpoints Directly

Use curl or Postman to test the /api/students endpoint:

```bash
# Get your access token from browser dev tools:
# Open Network tab, find any API call, copy the Authorization header value

curl -X GET "https://YOUR_APP.azurestaticapps.net/api/students?org_id=YOUR_ORG_ID" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "X-Supabase-Authorization: Bearer YOUR_TOKEN_HERE" \
  -v
```

Expected response:
- 200 OK with array of students, or
- 4xx/5xx with specific error message in JSON

## 7. Check Azure Function Logs

View detailed error logs:
1. Go to Azure Portal → Your Static Web App
2. Go to "Environment" → "Functions"
3. Click on "Monitor" or "Logs"
4. Look for errors around the time you accessed the student page

## 8. Common Error Patterns

### Error: "server_misconfigured"
**Cause**: Missing Supabase admin credentials  
**Solution**: Add APP_CONTROL_DB_URL and APP_CONTROL_DB_SERVICE_ROLE_KEY to Azure config

### Error: "missing_connection_settings" or "missing_dedicated_key"
**Cause**: Organization not properly set up in control DB  
**Solution**: Run the organization setup SQL scripts

### Error: "failed_to_decrypt_key"
**Cause**: Missing or incorrect encryption key  
**Solution**: Verify APP_ORG_CREDENTIALS_ENCRYPTION_KEY is set correctly

### Error: "failed_to_verify_membership"
**Cause**: User is not a member of the organization  
**Solution**: Add user to org_memberships table

### Error: "forbidden"
**Cause**: User is a member but not admin/owner  
**Solution**: Update user's role in org_memberships to 'admin' or 'owner'

### Error: "failed_to_load_students"
**Cause**: Database query failed (schema, RLS, or connection issue)  
**Solution**: Check tenant DB schema and RLS policies

## 9. Code Verification

After rollback, verify these critical patterns are in place:

### `api/_shared/org-bff.js` - Tenant Client Creation:
```javascript
export function createTenantClient({ supabaseUrl, anonKey, dedicatedKey }) {
  return createClient(supabaseUrl, anonKey, {  // ← Must use anonKey, NOT dedicatedKey
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${dedicatedKey}`,  // ← dedicatedKey goes in header
      },
    },
    db: {
      schema: 'tuttiud',  // ← Must target tuttiud schema
    },
  });
}
```

### `api/students/index.js` - Auth Pattern:
```javascript
const authResult = await supabase.auth.getUser(authorization.token);
// ✅ Correct: access via authResult.data.user
const userId = authResult.data.user.id;

// ❌ Wrong: destructuring breaks the pattern
// const { data: authResult } = await supabase.auth.getUser(token);
```

## 10. If Issue Persists

1. Share the exact error message from Azure Function logs
2. Verify the deployment timestamp matches your latest push
3. Check browser console for frontend errors
4. Try clearing browser cache and reloading
5. Test with a different organization if you have multiple

## Expected Behavior After Fix

Once resolved, the students admin page should:
1. Load without 500 errors
2. Display list of active students by default
3. Allow filtering by status (active/inactive/all)
4. Show proper national_id validation on create/edit
5. Display duplicate detection alerts when national_id conflicts
