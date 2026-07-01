#!/usr/bin/env node
/**
 * validate-error-tracking.js
 *
 * Flags internal (5xx) failures that are returned with a bare
 * `respond(context, 5xx, ...)` instead of being routed through the
 * error-tracking helper (error-events.js). Tracked responses persist a row to
 * the `error_events` table and return a support code to the user; bare ones do
 * neither.
 *
 * Tracked forms (NOT flagged):
 *   - respondTracked(context, status, ...)
 *   - respondTrackedError(context, req, supabase, { status, ... })
 *   - a local wrapper named respond<Name>Error(context, status, ...) that
 *     delegates to one of the above.
 *
 * Why only 5xx: 4xx responses (validation, auth, not-found, conflict, invariant
 * violations) are expected and user-actionable — tracking them would only add
 * low-value noise to error_events. See severityForStatus() in error-events.js.
 *
 * Mode: WARN by default — it reports findings across the whole API surface but
 * always exits 0, so the build is never blocked while the backlog is migrated.
 * Pass --strict to exit non-zero when any finding is present (for opt-in CI
 * gating once the project is clean).
 *
 * Escape hatch: a genuine 5xx that cannot be tracked (e.g. raised before the
 * supabase client exists) may opt out with a `tracked-error-exempt` comment on
 * the same line or the line immediately above.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const API_DIR = path.join(root, 'api');
const STRICT = process.argv.includes('--strict');

const EXEMPT_MARKER = 'tracked-error-exempt';

// Skip dependencies and test files; everything else under api/ is scanned.
const SKIP_DIR = /(^|\/)node_modules(\/|$)/;
const SKIP_FILE = /\.test\.js$/i;

function readRelative(absolutePath) {
  return path.relative(root, absolutePath).replaceAll('\\', '/');
}

function walkJsFiles(dirPath) {
  const out = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const nextPath = path.join(dirPath, entry.name);
    if (SKIP_DIR.test(readRelative(nextPath))) continue;
    if (entry.isDirectory()) {
      out.push(...walkJsFiles(nextPath));
    } else if (entry.isFile() && entry.name.endsWith('.js') && !SKIP_FILE.test(entry.name)) {
      out.push(nextPath);
    }
  }
  return out;
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split('\n').length;
}

// Matches a bare plain `respond(context, 5xx` call. The negative lookbehind on a
// word character means it does NOT match `respondTracked(` / `respondTrackedError(`
// / `respond<Name>Error(` — those have letters between `respond` and `(`.
const BARE_5XX_PATTERN = /(?<![A-Za-z0-9_])respond\(\s*context\s*,\s*(5\d\d)\b/g;

function lineHasExemption(allLines, lineNo) {
  const current = allLines[lineNo - 1] || '';
  const previous = allLines[lineNo - 2] || '';
  return current.includes(EXEMPT_MARKER) || previous.includes(EXEMPT_MARKER);
}

function collectFindings() {
  const findings = [];
  for (const file of walkJsFiles(API_DIR)) {
    const text = fs.readFileSync(file, 'utf8');
    const allLines = text.split('\n');
    const relativePath = readRelative(file);

    let match;
    BARE_5XX_PATTERN.lastIndex = 0;
    while ((match = BARE_5XX_PATTERN.exec(text)) !== null) {
      const line = lineNumberAt(text, match.index);
      if (lineHasExemption(allLines, line)) continue;
      findings.push({ file: relativePath, line, status: match[1] });
    }
  }
  return findings;
}

const findings = collectFindings();

if (findings.length === 0) {
  console.log('Error-tracking validation passed — no untracked 5xx responses found.');
  process.exit(0);
}

const byFile = new Map();
for (const f of findings) {
  if (!byFile.has(f.file)) byFile.set(f.file, []);
  byFile.get(f.file).push(f);
}

const label = STRICT ? 'Error-tracking validation FAILED' : 'Error-tracking warnings';
console.warn(
  `${label}: ${findings.length} untracked 5xx response(s) in ${byFile.size} file(s).`,
);
console.warn(
  'These return an internal error without a support code. Route them through a tracked helper '
    + '(respondTracked / respondTrackedError / respond<Name>Error), or add a '
    + `"${EXEMPT_MARKER}" comment if tracking is impossible at that point.\n`,
);

for (const [file, items] of [...byFile.entries()].sort()) {
  console.warn(`  ${file}`);
  for (const item of items.sort((a, b) => a.line - b.line)) {
    console.warn(`    :${item.line}  respond(context, ${item.status}, ...)`);
  }
}

if (STRICT) {
  process.exit(1);
}

console.warn('\n(warn-only mode — build not blocked. Run with --strict to enforce.)');
process.exit(0);
