#!/usr/bin/env node
import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SETUP_SQL_SCRIPT } from '../src/lib/setup-sql.js';

const sql = String(SETUP_SQL_SCRIPT || '');

const RULES = {
  TABLE_IF_NOT_EXISTS: 'SQL001',
  INDEX_IF_NOT_EXISTS: 'SQL002',
  ADD_COLUMN_IF_NOT_EXISTS: 'SQL003',
  TABLE_RLS_COVERAGE: 'SQL004',
  TABLE_GRANT_COVERAGE: 'SQL005',
  TABLE_POLICY_COVERAGE: 'SQL006',
  UNIQUE_GUARD: 'SQL007',
  APP_USER_ROLE: 'SQL008',
  PUBLIC_SCHEMA_USAGE: 'SQL009',
  ORG_ID_COLUMN: 'SQL010',
  GET_ACTIVE_ORG_ID: 'SQL011',
  FK_REFERENCE_ORDER: 'SQL012',
  CREATE_TABLE_UNIQUE_USING_INDEX: 'SQL013',
  TABLE_OPERATION_ORDER: 'SQL014',
  FRONTEND_RPC_COVERAGE: 'SQL015',
  BROAD_EXCEPTION_SWALLOW: 'SQL101',
  DESTRUCTIVE_DROP_TABLE: 'SQL102',
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

function parseArgs(argv) {
  const options = {
    format: 'text',
    strict: false,
    quiet: false,
    maxWarnings: null,
  };

  for (const arg of argv) {
    if (arg === '--strict') {
      options.strict = true;
      continue;
    }

    if (arg === '--quiet') {
      options.quiet = true;
      continue;
    }

    if (arg.startsWith('--format=')) {
      options.format = arg.slice('--format='.length).trim() || 'text';
      continue;
    }

    if (arg.startsWith('--max-warnings=')) {
      const raw = arg.slice('--max-warnings='.length).trim();
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed >= 0) {
        options.maxWarnings = parsed;
      }
      continue;
    }
  }

  if (!['text', 'json', 'github'].includes(options.format)) {
    throw new Error(`Unsupported format "${options.format}". Use text, json, or github.`);
  }

  return options;
}

function normalizeIdentifier(identifier) {
  return String(identifier || '')
    .trim()
    .replace(/^public\./i, '')
    .replace(/^"(.*)"$/, '$1');
}

function unique(values) {
  return Array.from(new Set(values));
}

function buildLineIndex(text) {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') {
      starts.push(index + 1);
    }
  }
  return starts;
}

const lineStarts = buildLineIndex(sql);

function offsetToPosition(offset = 0) {
  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lineStarts[mid] <= offset) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const lineIndex = Math.max(0, high);
  const line = lineIndex + 1;
  const column = offset - lineStarts[lineIndex] + 1;
  return { line, column };
}

const findings = [];

function addFinding({ severity, ruleId, message, line = null, column = null, context = null }) {
  findings.push({ severity, ruleId, message, line, column, context });
}

function addError(ruleId, message, position = {}) {
  addFinding({ severity: 'error', ruleId, message, ...position });
}

function addWarning(ruleId, message, position = {}) {
  addFinding({ severity: 'warning', ruleId, message, ...position });
}

function collectMatches(pattern, mapper = (match) => match[1]) {
  return unique(Array.from(sql.matchAll(pattern), mapper).filter(Boolean));
}

function extractArrayTableNames() {
  const names = [];
  const arrayBlocks = Array.from(sql.matchAll(/FOREACH\s+tbl\s+IN\s+ARRAY\s+ARRAY\[(.*?)\]\s*LOOP/gs));
  for (const block of arrayBlocks) {
    const quoted = block[1].matchAll(/'([^']+)'/g);
    for (const match of quoted) {
      names.push(normalizeIdentifier(match[1]));
    }
  }
  return unique(names);
}

// These tables intentionally have no GRANT to app_user — service_role access
// only. The hard permission denial is the intended security boundary.
const TABLES_WITHOUT_APP_USER_GRANT = new Set([
  'admin_data',
  'email_log',
]);

// These control-DB tables have hand-written RLS policies and are intentionally
// excluded from the generated tenant RLS policy loop (SQL006).
const TABLES_WITH_CUSTOM_RLS = new Set([
  'organizations',
  'profiles',
  'org_memberships',
  'org_invitations',
  'permission_registry',
  'active_routing',
  'audit_log',
  'impersonation_sessions',
  'admin_data',
  'email_log',
]);

