#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { SETUP_SQL_SCRIPT } from '../src/lib/setup-sql.js';

const root = process.cwd();
const setupSql = String(SETUP_SQL_SCRIPT || '');

const API_DIR = path.join(root, 'api');
const JS_FILE_PATTERN = /\.js$/i;

const EXPECTED_CONFLICTS_BY_TABLE = {
  Settings: ['org_id,key'],
  grace_cancellation_requests: ['org_id,lesson_participant_id'],
  instructor_service_capabilities: ['org_id,employee_id,service_id'],
  instructor_profiles: ['employee_id'],
  client_guardians: ['org_id,client_profile_id,guardian_id'],
  import_rows: ['workspace_id,source_reference,row_index'],
  import_candidates: ['workspace_id,source_row_id,entity_type'],
};

function normalizeConflictValue(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join(',');
}

function readFile(absolutePath) {
  return fs.readFileSync(absolutePath, 'utf8');
}

function readRelative(absolutePath) {
  return path.relative(root, absolutePath).replaceAll('\\', '/');
}

function walkJsFiles(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const nextPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkJsFiles(nextPath));
      continue;
    }
    if (entry.isFile() && JS_FILE_PATTERN.test(entry.name)) {
      files.push(nextPath);
    }
  }
  return files;
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split('\n').length;
}

function validateWithOrgScopeUpserts() {
  const errors = [];
  const files = walkJsFiles(API_DIR);
  const usagePattern = /withOrgScope\(\s*[^,]+,\s*['"]([^'"]+)['"]\s*,\s*orgId\s*\)/g;

  for (const file of files) {
    const text = readFile(file);
    const relativePath = readRelative(file);

    let match;
    while ((match = usagePattern.exec(text)) !== null) {
      const table = match[1];
      const statementStart = match.index;
      const statementEnd = text.indexOf(';', statementStart);
      if (statementEnd === -1) {
        continue;
      }

      const statement = text.slice(statementStart, statementEnd + 1);
      if (!statement.includes('.upsert(')) {
        continue;
      }

      const conflictMatch = statement.match(/onConflict\s*:\s*['"]([^'"]+)['"]/);
      const expectedRaw = EXPECTED_CONFLICTS_BY_TABLE[table];
      const line = lineNumberAt(text, match.index);

      if (!conflictMatch) {
        errors.push(
          `${relativePath}:${line}: table '${table}' uses upsert without explicit onConflict`,
        );
        continue;
      }

      const actualConflict = normalizeConflictValue(conflictMatch[1]);

      if (!expectedRaw) {
        errors.push(
          `${relativePath}:${line}: withOrgScope().upsert() uses table '${table}' without a rule in EXPECTED_CONFLICTS_BY_TABLE`,
        );
        continue;
      }

      const expected = expectedRaw.map((value) => normalizeConflictValue(value));
      if (!expected.includes(actualConflict)) {
        errors.push(
          `${relativePath}:${line}: table '${table}' uses onConflict='${actualConflict}' but expected one of [${expected.join(', ')}]`,
        );
      }
    }
  }

  return errors;
}

