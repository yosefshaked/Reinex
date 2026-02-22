/**
 * Unified Documents API - Polymorphic file management for students, instructors, organizations
 * Replaces: /api/student-files, /api/instructor-files, /api/org-documents
 * 
 * GET    /api/documents?entity_type=student&entity_id={uuid} - List documents
 * POST   /api/documents - Upload document with multipart form data
 * PUT    /api/documents/{id} - Update document metadata
 * DELETE /api/documents/{id} - Delete document
 */

import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { ensureMembership, resolveTenantClient, readEnv, respond } from '../_shared/org-bff.js';
import { resolveBearerAuthorization } from '../_shared/http.js';
import { logAuditEvent, AUDIT_ACTIONS, AUDIT_CATEGORIES } from '../_shared/audit-log.js';
import { decryptStorageProfile } from '../_shared/storage-encryption.js';
import multipart from 'parse-multipart-data';
import { createHash } from 'crypto';
import { getStorageDriver } from '../cross-platform/storage-drivers/index.js';

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Validate entity type and permissions
 * @param {string} operation - 'GET' | 'POST' | 'PUT' | 'DELETE'
 */
function validateEntityAccess(entityType, userRole, userId, entityId, isAdmin, operation = null) {
  if (!['student', 'instructor', 'organization'].includes(entityType)) {
    return { valid: false, error: 'invalid_entity_type' };
  }

  // Organization documents: admin/owner for upload/delete, members can view if visibility enabled
  if (entityType === 'organization') {
    // For POST/PUT/DELETE operations, require admin
    if (operation && ['POST', 'PUT', 'DELETE'].includes(operation)) {
      if (!isAdmin) {
        return { valid: false, error: 'admin_required' };
      }
    }
    // For GET, allow non-admins (visibility check happens in handler)
  }

  // Instructor documents: admin/owner can manage all, instructors only their own
  if (entityType === 'instructor') {
    if (!isAdmin && userId !== entityId) {
      return { valid: false, error: 'permission_denied' };
    }
  }

  // Student documents: all org members can view/upload (controlled via org membership check)

  return { valid: true };
}

/**
 * GET - List documents for an entity
 */
async function handleGet(req, supabase, tenantClient, orgId, userId, userRole, isAdmin) {
  const { entity_type, entity_id } = req.query;

  if (!entity_type || !entity_id) {
    return { status: 400, body: { error: 'entity_type and entity_id required' } };
  }

  const validation = validateEntityAccess(entity_type, userRole, userId, entity_id, isAdmin, 'GET');
  if (!validation.valid) {
    return { status: 403, body: { error: validation.error } };
  }

  // For organization documents, check member visibility setting if user is not admin
  if (entity_type === 'organization' && !isAdmin) {
    const { data: visibilitySetting } = await tenantClient
      .from('Settings')
      .select('settings_value')
      .eq('key', 'org_documents_member_visibility')
      .single();

    const memberVisibility = visibilitySetting?.settings_value === true;
    if (!memberVisibility) {
      return { status: 403, body: { error: 'members_cannot_view_org_documents' } };
    }
  }

  // Fetch documents from Documents table
  const { data: documents, error } = await tenantClient
    .from('Documents')
    .select('*')
    .eq('entity_type', entity_type)
    .eq('entity_id', entity_id)
    .order('uploaded_at', { ascending: false });

  if (error) {
    // Check if table doesn't exist
    if (error.message?.includes('relation') && error.message?.includes('does not exist')) {
      return { 
        status: 424, 
        body: { 
          error: 'documents_table_not_found', 
          message: 'Documents table does not exist. Please run the setup script.', 
          details: error.message,
          hint: 'Run setup-sql.js on the tenant database to create the Documents table'
        } 
      };
    }
    
    return { 
      status: 500, 
      body: { 
        error: 'fetch_failed', 
        message: error.message,
        details: error.details,
        code: error.code,
        hint: error.hint
      } 
    };
  }

  return { status: 200, body: { documents: documents || [] } };
}

/**
 * POST - Upload document
 */
