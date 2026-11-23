#!/usr/bin/env node
/**
 * validate-plans-index.js
 *
 * Checks docs/plans/index.csv, the only record of each plan's overall status.
 * See docs/plans/README.md.
 *
 * - The header is exactly three fields: path, title, status (compared field by field).
 * - Fields follow standard CSV quoting (RFC 4180): a field with a comma, a double quote or a
 *   line break is wrapped in double quotes, and an inner double quote is written twice.
 * - Each record has exactly 3 fields, a non-empty title and a status of
 *   planned | active | completed | canceled.
 * - `path` is relative to docs/plans/, uses forward slashes, is `<topic>/<plan>.md`, and names a
 *   regular plan file the checker found there (a folder named `x.md` is not a plan).
 * - No path is listed twice, and every `docs/plans/<topic>/<plan>.md` (except README.md) has a row.
 *
 * Usage: node scripts/validate-plans-index.js [--dir <plans directory>]
 * Exits 1 on any finding and names the record and the reason.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const HEADER = ['path', 'title', 'status'];
export const STATUSES = ['planned', 'active', 'completed', 'canceled'];
const PLAN_PATH = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9.-]*\.md$/;

/**
 * Parses CSV text (RFC 4180). Returns { records, errors }.
 * Each record is { line, fields } where `line` is the 1-based line the record starts on.
 */
export function parseCsv(text) {
  const records = [];
  const errors = [];
  let fields = [];
  let field = '';
  let quoted = false;
  let fieldStarted = false;
  let line = 1;
  let recordLine = 1;
  let i = 0;

  const endField = () => {
    fields.push(field);
    field = '';
    fieldStarted = false;
  };
  const endRecord = () => {
    endField();
    records.push({ line: recordLine, fields });
    fields = [];
  };

  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        const next = text[i];
        if (next !== undefined && next !== ',' && next !== '\r' && next !== '\n') {
          errors.push(`line ${line}: unexpected character after a closing quote`);
          return { records, errors };
        }
        continue;
      }
      if (ch === '\n') line += 1;
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      if (fieldStarted) {
        errors.push(`line ${line}: a double quote inside an unquoted field (wrap the field in quotes and double the inner quote)`);
        return { records, errors };
      }
      quoted = true;
      fieldStarted = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      endField();
      i += 1;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      endRecord();
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
      line += 1;
      recordLine = line;
      continue;
    }
    field += ch;
    fieldStarted = true;
    i += 1;
  }

  if (quoted) {
    errors.push(`line ${recordLine}: unterminated quoted field`);
    return { records, errors };
  }
  if (fieldStarted || field !== '' || fields.length > 0) endRecord();
  return { records, errors };
}

function listPlanFiles(plansDir) {
  const found = [];
  const misplaced = [];
  for (const entry of fs.readdirSync(plansDir, { withFileTypes: true })) {
    if (entry.isFile()) {
      if (entry.name.endsWith('.md') && entry.name !== 'README.md') misplaced.push(entry.name);
      continue;
    }
    if (!entry.isDirectory()) continue;
    for (const inner of fs.readdirSync(path.join(plansDir, entry.name), { withFileTypes: true })) {
      if (inner.isFile() && inner.name.endsWith('.md') && inner.name !== 'README.md') {
        found.push(`${entry.name}/${inner.name}`);
      }
    }
  }
  return { found: found.sort(), misplaced: misplaced.sort() };
}

/**
 * Validates the registry in `plansDir`. Returns { errors, rows }.
 */
export function validatePlansIndex(plansDir) {
  const errors = [];
  const indexPath = path.join(plansDir, 'index.csv');
  if (!fs.existsSync(indexPath)) {
    return { errors: [`${indexPath} does not exist`], rows: [] };
  }

  const parsed = parseCsv(fs.readFileSync(indexPath, 'utf8'));
  if (parsed.errors.length > 0) return { errors: parsed.errors, rows: [] };

  const [header, ...records] = parsed.records;
  // Compare field by field: a single quoted field "path,title,status" is one field, not a header.
  const headerOk = header
    && header.fields.length === HEADER.length
    && HEADER.every((name, index) => header.fields[index] === name);
  if (!headerOk) {
    errors.push(`line 1: header must be exactly the three fields ${HEADER.join(', ')}`);
    return { errors, rows: [] };
  }

  // Rows are matched against the plan files the checker discovers, so a folder named "x.md"
  // or any other non-file entry never counts as a plan.
  const { found, misplaced } = listPlanFiles(plansDir);
  const planFiles = new Set(found);

  const rows = [];
  const seen = new Map();
  records.forEach((record, index) => {
    const where = `record ${index + 1} (line ${record.line})`;
    if (record.fields.length !== HEADER.length) {
      errors.push(`${where}: expected ${HEADER.length} fields, found ${record.fields.length}`);
      return;
    }
    const [planPath, title, status] = record.fields;
    if (!PLAN_PATH.test(planPath) || planPath.endsWith('/README.md')) {
      errors.push(`${where}: path "${planPath}" must be "<topic>/<plan>.md", relative to docs/plans/, lowercase, with forward slashes`);
    } else if (!planFiles.has(planPath)) {
      errors.push(`${where}: path "${planPath}" is not a plan file in docs/plans/<topic>/ (missing, or not a regular file)`);
    }
    if (title.trim() === '') errors.push(`${where}: title is empty`);
    if (!STATUSES.includes(status)) {
      errors.push(`${where}: status "${status}" is not one of ${STATUSES.join(', ')}`);
    }
    if (seen.has(planPath)) {
      errors.push(`${where}: path "${planPath}" is already listed in record ${seen.get(planPath)}`);
    } else {
      seen.set(planPath, index + 1);
    }
    rows.push({ path: planPath, title, status });
  });

  for (const file of misplaced) {
    errors.push(`${file}: a plan must be in a topic folder (docs/plans/<topic>/<plan>.md)`);
  }
  for (const file of found) {
    if (!seen.has(file)) errors.push(`${file}: plan has no row in index.csv`);
  }

  return { errors, rows };
}

function main() {
  const args = process.argv.slice(2);
  const dirFlag = args.indexOf('--dir');
  const plansDir = path.resolve(dirFlag >= 0 ? args[dirFlag + 1] : path.join('docs', 'plans'));
  const { errors, rows } = validatePlansIndex(plansDir);
  if (errors.length > 0) {
    console.error(`Plans index check failed (${errors.length}):`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  const counts = STATUSES.map((status) => `${status} ${rows.filter((row) => row.status === status).length}`);
  console.log(`Plans index OK: ${rows.length} plan(s) (${counts.join(', ')}).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
