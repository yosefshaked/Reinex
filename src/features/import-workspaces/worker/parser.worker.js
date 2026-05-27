/**
 * parser.worker.js — Web Worker for CPU-intensive file parsing.
 *
 * Receives:  { type: 'PARSE', payload: { buffer: ArrayBuffer, filename: string } }
 * Emits:
 *   { type: 'PROGRESS',      payload: { pct: number, stage: string } }
 *   { type: 'PARSE_COMPLETE', payload: { headers, rows, sourceReference, profile } }
 *   { type: 'ERROR',          payload: { message: string } }
 *
 * Security: runs in an isolated Worker context — prototype pollution from
 * malicious file contents cannot reach the main thread's object graph.
 */

import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import jschardet from 'jschardet';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function postProgress(pct, stage) {
  self.postMessage({ type: 'PROGRESS', payload: { pct, stage } });
}

function postError(message) {
  self.postMessage({ type: 'ERROR', payload: { message } });
}

/**
 * Derive a stable, filesystem-safe source reference from the filename.
 * Format: <sanitized-basename>_<unix-seconds>
 */
function generateSourceReference(filename) {
  const basename = filename.replace(/\.[^.]+$/, ''); // strip extension
  const safe = basename
    .replace(/[^a-zA-Z0-9_\u0590-\u05FF\s-]/g, '') // keep alphanum, Hebrew, hyphens, spaces
    .replace(/\s+/g, '_')
    .slice(0, 80);
  return `${safe || 'file'}_${Math.floor(Date.now() / 1000)}`;
}

/**
 * Detect the likely entity type from column headers using simple heuristics.
 */
const STUDENT_HINTS = ['שם', 'name', 'student', 'תלמיד', 'ילד', 'child', 'first', 'last'];
const GUARDIAN_HINTS = ['parent', 'guardian', 'הורה', 'אמא', 'אבא', 'mother', 'father'];
const EMPLOYEE_HINTS = ['employee', 'instructor', 'teacher', 'מורה', 'מדריך', 'עובד'];

function detectEntityType(headers) {
  const joined = headers.join(' ').toLowerCase();
  if (EMPLOYEE_HINTS.some((h) => joined.includes(h))) return 'employee';
  if (GUARDIAN_HINTS.some((h) => joined.includes(h))) return 'guardian';
  if (STUDENT_HINTS.some((h) => joined.includes(h))) return 'student';
  return 'unknown';
}

/**
 * Build a profile summary from the parsed result.
 */
function profileSheet(headers, rows) {
  return {
    totalRows: rows.length,
    headers,
    likelyEntityType: detectEntityType(headers),
  };
}

// ---------------------------------------------------------------------------
// Value normalisation
// ---------------------------------------------------------------------------

const PHONE_HEADER_RE = /phone|tel|mobile|טלפון|נייד|פלאפון/i;
const ID_HEADER_RE = /id|ת\.?ז|תעודת|identity/i;

function normaliseValue(raw, header) {
  if (raw === null || raw === undefined || raw === '') return null;

  // ExcelJS returns Date objects for date cells
  if (raw instanceof Date) {
    return isNaN(raw.getTime()) ? null : raw.toISOString().slice(0, 10);
  }

  const str = String(raw).trim();
  if (str === '') return null;

  // Phone / ID columns: strip non-digit characters
  if (PHONE_HEADER_RE.test(header) || ID_HEADER_RE.test(header)) {
    return str.replace(/\D/g, '') || null;
  }

  return str;
}

function normaliseRow(rawObj, headers) {
  const out = {};
  for (const h of headers) {
    out[h] = normaliseValue(rawObj[h], h);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Format-specific parsers
// ---------------------------------------------------------------------------

async function parseExcel(buffer) {
  postProgress(10, 'loading_excel');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('excel_no_worksheets');

  postProgress(30, 'reading_sheet');

  // Row 1 = headers
  const headerRow = sheet.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: false }, (cell) => {
    headers.push(String(cell.value ?? '').trim());
  });

  if (headers.length === 0) throw new Error('excel_no_headers');

  postProgress(50, 'extracting_rows');

  const rows = [];
  const rowCount = sheet.rowCount;

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // skip header row
    const obj = {};
    headers.forEach((h, idx) => {
      const cell = row.getCell(idx + 1);
      obj[h] = cell.value;
    });
    rows.push(normaliseRow(obj, headers));

    if (rowNumber % 1000 === 0) {
      const pct = 50 + Math.min(40, Math.round((rowNumber / rowCount) * 40));
      postProgress(pct, 'extracting_rows');
    }
  });

  return { headers, rows };
}

async function parseCsv(buffer) {
  postProgress(10, 'detecting_encoding');

  // Detect encoding from first 8 KB — use binary string (Buffer not available in browser)
  const probeBytes = new Uint8Array(buffer.slice(0, 8192));
  let binaryStr = '';
  for (let i = 0; i < probeBytes.length; i++) binaryStr += String.fromCharCode(probeBytes[i]);
  const detected = jschardet.detect(binaryStr);
  const encoding = (detected?.encoding || 'UTF-8').toUpperCase();

  postProgress(20, 'decoding_text');

  // Decode the buffer to a string
  let text;
  try {
    const decoder = new TextDecoder(encoding === 'ASCII' ? 'utf-8' : encoding);
    text = decoder.decode(buffer);
  } catch {
    // fallback to utf-8 if the detected encoding is not supported
    text = new TextDecoder('utf-8').decode(buffer);
  }

  postProgress(30, 'parsing_csv');

  const result = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  if (result.errors.length > 0 && result.data.length === 0) {
    throw new Error(`csv_parse_error: ${result.errors[0].message}`);
  }

  const headers = result.meta.fields ?? [];
  if (headers.length === 0) throw new Error('csv_no_headers');

  postProgress(60, 'normalising_rows');

  const rows = result.data.map((rawObj) => normaliseRow(rawObj, headers));

  return { headers, rows };
}

// ---------------------------------------------------------------------------
// Main message handler
// ---------------------------------------------------------------------------

self.addEventListener('message', async (event) => {
  const { type, payload } = event.data ?? {};
  if (type !== 'PARSE') return;

  const { buffer, filename } = payload ?? {};

  if (!buffer || !filename) {
    postError('missing_buffer_or_filename');
    return;
  }

  try {
    const lowerName = filename.toLowerCase();
    const isExcel =
      lowerName.endsWith('.xlsx') ||
      lowerName.endsWith('.xls') ||
      lowerName.endsWith('.xlsm');

    let headers;
    let rows;

    if (isExcel) {
      ({ headers, rows } = await parseExcel(buffer));
    } else {
      ({ headers, rows } = await parseCsv(buffer));
    }

    postProgress(95, 'profiling');

    const sourceReference = generateSourceReference(filename);
    const profile = profileSheet(headers, rows);

    postProgress(100, 'done');

    self.postMessage({
      type: 'PARSE_COMPLETE',
      payload: { headers, rows, sourceReference, profile },
    });
  } catch (err) {
    postError(err?.message ?? 'unknown_parse_error');
  }
});