async function handlePost(req, supabase, tenantClient, orgId, userId, userEmail, userRole, isAdmin, context, env, multipartParts = null) {
  const contentType = req.headers['content-type'] || '';
  const boundary = contentType.split('boundary=')[1];

  if (!boundary) {
    return { status: 400, body: { error: 'missing_boundary' } };
  }

  // Use pre-parsed parts if available, otherwise parse now
  let parts = multipartParts;
  if (!parts) {
    try {
      parts = multipart.parse(req.body, boundary);
    } catch (err) {
      console.error('Multipart parsing error:', err);
      return { status: 400, body: { error: 'parse_failed' } };
    }
  }

  // Extract metadata
  const entityTypePart = parts.find(p => p.name === 'entity_type');
  const entityIdPart = parts.find(p => p.name === 'entity_id');
  const fileParts = parts.filter(p => p.name === 'file' && p.filename); // Get ALL files
  const customNameParts = parts.filter(p => p.name === 'custom_name');
  const relevantDateParts = parts.filter(p => p.name === 'relevant_date');
  const expirationDateParts = parts.filter(p => p.name === 'expiration_date');
  const definitionIdParts = parts.filter(p => p.name === 'definition_id');

  if (!entityTypePart || !entityIdPart || fileParts.length === 0) {
    return { status: 400, body: { error: 'missing_required_fields' } };
  }

  const entityType = entityTypePart.data.toString('utf8');
  const entityId = entityIdPart.data.toString('utf8');

  // Validate permissions once (applies to all files)
  const validation = validateEntityAccess(entityType, userRole, userId, entityId, isAdmin, 'POST');
  if (!validation.valid) {
    return { status: 403, body: { error: validation.error } };
  }

  // Arrays to collect results
  const uploadedFiles = [];
  const errors = [];

  // Cache these lookups (fetch once, reuse for all files)
  let entityName = null;
  let storageProfile = null;
  let driver = null;

  // Process each file
  for (let i = 0; i < fileParts.length; i++) {
    const filePart = fileParts[i];
    const fileName = filePart.filename;
    
    try {
      // Validate file
      const fileBuffer = filePart.data;
      const fileType = filePart.type;

      if (fileBuffer.length > MAX_FILE_SIZE) {
        errors.push({ fileName, error: 'file_too_large', max_size: MAX_FILE_SIZE });
        continue;
      }

      if (!ALLOWED_MIME_TYPES.includes(fileType)) {
        errors.push({ fileName, error: 'unsupported_file_type', allowed_types: ALLOWED_MIME_TYPES });
        continue;
      }

      // Decode Hebrew filename
      let decodedFileName = fileName;
      try {
        // eslint-disable-next-line no-control-regex
        if (fileName.match(/[^\x00-\x7F]/)) {
          const latinBuffer = Buffer.from(fileName, 'latin1');
          decodedFileName = latinBuffer.toString('utf8');
        }
      } catch (err) {
        console.warn('Filename decoding failed, using original:', err);
      }

      // Extract per-file metadata (indexed to match file order)
      const customName = customNameParts[i] ? customNameParts[i].data.toString('utf8') : null;
      const relevantDate = relevantDateParts[i] ? relevantDateParts[i].data.toString('utf8') : null;
      const expirationDate = expirationDateParts[i] ? expirationDateParts[i].data.toString('utf8') : null;
      const definitionId = definitionIdParts[i] ? definitionIdParts[i].data.toString('utf8') : null;

      // Generate file hash
      const hash = createHash('md5').update(fileBuffer).digest('hex');

      // Get entity name for file naming (cache after first lookup)
      if (entityName === null) {
        if (entityType === 'student') {
          const { data: student, error: studentError } = await tenantClient.from('students').select('name').eq('id', entityId).single();
          if (studentError) {
            console.error('Failed to fetch student name:', { entityId, error: studentError.message });
          }
          entityName = student?.name || 'Unknown';
        } else if (entityType === 'instructor') {
          const { data: instructor, error: instructorError } = await tenantClient
            .from('Employees')
            .select('name, employee_type')
            .eq('id', entityId)
            .maybeSingle();
          if (instructorError) {
            console.error('Failed to fetch instructor name:', { entityId, error: instructorError.message });
          }
          if (!instructor || (instructor.employee_type && instructor.employee_type !== 'instructor')) {
            entityName = 'Unknown';
          } else {
            entityName = instructor?.name || 'Unknown';
          }
        } else {
          entityName = '';
        }
      }

      // Build final file name
      const ext = decodedFileName.split('.').pop();
      const baseNameWithoutExt = decodedFileName.substring(0, decodedFileName.lastIndexOf('.'));
      const baseName = customName || baseNameWithoutExt;
      const finalName = entityName ? `${baseName} - ${entityName}` : baseName;

      // Get definition name if applicable
      let definitionName = null;
      if (definitionId) {
        const settingsKey = entityType === 'instructor' ? 'instructor_document_definitions' : 'document_definitions';
        const { data: settingsRow } = await tenantClient
          .from('Settings')
          .select('settings_value')
          .eq('key', settingsKey)
          .single();

        if (settingsRow?.settings_value) {
          const definitions = Array.isArray(settingsRow.settings_value) ? settingsRow.settings_value : [];
          const definition = definitions.find(d => d.id === definitionId);
          if (definition) {
            definitionName = definition.name;
          }
        }
      }

      // Load storage profile (cache after first lookup)
      if (storageProfile === null) {
        const { data: orgSettings } = await supabase
          .from('org_settings')
          .select('storage_profile')
          .eq('org_id', orgId)
          .single();

        if (!orgSettings?.storage_profile) {
          errors.push({ fileName, error: 'storage_not_configured' });
          continue;
        }

        storageProfile = orgSettings.storage_profile;

        // Decrypt BYOS credentials if needed
        storageProfile = decryptStorageProfile(storageProfile, env);

        // Check if storage is disconnected
        if (storageProfile.disconnected) {
          errors.push({ fileName, error: 'storage_disconnected' });
          continue;
        }

        // Initialize storage driver
        try {
          if (storageProfile.mode === 'managed') {
            driver = getStorageDriver('managed', null, env);
          } else if (storageProfile.mode === 'byos') {
            driver = getStorageDriver('byos', storageProfile.byos, env);
          } else {
            throw new Error(`Invalid storage mode: ${storageProfile.mode}`);
          }
        } catch (err) {
          console.error('Storage driver initialization error:', err);
          errors.push({ fileName, error: 'storage_init_failed' });
          continue;
        }
      }

      // Build storage path (temporary for now, will update after DB insert)
      const tempDocRecord = {
        entity_type: entityType,
        entity_id: entityId,
        name: finalName,
        original_name: decodedFileName,
        relevant_date: relevantDate || null,
        expiration_date: expirationDate || null,
        resolved: false,
        url: null,
        path: 'temp', // Will update after we get the ID
        storage_provider: storageProfile.mode,
        uploaded_at: new Date().toISOString(),
        uploaded_by: userId,
        definition_id: definitionId || null,
        definition_name: definitionName,
        size: fileBuffer.length,
        type: fileType,
        hash,
        metadata: null
      };

      // Insert into Documents table first to get auto-generated UUID
      const { data: insertedDoc, error: insertError } = await tenantClient
        .from('Documents')
        .insert([tempDocRecord])
        .select()
        .single();

      if (insertError || !insertedDoc) {
        console.error('Document insert error:', insertError);
        errors.push({ fileName, error: 'insert_failed', details: insertError?.message });
        continue;
      }

      const fileId = insertedDoc.id;

      // Now build the correct storage path with the real ID
      let storagePath;
      if (storageProfile.mode === 'managed') {
        storagePath = `managed/${orgId}/${entityType}s/${entityId}/${fileId}.${ext}`;
      } else {
        storagePath = `${entityType}s/${orgId}/${entityId}/${fileId}.${ext}`;
      }

      // Upload to storage
      let uploadResult;
      try {
        uploadResult = await driver.upload(storagePath, fileBuffer, fileType);
      } catch (err) {
        console.error('Storage upload error:', err);
        // Rollback: delete the document record
        await tenantClient.from('Documents').delete().eq('id', fileId);
        errors.push({ fileName, error: 'upload_failed', details: err.message });
        continue;
      }

      // Update the document with the correct path and URL
      const { error: updateError } = await tenantClient
        .from('Documents')
        .update({ 
          path: storagePath,
          url: uploadResult.url 
        })
        .eq('id', fileId);

      if (updateError) {
        console.error('Document path update error:', updateError);
        // Try to clean up storage
        try {
          await driver.delete(storagePath);
        } catch (cleanupErr) {
          console.error('Cleanup error after failed path update:', cleanupErr);
        }
        await tenantClient.from('Documents').delete().eq('id', fileId);
        errors.push({ fileName, error: 'path_update_failed', details: updateError.message });
        continue;
      }

      // Audit log
      await logAuditEvent(supabase, {
        orgId,
        userId,
        userEmail,
        userRole,
        actionType: AUDIT_ACTIONS.FILE_UPLOADED,
        actionCategory: AUDIT_CATEGORIES.FILES,
        resourceType: `${entityType}_file`,
        resourceId: fileId,
        details: {
          entity_type: entityType,
          entity_id: entityId,
          file_name: finalName,
          file_size: fileBuffer.length,
          storage_mode: storageProfile.mode
        }
      });

      // Add to successful uploads
      uploadedFiles.push({
        id: fileId,
        name: finalName,
        original_name: decodedFileName,
        relevant_date: relevantDate,
        expiration_date: expirationDate,
        url: uploadResult.url,
        path: storagePath,
        storage_provider: storageProfile.mode,
        uploaded_at: tempDocRecord.uploaded_at,
        uploaded_by: userId,
        definition_id: definitionId,
        definition_name: definitionName,
        size: fileBuffer.length,
        type: fileType,
        hash
      });

    } catch (err) {
      console.error(`Error processing file ${fileName}:`, err);
      errors.push({ fileName, error: 'processing_failed', details: err.message });
    }
  }

  // Return multi-status response with summary
  return {
    status: 207, // Multi-Status
    body: {
      files: uploadedFiles,
      errors,
      summary: {
        total: fileParts.length,
        uploaded: uploadedFiles.length,
        failed: errors.length
      }
    }
  };
}