function validatePresenceCoverage() {
  const createdTables = collectMatches(/CREATE TABLE IF NOT EXISTS\s+public\.("?[\w]+"?)/g, (match) => normalizeIdentifier(match[1]));
  const rlsTables = collectMatches(/ALTER TABLE\s+public\.("?[\w]+"?)\s+ENABLE ROW LEVEL SECURITY;/g, (match) => normalizeIdentifier(match[1]));
  const grantTables = collectMatches(/GRANT ALL ON TABLE\s+public\.("?[\w]+"?)\s+TO app_user;/g, (match) => normalizeIdentifier(match[1]));
  const policyTables = extractArrayTableNames();

  for (const tableName of createdTables) {
    const createMatch = sql.match(new RegExp(`CREATE TABLE IF NOT EXISTS\\s+public\\.${tableName.replace(/"/g, '\\"')}`, 'i'));
    const position = createMatch?.index !== undefined ? offsetToPosition(createMatch.index) : {};

    if (!rlsTables.includes(tableName)) {
      addError(RULES.TABLE_RLS_COVERAGE, `Table "${tableName}" is missing ENABLE ROW LEVEL SECURITY coverage.`, position);
    }

    if (!grantTables.includes(tableName) && !TABLES_WITHOUT_APP_USER_GRANT.has(tableName)) {
      addError(RULES.TABLE_GRANT_COVERAGE, `Table "${tableName}" is missing GRANT ALL ... TO app_user coverage.`, position);
    }

    if (!policyTables.includes(tableName) && !TABLES_WITH_CUSTOM_RLS.has(tableName)) {
      addError(RULES.TABLE_POLICY_COVERAGE, `Table "${tableName}" is missing from the generated RLS policy loop.`, position);
    }
  }
}

function validateCreateStatements() {
  const nonIdempotentCreateTables = Array.from(sql.matchAll(/CREATE TABLE\s+(?!IF NOT EXISTS)\s+public\./g));
  for (const match of nonIdempotentCreateTables) {
    addError(
      RULES.TABLE_IF_NOT_EXISTS,
      'Found non-idempotent CREATE TABLE. Use CREATE TABLE IF NOT EXISTS.',
      offsetToPosition(match.index),
    );
  }

  const nonIdempotentCreateIndexes = Array.from(sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF NOT EXISTS)/g));
  for (const match of nonIdempotentCreateIndexes) {
    addError(
      RULES.INDEX_IF_NOT_EXISTS,
      'Found non-idempotent CREATE INDEX. Use CREATE INDEX IF NOT EXISTS.',
      offsetToPosition(match.index),
    );
  }

  const lines = sql.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (!line.includes('ADD COLUMN')) {
      continue;
    }

    const normalized = line.trim();
    if (normalized.startsWith('ADD COLUMN ') && !normalized.startsWith('ADD COLUMN IF NOT EXISTS ')) {
      addError(
        RULES.ADD_COLUMN_IF_NOT_EXISTS,
        'Found ALTER TABLE ... ADD COLUMN without IF NOT EXISTS.',
        { line: index + 1, column: line.indexOf('ADD COLUMN') + 1 },
      );
    }
  }
}

function validateUniqueConstraintGuards() {
  const uniqueConstraintStatements = Array.from(
    sql.matchAll(/ADD CONSTRAINT\s+"?([\w]+)"?\s+UNIQUE\b(?!\s+USING\s+INDEX)/g),
  );

  for (const match of uniqueConstraintStatements) {
    const constraintName = match[1];
    const hasConstraintExistenceGuard =
      sql.includes(`conname = '${constraintName}'`) ||
      sql.includes(`conname = "${constraintName}"`) ||
      sql.includes(`DROP CONSTRAINT IF EXISTS ${constraintName}`) ||
      sql.includes(`DROP CONSTRAINT IF EXISTS "${constraintName}"`);

    if (!hasConstraintExistenceGuard) {
      addError(
        RULES.UNIQUE_GUARD,
        `UNIQUE constraint "${constraintName}" is added without a clear idempotency guard.`,
        offsetToPosition(match.index),
      );
    }
  }
}

