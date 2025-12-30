/* eslint-env node */
/**
 * Bulk File Download API
 * 
 * Downloads all files for an organization as a ZIP archive.
 * Useful for migration or backup before disconnecting storage.
 * 
 * POST /api/storage-bulk-download
 */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  ensureMembership,
  isAdminRole,
  parseRequestBody,
  readEnv,
  respond,
  resolveOrgId,
  resolveTenantClient,
} from '../_shared/org-bff.js';
import { getStorageDriver } from '../cross-platform/storage-drivers/index.js';
import { logAuditEvent, AUDIT_ACTIONS, AUDIT_CATEGORIES } from '../_shared/audit-log.js';
import { decryptStorageProfile } from '../_shared/storage-encryption.js';
import archiver from 'archiver';

export default async function (context, req) {
  context.log('storage-bulk-download: function started');

  if (req.method !== 'POST') {
    return respond(context, 405, { message: 'method_not_allowed' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);
  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log.error('storage-bulk-download missing Supabase admin credentials');
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
    context.log.error('storage-bulk-download failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  const userId = authResult.data.user.id;
  const userEmail = authResult.data.user.email;
  const body = parseRequestBody(req);
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid_org_id' });
  }

  // Verify membership and admin role
  let role;
  try {
    role = await ensureMembership(controlClient, orgId, userId);
  } catch (membershipError) {
    context.log.error('storage-bulk-download failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role) {
    return respond(context, 403, { message: 'not_a_member' });
  }

  if (!isAdminRole(role)) {
    return respond(context, 403, { message: 'admin_or_owner_required' });
  }

  // Get storage profile
  const { data: orgSettings, error: settingsError } = await controlClient
    .from('org_settings')
    .select('storage_profile, permissions')
    .eq('org_id', orgId)
    .maybeSingle();

  if (settingsError) {
    context.log.error('Failed to load storage profile', { message: settingsError.message });
    return respond(context, 500, { message: 'failed_to_load_storage_profile' });
  }

  const storageProfile = orgSettings?.storage_profile;
  if (!storageProfile || !storageProfile.mode) {
    return respond(context, 400, { message: 'storage_not_configured' });
  }

  // Decrypt BYOS credentials if present
  const decryptedProfile = decryptStorageProfile(storageProfile, env);

  // Handle disconnected storage - allow bulk download during grace period for migration
  if (decryptedProfile.disconnected === true && decryptedProfile.mode === 'managed') {
    const accessLevel = orgSettings?.permissions?.storage_access_level;
    if (accessLevel !== 'read_only_grace') {
      return respond(context, 403, { 
        message: 'storage_disconnected',
        details: 'Storage is disconnected and grace period has ended. Files are no longer available.'
      });
    }
  }
  // BYOS bulk download always allowed (user owns storage)

  // Get tenant client to fetch all student files
  const { client: tenantClient, error: tenantError } = await resolveTenantClient(
    context,
    controlClient,
    env,
    orgId
  );

  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  // Fetch all students
  const { data: students, error: studentsError } = await tenantClient
    .from('Students')
    .select('id, name');

  if (studentsError) {
    context.log.error('Failed to fetch students', { message: studentsError.message });
    return respond(context, 500, { message: 'failed_to_fetch_students' });
  }

  // Fetch all student documents from Documents table
  const { data: documents, error: documentsError } = await tenantClient
    .from('Documents')
    .select('*')
    .eq('entity_type', 'student');

  if (documentsError) {
    context.log.error('Failed to fetch documents', { message: documentsError.message });
    return respond(context, 500, { message: 'failed_to_fetch_documents' });
  }

  // Collect all files with student names
  const allFiles = [];
  for (const doc of documents || []) {
    const student = students.find(s => s.id === doc.entity_id);
    allFiles.push({
      ...doc,
      student_id: doc.entity_id,
      student_name: student?.name || 'Unknown',
    });
  }

  if (allFiles.length === 0) {
    return respond(context, 200, { 
      message: 'no_files_to_download',
      file_count: 0 
    });
  }

  context.log(`Found ${allFiles.length} files to download`);

  // Get storage driver
  let driver;
  try {
    if (decryptedProfile.mode === 'managed') {
      driver = getStorageDriver('managed', {}, env);
    } else if (decryptedProfile.mode === 'byos') {
      driver = getStorageDriver('byos', decryptedProfile.byos, env);
    } else {
      throw new Error(`Unknown storage mode: ${storageProfile.mode}`);
    }
  } catch (driverError) {
    context.log.error('Failed to create storage driver', { message: driverError?.message });
    return respond(context, 500, { 
      message: 'storage_driver_error', 
      details: driverError.message 
    });
  }

  // Create ZIP archive in memory
  const archive = archiver('zip', {
    zlib: { level: 6 } // Compression level (0-9)
  });

  const chunks = [];
  archive.on('data', (chunk) => chunks.push(chunk));
  archive.on('error', (err) => {
    context.log.error('Archive error', { message: err.message });
  });

  // Download each file and add to ZIP
  let successCount = 0;
  let failureCount = 0;

  for (const file of allFiles) {
    try {
      // Download file from storage
      const fileBuffer = await driver.getFile(file.path);
      
      // Add file to archive with student name in path
      const safeStudentName = file.student_name.replace(/[/\\?%*:|"<>]/g, '-');
      const archivePath = `${safeStudentName}/${file.original_name || file.name}`;
      
      archive.append(fileBuffer, { name: archivePath });
      
      context.log(`Added file to archive: ${archivePath} (${file.size || fileBuffer.length} bytes)`);
      successCount++;
    } catch (fileError) {
      context.log.error('Failed to download file', {
        fileId: file.id,
        path: file.path,
        error: fileError.message,
      });
      failureCount++;
    }
  }

  // Finalize archive
  await archive.finalize();

  const zipBuffer = Buffer.concat(chunks);

  // Log audit event
  try {
    await logAuditEvent(controlClient, {
      orgId,
      userId,
      userEmail,
      userRole: role,
      actionType: AUDIT_ACTIONS.STORAGE_BULK_DOWNLOAD,
      actionCategory: AUDIT_CATEGORIES.STORAGE,
      resourceType: 'files',
      resourceId: orgId,
      details: {
        total_files: allFiles.length,
        successful: successCount,
        failed: failureCount,
        storage_mode: storageProfile.mode,
        zip_size_bytes: zipBuffer.length,
      },
    });
  } catch (auditError) {
    context.log.error('Failed to log audit event', { message: auditError.message });
  }

  context.log('Bulk download completed', {
    totalFiles: allFiles.length,
    successful: successCount,
    failed: failureCount,
    zipSizeBytes: zipBuffer.length,
  });

  // Return ZIP file
  context.res = {
    status: 200,
    body: zipBuffer,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="organization-files-${orgId}.zip"`,
      'Content-Length': zipBuffer.length.toString(),
    },
  };
}