/**
 * PUT - Update document metadata
 */
async function handlePut(req, supabase, tenantClient, orgId, userId, userEmail, userRole, isAdmin) {
  let documentId = req.params?.id;
  
  // Fallback: extract from URL if params not populated
  if (!documentId && req.url) {
    const match = req.url.match(/\/documents\/([a-f0-9-]+)/i);
    if (match) {
      documentId = match[1];
    }
  }
  
  if (!documentId) {
    console.error('[ERROR] handlePut: document_id missing', {
      hasParams: !!req.params,
      paramsId: req.params?.id,
      url: req.url
    });
    return { status: 400, body: { error: 'document_id_required' } };
  }

  const { name, relevant_date, expiration_date, resolved } = req.body;

  // Fetch existing document
  const { data: existingDoc, error: fetchError } = await tenantClient
    .from('Documents')
    .select('*')
    .eq('id', documentId)
    .single();

  if (fetchError || !existingDoc) {
    return { status: 404, body: { error: 'document_not_found' } };
  }

  // Validate permissions
  const validation = validateEntityAccess(existingDoc.entity_type, userRole, userId, existingDoc.entity_id, isAdmin, 'DELETE');
  if (!validation.valid) {
    return { status: 403, body: { error: validation.error } };
  }

  // Build update payload
  const updates = {};
  const updatedFields = [];

  if (name !== undefined && name !== existingDoc.name) {
    // eslint-disable-next-line no-restricted-syntax
    updates.name = name;
    updatedFields.push('name');
  }
  if (relevant_date !== undefined && relevant_date !== existingDoc.relevant_date) {
    updates.relevant_date = relevant_date || null;
    updatedFields.push('relevant_date');
  }
  if (expiration_date !== undefined && expiration_date !== existingDoc.expiration_date) {
    updates.expiration_date = expiration_date || null;
    updatedFields.push('expiration_date');
  }
  if (resolved !== undefined && resolved !== existingDoc.resolved) {
    updates.resolved = resolved;
    updatedFields.push('resolved');
  }

  if (Object.keys(updates).length === 0) {
    return { status: 200, body: { message: 'no_changes' } };
  }

  updates.updated_at = new Date().toISOString();

  // Update document
  const { error: updateError } = await tenantClient
    .from('Documents')
    .update(updates)
    .eq('id', documentId);

  if (updateError) {
    console.error('Document update error:', updateError);
    return { status: 500, body: { error: 'update_failed', details: updateError.message } };
  }

  // Audit log
  console.log('[DEBUG] Preparing audit log for document update', {
    hasOrgId: !!orgId,
    hasUserId: !!userId,
    hasUserEmail: !!userEmail,
    hasUserRole: !!userRole,
    orgId,
    userId,
    userEmail,
    userRole
  });
  
  await logAuditEvent(supabase, {
    orgId,
    userId,
    userEmail,
    userRole,
    actionType: AUDIT_ACTIONS.DOCUMENT_UPDATED,
    actionCategory: AUDIT_CATEGORIES.FILES,
    resourceType: `${existingDoc.entity_type}_file`,
    resourceId: documentId,
    details: {
      entity_type: existingDoc.entity_type,
      entity_id: existingDoc.entity_id,
      file_name: existingDoc.name,
      updated_fields: updatedFields
    }
  });

  return { status: 200, body: { message: 'updated', updated_fields: updatedFields } };
}

