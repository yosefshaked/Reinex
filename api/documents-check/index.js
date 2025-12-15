/* eslint-env node */
/**
 * Unified Documents Duplicate Check API
 * 
 * Pre-upload duplicate detection for all document types (students, instructors, organizations).
 * Calculates file MD5 hash and searches Documents table for matches.
 * Respects entity-specific permission models.
 * 
 * POST /api/documents-check
 * Query params:
 *   - entity_type: 'student' | 'instructor' | 'organization'
 *   - entity_id: UUID of the student/instructor or org_id for organization documents
 * 
 * Body: multipart/form-data with 'file' field containing the file to check
 * 
 * Response:
 *   { 
 *     hash: string (MD5),
 *     has_duplicates: boolean,
 *     duplicates: [{ file_id, file_name, uploaded_at, entity_id, entity_name }]
 *   }
 */

import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  ensureMembership,
  readEnv,
  respond,
  resolveTenantClient,
} from '../_shared/org-bff.js';
import crypto from 'crypto';
import multipart from 'parse-multipart-data';

/**
 * Validate entity type
 */
function validateEntityType(entityType) {
  const validTypes = ['student', 'instructor', 'organization'];
  return validTypes.includes(entityType);
}

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
  
  // In Azure Static Web Apps / Azure Functions v4:
  // - req.body is a string (not Buffer) for binary data
  // - We need to convert it to Buffer with 'binary' encoding to preserve byte values
  let bodyBuffer;
  if (Buffer.isBuffer(req.body)) {
    bodyBuffer = req.body;
  } else if (typeof req.body === 'string') {
    // Azure SWA sends binary data as a latin1/binary string
    bodyBuffer = Buffer.from(req.body, 'binary');
  } else {
    throw new Error(`Unexpected body type: ${typeof req.body}`);
  }
  
  const parts = multipart.parse(bodyBuffer, boundary);
  return parts;
}

/**
 * Get entity names for duplicates based on entity type
 */
async function getEntityNames(tenantClient, entityType, entityIds) {
  if (entityType === 'student') {
    const { data: students } = await tenantClient
      .from('Students')
      .select('id, name')
      .in('id', entityIds);
    return new Map((students || []).map(s => [s.id, s.name]));
  }
  
  if (entityType === 'instructor') {
    const { data: instructors } = await tenantClient
      .from('Instructors')
      .select('id, name')
      .in('id', entityIds);
    return new Map((instructors || []).map(i => [i.id, i.name]));
  }
  
  // Organization - org_id is self-identifying, no lookup needed
  return new Map();
}

/**
 * Validate permissions for entity type and user
 */
async function validateEntityPermissions(entityType, entityId, userId, isAdmin) {
  // Student documents: All org members can see duplicates across all students
  if (entityType === 'student') {
    return true; // All org members can check
  }
  
  // Instructor documents: Admins see all, non-admins only their own
  if (entityType === 'instructor') {
    if (isAdmin) {
      return true;
    }
    // Non-admin can only check their own instructor record
    return entityId === userId;
  }
  
  // Organization documents: Admin/owner only
  if (entityType === 'organization') {
    return isAdmin;
  }
  
  return false;
}

