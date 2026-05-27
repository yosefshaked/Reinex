/**
 * useImportRowIngestion.js — Chunked row ingestion orchestrator (Phase 3).
 *
 * Slices `parsedRows` from the Phase 2 parse result into chunks of ≤ 500 rows
 * and sends them sequentially to the backend. After each successful chunk the
 * workspace config is patched with an `operationProgress` object so the UI can
 * render a progress bar without polling.
 *
 * Resume contract:
 *   If a chunk fails, the hook stops the loop and records `resumeFromChunk`.
 *   Calling `ingest()` again while `resumeFromChunk !== null` continues from
 *   that chunk index, making the full ingestion idempotent (server upsert
 *   ensures already-written rows are simply overwritten, not duplicated).
 */

import { useCallback, useRef, useState } from 'react';
import { ingestRowsBulk, patchWorkspaceConfig } from '../api/importWorkspacesApi.js';

// Must match the backend MAX_ROWS_PER_CHUNK constant.
const CHUNK_SIZE = 500;

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const IDLE_STATE = {
  status: 'idle',      // 'idle' | 'ingesting' | 'done' | 'error'
  uploadedRows: 0,
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
 * @param {string|null} sourceReference  - from Phase 2 parse result
 * @param {object[]|null} parsedRows     - from Phase 2 parse result
 */
export function useImportRowIngestion(workspaceId, sourceReference, parsedRows) {
  const [state, setState] = useState(IDLE_STATE);

  // Allows cancellation if the component unmounts mid-loop
  const cancelledRef = useRef(false);

  // -------------------------------------------------------------------------
  // ingest — entry point; can resume from a prior failure
  // -------------------------------------------------------------------------

  const ingest = useCallback(async (opts = {}) => {
    if (!parsedRows || parsedRows.length === 0) {
      setState((prev) => ({ ...prev, error: 'no_rows_to_ingest' }));
      return;
    }
    if (!sourceReference) {
      setState((prev) => ({ ...prev, error: 'missing_source_reference' }));
      return;
    }

    const startChunk = opts.resumeFromChunk ?? state.resumeFromChunk ?? 0;

    const totalRows = parsedRows.length;
    const totalChunks = Math.ceil(totalRows / CHUNK_SIZE);

    // Rows already confirmed written before a prior failure
    const alreadyUploaded = startChunk * CHUNK_SIZE;

    cancelledRef.current = false;

    setState({
      status: 'ingesting',
      uploadedRows: alreadyUploaded,
      totalRows,
      currentChunk: startChunk,
      totalChunks,
      resumeFromChunk: null,
      error: null,
    });

    for (let chunkIdx = startChunk; chunkIdx < totalChunks; chunkIdx++) {
      if (cancelledRef.current) break;

      const sliceStart = chunkIdx * CHUNK_SIZE;
      const sliceEnd = Math.min(sliceStart + CHUNK_SIZE, totalRows);

      // Build rows with absolute row_index values so the upsert key is stable
      // regardless of how many chunks have been sent.
      const chunkRows = parsedRows.slice(sliceStart, sliceEnd).map((rawData, localIdx) => ({
        row_index: sliceStart + localIdx,
        raw_data: rawData,
      }));

      setState((prev) => ({ ...prev, currentChunk: chunkIdx }));

      try {
        await ingestRowsBulk(workspaceId, sourceReference, chunkRows);
      } catch (err) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          resumeFromChunk: chunkIdx,
          error: err.message ?? 'chunk_failed',
        }));
        return;
      }

      const uploadedRows = sliceEnd;

      // Patch operationProgress after each successful chunk — non-fatal if it
      // fails (ingestion has already succeeded for this chunk).
      try {
        await patchWorkspaceConfig(workspaceId, {
          operationProgress: {
            uploadedRows,
            totalRows,
            currentChunk: chunkIdx,
            totalChunks,
            lastSuccessAt: new Date().toISOString(),
          },
        });
      } catch (patchErr) {
        // Non-fatal: progress bar may stall but data integrity is preserved
        console.error('[useImportRowIngestion] progress patch failed:', patchErr);
      }

      setState((prev) => ({
        ...prev,
        uploadedRows,
        currentChunk: chunkIdx + 1,
      }));
    }

    if (!cancelledRef.current) {
      setState((prev) => ({
        ...prev,
        status: 'done',
        uploadedRows: totalRows,
        resumeFromChunk: null,
        error: null,
      }));
    }
  }, [parsedRows, sourceReference, workspaceId, state.resumeFromChunk]);

  // -------------------------------------------------------------------------
  // resume — convenience wrapper so callers don't need to read state
  // -------------------------------------------------------------------------

  const resume = useCallback(() => {
    if (state.resumeFromChunk === null) return;
    ingest({ resumeFromChunk: state.resumeFromChunk });
  }, [ingest, state.resumeFromChunk]);

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
    ingest,
    resume,
    cancel,
    reset,
    /** Convenience: 0-1 fraction for a progress bar */
    progress: state.totalRows > 0 ? state.uploadedRows / state.totalRows : 0,
  };
}
