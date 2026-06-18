import { useCallback, useEffect, useRef, useState } from 'react';
import { analyzeChunk, ingestRowsBulk, patchWorkspaceConfig } from '../api/importWorkspacesApi.js';

const INGEST_CHUNK_SIZE = 500;
const ANALYSIS_CHUNK_SIZE = 100;

const IDLE_STATE = {
  phase: 'idle',
  status: 'idle',
  currentSourceLabel: '',
  processed: 0,
  total: 0,
  error: null,
};

export function getSourceTotalRows(source) {
  return Number(source?.profile?.rowCount ?? source?.profile?.totalRows ?? source?.rows?.length ?? 0);
}

export function getMappedSourceReferences(config = {}) {
  const anchorReferences = [];
  const participatingReferences = new Set();
  const requiredReferencesByAnchor = new Map();

  for (const [anchorReference, mapping] of Object.entries(config.mappings?.by_source || {})) {
    const entityMappings = mapping?.entities
      ? Object.values(mapping.entities).filter((entity) => entity?.enabled)
      : [mapping];
    if (!entityMappings.some((entity) => Object.keys(entity?.field_map || {}).length > 0)) continue;

    const requiredReferences = new Set([anchorReference]);
    entityMappings.forEach((entity) => Object.values(entity?.field_map || {}).forEach((fieldSource) => {
      if (fieldSource?.source_reference) requiredReferences.add(fieldSource.source_reference);
    }));

    anchorReferences.push(anchorReference);
    requiredReferencesByAnchor.set(anchorReference, requiredReferences);
    requiredReferences.forEach((reference) => participatingReferences.add(reference));
  }

  return { anchorReferences, participatingReferences, requiredReferencesByAnchor };
}

function sourceLabel(source) {
  return source?.label || source?.sheetName || source?.filename || source?.sourceReference || '';
}

function errorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithSingleRetry(operation) {
  try {
    return await operation();
  } catch {
    await delay(750);
    return operation();
  }
}