export default async function (context, req) {
  if (req.method !== 'POST') {
    return respond(context, 405, { message: 'method_not_allowed' });
  }

  context.log?.info?.('📄 [DOCUMENTS-CHECK] Request started', {
    url: req.url,
    queryParams: Object.keys(req.query || {}),
  });

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);
  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('documents-check: missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  // Extract query params
  const entityType = (req.query.entity_type || '').toLowerCase().trim();
  const entityId = (req.query.entity_id || '').trim();

  if (!entityType || !validateEntityType(entityType)) {
    context.log?.warn?.('documents-check: invalid entity_type', { entityType });
    return respond(context, 400, { 
      message: 'invalid_entity_type',
      details: 'entity_type must be: student, instructor, or organization'
    });
  }

  if (!entityId) {
    context.log?.warn?.('documents-check: missing entity_id', { entityType });
    return respond(context, 400, { 
      message: 'missing_entity_id',
      details: 'entity_id (student/instructor UUID or org_id) is required'
    });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    context.log?.warn?.('documents-check: missing bearer token');
    return respond(context, 401, { message: 'missing_bearer' });
  }

  const controlClient = createSupabaseAdminClient(adminConfig);

  // Validate token
  let authResult;
  try {
    authResult = await controlClient.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('documents-check: failed to validate token', { 
      message: error?.message 
    });
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    context.log?.warn?.('documents-check: token validation failed');
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  const userId = authResult.data.user.id;

  // For org documents, entityId IS the orgId. For student/instructor, derive orgId from context
  // We need to call ensureMembership to get the org and validate the user's role
  let orgId = entityType === 'organization' ? entityId : null;

  // Parse multipart data
  let parts;
  try {
    context.log?.info?.('📄 [DOCUMENTS-CHECK] Parsing multipart data', {
      contentType: req.headers['content-type']?.substring(0, 50),
    });
    parts = parseMultipartData(req);
    context.log?.info?.('📄 [DOCUMENTS-CHECK] Multipart parsing successful', { 
      partsCount: parts?.length || 0 
    });
  } catch (error) {
    context.log?.error?.('documents-check: failed to parse multipart', { 
      message: error?.message 
    });
    return respond(context, 400, { 
      message: 'invalid_multipart_data',
      error: error?.message 
    });
  }

  const filePart = parts.find(p => p.filename);
  if (!filePart) {
    context.log?.warn?.('documents-check: no file provided');
    return respond(context, 400, { message: 'no_file_provided' });
  }

  // If orgId not set (student/instructor), extract from multipart
  if (!orgId) {
    const orgIdPart = parts.find(p => p.name === 'org_id');
    if (!orgIdPart) {
      context.log?.warn?.('documents-check: missing org_id in body');
      return respond(context, 400, { message: 'missing_org_id' });
    }
    orgId = orgIdPart.data.toString('utf8').trim();
  }

  context.log?.info?.('📄 [DOCUMENTS-CHECK] Extracted parameters', {
    entityType,
    entityId: entityId.substring(0, 8) + '...',
    orgId: orgId.substring(0, 8) + '...',
    userId: userId.substring(0, 8) + '...',
  });

  // Verify membership and get role
  let role;
  try {
    role = await ensureMembership(controlClient, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('documents-check: failed to verify membership', {
      message: membershipError?.message,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role) {
    context.log?.warn?.('documents-check: user not a member', { orgId, userId });
    return respond(context, 403, { message: 'not_a_member' });
  }

  const isAdmin = role === 'admin' || role === 'owner';

  // Validate permissions for this entity type
  const hasPermission = await validateEntityPermissions(entityType, entityId, userId, isAdmin);
  if (!hasPermission) {
    context.log?.warn?.('documents-check: insufficient permissions', {
      entityType,
      entityId: entityId.substring(0, 8) + '...',
      userId: userId.substring(0, 8) + '...',
      isAdmin,
    });
    
    let message = 'forbidden';
    if (entityType === 'instructor') {
      message = 'can_only_check_own_files';
    } else if (entityType === 'organization') {
      message = 'admin_only';
    }
    
    return respond(context, 403, { message });
  }

  // Get tenant client
  const { client: tenantClient, error: tenantError } = await resolveTenantClient(
    context,
    controlClient,
    env,
    orgId
  );
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  // Calculate file hash
  const fileHash = calculateFileHash(filePart.data);
  context.log?.info?.('📄 [DOCUMENTS-CHECK] Hash calculated', { hash: fileHash });

  // Query Documents table for duplicates
  const { data: allDocuments, error: documentsError } = await tenantClient
    .from('Documents')
    .select('id, name, uploaded_at, entity_id, hash')
    .eq('entity_type', entityType)
    .eq('hash', fileHash);

  if (documentsError) {
    context.log?.error?.('documents-check: failed to query Documents table', { 
      message: documentsError.message,
      code: documentsError.code,
    });
    return respond(context, 500, { 
      message: 'failed_to_check_duplicates',
      error: documentsError.message,
    });
  }

  // Filter results based on permissions
  let filtersDocuments = allDocuments || [];
  if (entityType === 'instructor' && !isAdmin) {
    // Non-admin instructors only see their own duplicates
    filtersDocuments = filtersDocuments.filter(doc => doc.entity_id === userId);
  }
  if (entityType === 'organization') {
    // Organization duplicates are scoped to this org already (by entity_id filter above)
    // No additional filtering needed
  }

  // Build duplicates array with entity names
  const duplicates = [];
  if (filtersDocuments.length > 0) {
    const entityIds = [...new Set(filtersDocuments.map(doc => doc.entity_id))];
    const nameMap = await getEntityNames(tenantClient, entityType, entityIds);

    for (const doc of filtersDocuments) {
      const entityName = entityType === 'organization' 
        ? null // Org documents don't have a "name" for the org
        : (nameMap.get(doc.entity_id) || 'Unknown');
      
      duplicates.push({
        file_id: doc.id,
        file_name: doc.name,
        uploaded_at: doc.uploaded_at,
        entity_id: doc.entity_id,
        entity_name: entityName,
      });
    }
  }

  context.log?.info?.('📄 [DOCUMENTS-CHECK] Duplicate check completed', { 
    hash: fileHash.substring(0, 8) + '...',
    duplicatesFound: duplicates.length,
    entityType,
  });

  return respond(context, 200, {
    hash: fileHash,
    has_duplicates: duplicates.length > 0,
    duplicates,
  });
}