function validateRlsEngineering() {
  const createdTables = collectMatches(/CREATE TABLE IF NOT EXISTS\s+public\.("?[\w]+"?)/g, (match) => normalizeIdentifier(match[1]));
  if (!createdTables.length) {
    addError(RULES.TABLE_RLS_COVERAGE, 'No public tables were detected in SETUP_SQL_SCRIPT. The validator may be reading the wrong source.');
  }

  const appUserMatch = sql.match(/CREATE ROLE app_user;/i);
  if (!appUserMatch) {
    addError(RULES.APP_USER_ROLE, 'The setup SQL does not create the app_user role.');
  }

  const schemaUsageMatch = sql.match(/GRANT USAGE ON SCHEMA public TO app_user;/i);
  if (!schemaUsageMatch) {
    addError(RULES.PUBLIC_SCHEMA_USAGE, 'The setup SQL is missing GRANT USAGE ON SCHEMA public TO app_user.');
  }

  // SQL011: The get_active_org_id() function powers all tenant RLS policies.
  // If it is missing the entire tenant isolation model silently breaks.
  if (!sql.match(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_active_org_id\s*\(/i)) {
    addError(RULES.GET_ACTIVE_ORG_ID, 'get_active_org_id() function is not defined. All tenant RLS policies depend on it.');
  }
}

// SQL010: Every table enrolled in the tenant RLS policy loop must declare an
// org_id column so the generated policies can filter by it.
function validateOrgIdOnTenantTables() {
  const policyTables = extractArrayTableNames();

  for (const tableName of policyTables) {
    const escapedName = tableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match both quoted (e.g. public."Employees") and unquoted forms.
    const headerRegex = new RegExp(
      `CREATE TABLE IF NOT EXISTS\\s+public\\.(?:"${escapedName}"|${escapedName})\\s*\\(`,
      'i',
    );
    const headerMatch = sql.match(headerRegex);
    if (!headerMatch) continue; // SQL006 already errors when the CREATE TABLE is absent.

    const startIdx = headerMatch.index + headerMatch[0].length;
    // Find the closing ");" of this CREATE TABLE block.
    const closingIdx = sql.indexOf(');', startIdx);
    const block = closingIdx !== -1 ? sql.slice(startIdx, closingIdx) : sql.slice(startIdx, startIdx + 4000);

    if (!/\borg_id\b/.test(block)) {
      addError(
        RULES.ORG_ID_COLUMN,
        `Tenant table "${tableName}" is in the RLS policy loop but its CREATE TABLE block has no "org_id" column. Every tenant table must include org_id for row-level isolation.`,
        offsetToPosition(headerMatch.index),
      );
    }
  }
}

// SQL012: A REFERENCES public.<table> must not appear before that table's
// CREATE TABLE statement in a fresh execution order.
function validateReferenceOrder() {
  const tableCreateOffsets = new Map();
  const createTableMatches = Array.from(sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+public\.("?[\w]+"?)/gi));

  for (const match of createTableMatches) {
    const tableName = normalizeIdentifier(match[1]);
    if (!tableCreateOffsets.has(tableName)) {
      tableCreateOffsets.set(tableName, match.index ?? 0);
    }
  }

  const referenceMatches = Array.from(sql.matchAll(/REFERENCES\s+public\.("?[\w]+"?)/gi));
  for (const match of referenceMatches) {
    const referencedTable = normalizeIdentifier(match[1]);
    const referenceOffset = match.index ?? 0;
    const createOffset = tableCreateOffsets.get(referencedTable);

    if (typeof createOffset === 'number' && referenceOffset < createOffset) {
      addError(
        RULES.FK_REFERENCE_ORDER,
        `Reference to table "${referencedTable}" appears before its CREATE TABLE statement. Move the table definition earlier or defer the constraint with ALTER TABLE after creation.`,
        offsetToPosition(referenceOffset),
      );
    }
  }
}

// SQL013: PostgreSQL does not allow binding an existing index as a table
// constraint within CREATE TABLE. UNIQUE USING INDEX is valid via ALTER TABLE,
// but should never appear inside a CREATE TABLE definition block.
function validateCreateTableUniqueUsingIndex() {
  const createTableBlocks = Array.from(
    sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+public\.("?[\w]+"?)\s*\((.*?)\);/gis),
  );

  for (const blockMatch of createTableBlocks) {
    const tableName = normalizeIdentifier(blockMatch[1]);
    const blockBody = blockMatch[2] || '';
    const localMatch = blockBody.match(/UNIQUE\s+USING\s+INDEX/gi);
    if (!localMatch) {
      continue;
    }

    const relativeOffset = blockBody.search(/UNIQUE\s+USING\s+INDEX/i);
    const absoluteOffset = (blockMatch.index ?? 0) + (blockMatch[0].indexOf(blockBody) || 0) + Math.max(relativeOffset, 0);

    addError(
      RULES.CREATE_TABLE_UNIQUE_USING_INDEX,
      `Table "${tableName}" uses UNIQUE USING INDEX inside CREATE TABLE. Define the table first, then create a UNIQUE INDEX IF NOT EXISTS or add the constraint via ALTER TABLE in a guarded block.`,
      offsetToPosition(absoluteOffset),
    );
  }
}

