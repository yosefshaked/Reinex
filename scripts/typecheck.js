#!/usr/bin/env node
/* eslint-env node */
/**
 * typecheck.js — Warn-only TypeScript `checkJs` gate for the frontend (src/).
 *
 * Why this exists:
 *   ESLint does no cross-function/cross-module type inference, so it cannot catch
 *   bugs like destructuring a property a function never returns (e.g. the
 *   `resetAnalysisProgress` regression — `const { x } = useHook()` where the hook
 *   never returns `x`, yielding `undefined` and a runtime crash when called).
 *   `tsc --checkJs` catches that class reliably, from inference alone.
 *
 * Modes:
 *   default        → warn-only: prints diagnostics, ALWAYS exits 0 (build not blocked).
 *   --strict       → enforce:  exits non-zero when there are any type errors.
 *
 * Flip to blocking once the existing diagnostics are cleared: change the build
 * step from `lint:types` to `lint:types:strict` (or pass --strict here).
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const strict = process.argv.includes('--strict');

let tscPath;
try {
  tscPath = require.resolve('typescript/bin/tsc');
} catch {
  console.error('[typecheck] TypeScript is not installed. Run `npm install -D typescript`.');
  process.exit(strict ? 1 : 0);
}

const result = spawnSync(
  process.execPath,
  [tscPath, '-p', 'tsconfig.typecheck.json', '--pretty', 'false'],
  { cwd: repoRoot, encoding: 'utf8' },
);

const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
const errorCount = (output.match(/: error TS\d+:/g) || []).length;

if (output) console.log(output);

if (errorCount === 0) {
  console.log('\n[typecheck] No type errors. 🎉');
  process.exit(0);
}

console.log(`\n[typecheck] ${errorCount} type ${errorCount === 1 ? 'issue' : 'issues'} found.`);
if (strict) {
  console.log('[typecheck] Failing (--strict).');
  process.exit(1);
}
console.log('[typecheck] warn-only mode — build not blocked. Run with --strict to enforce.');
process.exit(0);
