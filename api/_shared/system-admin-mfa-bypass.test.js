/* eslint-env node */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isSystemAdminMfaBypassAllowed } from './org-bff.js';

const LOCAL = {
  SYSTEM_ADMIN_ALLOW_WITHOUT_MFA: 'true',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  AZURE_FUNCTIONS_ENVIRONMENT: 'Development',
};

test('the MFA bypass is allowed only with the flag, a loopback Supabase URL and a non-Production host', () => {
  assert.equal(isSystemAdminMfaBypassAllowed(LOCAL), true);
  assert.equal(isSystemAdminMfaBypassAllowed({ ...LOCAL, SUPABASE_URL: 'http://localhost:54321' }), true);
  assert.equal(isSystemAdminMfaBypassAllowed({ ...LOCAL, SYSTEM_ADMIN_ALLOW_WITHOUT_MFA: 'TRUE' }), true);
  assert.equal(isSystemAdminMfaBypassAllowed({ ...LOCAL, AZURE_FUNCTIONS_ENVIRONMENT: undefined }), true);
});

test('the MFA bypass is refused when any condition is missing', () => {
  assert.equal(isSystemAdminMfaBypassAllowed({ ...LOCAL, SYSTEM_ADMIN_ALLOW_WITHOUT_MFA: undefined }), false, 'no flag');
  assert.equal(isSystemAdminMfaBypassAllowed({ ...LOCAL, SYSTEM_ADMIN_ALLOW_WITHOUT_MFA: '1' }), false, 'only "true" counts');
  assert.equal(isSystemAdminMfaBypassAllowed({ ...LOCAL, AZURE_FUNCTIONS_ENVIRONMENT: 'Production' }), false, 'production host');
  assert.equal(isSystemAdminMfaBypassAllowed({ ...LOCAL, SUPABASE_URL: 'https://abcd.supabase.co' }), false, 'hosted Supabase');
  assert.equal(isSystemAdminMfaBypassAllowed({ ...LOCAL, SUPABASE_URL: 'http://127.0.0.1.evil.example' }), false, 'look-alike host');
  assert.equal(isSystemAdminMfaBypassAllowed({ ...LOCAL, SUPABASE_URL: 'not a url' }), false, 'invalid URL');
  assert.equal(isSystemAdminMfaBypassAllowed({ SYSTEM_ADMIN_ALLOW_WITHOUT_MFA: 'true' }), false, 'no Supabase URL');
});
