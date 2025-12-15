/**
 * Unified Documents Download API - Generate download URLs for documents
 * Replaces: /api/student-files-download, /api/instructor-files-download, /api/org-documents-download
 * 
 * GET /api/documents-download?document_id={uuid}&org_id={uuid}&preview={true|false}
 * 
 * Query Parameters:
 * - document_id: Document ID (required)
 * - org_id: Organization ID (required)
 * - preview: If true, returns URL with inline disposition (opens in browser).
 *            If false, returns URL with attachment disposition (downloads file).
 *            Default: false
 */

import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { ensureMembership, resolveTenantClient, readEnv, respond } from '../_shared/org-bff.js';
import { getStorageDriver } from '../cross-platform/storage-drivers/index.js';
import { resolveBearerAuthorization } from '../_shared/http.js';
import { decryptStorageProfile } from '../_shared/storage-encryption.js';

export default async function handler(context, req) {
  context.log?.info?.('[DOCUMENTS-DOWNLOAD] Request started', {
    method: req.method,
    url: req.url,
    query: req.query,
    headers: Object.keys(req.headers || {})
  });

  try {
    if (req.method !== 'GET') {
      return respond(context, 405, { error: 'method_not_allowed' });
    }

    const { document_id, org_id, preview } = req.query;
    const isPreview = preview === 'true';

    context.log?.info?.('[DOCUMENTS-DOWNLOAD] Parsed parameters', {
      document_id,
      org_id,
      preview,
      isPreview
    });

    if (!document_id || !org_id) {
      return respond(context, 400, { error: 'document_id and org_id required' });
    }

    // Read environment and create Supabase admin client
    const env = readEnv(context);
    const adminConfig = readSupabaseAdminConfig(env);

    if (!adminConfig?.supabaseUrl || !adminConfig?.serviceRoleKey) {
      context.log?.error?.('documents-download missing Supabase admin credentials');
      return respond(context, 500, { error: 'server_misconfigured' });
    }

    // Auth check
    const supabase = createSupabaseAdminClient(adminConfig);
    const authorization = resolveBearerAuthorization(req);
    if (!authorization?.token) {
      return respond(context, 401, { error: 'missing_auth' });
    }

    const token = authorization.token;
    const authResult = await supabase.auth.getUser(token);
    if (authResult.error || !authResult.data?.user?.id) {
      return respond(context, 401, { error: 'invalid_token' });
    }

    const userId = authResult.data.user.id;

    // Membership check
    let role;
    try {
      role = await ensureMembership(supabase, org_id, userId);
    } catch (membershipError) {
      context.log?.error?.('documents-download failed to verify membership', {
        message: membershipError?.message,
        org_id,
        userId,
      });
      return respond(context, 500, { error: 'failed_to_verify_membership' });
    }

    if (!role) {
      return respond(context, 403, { error: 'not_member' });
    }

    const userRole = role;
    const isAdmin = ['admin', 'owner'].includes(userRole);

    // Get tenant client
    const tenantResult = await resolveTenantClient(context, supabase, env, org_id);
    if (tenantResult.error) {
      return respond(context, 424, { error: 'tenant_not_configured', details: tenantResult.error });
    }
    const tenantClient = tenantResult.client;

    // Get storage profile
    const { data: orgSettings, error: orgSettingsError } = await supabase
      .from('org_settings')
      .select('storage_profile')
      .eq('org_id', org_id)
      .single();

    if (orgSettingsError || !orgSettings) {
      context.log?.error?.('documents-download failed to fetch org settings', {
        error: orgSettingsError?.message,
        org_id
      });
      return respond(context, 424, { error: 'org_settings_not_found' });
    }

    // Fetch document
    context.log?.info?.('[DOCUMENTS-DOWNLOAD] Fetching document from Documents table', {
      document_id,
      table: 'Documents',
      schema: 'tuttiud'
    });

    const { data: document, error: fetchError } = await tenantClient
      .from('Documents')
      .select('*')
      .eq('id', document_id)
      .single();

    context.log?.info?.('[DOCUMENTS-DOWNLOAD] Document fetch result', {
      found: !!document,
      hasError: !!fetchError,
      errorMessage: fetchError?.message,
      errorCode: fetchError?.code,
      documentData: document ? {
        id: document.id,
        entity_type: document.entity_type,
        entity_id: document.entity_id,
        name: document.name,
        path: document.path,
        storage_provider: document.storage_provider
      } : null
    });

    if (fetchError || !document) {
      context.log?.error?.('[DOCUMENTS-DOWNLOAD] Document not found', {
        document_id,
        fetchError: fetchError?.message
      });
      return respond(context, 404, { error: 'document_not_found' });
    }

    // Permission validation
    if (document.entity_type === 'organization' && !isAdmin) {
      // Check org_documents_member_visibility setting (stored as bare boolean)
      const { data: visibilitySetting } = await tenantClient
        .from('Settings')
        .select('settings_value')
        .eq('key', 'org_documents_member_visibility')
        .single();

      const memberVisibility = visibilitySetting?.settings_value === true;
      if (!memberVisibility) {
        return respond(context, 403, { error: 'members_cannot_view_org_documents' });
      }
    }

    if (document.entity_type === 'instructor' && !isAdmin && userId !== document.entity_id) {
      return respond(context, 403, { error: 'permission_denied' });
    }

    // Load storage profile
    const storageProfile = orgSettings.storage_profile;
    context.log?.info?.('[DOCUMENTS-DOWNLOAD] Storage profile loaded', {
      hasProfile: !!storageProfile,
      mode: storageProfile?.mode,
      provider: storageProfile?.byos?.provider,
      hasCredentials: !!storageProfile?.byos?._encrypted
    });

    if (!storageProfile || !storageProfile.mode) {
      context.log?.error?.('[DOCUMENTS-DOWNLOAD] Storage not configured');
      return respond(context, 424, { error: 'storage_not_configured' });
    }

    // Decrypt BYOS credentials if present
    const decryptedProfile = decryptStorageProfile(storageProfile, env);
    context.log?.info?.('[DOCUMENTS-DOWNLOAD] Profile decrypted', {
      mode: decryptedProfile.mode,
      hasDecryptedCredentials: decryptedProfile.mode === 'byos' && !!decryptedProfile.byos?.access_key_id
    });

    // Prepare display filename
    const downloadFilename = document.name;
    const hasExtension = /\.[^.]+$/.test(downloadFilename);
    
    let finalFilename = downloadFilename;
    if (!hasExtension && document.original_name) {
      // Extract extension from original filename
      const extensionMatch = document.original_name.match(/\.[^.]+$/);
      if (extensionMatch) {
        finalFilename = downloadFilename + extensionMatch[0];
      }
    } else if (!hasExtension && document.path) {
      // Fallback: extract from storage path
      const extensionMatch = document.path.match(/\.[^.]+$/);
      if (extensionMatch) {
        finalFilename = downloadFilename + extensionMatch[0];
      }
    }

    context.log?.info?.('[DOCUMENTS-DOWNLOAD] Filename prepared', {
      originalName: document.name,
      finalFilename,
      hasExtension,
      path: document.path
    });

    // Determine Content-Disposition: inline for preview, attachment for download
    const dispositionType = isPreview ? 'inline' : 'attachment';

    context.log?.info?.('[DOCUMENTS-DOWNLOAD] About to generate URL', {
      mode: decryptedProfile.mode,
      path: document.path,
      filename: finalFilename,
      dispositionType,
      expiresIn: 3600
    });

    // Get storage driver and generate download URL
    let downloadUrl;
    try {
      let driver;
      if (decryptedProfile.mode === 'managed') {
        driver = getStorageDriver('managed', null, env);
      } else if (decryptedProfile.mode === 'byos') {
        if (!decryptedProfile.byos) {
          return respond(context, 400, { error: 'byos_config_missing' });
        }
        driver = getStorageDriver('byos', decryptedProfile.byos, env);
      } else {
        return respond(context, 400, { error: 'invalid_storage_mode' });
      }

      // Driver handles URL generation (public URL if configured, presigned otherwise)
      downloadUrl = await driver.getDownloadUrl(document.path, 3600, finalFilename, dispositionType);
      
      context.log?.info?.('Generated download URL via driver', { 
        mode: decryptedProfile.mode,
        dispositionType,
        expiresIn: 3600 
      });
    } catch (driverError) {
      context.log?.error?.('Failed to generate download URL', { 
        message: driverError?.message,
        mode: decryptedProfile.mode
      });
      return respond(context, 500, { 
        error: 'failed_to_generate_download_url', 
        details: driverError.message 
      });
    }

    context.log?.info?.('Document download URL generated', {
      documentId: document_id,
      orgId: org_id,
      entityType: document.entity_type,
      filename: finalFilename,
      mode: decryptedProfile.mode,
      dispositionType,
      isPreview,
    });

    return respond(context, 200, { 
      url: downloadUrl,
      contentType: document.type || 'application/octet-stream'
    });
  } catch (error) {
    context.log?.error?.('documents-download unhandled exception', {
      message: error.message,
      stack: error.stack
    });
    return respond(context, 500, { 
      error: 'internal_error', 
      details: error.message,
      type: error.name 
    });
  }
}