// SQL014: Direct table operations must target tables created in this script
// and appear after the corresponding CREATE TABLE statement.
function validateTableOperationOrder() {
  const tableCreateOffsets = new Map();
  const createTableMatches = Array.from(sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+public\.("?[\w]+"?)/gi));

  for (const match of createTableMatches) {
    const tableName = normalizeIdentifier(match[1]);
    if (!tableCreateOffsets.has(tableName)) {
      tableCreateOffsets.set(tableName, match.index ?? 0);
    }
  }

  const operationPatterns = [
    /ALTER TABLE\s+public\.("?[\w]+"?)/gi,
    /GRANT\s+ALL\s+ON\s+TABLE\s+public\.("?[\w]+"?)\s+TO/gi,
    /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"?[\w]+"?\s+ON\s+public\.("?[\w]+"?)/gi,
    /DROP TRIGGER\s+(?:IF\s+EXISTS\s+)?"?[\w]+"?\s+ON\s+public\.("?[\w]+"?)/gi,
    /CREATE TRIGGER\s+"?[\w]+"?\s+(?:BEFORE|AFTER|INSTEAD OF)[\s\S]*?\s+ON\s+public\.("?[\w]+"?)/gi,
  ];

  for (const pattern of operationPatterns) {
    const matches = Array.from(sql.matchAll(pattern));
    for (const match of matches) {
      const tableName = normalizeIdentifier(match[1]);
      const operationOffset = match.index ?? 0;
      const createOffset = tableCreateOffsets.get(tableName);

      if (typeof createOffset !== 'number') {
        addError(
          RULES.TABLE_OPERATION_ORDER,
          `Operation targets table "${tableName}" but no CREATE TABLE IF NOT EXISTS public.${tableName} statement was found in setup-sql.`,
          offsetToPosition(operationOffset),
        );
        continue;
      }

      if (operationOffset < createOffset) {
        addError(
          RULES.TABLE_OPERATION_ORDER,
          `Operation on table "${tableName}" appears before its CREATE TABLE statement. Move the operation after table creation or guard it in a safe migration block.`,
          offsetToPosition(operationOffset),
        );
      }
    }
  }
}

function collectFilesRecursive(rootDir, predicate) {
  const results = [];
  const pending = [rootDir];

  while (pending.length) {
    const currentDir = pending.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolutePath);
        continue;
      }

      if (predicate(absolutePath)) {
        results.push(absolutePath);
      }
    }
  }

  return results;
}

