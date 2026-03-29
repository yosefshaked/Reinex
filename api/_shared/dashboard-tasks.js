/* eslint-env node */
import { normalizeString } from './org-bff.js';

export async function createDashboardTask(tenantClient, params) {
  const taskType = normalizeString(params?.taskType);
  const resourceType = normalizeString(params?.resourceType) || null;
  const resourceId = normalizeString(params?.resourceId) || null;

  if (!taskType) {
    throw new Error('missing_task_type');
  }

  let existingQuery = tenantClient
    .from('dashboard_tasks')
    .select('id, status')
    .eq('task_type', taskType)
    .eq('status', 'open');

  existingQuery = resourceType
    ? existingQuery.eq('resource_type', resourceType)
    : existingQuery.is('resource_type', null);
  existingQuery = resourceId
    ? existingQuery.eq('resource_id', resourceId)
    : existingQuery.is('resource_id', null);

  const { data: existing, error: existingError } = await existingQuery.maybeSingle();

  if (existingError && existingError.code !== 'PGRST116') {
    throw existingError;
  }

  if (existing?.id) {
    return existing;
  }

  const payload = {
    task_type: taskType,
    title: normalizeString(params?.title) || taskType,
    description: normalizeString(params?.description) || taskType,
    priority: normalizeString(params?.priority) || 'medium',
    status: 'open',
    resource_type: resourceType,
    resource_id: resourceId,
    action_path: normalizeString(params?.actionPath) || null,
    created_by: params?.createdBy || null,
    expires_at: params?.expiresAt || null,
    metadata: params?.metadata && typeof params.metadata === 'object' ? params.metadata : {},
  };

  const { data, error } = await tenantClient
    .from('dashboard_tasks')
    .insert(payload)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function listDashboardTasks(tenantClient, options = {}) {
  let query = tenantClient
    .from('dashboard_tasks')
    .select('*')
    .order('created_at', { ascending: false });

  const status = normalizeString(options?.status);
  const resourceType = normalizeString(options?.resourceType);
  const resourceId = normalizeString(options?.resourceId);

  if (status) {
    query = query.eq('status', status);
  }
  if (resourceType) {
    query = query.eq('resource_type', resourceType);
  }
  if (resourceId) {
    query = query.eq('resource_id', resourceId);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  return Array.isArray(data) ? data : [];
}

export async function resolveDashboardTask(tenantClient, params) {
  const taskId = normalizeString(params?.taskId);
  if (!taskId) {
    throw new Error('missing_task_id');
  }

  const updatePayload = {
    status: 'resolved',
    resolved_at: new Date().toISOString(),
    resolved_by: params?.resolvedBy || null,
  };

  if (params?.metadata && typeof params.metadata === 'object') {
    updatePayload.metadata = params.metadata;
  }

  const { data, error } = await tenantClient
    .from('dashboard_tasks')
    .update(updatePayload)
    .eq('id', taskId)
    .eq('status', 'open')
    .select('*')
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}