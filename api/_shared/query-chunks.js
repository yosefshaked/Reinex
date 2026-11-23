// PostgREST carries `.in(column, ids)` in the request URL. Kong rejects a URL that is too long
// (414), so a long id list must be split into several requests and the rows put back together.

export const DEFAULT_IN_CHUNK_SIZE = 100;
const DEFAULT_PAGE_SIZE = 1000;

export function chunkArray(values, size = DEFAULT_IN_CHUNK_SIZE) {
  const list = Array.isArray(values) ? values : [];
  const step = Number.isInteger(size) && size > 0 ? size : DEFAULT_IN_CHUNK_SIZE;
  const chunks = [];
  for (let index = 0; index < list.length; index += step) {
    chunks.push(list.slice(index, index + step));
  }
  return chunks;
}

/**
 * Runs `buildQuery()` once per chunk of `ids`, each with `.in(column, chunk)` added, and joins the rows
 * in chunk order. `buildQuery` must return a fresh query builder on every call.
 *
 * Returns `{ data, error }` like a single PostgREST call: the first failing chunk stops the loop and
 * its `error` is returned with `data: null`. No ids means no request and `{ data: [], error: null }`.
 *
 * `pageSize` reads each chunk a page at a time (one request returns at most 1000 rows). Give the query
 * an `.order(...)` when you use it, so the pages do not overlap.
 */
export async function selectInChunks(buildQuery, column, ids, { size = DEFAULT_IN_CHUNK_SIZE, pageSize = null } = {}) {
  const rows = [];
  for (const idChunk of chunkArray(ids, size)) {
    if (!pageSize) {
      const { data, error } = await buildQuery().in(column, idChunk);
      if (error) return { data: null, error };
      rows.push(...(data || []));
      continue;
    }
    const step = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : DEFAULT_PAGE_SIZE;
    for (let from = 0; ; from += step) {
      const { data, error } = await buildQuery().in(column, idChunk).range(from, from + step - 1);
      if (error) return { data: null, error };
      rows.push(...(data || []));
      if (!data || data.length < step) break;
    }
  }
  return { data: rows, error: null };
}
