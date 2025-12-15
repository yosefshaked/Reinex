/* eslint-env node */
/**
 * Instructor Files Check API
 * 
 * Pre-upload duplicate check endpoint.
 * Calculates file hash and checks for duplicates across all instructors.
 * 
 * POST /api/instructor-files-check - Check for duplicate files
 */

import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  ensureMembership,
  isAdminRole,
  readEnv,
  respond,
  resolveTenantClient,
} from '../_shared/org-bff.js';
import crypto from 'crypto';
import multipart from 'parse-multipart-data';

/**
 * Calculate MD5 hash of file content for duplicate detection
 */
function calculateFileHash(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

/**
 * Parse multipart form data
 */
function parseMultipartData(req) {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    throw new Error('Request must be multipart/form-data');
  }

  const boundaryMatch = contentType.match(/boundary=([^;]+)/);
  if (!boundaryMatch) {
    throw new Error('No boundary found in content-type');
  }

  const boundary = boundaryMatch[1];
  
  let bodyBuffer;
  if (Buffer.isBuffer(req.body)) {
    bodyBuffer = req.body;
  } else if (typeof req.body === 'string') {
    bodyBuffer = Buffer.from(req.body, 'binary');
  } else {
    throw new Error(`Unexpected body type: ${typeof req.body}`);
  }
  
  const parts = multipart.parse(bodyBuffer, boundary);
  return parts;
}

export default async function (context, req) {
  if (req.method !== 'POST') {
    return respond(context, 405, { message: 'method_not_allowed' });
  }

  context.log?.info?.('🔍 [INSTRUCTOR-CHECK] Request received');

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);
  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('instructor-files-check missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing_bearer' });
  }

  const controlClient = createSupabaseAdminClient(adminConfig);

  // Validate token
  let authResult;
  try {
    authResult = await controlClient.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('instructor-files-check failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  const userId = authResult.data.user.id;

  // Parse multipart data
  let parts;
  try {
    parts = parseMultipartData(req);
    context.log?.info?.('✅ [INSTRUCTOR-CHECK] Multipart parsed', { partsCount: parts?.length });
  } catch (error) {
    context.log?.error?.('❌ [INSTRUCTOR-CHECK] Failed to parse multipart', { message: error?.message });
    return respond(context, 400, { message: 'invalid_multipart_data', error: error?.message });
  }

  // Extract fields
  const filePart = parts.find(p => p.filename);
  const orgIdPart = parts.find(p => p.name === 'org_id');
  const instructorIdPart = parts.find(p => p.name === 'instructor_id');

  if (!filePart) {
    return respond(context, 400, { message: 'no_file_provided' });
  }

  if (!orgIdPart || !instructorIdPart) {
    return respond(context, 400, { message: 'missing_org_id_or_instructor_id' });
  }

  const orgId = orgIdPart.data.toString('utf8').trim();
  const instructorId = instructorIdPart.data.toString('utf8').trim();

  // Verify membership
  let role;
  try {
    role = await ensureMembership(controlClient, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('instructor-files-check failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role) {
    return respond(context, 403, { message: 'not_a_member' });
  }

  const isAdmin = isAdminRole(role);

  // Permission check: Non-admin users can only check their own files
  if (!isAdmin && instructorId !== userId) {
    return respond(context, 403, { 
      message: 'forbidden',
      details: 'You can only check files for your own instructor record'
    });
  }

  // Calculate file hash
  const fileHash = calculateFileHash(filePart.data);
  context.log?.info?.('🔐 [INSTRUCTOR-CHECK] Hash calculated', { hash: fileHash });

  // Get tenant client
  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, controlClient, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  // Check for duplicate files in Documents table
  // Admins can see all instructor duplicates, non-admins only their own
  let documentsQuery = tenantClient
    .from('Documents')
    .select('id, name, uploaded_at, entity_id, hash')
    .eq('entity_type', 'instructor')
    .eq('hash', fileHash);
  
  if (!isAdmin) {
    // Non-admins can only see their own duplicates
    documentsQuery = documentsQuery.eq('entity_id', userId);
  }

  const { data: allDocuments, error: documentsError } = await documentsQuery;

  if (documentsError) {
    context.log?.error?.('❌ [INSTRUCTOR-CHECK] Failed to check duplicates in Documents table', { 
      message: documentsError.message,
      code: documentsError.code,
    });
    return respond(context, 500, { 
      message: 'failed_to_check_duplicates',
      error: documentsError.message,
    });
  }

  // Fetch instructor names for found duplicates
  const duplicates = [];
  if (allDocuments && allDocuments.length > 0) {
    const instructorIds = [...new Set(allDocuments.map(doc => doc.entity_id))];
    const { data: instructors } = await tenantClient
      .from('Instructors')
      .select('id, name')
      .in('id', instructorIds);

    const instructorMap = new Map((instructors || []).map(i => [i.id, i.name]));

    for (const doc of allDocuments) {
      duplicates.push({
        file_id: doc.id,
        file_name: doc.name,
        uploaded_at: doc.uploaded_at,
        instructor_id: doc.entity_id,
        instructor_name: instructorMap.get(doc.entity_id) || 'Unknown',
      });
    }
  }

  context.log?.info?.('✅ [INSTRUCTOR-CHECK] Duplicate check completed', { 
    hash: fileHash, 
    duplicatesFound: duplicates.length 
  });

  return respond(context, 200, {
    hash: fileHash,
    has_duplicates: duplicates.length > 0,
    duplicates,
  });
}
