import { authenticatedFetch } from '@/lib/api-client.js';

export function createSchemaPlan(tenantId) {
  return authenticatedFetch(`tenants/${tenantId}/schema/plan`, {
    method: 'POST',
    body: {},
  });
}

export function runSchemaPreflight(tenantId, planId) {
  return authenticatedFetch(`tenants/${tenantId}/schema/preflight`, {
    method: 'POST',
    body: { plan_id: planId },
  });
}

export function applySchemaSafe(tenantId, planId) {
  return authenticatedFetch(`tenants/${tenantId}/schema/apply-safe`, {
    method: 'POST',
    body: { plan_id: planId },
  });
}

export function applySchemaDestructive(tenantId, planId, confirmationPhrase) {
  return authenticatedFetch(`tenants/${tenantId}/schema/apply-destructive`, {
    method: 'POST',
    body: { plan_id: planId, confirmationPhrase },
  });
}

export function fetchSchemaHistory(tenantId) {
  return authenticatedFetch(`tenants/${tenantId}/schema/history`, {
    method: 'GET',
  });
}
