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
import { getUploadUrl, patchWorkspaceConfig, getDownloadUrl } from '../api/importWorkspacesApi.js';

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
 * @param {object[]} existingSources - source metadata already saved in workspace config
 */
export function useImportFileUpload(workspaceId, existingSources = []) {
  const [fileState, setFileState] = useState(IDLE_FILE);
  const [encodingState, setEncodingState] = useState(IDLE_ENCODING);
  const [uploadState, setUploadState] = useState(IDLE_UPLOAD);
  const [parseState, setParseState] = useState(IDLE_PARSE);
  const [parsedRows, setParsedRows] = useState(null);
  const [profile, setProfile] = useState(null);
  const [sourceReference, setSourceReference] = useState(null);
  const [parsedSources, setParsedSources] = useState([]);

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
      const fileMetadata = {
        fileName: file['name'],
        fileSize: file.size,
        contentType: file.type,
        objectKey,
        uploadedAt: uploadedAt.toISOString(),
        backupExpiresAt: backupExpiresAt.toISOString(),
      };
      const priorFiles = [...existingSources, ...parsedSources]
        .map((source) => source.file)
        .filter((item, index, all) => item && all.findIndex((candidate) => (
          candidate?.objectKey === item.objectKey && candidate?.fileName === item.fileName
        )) === index);
      await patchWorkspaceConfig(workspaceId, {
        objectKey,
        ...fileMetadata,
        files: [...priorFiles, fileMetadata],
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
  }, [existingSources, fileState.file, parsedSources, workspaceId]);

  // -------------------------------------------------------------------------
  // parse
  // -------------------------------------------------------------------------

  // Shared worker-parse routine. Used by both the initial local parse (from a
  // picked File) and backup recovery (from a downloaded ArrayBuffer). Resolves
  // with the parsed sources or rejects on a parse/worker error.
  const parseArrayBuffer = useCallback((buffer, meta) => new Promise((resolve, reject) => {
    // Terminate any previously running worker
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }

    setParseState({ status: 'parsing', pct: 5, stage: 'spawning_worker', error: null });
    setParsedRows(null);
    setProfile(null);

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

        // The worker derives sourceReference as `<deterministic>_<timestamp>`, so a
        // re-parse during recovery would mint NEW references and orphan the saved
        // config/mappings. referenceBySheet (keyed by sheet name, '' for CSV) lets
        // recovery pin the recovered sources back onto their original references.
        const incomingSources = (payload.sources || []).map((source) => {
          const overrideReference = meta.referenceBySheet
            ? meta.referenceBySheet[source.sheetName || '']
            : undefined;
          return {
            ...source,
            sourceReference: overrideReference || source.sourceReference,
            file: {
              fileName: meta.fileName,
              fileSize: meta.fileSize,
              contentType: meta.contentType,
              objectKey: meta.objectKey || null,
            },
          };
        });
        const firstSource = incomingSources[0];
        if (!firstSource) {
          setParseState({ status: 'error', pct: 0, stage: null, error: 'no_parsed_sources' });
          reject(new Error('no_parsed_sources'));
          return;
        }
        setParsedSources((previous) => {
          const byReference = new Map(previous.map((source) => [source.sourceReference, source]));
          incomingSources.forEach((source) => byReference.set(source.sourceReference, source));
          return [...byReference.values()];
        });
        setParsedRows(firstSource.rows);
        setProfile(firstSource.profile);
        setSourceReference(firstSource.sourceReference);

        setParseState({ status: 'saving_profile', pct: 98, stage: 'saving_profile', error: null });

        try {
          const durableIncoming = incomingSources.map((source) => {
            const durableSource = { ...source };
            delete durableSource.rows;
            return durableSource;
          });
          const priorSources = [...(existingSources || []), ...parsedSources].map((source) => {
            const durableSource = { ...source };
            delete durableSource.rows;
            return durableSource;
          });
          const knownSources = new Map(priorSources.map((source) => [source.sourceReference, source]));
          durableIncoming.forEach((source) => knownSources.set(source.sourceReference, source));
          await patchWorkspaceConfig(workspaceId, {
            sourceReference: firstSource.sourceReference,
            activeSourceReference: firstSource.sourceReference,
            profile: firstSource.profile,
            headers: firstSource.headers,
            sources: [...knownSources.values()],
          });
        } catch (err) {
          // Non-fatal: profile patch failure doesn't invalidate the parsed data
          console.error('[useImportFileUpload] profile patch failed:', err);
        }

        setParseState({ status: 'done', pct: 100, stage: 'done', error: null });
        resolve(incomingSources);
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
        reject(new Error(payload.message ?? 'parse_error'));
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
      reject(err instanceof Error ? err : new Error('worker_error'));
    };

    worker.postMessage({ type: 'PARSE', payload: { buffer, filename: meta.fileName } }, [buffer]);
  }), [existingSources, parsedSources, workspaceId]);

  const parse = useCallback(() => {
    const file = fileState.file;
    if (!file) {
      setParseState((prev) => ({ ...prev, error: 'no_file_selected' }));
      return;
    }

    setParseState({ status: 'reading', pct: 0, stage: 'reading_file', error: null });
    setParsedRows(null);
    setProfile(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      parseArrayBuffer(e.target.result, {
        fileName: file['name'],
        fileSize: file.size,
        contentType: file.type,
        objectKey: uploadState.objectKey || null,
      }).catch(() => { /* parseState already carries the error */ });
    };
    reader.onerror = () => {
      setParseState({ status: 'error', pct: 0, stage: null, error: 'file_read_error' });
    };
    reader.readAsArrayBuffer(file);
  }, [fileState.file, parseArrayBuffer, uploadState.objectKey]);

  // Recover parsed rows after a refresh by re-downloading the uploaded backup
  // from R2 and re-parsing it locally. Rejects (so the caller can prompt a
  // re-upload) when the backup is missing/expired or the fetch/parse fails.
  // Pin recovered sources back onto the references already saved in config for
  // this file, so mappings and progress keyed on the originals still line up.
  const buildReferenceBySheet = useCallback((objectKey) => {
    const referenceBySheet = {};
    for (const source of existingSources || []) {
      if (objectKey && source.file?.objectKey && source.file.objectKey !== objectKey) continue;
      referenceBySheet[source.sheetName || ''] = source.sourceReference;
    }
    return referenceBySheet;
  }, [existingSources]);

  const recoverFromBackup = useCallback(async (objectKey, meta = {}) => {
    setParseState({ status: 'reading', pct: 0, stage: 'downloading_backup', error: null });

    let info;
    try {
      info = await getDownloadUrl(workspaceId, objectKey);
    } catch (err) {
      setParseState({ status: 'error', pct: 0, stage: null, error: err.message || 'backup_unavailable' });
      throw err;
    }

    let buffer;
    try {
      const res = await fetch(info.downloadUrl);
      if (!res.ok) throw new Error(`backup_fetch_failed_${res.status}`);
      buffer = await res.arrayBuffer();
    } catch (err) {
      setParseState({ status: 'error', pct: 0, stage: null, error: err.message || 'backup_fetch_failed' });
      throw err;
    }

    const resolvedKey = info.objectKey || objectKey;
    return parseArrayBuffer(buffer, {
      fileName: info.fileName || meta.fileName || 'import-file',
      fileSize: meta.fileSize || buffer.byteLength,
      contentType: meta.contentType || '',
      objectKey: resolvedKey || null,
      referenceBySheet: buildReferenceBySheet(resolvedKey),
    });
  }, [buildReferenceBySheet, parseArrayBuffer, workspaceId]);

  // Recovery fallback when the backup can't be fetched: the user re-selects the
  // same file from disk. Re-parses with the original references pinned so the
  // saved mapping is preserved (a plain parse() would mint new references).
  const recoverFromFile = useCallback((file, objectKey) => {
    if (!file) return Promise.reject(new Error('no_file_selected'));
    setParseState({ status: 'reading', pct: 0, stage: 'reading_file', error: null });
    setParsedRows(null);
    setProfile(null);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        parseArrayBuffer(e.target.result, {
          fileName: file['name'],
          fileSize: file.size,
          contentType: file.type,
          objectKey: objectKey || null,
          referenceBySheet: buildReferenceBySheet(objectKey),
        }).then(resolve, reject);
      };
      reader.onerror = () => {
        setParseState({ status: 'error', pct: 0, stage: null, error: 'file_read_error' });
        reject(new Error('file_read_error'));
      };
      reader.readAsArrayBuffer(file);
    });
  }, [buildReferenceBySheet, parseArrayBuffer]);

  const selectParsedSource = useCallback((nextSourceReference) => {
    const source = parsedSources.find((item) => item.sourceReference === nextSourceReference);
    if (!source) return;
    setSourceReference(source.sourceReference);
    setParsedRows(source.rows);
    setProfile(source.profile);
  }, [parsedSources]);

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
    parsedSources,
    selectParsedSource,
    selectFile,
    upload,
    parse,
    recoverFromBackup,
    recoverFromFile,
  };
}
