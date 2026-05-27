/**
 * useImportAnalysis.js — Chunked candidate analysis orchestrator (Phase 4).
 *
 * Iterates over the full row index range in chunks of ≤ 100 rows, calling
 * POST /api/import-workspaces/:id/analyze-chunk sequentially. After each
 * successful chunk the workspace config is patched with an `operationProgress`
 * object so the UI can render a progress bar without polling.
 *
 * Resume contract:
 *   If a chunk fails, the hook stops and records `resumeFromChunk`.
 *   Calling `analyze()` again while `resumeFromChunk !== null` continues from
 *   that chunk index. Analysis is idempotent — the backend upserts on
 *   (workspace_id, source_row_id) so re-running the same chunk is safe.
 */

import { useCallback, useRef, useState } from 'react';
import { analyzeChunk, patchWorkspaceConfig } from '../api/importWorkspacesApi.js';

// Must match the backend MAX_ROWS_PER_ANALYSIS_CHUNK constant.
const CHUNK_SIZE = 100;

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const IDLE_STATE = {
  status: 'idle',         // 'idle' | 'analyzing' | 'done' | 'error'
  analyzedRows: 0,
  totalRows: 0,
  currentChunk: 0,
  totalChunks: 0,
  resumeFromChunk: null,
  error: null,
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * @param {string} workspaceId
 * @param {string|null} sourceReference  - from Phase 2/3 (stored in workspace config)
 * @param {number} totalRows             - total rows ingested in Phase 3
 */
export function useImportAnalysis(workspaceId, sourceReference, totalRows) {
  const [state, setState] = useState(IDLE_STATE);

  // Allows cancellation if the component unmounts mid-loop
  const cancelledRef = useRef(false);

  // -------------------------------------------------------------------------
  // analyze — entry point; can resume from a prior failure
  // -------------------------------------------------------------------------

  const analyze = useCallback(async (opts = {}) => {
    if (!totalRows || totalRows <= 0) {
      setState((prev) => ({ ...prev, error: 'no_rows_to_analyze' }));
      return;
    }
    if (!sourceReference) {
      setState((prev) => ({ ...prev, error: 'missing_source_reference' }));
      return;
    }

    const startChunk = opts.resumeFromChunk ?? state.resumeFromChunk ?? 0;
    const chunks = Math.ceil(totalRows / CHUNK_SIZE);

    // Rows already confirmed analyzed before a prior failure
    const alreadyAnalyzed = startChunk * CHUNK_SIZE;

    cancelledRef.current = false;

    setState({
      status: 'analyzing',
      analyzedRows: alreadyAnalyzed,
      totalRows,
      currentChunk: startChunk,
      totalChunks: chunks,
      resumeFromChunk: null,
      error: null,
    });

    for (let chunkIdx = startChunk; chunkIdx < chunks; chunkIdx++) {
      if (cancelledRef.current) break;

      const rowIndexFrom = chunkIdx * CHUNK_SIZE;
      const rowIndexTo = Math.min(rowIndexFrom + CHUNK_SIZE - 1, totalRows - 1);

      setState((prev) => ({ ...prev, currentChunk: chunkIdx }));

      try {
        await analyzeChunk(workspaceId, sourceReference, rowIndexFrom, rowIndexTo);
      } catch (err) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          resumeFromChunk: chunkIdx,
          error: err.message ?? 'chunk_analysis_failed',
        }));
        return;
      }

      const analyzedRows = rowIndexTo + 1;

      // Patch operationProgress after each successful chunk — non-fatal if it
      // fails (analysis has already succeeded for this chunk).
      try {
        await patchWorkspaceConfig(workspaceId, {
          operationProgress: {
            analyzedRows,
            totalRows,
            currentChunk: chunkIdx,
            totalChunks: chunks,
            lastSuccessAt: new Date().toISOString(),
          },
        });
      } catch (patchErr) {
        // Non-fatal: progress bar may stall but data integrity is preserved
        console.error('[useImportAnalysis] progress patch failed:', patchErr);
      }

      setState((prev) => ({
        ...prev,
        analyzedRows,
        currentChunk: chunkIdx + 1,
      }));
    }

    if (!cancelledRef.current) {
      setState((prev) => ({
        ...prev,
        status: 'done',
        analyzedRows: totalRows,
        resumeFromChunk: null,
        error: null,
      }));
    }
  }, [sourceReference, totalRows, workspaceId, state.resumeFromChunk]);

  // -------------------------------------------------------------------------
  // resume — convenience wrapper so callers don't need to read state
  // -------------------------------------------------------------------------

  const resume = useCallback(() => {
    if (state.resumeFromChunk === null) return;
    analyze({ resumeFromChunk: state.resumeFromChunk });
  }, [analyze, state.resumeFromChunk]);

  // -------------------------------------------------------------------------
  // cancel — signals the in-flight loop to stop after the current chunk
  // -------------------------------------------------------------------------

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setState((prev) => ({
      ...prev,
      status: 'idle',
      resumeFromChunk: prev.currentChunk < prev.totalChunks ? prev.currentChunk : null,
    }));
  }, []);

  // -------------------------------------------------------------------------
  // reset
  // -------------------------------------------------------------------------

  const reset = useCallback(() => {
    cancelledRef.current = true;
    setState(IDLE_STATE);
  }, []);

  return {
    ...state,
    analyze,
    resume,
    cancel,
    reset,
    /** Convenience: 0-1 fraction for a progress bar */
    progress: state.totalRows > 0 ? state.analyzedRows / state.totalRows : 0,
  };
}
