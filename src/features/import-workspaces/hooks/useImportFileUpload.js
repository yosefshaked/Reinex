/**
 * useImportFileUpload.js — Orchestrates the three-step import upload pipeline:
 *
 *   1. SELECT  – user picks a file, encoding is sniffed on main thread
 *   2. UPLOAD  – Azure gatekeeper issues a pre-signed R2 PUT URL; browser
 *                PUTs directly to R2 (no auth — URL is time-limited)
 *   3. PARSE   – Web Worker parses the file; result stored in local state
 *                (rows are NOT sent to the backend here — that is Phase 3)
 *
 * Security invariants:
 *  - The frontend NEVER writes to the database directly.
 *  - DB config updates go through authenticatedFetch → Azure Function.
 *  - The parser runs in a Worker to isolate prototype pollution from
 *    potentially malicious file contents.
 */

import { useCallback, useRef, useState } from 'react';
import jschardet from 'jschardet';
import { getUploadUrl, patchWorkspaceConfig } from '../api/importWorkspacesApi.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACCEPTED_MIME_TYPES = new Set([
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB hard cap

// ---------------------------------------------------------------------------
// Initial state shapes
// ---------------------------------------------------------------------------

const IDLE_FILE = { file: null, error: null };
const IDLE_ENCODING = { detected: null, override: null, error: null };
const IDLE_UPLOAD = { status: 'idle', progress: 0, objectKey: null, error: null };
const IDLE_PARSE = { status: 'idle', pct: 0, stage: null, error: null };

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * @param {string} workspaceId  - the import workspace to attach files to
 * @param {string|null} existingSourceReference - current workspace source, reused on re-parse
 */
