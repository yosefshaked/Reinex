/* eslint-env node */
import { Buffer } from 'node:buffer';
import { randomBytes, createCipheriv } from 'node:crypto';
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  readEnv,
  respond,
  normalizeString,
  parseRequestBody,
  resolveEncryptionSecret,
  deriveEncryptionKey,
  isValidOrgId,
  isAdminRole,
} from '../_shared/org-bff.js';


function encryptDedicatedKey(plainText, keyBuffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBuffer, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `v1:gcm:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

export default async function (context, req) {
  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);
  const { supabaseUrl, serviceRoleKey } = adminConfig;

  if (!supabaseUrl || !serviceRoleKey) {
    context.log?.error?.('save-org-credentials missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const encryptionSecret = resolveEncryptionSecret(env);
  const encryptionKey = deriveEncryptionKey(encryptionSecret);

  if (!encryptionKey) {
    context.log?.error?.('save-org-credentials missing encryption secret');
    return respond(context, 500, { message: 'encryption_not_configured' });
  }

  const authorization = resolveBearerAuthorization(req);
  const hasBearer = Boolean(authorization?.token);

  if (!hasBearer) {
    context.log?.warn?.('save-org-credentials missing bearer token');
    return respond(context, 401, { message: 'missing bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('save-org-credentials failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    context.log?.warn?.('save-org-credentials token did not resolve to user');
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const body = parseRequestBody(req);
  const orgId = normalizeString(body.org_id || body.orgId);
  const dedicatedKey = normalizeString(body.dedicated_key || body.dedicatedKey);

  if (!orgId || !isValidOrgId(orgId)) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  if (!dedicatedKey) {
    return respond(context, 400, { message: 'missing dedicated key' });
  }

  const membershipResult = await supabase
    .from('org_memberships')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();

  if (membershipResult.error) {
    context.log?.error?.('save-org-credentials failed to load membership', {
      orgId,
      userId,
      message: membershipResult.error.message,
    });
    return respond(context, 500, { message: 'failed to verify membership' });
  }

  if (!membershipResult.data || !isAdminRole(membershipResult.data.role)) {
    context.log?.warn?.('save-org-credentials forbidden', {
      orgId,
      userId,
      hasMembership: Boolean(membershipResult.data),
    });
    return respond(context, 403, { message: 'forbidden' });
  }

  // DEBUG LOG 1: Show first/last 4 chars of JWT before encryption
  context.log?.('[DEBUG] Setup wizard saving credentials', {
    first4: dedicatedKey.substring(0, 4),
    last4: dedicatedKey.substring(dedicatedKey.length - 4),
    totalLength: dedicatedKey.length,
  });

  const encryptedKey = encryptDedicatedKey(dedicatedKey, encryptionKey);
  const savedAt = new Date().toISOString();

  const fullUpdates = {
    dedicated_key_encrypted: encryptedKey,
    updated_at: savedAt,
    dedicated_key_saved_at: savedAt,
    verified_at: savedAt,
    setup_completed: true,
  };

  let updateError = null;
  const { error: primaryError } = await supabase
    .from('organizations')
    .update(fullUpdates)
    .eq('id', orgId);

  if (primaryError?.code === '42703') {
    const { error: fallbackError } = await supabase
      .from('organizations')
      .update({
        dedicated_key_encrypted: encryptedKey,
        updated_at: savedAt,
      })
      .eq('id', orgId);

    if (fallbackError) {
      updateError = fallbackError;
    } else {
      const optionalFields = [
        ['dedicated_key_saved_at', savedAt],
        ['verified_at', savedAt],
        ['setup_completed', true],
      ];

      for (const [column, value] of optionalFields) {
        const payload = { [column]: value };
        if (column !== 'setup_completed') {
          payload.updated_at = savedAt;
        }

        const { error: optionalError } = await supabase
          .from('organizations')
          .update(payload)
          .eq('id', orgId);

        if (optionalError) {
          if (optionalError.code === '42703') {
            continue;
          }
          updateError = optionalError;
          break;
        }
      }
    }
  } else {
    updateError = primaryError;
  }

  if (updateError) {
    context.log?.error?.('save-org-credentials update failed', {
      orgId,
      userId,
      message: updateError.message,
      code: updateError.code,
    });
    return respond(context, 500, { message: 'failed to store dedicated key' });
  }

  context.log?.info?.('save-org-credentials success', { orgId, userId });
  return respond(context, 200, { saved: true, saved_at: savedAt, verified_at: savedAt });
}
