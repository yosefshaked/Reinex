/* eslint-env node */
import { randomUUID } from 'node:crypto';

export const TENANT_AUDIT_RETENTION = {
  CRITICAL: 'critical',
  STANDARD: 'standard',
  DIAGNOSTIC: 'diagnostic',
};

export async function logTenantAuditEvent(tenantClient, params) {
  const payload = {
    correlation_id: params.correlationId || randomUUID(),
    actor_user_id: params.actorUserId || null,
    event_type: params.eventType,
    retention_category: params.retentionCategory || TENANT_AUDIT_RETENTION.STANDARD,
    resource_type: params.resourceType,
    resource_id: params.resourceId,
    before_state: params.beforeState || null,
    after_state: params.afterState || null,
    details: params.details || null,
    org_id: params.orgId || null,
  };

  const { data, error } = await tenantClient
    .from('audit_log')
    .insert(payload)
    .select('id, correlation_id')
    .maybeSingle();

  if (error) {
    console.error('Failed to log tenant audit event', {
      eventType: params.eventType,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      error: error.message,
    });
    return null;
  }

  return data;
}