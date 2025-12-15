/* eslint-env node */
/**
 * Audit Logging Utilities
 * 
 * Centralized helpers for logging admin and system actions to the audit log.
 * Required for legal compliance and dispute resolution.
 */

/**
 * Log an audit event to the control database
 * 
 * @param {Object} supabaseClient - Supabase admin client (control DB)
 * @param {Object} params - Audit event parameters
 * @param {string} params.orgId - Organization ID
 * @param {string} params.userId - User ID who performed the action
 * @param {string} params.userEmail - User email
 * @param {string} params.userRole - User role ('system_admin', 'owner', 'admin', 'member')
 * @param {string} params.actionType - Action type (e.g., 'storage.grace_period_started')
 * @param {string} params.actionCategory - Action category (e.g., 'storage', 'backup', 'permissions')
 * @param {string} [params.resourceType] - Resource type (e.g., 'storage_profile', 'files')
 * @param {string} [params.resourceId] - Resource ID
 * @param {Object} [params.details] - Structured details about the action
 * @param {Object} [params.metadata] - Additional context (IP, user agent, etc.)
 * @returns {Promise<string>} Log entry ID
 */
export async function logAuditEvent(supabaseClient, params) {
  const {
    orgId,
    userId,
    userEmail,
    userRole,
    actionType,
    actionCategory,
    resourceType = null,
    resourceId = null,
    details = null,
    metadata = null,
  } = params;

  if (!orgId || !userId || !userEmail || !userRole || !actionType || !actionCategory) {
    throw new Error('Missing required audit log parameters');
  }

  // Use the RPC function for logging
  const { data, error } = await supabaseClient.rpc('log_audit_event', {
    p_org_id: orgId,
    p_user_id: userId,
    p_user_email: userEmail,
    p_user_role: userRole,
    p_action_type: actionType,
    p_action_category: actionCategory,
    p_resource_type: resourceType,
    p_resource_id: resourceId,
    p_details: details,
    p_metadata: metadata,
  });

  if (error) {
    // Log the error but don't fail the request
    console.error('Failed to log audit event', {
      actionType,
      error: error.message,
    });
    return null;
  }

  return data;
}

/**
 * Common action types for consistency
 */
export const AUDIT_ACTIONS = {
  // Storage
  STORAGE_CONFIGURED: 'storage.configured',
  STORAGE_UPDATED: 'storage.updated',
  STORAGE_DISCONNECTED: 'storage.disconnected',
  STORAGE_RECONNECTED: 'storage.reconnected',
  STORAGE_GRACE_STARTED: 'storage.grace_period_started',
  STORAGE_FILES_DELETED: 'storage.files_deleted',
  STORAGE_MIGRATED_BYOS: 'storage.migrated_to_byos',
  STORAGE_BULK_DOWNLOAD: 'storage.bulk_download',
  
  // Permissions
  PERMISSION_ENABLED: 'permission.enabled',
  PERMISSION_DISABLED: 'permission.disabled',
  
  // Membership
  MEMBER_INVITED: 'member.invited',
  MEMBER_REMOVED: 'member.removed',
  MEMBER_ROLE_CHANGED: 'member.role_changed',
  
  // Backup
  BACKUP_CREATED: 'backup.created',
  BACKUP_RESTORED: 'backup.restored',
  
  // Files
  FILE_UPLOADED: 'file.uploaded',
  FILE_DELETED: 'file.deleted',
  DOCUMENT_UPDATED: 'document.updated',
  FILES_BULK_DOWNLOADED: 'files.bulk_downloaded',

  // Sessions
  SESSION_CREATED: 'session.created',
  SESSION_RESOLVED: 'session.resolved',
  
  // Students
  STUDENT_CREATED: 'student.created',
  STUDENT_UPDATED: 'student.updated',
  STUDENT_DELETED: 'student.deleted',
  STUDENTS_BULK_UPDATE: 'students.bulk_update',
  
  // Instructors
  INSTRUCTOR_CREATED: 'instructor.created',
  INSTRUCTOR_UPDATED: 'instructor.updated',
  INSTRUCTOR_DELETED: 'instructor.deleted',
  
  // Settings
  SETTINGS_UPDATED: 'settings.updated',
  LOGO_UPDATED: 'logo.updated',
};

/**
 * Action categories
 */
export const AUDIT_CATEGORIES = {
  STORAGE: 'storage',
  PERMISSIONS: 'permissions',
  MEMBERSHIP: 'membership',
  BACKUP: 'backup',
  SETTINGS: 'settings',
  FILES: 'files',
  SESSIONS: 'sessions',
  STUDENTS: 'students',
  INSTRUCTORS: 'instructors',
};

/**
 * User roles for audit logging
 */
export const AUDIT_ROLES = {
  SYSTEM_ADMIN: 'system_admin',
  OWNER: 'owner',
  ADMIN: 'admin',
  MEMBER: 'member',
};
