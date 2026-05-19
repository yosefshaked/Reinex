#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const API_DIR = path.join(root, 'api');
const JS_FILE_PATTERN = /\.js$/i;

const EXPECTED_CONFLICTS_BY_TABLE = {
  Settings: ['org_id,key'],
  grace_cancellation_requests: ['org_id,lesson_participant_id'],
  instructor_service_capabilities: ['org_id,employee_id,service_id'],
  instructor_profiles: ['employee_id'],
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

const errors = [
  ...validateWithOrgScopeUpserts(),
  ...validateClientGuardiansUpsert(),
  ...validateLeaveLedgerWritesAreScoped(),
];

if (errors.length > 0) {
  console.error('Org-scope write validation failed:');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log('Org-scope write validation passed.');