export function useImportProcessing(
  workspaceId,
  { sources = [], config = {}, getParsedRows, ingestedRowsBySource = {} },
) {
  const [state, setState] = useState(IDLE_STATE);
  const [sourceProgress, setSourceProgress] = useState({});
  const cancelledRef = useRef(false);
  const runningRef = useRef(null);
  const sourcesRef = useRef(sources);
  const configRef = useRef(config);
  const getParsedRowsRef = useRef(getParsedRows);
  const progressRef = useRef({});

  sourcesRef.current = sources;
  configRef.current = config;
  getParsedRowsRef.current = getParsedRows;

  useEffect(() => {
    const persisted = config.operationProgress?.by_source || {};
    const next = { ...progressRef.current };
    for (const source of sources) {
      const reference = source.sourceReference;
      if (!reference) continue;
      const saved = persisted[reference] || {};
      const legacy = sources.length === 1 ? config.operationProgress || {} : {};
      const databaseCount = Number(ingestedRowsBySource[reference] || 0);
      next[reference] = {
        ...saved,
        ...next[reference],
        uploadedRows: Math.max(
          Number(saved.uploadedRows || legacy.uploadedRows || 0),
          Number(next[reference]?.uploadedRows || 0),
          databaseCount,
        ),
        analyzedRows: Math.max(
          Number(saved.analyzedRows || legacy.analyzedRows || 0),
          Number(next[reference]?.analyzedRows || 0),
        ),
      };
    }
    progressRef.current = next;
    setSourceProgress(next);
  }, [config, ingestedRowsBySource, sources]);

  useEffect(() => () => {
    cancelledRef.current = true;
  }, []);

  const updateSourceProgress = useCallback((reference, patch) => {
    const next = {
      ...progressRef.current,
      [reference]: {
        ...progressRef.current[reference],
        ...patch,
      },
    };
    progressRef.current = next;
    setSourceProgress(next);
  }, []);

  const resetAnalysisProgress = useCallback((reference) => {
    if (!reference) return;
    updateSourceProgress(reference, { analyzedRows: 0 });
  }, [updateSourceProgress]);

  const ingestAll = useCallback(async () => {
    if (!workspaceId || runningRef.current) return false;

    const ingestibleSources = sourcesRef.current
      .map((source) => ({ source, rows: getParsedRowsRef.current?.(source.sourceReference) }))
      .filter(({ source, rows }) => source.sourceReference && Array.isArray(rows) && rows.length > 0);
    if (ingestibleSources.length === 0) return false;

    const total = ingestibleSources.reduce((sum, { rows }) => sum + rows.length, 0);
    let processed = ingestibleSources.reduce((sum, { source, rows }) => (
      sum + Math.min(Number(progressRef.current[source.sourceReference]?.uploadedRows || 0), rows.length)
    ), 0);

    cancelledRef.current = false;
    runningRef.current = 'ingest';
    setState({
      phase: 'ingest',
      status: 'running',
      currentSourceLabel: sourceLabel(ingestibleSources[0]?.source),
      processed,
      total,
      error: null,
    });

    try {
      for (const { source, rows } of ingestibleSources) {
        if (cancelledRef.current) return false;
        const reference = source.sourceReference;
        let uploadedRows = Math.min(Number(progressRef.current[reference]?.uploadedRows || 0), rows.length);
        if (uploadedRows >= rows.length) continue;

        setState((previous) => ({ ...previous, currentSourceLabel: sourceLabel(source) }));
        while (uploadedRows < rows.length) {
          if (cancelledRef.current) return false;
          const sliceEnd = Math.min(uploadedRows + INGEST_CHUNK_SIZE, rows.length);
          const chunkRows = rows.slice(uploadedRows, sliceEnd).map((rawData, index) => ({
            row_index: uploadedRows + index,
            raw_data: rawData,
          }));
          const chunkIndex = Math.floor(uploadedRows / INGEST_CHUNK_SIZE);
          const totalChunks = Math.ceil(rows.length / INGEST_CHUNK_SIZE);

          await runWithSingleRetry(() => ingestRowsBulk(workspaceId, reference, chunkRows));
          processed += sliceEnd - uploadedRows;
          uploadedRows = sliceEnd;

          const progressPatch = {
            uploadedRows,
            totalRows: rows.length,
            currentChunk: chunkIndex,
            totalChunks,
            lastSuccessAt: new Date().toISOString(),
          };
          updateSourceProgress(reference, progressPatch);
          setState((previous) => ({ ...previous, processed }));

          try {
            await patchWorkspaceConfig(workspaceId, {
              operationProgress: { by_source: { [reference]: progressPatch } },
            });
          } catch (patchError) {
            console.error('[useImportProcessing] ingest progress patch failed:', patchError);
          }
        }
      }

      if (!cancelledRef.current) {
        setState({
          phase: 'ingest',
          status: 'done',
          currentSourceLabel: '',
          processed: total,
          total,
          error: null,
        });
        return true;
      }
      return false;
    } catch (error) {
      setState((previous) => ({
        ...previous,
        status: 'error',
        error: errorMessage(error, 'chunk_failed'),
      }));
      return false;
    } finally {
      runningRef.current = null;
    }
  }, [updateSourceProgress, workspaceId]);

  const analyzeAll = useCallback(async ({ forceReferences = [] } = {}) => {
    if (!workspaceId || runningRef.current) return false;

    const currentSources = sourcesRef.current;
    const sourcesByReference = new Map(currentSources.map((source) => [source.sourceReference, source]));
    const { anchorReferences, requiredReferencesByAnchor } = getMappedSourceReferences(configRef.current);
    if (anchorReferences.length === 0) return false;

    const forceSet = new Set(forceReferences);
    const analyzableSources = anchorReferences
      .map((reference) => sourcesByReference.get(reference))
      .filter((source) => getSourceTotalRows(source) > 0);
    const readySources = analyzableSources.filter((source) => (
      [...(requiredReferencesByAnchor.get(source.sourceReference) || [])].every((reference) => {
        const requiredSource = sourcesByReference.get(reference);
        const requiredTotal = getSourceTotalRows(requiredSource);
        return requiredTotal > 0
          && Number(progressRef.current[reference]?.uploadedRows || 0) >= requiredTotal;
      })
    ));
    const pendingSources = readySources.filter((source) => (
      forceSet.has(source.sourceReference)
      || Number(progressRef.current[source.sourceReference]?.analyzedRows || 0) < getSourceTotalRows(source)
    ));
    if (pendingSources.length === 0) return false;

    const total = pendingSources.reduce((sum, source) => sum + getSourceTotalRows(source), 0);
    let processed = pendingSources.reduce((sum, source) => (
      forceSet.has(source.sourceReference) ? sum : (
      sum + Math.min(
        Number(progressRef.current[source.sourceReference]?.analyzedRows || 0),
        getSourceTotalRows(source),
      )
      )
    ), 0);

    cancelledRef.current = false;
    runningRef.current = 'analyze';
    setState({
      phase: 'analyze',
      status: 'running',
      currentSourceLabel: sourceLabel(pendingSources[0]),
      processed,
      total,
      error: null,
    });

    try {
      for (const source of pendingSources) {
        if (cancelledRef.current) return false;
        const reference = source.sourceReference;
        const sourceTotal = getSourceTotalRows(source);
        let analyzedRows = forceSet.has(reference)
          ? 0
          : Math.min(Number(progressRef.current[reference]?.analyzedRows || 0), sourceTotal);
        if (analyzedRows >= sourceTotal) continue;

        setState((previous) => ({ ...previous, currentSourceLabel: sourceLabel(source) }));
        while (analyzedRows < sourceTotal) {
          if (cancelledRef.current) return false;
          const rowIndexTo = Math.min(analyzedRows + ANALYSIS_CHUNK_SIZE - 1, sourceTotal - 1);
          const chunkIndex = Math.floor(analyzedRows / ANALYSIS_CHUNK_SIZE);
          const totalChunks = Math.ceil(sourceTotal / ANALYSIS_CHUNK_SIZE);

          await runWithSingleRetry(() => analyzeChunk(
            workspaceId,
            reference,
            analyzedRows,
            rowIndexTo,
          ));
          processed += rowIndexTo + 1 - analyzedRows;
          analyzedRows = rowIndexTo + 1;

          const progressPatch = {
            analyzedRows,
            totalRows: sourceTotal,
            currentChunk: chunkIndex,
            totalChunks,
            lastSuccessAt: new Date().toISOString(),
          };
          updateSourceProgress(reference, progressPatch);
          setState((previous) => ({ ...previous, processed }));

          try {
            await patchWorkspaceConfig(workspaceId, {
              operationProgress: { by_source: { [reference]: progressPatch } },
            });
          } catch (patchError) {
            console.error('[useImportProcessing] analysis progress patch failed:', patchError);
          }
        }
      }

      if (!cancelledRef.current) {
        const allAnchorsComplete = analyzableSources.every((source) => (
          Number(progressRef.current[source.sourceReference]?.analyzedRows || 0) >= getSourceTotalRows(source)
        ));
        setState({
          phase: allAnchorsComplete ? 'done' : 'analyze',
          status: allAnchorsComplete ? 'done' : 'idle',
          currentSourceLabel: '',
          processed: total,
          total,
          error: null,
        });
        return true;
      }
      return false;
    } catch (error) {
      setState((previous) => ({
        ...previous,
        status: 'error',
        error: errorMessage(error, 'chunk_analysis_failed'),
      }));
      return false;
    } finally {
      runningRef.current = null;
    }
  }, [updateSourceProgress, workspaceId]);

  const { anchorReferences } = getMappedSourceReferences(config);
  const sourcesByReference = new Map(sources.map((source) => [source.sourceReference, source]));
  const ingestTotal = sources.reduce((sum, source) => sum + getSourceTotalRows(source), 0);
  const analyzedTotal = anchorReferences.reduce((sum, reference) => (
    sum + getSourceTotalRows(sourcesByReference.get(reference))
  ), 0);
  const ingested = sources.reduce((sum, source) => {
    const total = getSourceTotalRows(source);
    return sum + Math.min(Number(sourceProgress[source.sourceReference]?.uploadedRows || 0), total);
  }, 0);
  const analyzed = anchorReferences.reduce((sum, reference) => {
    const total = getSourceTotalRows(sourcesByReference.get(reference));
    return sum + Math.min(Number(sourceProgress[reference]?.analyzedRows || 0), total);
  }, 0);
  const aggregateTotal = ingestTotal + analyzedTotal;
  const aggregateProcessed = ingested + analyzed;

  return {
    ...state,
    processed: aggregateProcessed,
    total: aggregateTotal,
    sourceProgress,
    progress: aggregateTotal > 0 ? aggregateProcessed / aggregateTotal : 0,
    ingestAll,
    analyzeAll,
    resetAnalysisProgress,
  };
}