function validateClientGuardiansUpsert() {
  const errors = [];
  const file = path.join(root, 'api/_shared/client-profiles.js');
  const text = readFile(file);
  const relativePath = readRelative(file);

  const upsertPattern = /\.from\(\s*['"]client_guardians['"]\s*\)\s*[\s\S]*?\.upsert\(\s*\{([\s\S]*?)\}\s*,\s*\{\s*onConflict\s*:\s*['"]([^'"]+)['"]\s*\}\s*\)/g;

  let match;
  while ((match = upsertPattern.exec(text)) !== null) {
    const payloadBlock = match[1] || '';
    const onConflict = normalizeConflictValue(match[2]);
    const line = lineNumberAt(text, match.index);

    if (!payloadBlock.includes('org_id: orgId')) {
      errors.push(`${relativePath}:${line}: client_guardians upsert payload must include org_id: orgId`);
    }

    if (onConflict !== 'org_id,client_profile_id,guardian_id') {
      errors.push(
        `${relativePath}:${line}: client_guardians upsert must use onConflict='org_id,client_profile_id,guardian_id'`,
      );
    }
  }

  return errors;
}

function validateLeaveLedgerWritesAreScoped() {
  const errors = [];
  const file = path.join(root, 'api/_shared/employee-finance.js');
  const text = readFile(file);
  const relativePath = readRelative(file);

  const forbiddenPatterns = [
    /\.from\(\s*['"]employee_leave_balance_events['"]\s*\)\s*\.insert\(/g,
    /\.from\(\s*['"]employee_leave_balance_events['"]\s*\)\s*\.delete\(/g,
    /\.from\(\s*['"]employee_leave_days['"]\s*\)\s*\.delete\(/g,
  ];

  for (const pattern of forbiddenPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const line = lineNumberAt(text, match.index);
      errors.push(`${relativePath}:${line}: leave ledger writes must use withOrgScope(..., orgId), not raw tenantClient.from(...)`);
    }
  }

  return errors;
}

// Cross-check: every conflict key registered in EXPECTED_CONFLICTS_BY_TABLE
// must have a matching CREATE UNIQUE INDEX or UNIQUE constraint in setup-sql.
// This catches the 42P10 class of bugs before they reach a live database.
function buildColPattern(cols) {
  return cols.split(',').map((c) => `"?${c.trim()}"?`).join('\\s*,\\s*');
}

function normalizeIdentifier(value) {
  return String(value || '').trim().replace(/^"|"$/g, '').toLowerCase();
}

function normalizeColumnList(value) {
  return String(value || '')
    .split(',')
    .map((segment) => normalizeIdentifier(segment))
    .filter(Boolean)
    .join(',');
}

function collectUniqueIndexes(sqlText) {
  const indexes = new Map();
  const pattern = /CREATE\s+UNIQUE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?("?[A-Za-z0-9_]+"?)\s+ON\s+public\.((?:"?[A-Za-z0-9_]+"?))\s*\(([^)]*)\)/gi;
  for (const match of sqlText.matchAll(pattern)) {
    const indexName = normalizeIdentifier(match[1]);
    const tableName = normalizeIdentifier(match[2]);
    const columns = normalizeColumnList(match[3]);
    if (!indexName || !tableName || !columns) continue;
    indexes.set(indexName, { tableName, columns });
  }
  return indexes;
}

function hasMatchingUniqueUsingIndex(sqlText, table, cols, uniqueIndexes) {
  const escapedTable = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const targetCols = normalizeColumnList(cols);
  const pattern = new RegExp(
    `ALTER TABLE\\s+public\\.(?:"?${escapedTable}"?)[\\s\\S]{0,1200}?UNIQUE\\s+USING\\s+INDEX\\s+("?[A-Za-z0-9_]+"?)`,
    'gi',
  );

  for (const match of sqlText.matchAll(pattern)) {
    const indexName = normalizeIdentifier(match[1]);
    const indexMeta = uniqueIndexes.get(indexName);
    if (!indexMeta) continue;
    if (indexMeta.tableName !== normalizeIdentifier(table)) continue;
    if (indexMeta.columns !== targetCols) continue;
    return true;
  }

  return false;
}

function validateConflictIndexesExistInSql() {
  const errs = [];
  const uniqueIndexes = collectUniqueIndexes(setupSql);

  for (const [table, expectedList] of Object.entries(EXPECTED_CONFLICTS_BY_TABLE)) {
    for (const rawColumns of expectedList) {
      const cols = normalizeConflictValue(rawColumns);
      const colPattern = buildColPattern(cols);
      const columnList = cols.split(',').map((c) => c.trim());
      const escapedTable = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      const hasIndex = new RegExp(
        `CREATE UNIQUE INDEX\\s+(?:IF NOT EXISTS\\s+)?\\w+\\s+ON\\s+public\\.(?:"?${escapedTable}"?)\\s*\\(\\s*${colPattern}\\s*\\)`,
        'i',
      ).test(setupSql);

      const hasConstraint = new RegExp(
        `ALTER TABLE\\s+public\\.(?:"?${escapedTable}"?)[\\s\\S]{0,800}?UNIQUE\\s*\\(\\s*${colPattern}\\s*\\)`,
        'i',
      ).test(setupSql);

      const hasConstraintUsingIndex = hasMatchingUniqueUsingIndex(setupSql, table, cols, uniqueIndexes);

      const hasPrimaryKey = columnList.length === 1 && new RegExp(
        `CREATE TABLE IF NOT EXISTS\\s+public\\.(?:"?${escapedTable}"?)[\\s\\S]{0,2000}?"?${columnList[0]}"?[^\\n]*(PRIMARY KEY)`,
        'i',
      ).test(setupSql);

      if (!hasIndex && !hasConstraint && !hasConstraintUsingIndex && !hasPrimaryKey) {
        errs.push(
          `Table '${table}' uses onConflict='${cols}' but no matching CREATE UNIQUE INDEX, UNIQUE constraint, or PRIMARY KEY was found in setup-sql.js. Without this the ON CONFLICT upsert will fail at runtime with 42P10.`,
        );
      }
    }
  }

  return errs;
}

const errors = [
  ...validateWithOrgScopeUpserts(),
  ...validateClientGuardiansUpsert(),
  ...validateLeaveLedgerWritesAreScoped(),
  ...validateConflictIndexesExistInSql(),
];

if (errors.length > 0) {
  console.error('Org-scope write validation failed:');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log('Org-scope write validation passed.');