/**
 * DELETE - Remove document
 */
async function handleDelete(req, supabase, tenantClient, orgId, userId, userEmail, userRole, isAdmin, env) {
  let documentId = req.params?.id;
  
  // Fallback: extract from URL if params not populated
  if (!documentId && req.url) {
    const match = req.url.match(/\/documents\/([a-f0-9-]+)/i);
    if (match) {
      documentId = match[1];
    }
  }
  
  if (!documentId) {
    console.error('[ERROR] handleDelete: document_id missing', {
      hasParams: !!req.params,
      paramsId: req.params?.id,
      url: req.url
    });
    return { status: 400, body: { error: 'document_id_required' } };
  }

  console.log('[DEBUG] handleDelete: Processing deletion');

  // Fetch existing document
  const { data: existingDoc, error: fetchError } = await tenantClient
    .from('Documents')
    .select('*')
    .eq('id', documentId)
    .single();

  if (fetchError || !existingDoc) {
    return { status: 404, body: { error: 'document_not_found' } };
  }

  // Validate permissions (instructors cannot delete their own files)
  if (existingDoc.entity_type === 'instructor' && !isAdmin) {
    return { status: 403, body: { error: 'admin_required' } };
  }

  const validation = validateEntityAccess(existingDoc.entity_type, userRole, userId, existingDoc.entity_id, isAdmin);
  if (!validation.valid) {
    return { status: 403, body: { error: validation.error } };
  }

  // Load storage profile
  const { data: orgSettings } = await supabase
    .from('org_settings')
    .select('storage_profile')
    .eq('org_id', orgId)
    .single();

  if (!orgSettings?.storage_profile) {
    return { status: 424, body: { error: 'storage_not_configured' } };
  }

  let storageProfile = orgSettings.storage_profile;

  // Decrypt BYOS credentials if needed
  storageProfile = decryptStorageProfile(storageProfile, env);

  // Initialize storage driver
  let driver;
  try {
    if (storageProfile.mode === 'managed') {
      driver = getStorageDriver('managed', null, env);
    } else if (storageProfile.mode === 'byos') {
      driver = getStorageDriver('byos', storageProfile.byos, env);
    } else {
      throw new Error(`Invalid storage mode: ${storageProfile.mode}`);
    }
  } catch (err) {
    console.error('Storage driver initialization error:', err);
    return { status: 500, body: { error: 'storage_init_failed' } };
  }

  // Delete from storage
  try {
    await driver.delete(existingDoc.path);
  } catch (err) {
    console.error('Storage deletion error:', err);
    // Continue with database deletion even if storage fails
  }

  // Delete from Documents table
  const { error: deleteError } = await tenantClient
    .from('Documents')
    .delete()
    .eq('id', documentId);

  if (deleteError) {
    console.error('Document deletion error:', deleteError);
    return { status: 500, body: { error: 'delete_failed', details: deleteError.message } };
  }

  // Audit log
  await logAuditEvent(supabase, {
    orgId,
    userId,
    userEmail,
    userRole,
    actionType: AUDIT_ACTIONS.FILE_DELETED,
    actionCategory: AUDIT_CATEGORIES.FILES,
    resourceType: `${existingDoc.entity_type}_file`,
    resourceId: documentId,
    details: {
      entity_type: existingDoc.entity_type,
      entity_id: existingDoc.entity_id,
      file_name: existingDoc.name,
      file_size: existingDoc.size,
      storage_mode: storageProfile.mode
    }
  });

  return { status: 200, body: { message: 'deleted' } };
}

