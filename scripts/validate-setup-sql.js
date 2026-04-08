#!/usr/bin/env node
import process from 'node:process';
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
  BROAD_EXCEPTION_SWALLOW: 'SQL101',
  DESTRUCTIVE_DROP_TABLE: 'SQL102',
};

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

    if (!grantTables.includes(tableName)) {
      addError(RULES.TABLE_GRANT_COVERAGE, `Table "${tableName}" is missing GRANT ALL ... TO app_user coverage.`, position);
    }

    if (!policyTables.includes(tableName)) {
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