export function useImportFileUpload(workspaceId, existingSourceReference = null) {
  const [fileState, setFileState] = useState(IDLE_FILE);
  const [encodingState, setEncodingState] = useState(IDLE_ENCODING);
  const [uploadState, setUploadState] = useState(IDLE_UPLOAD);
  const [parseState, setParseState] = useState(IDLE_PARSE);
  const [parsedRows, setParsedRows] = useState(null);
  const [profile, setProfile] = useState(null);
  const [sourceReference, setSourceReference] = useState(null);

  const workerRef = useRef(null);

  // -------------------------------------------------------------------------
  // selectFile
  // -------------------------------------------------------------------------

  const selectFile = useCallback((file) => {
    if (!file) {
      setFileState({ file: null, error: null });
      setEncodingState(IDLE_ENCODING);
      setUploadState(IDLE_UPLOAD);
      setParseState(IDLE_PARSE);
      setParsedRows(null);
      setProfile(null);
      setSourceReference(null);
      return;
    }

    if (!ACCEPTED_MIME_TYPES.has(file.type)) {
      setFileState({ file: null, error: 'unsupported_file_type' });
      return;
    }

    if (file.size > MAX_FILE_BYTES) {
      setFileState({ file: null, error: 'file_too_large' });
      return;
    }

    setFileState({ file, error: null });
    setUploadState(IDLE_UPLOAD);
    setParseState(IDLE_PARSE);
    setParsedRows(null);
    setProfile(null);
    setSourceReference(null);

    // Quick encoding sniff: read first 8 KB on main thread (fast, <1 ms)
    const isCsv =
      file.type === 'text/csv' || file['name'].toLowerCase().endsWith('.csv');

    if (isCsv) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const probeBytes = new Uint8Array(e.target.result);
          let binaryStr = '';
          for (let i = 0; i < probeBytes.length; i++) binaryStr += String.fromCharCode(probeBytes[i]);
          const detected = jschardet.detect(binaryStr);
          setEncodingState({
            detected: detected?.encoding ?? 'UTF-8',
            override: null,
            error: null,
          });
        } catch {
          setEncodingState({ detected: 'UTF-8', override: null, error: null });
        }
      };
      reader.readAsArrayBuffer(file.slice(0, 8192));
    } else {
      setEncodingState({ detected: null, override: null, error: null });
    }
  }, []);

  // -------------------------------------------------------------------------
  // setOverrideEncoding
  // -------------------------------------------------------------------------

  const setOverrideEncoding = useCallback((encoding) => {
    setEncodingState((prev) => ({ ...prev, override: encoding }));
  }, []);

  // -------------------------------------------------------------------------
  // upload
  // -------------------------------------------------------------------------

  const upload = useCallback(async () => {
    const file = fileState.file;
    if (!file) {
      setUploadState((prev) => ({ ...prev, error: 'no_file_selected' }));
      return;
    }

    setUploadState({ status: 'requesting_url', progress: 0, objectKey: null, error: null });

    let uploadUrl;
    let objectKey;

    try {
      const result = await getUploadUrl(workspaceId, file['name'], file.type);
      uploadUrl = result.uploadUrl;
      objectKey = result.objectKey;
    } catch (err) {
      setUploadState({
        status: 'failed_nonblocking',
        progress: 0,
        objectKey: null,
        error: err.message ?? 'upload_url_error',
      });
      return;
    }

    setUploadState({ status: 'uploading', progress: 5, objectKey: null, error: null });

    try {
      // PUT directly to R2 with the pre-signed URL — no auth header needed
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      });

      if (!res.ok) {
        throw new Error(`r2_put_failed_${res.status}`);
      }
    } catch (err) {
      setUploadState({
        status: 'failed_nonblocking',
        progress: 0,
        objectKey: null,
        error: err.message ?? 'upload_failed',
      });
      return;
    }

    setUploadState({ status: 'saving_metadata', progress: 90, objectKey, error: null });

    try {
      const uploadedAt = new Date();
      const backupExpiresAt = new Date(uploadedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
      await patchWorkspaceConfig(workspaceId, {
        objectKey,
        fileName: file['name'],
        fileSize: file.size,
        contentType: file.type,
        uploadedAt: uploadedAt.toISOString(),
        backupExpiresAt: backupExpiresAt.toISOString(),
      });
    } catch (err) {
      // Upload succeeded but metadata patch failed — expose partial state
      setUploadState({
        status: 'failed_nonblocking',
        progress: 90,
        objectKey,
        error: err.message ?? 'metadata_patch_failed',
      });
      return;
    }

    setUploadState({ status: 'done', progress: 100, objectKey, error: null });
  }, [fileState.file, workspaceId]);

  // -------------------------------------------------------------------------
  // parse
  // -------------------------------------------------------------------------

  const parse = useCallback(() => {
    const file = fileState.file;
    if (!file) {
      setParseState((prev) => ({ ...prev, error: 'no_file_selected' }));
      return;
    }

    // Terminate any previously running worker
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }

    setParseState({ status: 'reading', pct: 0, stage: 'reading_file', error: null });
    setParsedRows(null);
    setProfile(null);

    const reader = new FileReader();

    reader.onload = (e) => {
      const buffer = e.target.result;

      setParseState({ status: 'parsing', pct: 5, stage: 'spawning_worker', error: null });

      // Spawn the Web Worker — Vite bundles it as a separate chunk
      const worker = new Worker(
        new URL('../worker/parser.worker.js', import.meta.url),
        { type: 'module' },
      );
      workerRef.current = worker;

      worker.onmessage = async (evt) => {
        const { type: msgType, payload } = evt.data ?? {};

        if (msgType === 'PROGRESS') {
          setParseState({
            status: 'parsing',
            pct: payload.pct,
            stage: payload.stage,
            error: null,
          });
          return;
        }

        if (msgType === 'PARSE_COMPLETE') {
          worker.terminate();
          workerRef.current = null;

          const { headers, rows, sourceReference: parsedSourceReference, profile: prof } = payload;
          const sourceReference = existingSourceReference || parsedSourceReference;
          setParsedRows(rows);
          setProfile(prof);
          setSourceReference(sourceReference);

          setParseState({ status: 'saving_profile', pct: 98, stage: 'saving_profile', error: null });

          try {
            await patchWorkspaceConfig(workspaceId, {
              sourceReference,
              profile: prof,
              headers,
            });
          } catch (err) {
            // Non-fatal: profile patch failure doesn't invalidate the parsed data
            console.error('[useImportFileUpload] profile patch failed:', err);
          }

          setParseState({ status: 'done', pct: 100, stage: 'done', error: null });
          return;
        }

        if (msgType === 'ERROR') {
          worker.terminate();
          workerRef.current = null;
          setParseState({
            status: 'error',
            pct: 0,
            stage: null,
            error: payload.message ?? 'parse_error',
          });
        }
      };

      worker.onerror = (err) => {
        worker.terminate();
        workerRef.current = null;
        setParseState({
          status: 'error',
          pct: 0,
          stage: null,
          error: err.message ?? 'worker_error',
        });
      };

      worker.postMessage({ type: 'PARSE', payload: { buffer, filename: file['name'] } }, [buffer]);
    };

    reader.onerror = () => {
      setParseState({ status: 'error', pct: 0, stage: null, error: 'file_read_error' });
    };

    reader.readAsArrayBuffer(file);
  }, [existingSourceReference, fileState.file, workspaceId]);

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  return {
    fileState,
    encodingState,
    setOverrideEncoding,
    uploadState,
    parseState,
    parsedRows,
    profile,
    sourceReference,
    selectFile,
    upload,
    parse,
  };
}
