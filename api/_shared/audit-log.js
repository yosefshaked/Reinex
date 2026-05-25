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
    orgId = null,
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

  if (!userId || !userEmail || !userRole || !actionType || !actionCategory) {
    throw new Error('Missing required audit log parameters');
  }

  // Determine retention category: system_admin and security actions are critical.
  const retentionCategory =
    String(actionCategory).startsWith('admin') ||
    actionCategory === 'security' ||
    actionCategory === 'admin_control'
      ? 'critical'
      : 'standard';

  const { data, error } = await supabaseClient
    .from('audit_log')
    .insert({
      org_id: orgId || null,
      actor_user_id: userId,
      actor_email: userEmail,
      actor_role: userRole,
      event_type: actionType,
      action_category: actionCategory,
      retention_category: retentionCategory,
      resource_type: resourceType || null,
      resource_id: resourceId ? String(resourceId) : null,
      details: details || null,
      metadata: metadata || null,
    })
    .select('id')
    .single();

  if (error) {
    console.error('Failed to log audit event', { actionType, error: error.message });
    return null;
  }

  return data?.id ?? null;
}

export async function logSystemAuditEvent(supabaseClient, params) {
  const {
    orgId = null,
    actionType,
    actionCategory,
    resourceType = null,
    resourceId = null,
    details = null,
    metadata = null,
    systemEmail = 'system@reinex.local',
    systemRole = 'system',
  } = params;

  if (!actionType || !actionCategory) {
    throw new Error('Missing required audit log parameters');
  }

  const retentionCategory =
    String(actionCategory).startsWith('admin') ||
    actionCategory === 'security' ||
    actionCategory === 'admin_control'
      ? 'critical'
      : 'standard';

  const { data, error } = await supabaseClient
    .from('audit_log')
    .insert({
      org_id: orgId || null,
      actor_user_id: null,
      actor_email: systemEmail,
      actor_role: systemRole,
      event_type: actionType,
      action_category: actionCategory,
      retention_category: retentionCategory,
      resource_type: resourceType || null,
      resource_id: resourceId ? String(resourceId) : null,
      details: details || null,
      metadata: metadata || null,
    })
    .select('id')
    .single();

  if (error) {
    console.error('Failed to log system audit event', { actionType, error: error.message });
    return null;
  }

  return data?.id ?? null;
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
  MEMBER_LINKED_TO_EMPLOYEE: 'member.linked_to_employee',
  MEMBER_REMOVED: 'member.removed',
  MEMBER_ROLE_CHANGED: 'member.role_changed',
  INVITATION_RESENT: 'invitation.resent',
  INVITATION_ACCEPTED: 'invitation.accepted',
  INVITATION_DECLINED: 'invitation.declined',
  INVITATION_EXPIRED: 'invitation.expired',
  INVITATION_SEND_FAILED: 'invitation.send_failed',
  INVITATION_REVOKED: 'invitation.revoked',

  // Account
  ACCOUNT_PROFILE_UPDATED: 'account.profile_updated',
  ACCOUNT_SETUP_COMPLETED: 'account.setup_completed',
  ACCOUNT_DEACTIVATED: 'account.deactivated',
  ACCOUNT_REACTIVATED: 'account.reactivated',
  ACCOUNT_DEACTIVATION_BLOCKED: 'account.deactivation_blocked',
  ACCOUNT_REACTIVATION_BLOCKED: 'account.reactivation_blocked',
  
  // Backup
  BACKUP_CREATED: 'backup.created',
  BACKUP_RESTORED: 'backup.restored',

  // Local export/import
  LOCAL_EXPORT_STARTED: 'local_export_started',
  LOCAL_EXPORT_COMPLETED: 'local_export_completed',
  LOCAL_EXPORT_FAILED: 'local_export_failed',
  LOCAL_IMPORT_ANALYZED: 'local_import_analyzed',
  LOCAL_IMPORT_APPLIED: 'local_import_applied',
  LOCAL_IMPORT_FAILED: 'local_import_failed',
  
  // Files
  FILE_UPLOADED: 'file.uploaded',
  FILE_DELETED: 'file.deleted',
  DOCUMENT_UPDATED: 'document.updated',
  FILES_BULK_DOWNLOADED: 'files.bulk_downloaded',

  // Sessions
  SESSION_CREATED: 'session.created',
  SESSION_RESOLVED: 'session.resolved',
  SESSION_DELETED: 'session.deleted',
  CALENDAR_INSTANCE_CREATED: 'calendar.instance_created',
  CALENDAR_INSTANCE_UPDATED: 'calendar.instance_updated',
  CALENDAR_INSTANCE_CANCELLED: 'calendar.instance_cancelled',

  // Calendar Templates
  TEMPLATE_CREATED: 'template.created',
  TEMPLATE_UPDATED: 'template.updated',
  TEMPLATE_DEACTIVATED: 'template.deactivated',
  TEMPLATE_REACTIVATED: 'template.reactivated',
  TEMPLATE_OVERRIDE_CREATED: 'template.override_created',
  TEMPLATE_OVERRIDE_DELETED: 'template.override_deleted',
  CALENDAR_GENERATION_DRY_RUN: 'calendar.generation_dry_run',
  CALENDAR_GENERATION_APPLIED: 'calendar.generation_applied',
  
  // Students
  STUDENT_CREATED: 'student.created',
  STUDENT_UPDATED: 'student.updated',
  STUDENT_DELETED: 'student.deleted',
  STUDENTS_BULK_UPDATE: 'students.bulk_update',
  STUDENT_LESSONS_BULK_CANCELLED: 'student.lessons_bulk_cancelled',
  
  // Instructors
  INSTRUCTOR_CREATED: 'instructor.created',
  INSTRUCTOR_UPDATED: 'instructor.updated',
  INSTRUCTOR_DELETED: 'instructor.deleted',
  
  // Forms
  FORM_TEMPLATE_CREATED: 'form_template.created',
  FORM_TEMPLATE_UPDATED: 'form_template.updated',
  FORM_TEMPLATE_PUBLISHED: 'form_template.published',
  FORM_TEMPLATE_REACTIVATED: 'form_template.reactivated',
  FORM_TEMPLATE_DELETED: 'form_template.deleted',
  FORM_SUBMISSION_INITIATED: 'form_submission.initiated',
  FORM_SUBMISSION_RESENT: 'form_submission.resent',
  FORM_SUBMISSION_COMPLETED: 'form_submission.completed',
  WAITING_LIST_INTAKE_INVITE_SENT: 'waiting_list_intake.invite_sent',

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
  LOCAL_DATA_PORTABILITY: 'local_data_portability',
  SETTINGS: 'settings',
  FILES: 'files',
  SESSIONS: 'sessions',
  STUDENTS: 'students',
  INSTRUCTORS: 'instructors',
  CALENDAR: 'calendar',
  FORMS: 'forms',
  ACCOUNT: 'account',
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
