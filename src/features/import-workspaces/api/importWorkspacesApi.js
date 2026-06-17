/**
 * importWorkspacesApi.js — Frontend API wrappers for the Import Workspaces feature.
 *
 * All calls go through authenticatedFetch() which injects:
 *   - Authorization: Bearer <token>
 *   - x-org-id: <activeOrgId>
 */

import { authenticatedFetch } from '../../../lib/api-client.js';

/**
 * Request a pre-signed R2 PUT URL from the Azure gatekeeper endpoint.
 *
 * @param {string} workspaceId
 * @param {string} filename     - original filename (used for extension check on backend)
 * @param {string} contentType  - MIME type of the file
 * @returns {Promise<{ uploadUrl: string, objectKey: string }>}
 */
export async function getUploadUrl(workspaceId, filename, contentType) {
  const params = new URLSearchParams({
    filename,
    contentType,
  });
  const payload = await authenticatedFetch(
    `/api/import-workspaces/${encodeURIComponent(workspaceId)}/upload-url?${params}`,
  );
  return payload;
}

/**
 * Patch the workspace config via the RPC-backed PATCH endpoint.
 * Uses JSON Merge Patch semantics — only the supplied keys are updated.
 *
 * @param {string} workspaceId
 * @param {object} configPatch  - partial config object to merge
 * @returns {Promise<object>}   - updated workspace record
 */
export async function patchWorkspaceConfig(workspaceId, configPatch) {
  const payload = await authenticatedFetch(
    `/api/import-workspaces/${encodeURIComponent(workspaceId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: configPatch }),
    },
  );
  return payload?.workspace ?? payload;
}

/**
 * Create a new import workspace.
 *
 * @param {{ name: string, description?: string }} data
 * @returns {Promise<object>}
 */
export async function createImportWorkspace(data) {
  const payload = await authenticatedFetch('/api/import-workspaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return payload?.workspace ?? payload;
}

/**
 * List import workspaces for the active org.
 *
 * @returns {Promise<object[]>}
 */
export async function listImportWorkspaces() {
  const payload = await authenticatedFetch('/api/import-workspaces');
  return payload?.workspaces ?? [];
}

/**
 * Fetch a single import workspace by id.
 *
 * @param {string} workspaceId
 * @returns {Promise<object>}
 */
export async function getImportWorkspace(workspaceId) {
  const payload = await authenticatedFetch(
    `/api/import-workspaces/${encodeURIComponent(workspaceId)}`,
  );
  return payload?.workspace ?? payload;
}

/**
 * Send one chunk of parsed rows to the backend for ingestion.
 *
 * Each row must carry:
 *   { row_index: number, raw_data: object }
 *
 * The backend enforces a 500-row max per call. Empty-string scrubbing is
 * performed by both the Phase 2 Web Worker and by the backend as a second
 * defence — callers should not rely on either alone.
 *
 * @param {string} workspaceId
 * @param {string} sourceReference  - stable identifier from parser.worker.js
 * @param {{ row_index: number, raw_data: object }[]} rows  - max 500
 * @returns {Promise<{ inserted: number }>}
 */
export async function ingestRowsBulk(workspaceId, sourceReference, rows) {
  const payload = await authenticatedFetch(
    `/api/import-workspaces/${encodeURIComponent(workspaceId)}/rows-bulk`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_reference: sourceReference, rows }),
    },
  );
  return payload;
}

/**
 * Analyze one chunk of staged rows, producing import_candidates Golden Records.
 *
 * The backend enforces a 100-row max per call. Re-analyzing the same range
 * is idempotent (upsert on workspace_id, source_row_id).
 *
 * @param {string} workspaceId
 * @param {string} sourceReference
 * @param {number} rowIndexFrom  - inclusive
 * @param {number} rowIndexTo    - inclusive, max rowIndexFrom + 99
 * @returns {Promise<{ analyzed: number, candidates_created: number, candidates_updated: number }>}
 */
export async function analyzeChunk(workspaceId, sourceReference, rowIndexFrom, rowIndexTo) {
  const payload = await authenticatedFetch(
    `/api/import-workspaces/${encodeURIComponent(workspaceId)}/analyze-chunk`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_reference: sourceReference,
        row_index_from: rowIndexFrom,
        row_index_to: rowIndexTo,
      }),
    },
  );
  return payload;
}

/**
 * List import_candidates for a workspace with optional filters.
 *
 * @param {string} workspaceId
 * @param {{ entityType?: string, status?: string, page?: number, sourceReference?: string }} opts
 * @returns {Promise<{ candidates: object[], total: number, page: number, pageSize: number }>}
 */
export async function listCandidates(workspaceId, opts = {}) {
  const params = new URLSearchParams({ workspace_id: workspaceId });
  if (opts.entityType) params.set('entity_type', opts.entityType);
  if (opts.status) params.set('status', opts.status);
  if (opts.sourceReference) params.set('source_reference', opts.sourceReference);
  if (opts.page) params.set('page', String(opts.page));

  return authenticatedFetch(`/api/import-candidates?${params}`);
}

/**
 * Check whether the optional temporary R2 backup file still exists.
 *
 * @param {string} workspaceId
 * @returns {Promise<{ status: 'available'|'missing_or_expired'|'not_uploaded'|'unknown', object_key?: string|null }>}
 */
export async function getUploadStatus(workspaceId) {
  const payload = await authenticatedFetch(
    `/api/import-workspaces/${encodeURIComponent(workspaceId)}/upload-status`,
  );
  return payload;
}

/**
 * Patch decisions and/or status on an import candidate.
 *
 * @param {string} candidateId
 * @param {{ decisions_patch?: object, status?: string }} patch
 * @returns {Promise<{ candidate: object }>}
 */
export async function patchCandidate(candidateId, patch) {
  return authenticatedFetch(
    `/api/import-candidates/${encodeURIComponent(candidateId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
  );
}

/**
 * Run the dry-run simulation engine for a chunk of candidates.
 *
 * The backend reads live tables (read-only) and writes dry_run_summary into
 * each candidate's candidate_data. Max 50 candidates per call.
 *
 * @param {string} workspaceId
 * @param {string[]} candidateIds  — max 50 UUIDs
 * @returns {Promise<{ results: object[], processed: number }>}
 */
export async function runDryRunChunk(workspaceId, candidateIds) {
  return authenticatedFetch(
    `/api/import-workspaces/${encodeURIComponent(workspaceId)}/dry-run/chunk`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidate_ids: candidateIds }),
    },
  );
}

/**
 * Atomically commit a chunk of candidates to the live tables.
 *
 * The backend delegates to the commit_import_chunk PL/pgSQL RPC which
 * runs all inserts/updates in a single transaction (all-or-rollback).
 * Max 50 candidates per call; call multiple times for larger batches.
 *
 * Topological order must be enforced by the caller:
 *   active_student / inactive_student → guardian / service → guardian_link → student_note
 *
 * @param {string} workspaceId
 * @param {string[]} candidateIds  — max 50 UUIDs
 * @returns {Promise<{ committed: number, workspace_id: string, results: object[] }>}
 */
export async function commitChunk(workspaceId, candidateIds) {
  return authenticatedFetch(
    `/api/import-workspaces/${encodeURIComponent(workspaceId)}/commit/chunk`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidate_ids: candidateIds }),
    },
  );
}