function collectFrontendRpcNames() {
  const srcRoot = path.join(repoRoot, 'src');
  const files = collectFilesRecursive(srcRoot, (filePath) => {
    const normalized = filePath.replace(/\\/g, '/');
    if (normalized.endsWith('/src/lib/setup-sql.js')) {
      return false;
    }
    return /\.(js|jsx|ts|tsx)$/i.test(filePath);
  });

  const names = new Set();
  const rpcPattern = /\.rpc\(\s*['\"](?:public\.)?([a-zA-Z_][a-zA-Z0-9_]*)['\"]/g;

  for (const filePath of files) {
    let content = '';
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    for (const match of content.matchAll(rpcPattern)) {
      if (match[1]) {
        names.add(match[1]);
      }
    }
  }

  return Array.from(names);
}

// SQL015: Every frontend `.rpc('<fn>')` call must map to a function declared
// in setup-sql so missing RPCs fail fast in CI instead of runtime schema cache errors.
function validateFrontendRpcCoverage() {
  const rpcNames = collectFrontendRpcNames();

  for (const rpcName of rpcNames) {
    const declarationPattern = new RegExp(
      `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${rpcName}\\s*\\(`,
      'i',
    );

    if (!declarationPattern.test(sql)) {
      addError(
        RULES.FRONTEND_RPC_COVERAGE,
        `Frontend RPC call "${rpcName}" is not declared in SETUP_SQL_SCRIPT. Add CREATE OR REPLACE FUNCTION public.${rpcName}(...) or remove the call.`,
      );
    }
  }
}

function validateWarnings() {
  const broadSwallows = Array.from(sql.matchAll(/WHEN others THEN NULL;/gi));
  for (const match of broadSwallows) {
    addWarning(
      RULES.BROAD_EXCEPTION_SWALLOW,
      'Broad "WHEN others THEN NULL" handler detected. Review whether swallowing all migration failures is intentional.',
      offsetToPosition(match.index),
    );
  }

  const dropTables = Array.from(sql.matchAll(/DROP TABLE IF EXISTS\s+public\.("?[\w]+"?)/gi));
  for (const match of dropTables) {
    addWarning(
      RULES.DESTRUCTIVE_DROP_TABLE,
      `Destructive migration step detected: DROP TABLE IF EXISTS public.${normalizeIdentifier(match[1])}. Confirm this remains intentional.`,
      offsetToPosition(match.index),
    );
  }
}

function summarize() {
  const errors = findings.filter((item) => item.severity === 'error');
  const warnings = findings.filter((item) => item.severity === 'warning');
  return {
    total: findings.length,
    errors: errors.length,
    warnings: warnings.length,
  };
}

function sortFindings(items) {
  return [...items].sort((left, right) => {
    if (left.severity !== right.severity) {
      return left.severity === 'error' ? -1 : 1;
    }
    if ((left.line ?? Infinity) !== (right.line ?? Infinity)) {
      return (left.line ?? Infinity) - (right.line ?? Infinity);
    }
    return left.ruleId.localeCompare(right.ruleId);
  });
}

function formatFindingText(finding) {
  const location = finding.line ? `line ${finding.line}${finding.column ? `:${finding.column}` : ''}` : 'line ?';
  const level = finding.severity.toUpperCase();
  return `[${level}] ${finding.ruleId} ${location} ${finding.message}`;
}

function printTextOutput(options) {
  const ordered = sortFindings(findings);
  const summary = summarize();

  if (!options.quiet) {
    console.log('SQL setup validation results\n');
  }

  if (!ordered.length) {
    console.log('PASS  setup-sql static validation');
    return;
  }

  const errors = ordered.filter((item) => item.severity === 'error');
  const warnings = ordered.filter((item) => item.severity === 'warning');

  if (errors.length) {
    console.log(`Errors (${errors.length})`);
    for (const finding of errors) {
      console.log(`  - ${formatFindingText(finding)}`);
    }
    console.log('');
  }

  if (warnings.length) {
    console.log(`Warnings (${warnings.length})`);
    for (const finding of warnings) {
      console.log(`  - ${formatFindingText(finding)}`);
    }
    console.log('');
  }

  console.log(`Summary: ${summary.errors} error(s), ${summary.warnings} warning(s), ${summary.total} total finding(s).`);
}

function escapeGitHubMessage(value) {
  return String(value)
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A')
    .replace(/:/g, '%3A')
    .replace(/,/g, '%2C');
}

function printGitHubOutput() {
  const ordered = sortFindings(findings);
  for (const finding of ordered) {
    const type = finding.severity === 'error' ? 'error' : 'warning';
    const line = finding.line ?? 1;
    const column = finding.column ?? 1;
    const title = escapeGitHubMessage(finding.ruleId);
    const message = escapeGitHubMessage(finding.message);
    console.log(`::${type} file=src/lib/setup-sql.js,line=${line},col=${column},title=${title}::${message}`);
  }
}

function printJsonOutput(options, exitCode) {
  const payload = {
    tool: 'validate-setup-sql',
    file: 'src/lib/setup-sql.js',
    strict: options.strict,
    maxWarnings: options.maxWarnings,
    exitCode,
    summary: summarize(),
    findings: sortFindings(findings),
  };
  console.log(JSON.stringify(payload, null, 2));
}

function determineExitCode(options) {
  const summary = summarize();
  if (summary.errors > 0) {
    return 1;
  }

  if (options.maxWarnings !== null && summary.warnings > options.maxWarnings) {
    return 1;
  }

  if (options.strict && summary.warnings > 0) {
    return 1;
  }

  return 0;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  if (!sql.trim()) {
    const payload = {
      severity: 'error',
      ruleId: 'SQL000',
      message: 'SETUP_SQL_SCRIPT is empty. Cannot validate setup SQL.',
      line: 1,
      column: 1,
    };
    findings.push(payload);
  } else {
    validatePresenceCoverage();
    validateCreateStatements();
    validateUniqueConstraintGuards();
    validateRlsEngineering();
    validateOrgIdOnTenantTables();
    validateReferenceOrder();
    validateCreateTableUniqueUsingIndex();
    validateTableOperationOrder();
    validateFrontendRpcCoverage();
    validateWarnings();
  }

  const exitCode = determineExitCode(options);

  if (options.format === 'json') {
    printJsonOutput(options, exitCode);
  } else if (options.format === 'github') {
    printGitHubOutput();
  } else {
    printTextOutput(options);
  }

  process.exit(exitCode);
}

main();