export default async function handler(context, req) {
  try {
    const method = req.method;

    // Parse JSON body for PUT/DELETE requests
    if ((method === 'PUT' || method === 'DELETE') && req.body) {
      try {
        // Only parse if body is a Buffer (not already parsed)
        if (Buffer.isBuffer(req.body)) {
          const bodyText = req.body.toString('utf8');
          req.body = bodyText ? JSON.parse(bodyText) : {};
        } else if (typeof req.body === 'string') {
          req.body = req.body ? JSON.parse(req.body) : {};
        }
      } catch (err) {
        console.error('Failed to parse JSON body:', err.message);
        return respond(context, 400, { error: 'invalid_json_body', details: err.message });
      }
    }

    // Read environment and create Supabase admin client
    const env = readEnv(context);
    const adminConfig = readSupabaseAdminConfig(env);

    if (!adminConfig?.supabaseUrl || !adminConfig?.serviceRoleKey) {
      const errorDetails = {
        hasUrl: !!adminConfig?.supabaseUrl,
        hasKey: !!adminConfig?.serviceRoleKey,
        urlPrefix: adminConfig?.supabaseUrl?.substring(0, 30) || 'null',
        keyPrefix: adminConfig?.serviceRoleKey?.substring(0, 10) || 'null'
      };
      console.error('[ERROR] Missing Supabase admin credentials', errorDetails);
      context.log?.error?.('documents missing Supabase admin credentials', errorDetails);
      return respond(context, 500, { error: 'server_misconfigured', message: 'Missing Supabase credentials', debug: errorDetails });
    }

    // Auth check
    const supabase = createSupabaseAdminClient(adminConfig);

    const authorization = resolveBearerAuthorization(req);
    if (!authorization?.token) {
      return respond(context, 401, { error: 'missing_auth' });
    }

    const token = authorization.token;
    
    let authResult;
    try {
      authResult = await supabase.auth.getUser(token);
    } catch (err) {
      console.error('Token verification threw exception:', err.message);
      return respond(context, 401, { error: 'invalid_token', details: err.message });
    }
    
    if (authResult.error || !authResult?.data?.user?.id) {
      return respond(context, 401, { error: 'invalid_token', details: authResult.error?.message });
    }

    const userId = authResult.data.user.id;
    const userEmail = authResult.data.user.email;
    
    // Validate email exists (required for audit logging)
    if (!userEmail) {
      console.error('[ERROR] User email missing from auth token', {
        userId,
        userHasEmail: 'email' in authResult.data.user,
        emailValue: authResult.data.user.email,
        emailType: typeof authResult.data.user.email,
        userKeys: Object.keys(authResult.data.user),
        fullUserObject: JSON.stringify(authResult.data.user, null, 2)
      });
      return respond(context, 401, { 
        error: 'invalid_token', 
        details: 'User email required for audit logging' 
      });
    }

    // Determine org from query or body
    let orgId = req.query?.org_id;
    let multipartParts = null; // Store parsed parts to avoid double-parsing
    
    // For POST with multipart data, extract org_id from form data
    if (method === 'POST') {
      try {
        const contentType = req.headers['content-type'] || '';
        const boundary = contentType.split('boundary=')[1];
        
        if (boundary) {
          multipartParts = multipart.parse(req.body, boundary);
          const orgIdPart = multipartParts.find(p => p.name === 'org_id');
          
          if (orgIdPart) {
            orgId = orgIdPart.data.toString('utf8');
          }
        }
      } catch (err) {
        console.error('Failed to parse multipart data for org_id extraction:', err.message);
      }
    }

    if (!orgId) {
      return respond(context, 400, { error: 'org_id_required' });
    }

    // Step 7: Verify membership
    let role;
    try {
      role = await ensureMembership(supabase, orgId, userId);
    } catch (membershipError) {
      console.error('Membership check failed:', membershipError.message);
      context.log?.error?.('documents failed to verify membership', {
        message: membershipError?.message,
        orgId,
        userId,
      });
      return respond(context, 500, { error: 'failed_to_verify_membership', details: membershipError?.message });
    }

    if (!role) {
      console.warn('[WARN] User is not a member of organization', { orgId, userId });
      return respond(context, 403, { error: 'not_member' });
    }

    const userRole = role;
    const isAdmin = ['admin', 'owner'].includes(userRole);

    // Step 8: Get tenant client
    const tenantResult = await resolveTenantClient(context, supabase, env, orgId);
    if (tenantResult.error) {
      console.error('Tenant client resolution failed:', tenantResult.error);
      return respond(context, 424, { error: 'tenant_not_configured', details: tenantResult.error });
    }
    const tenantClient = tenantResult.client;

    // Route to handler
    let result;
    if (method === 'GET') {
      result = await handleGet(req, supabase, tenantClient, orgId, userId, userRole, isAdmin);
    } else if (method === 'POST') {
      result = await handlePost(req, supabase, tenantClient, orgId, userId, userEmail, userRole, isAdmin, context, env, multipartParts);
    } else if (method === 'PUT') {
      result = await handlePut(req, supabase, tenantClient, orgId, userId, userEmail, userRole, isAdmin);
    } else if (method === 'DELETE') {
      result = await handleDelete(req, supabase, tenantClient, orgId, userId, userEmail, userRole, isAdmin, env);
    } else {
      return respond(context, 405, { error: 'method_not_allowed' });
    }
    
    return respond(context, result.status, result.body);
  } catch (error) {
    console.error('Unhandled error in documents API:', error);
    context.log?.error?.('Documents API crashed:', error);
    return respond(context, 500, { 
      error: 'internal_server_error', 
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
