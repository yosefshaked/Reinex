/* eslint-env node */
import { sha256Hex, stableJsonStringify } from './hashing.js';

function normalizeText(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

export function hashSnapshot(snapshot) {
  return sha256Hex(stableJsonStringify(snapshot ?? null));
}

export function hashSsot(ssotText) {
  return sha256Hex(normalizeText(ssotText));
}

export async function insertSchemaMigrationAudit(supabase, payload) {
  const { data, error } = await supabase
    .from('schema_migration_audit')
    .insert(payload)
    .select('id')
    .maybeSingle();

  if (error) {
    return { id: null, error };
  }

  return { id: data?.id ?? null, error: null };
}

export async function updateSchemaMigrationAudit(supabase, id, patch) {
  const { error } = await supabase
    .from('schema_migration_audit')
    .update(patch)
    .eq('id', id);

  return { error: error ?? null };
}

export async function fetchSchemaMigrationAudit(supabase, id) {
  const { data, error } = await supabase
    .from('schema_migration_audit')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return { data: null, error };
  }

  return { data, error: null };
}

export async function fetchSchemaMigrationHistory(supabase, tenantId, limit = 25) {
  const { data, error } = await supabase
    .from('schema_migration_audit')
    .select('id, tenant_id, created_at, status, ssot_version_hash, summary_counts, approved_by_user_id, approval_phrase')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    return { data: [], error };
  }

  return { data: Array.isArray(data) ? data : [], error: null };
}
