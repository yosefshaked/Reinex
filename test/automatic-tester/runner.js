#!/usr/bin/env node
/**
 * runner.js — Reinex Automatic Tester
 *
 * CLI entry point.  Reads script sheets from ./scripts/, validates them
 * against the live codebase, then drives a real browser via Playwright.
 *
 * Usage:
 *   node runner.js --all
 *   node runner.js --script student-lifecycle
 *   node runner.js --validate
 *   node runner.js --all --headed --browser firefox
 *   node runner.js --all --timeout 20000
 *
 * Options:
 *   --all              Run every script in ./scripts/
 *   --script <id>      Run a single script by its meta.id
 *   --validate         Validate scripts against the repo; do NOT open a browser
 *   --headed           Show the browser window while running
 *   --browser <name>   chromium (default) | firefox | webkit
 *   --timeout <ms>     Override per-step timeout
 *   --no-stop-on-fail  Continue running remaining scripts even if one fails
 */

import { readFileSync, readdirSync } from 'fs';
import { mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

// dotenv (optional — silently skip if not installed)
try {
  const { config } = await import('dotenv');
  config({ path: join(dirname(fileURLToPath(import.meta.url)), '.env') });
} catch { /* dotenv not installed — rely on real env vars */ }

const __dirname = dirname(fileURLToPath(import.meta.url));

import { validateScript } from './engine/validator.js';
import { runWorkflow }    from './engine/executor.js';
import { generateReport } from './engine/reporter.js';

// ─── CLI argument parsing ─────────────────────────────────────────────────

const args = process.argv.slice(2);

function flag(name)       { return args.includes(name); }
function arg(name, dflt)  {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : dflt;
}

const opts = {
  all:          flag('--all'),
  validateOnly: flag('--validate'),
  headed:       flag('--headed'),
  noStopOnFail: flag('--no-stop-on-fail'),
  scriptId:     arg('--script', null),
  browser:      arg('--browser', process.env.DEFAULT_BROWSER || 'chromium'),
  timeout:      arg('--timeout', null) ? parseInt(arg('--timeout', null), 10) : null,
};

if (!opts.all && !opts.scriptId && !opts.validateOnly) {
  console.log(`
  Reinex Automatic Tester
  ════════════════════════════════════════════════

  Usage:
    node runner.js --all
    node runner.js --script <id>
    node runner.js --validate

  Options:
    --all               Run every script in ./scripts/
    --script <id>       Run one script by its meta.id
    --validate          Validate scripts only (no browser launched)
    --headed            Show the browser window
    --browser <name>    chromium (default) | firefox | webkit
    --timeout <ms>      Override per-step timeout (default: 12000)
    --no-stop-on-fail   Continue running remaining scripts on failure

  First time setup:
    npm install
    npm run setup      (installs Playwright browser binaries)
    cp .env.example .env && nano .env
  `);
  process.exit(0);
}

// ─── Environment / credentials ────────────────────────────────────────────

const env = {
  BASE_URL:           process.env.BASE_URL           || 'http://localhost:4280',
  ADMIN_EMAIL:        process.env.ADMIN_EMAIL        || '',
  ADMIN_PASSWORD:     process.env.ADMIN_PASSWORD     || '',
  OFFICE_EMAIL:       process.env.OFFICE_EMAIL       || '',
  OFFICE_PASSWORD:    process.env.OFFICE_PASSWORD    || '',
  INSTRUCTOR_EMAIL:   process.env.INSTRUCTOR_EMAIL   || '',
  INSTRUCTOR_PASSWORD:process.env.INSTRUCTOR_PASSWORD|| '',
  TEST_ORG_ID:        process.env.TEST_ORG_ID        || '',
  SERVICE_ROLE_KEY:   process.env.SERVICE_ROLE_KEY   || '',
};

// ─── Script loading ───────────────────────────────────────────────────────

const scriptsDir = join(__dirname, 'scripts');
const repoRoot   = join(__dirname, '..', '..');

function loadAllScripts() {
  return readdirSync(scriptsDir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const path = join(scriptsDir, f);
      try {
        return { path, script: JSON.parse(readFileSync(path, 'utf8')) };
      } catch (err) {
        console.error(`Failed to parse ${f}: ${err.message}`);
        return null;
      }
    })
    .filter(Boolean);
}

// ─── Colour helpers ───────────────────────────────────────────────────────

const C = {
  green:  s => `\x1b[32m${s}\x1b[0m`,
  red:    s => `\x1b[31m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  grey:   s => `\x1b[90m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
};

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  const allScripts = loadAllScripts();

  let targetScripts = allScripts;
  if (opts.scriptId) {
    targetScripts = allScripts.filter(s => s.script.meta?.id === opts.scriptId);
    if (targetScripts.length === 0) {
      console.error(C.red(`\nScript not found: "${opts.scriptId}"`));
      console.log(`Available script IDs:\n  ${allScripts.map(s => s.script.meta?.id).join('\n  ')}`);
      process.exit(1);
    }
  }

  // ── Phase 1: Validation ───────────────────────────────────────────────

  console.log(C.bold('\n── Validation ──────────────────────────────────────────\n'));

  const validationResults = [];
  for (const { path, script } of targetScripts) {
    const result = await validateScript(path, script, repoRoot);
    validationResults.push({ script: script.meta, ...result });

    const icon = result.valid ? C.green('✓') : C.red('✗');
    console.log(`${icon} ${script.meta?.name ?? path}`);

    for (const issue of result.issues) {
      console.log(`    ${C.red('✗')} ${issue}`);
    }
    for (const warn of result.warnings) {
      console.log(`    ${C.yellow('⚠')} ${warn}`);
    }
  }

  const invalidCount = validationResults.filter(r => !r.valid).length;
  const warnCount    = validationResults.reduce((n, r) => n + r.warnings.length, 0);

  if (invalidCount > 0) {
    console.log(C.red(`\n${invalidCount} script(s) have integrity issues.`));
  }
  if (warnCount > 0) {
    console.log(C.yellow(`${warnCount} warning(s) — scripts may be stale.`));
  }
  if (invalidCount === 0 && warnCount === 0) {
    console.log(C.green('All scripts passed validation.'));
  }

  if (opts.validateOnly) {
    console.log('');
    process.exit(invalidCount > 0 ? 1 : 0);
  }

  // ── Phase 2: Prepare report directory ────────────────────────────────

  const timestamp  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportDir  = join(__dirname, 'reports', `run-${timestamp}`);
  await mkdir(join(reportDir, 'screenshots'), { recursive: true });

  // ── Phase 3: Launch browser ───────────────────────────────────────────

  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    console.error(C.red('\nPlaywright is not installed. Run:  npm install && npm run setup\n'));
    process.exit(1);
  }

  const browserEngines = {
    chromium: playwright.chromium,
    firefox:  playwright.firefox,
    webkit:   playwright.webkit,
  };
  const browserEngine = browserEngines[opts.browser] || playwright.chromium;

  console.log(C.bold(`\n── Running Tests (${opts.browser}) ─────────────────────────────\n`));
  console.log(C.grey(`  App:    ${env.BASE_URL}`));
  console.log(C.grey(`  Report: ${reportDir}\n`));

  const browser = await browserEngine.launch({ headless: !opts.headed });

  // ── Phase 4: Execute scripts ──────────────────────────────────────────

  const runResults = [];
  let hasAnyFailure = false;

  for (const { script } of targetScripts) {
    console.log(C.bold(`▶ ${script.meta.name}`));

    const scriptResult = {
      script:    script.meta,
      workflows: [],
      startTime: Date.now(),
      duration:  0,
    };

    // Each script gets its own browser context (isolated cookies / storage)
    // but all workflows within a script share variables.
    const browserCtx  = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const page = await browserCtx.newPage();

    // Shared variable map: start with script-level variables, then overlay env
    const sharedVars = {
      ...(script.variables || {}),
      ...env,
    };

    let scriptFailed = false;

    for (const workflow of (script.workflows || [])) {
      // Check if we should reset the browser context between workflows
      if (workflow.resetSession) {
        await browserCtx.clearCookies();
        await page.evaluate(() => {
          try { localStorage.clear(); } catch {}
        }).catch(() => {});
      }

      process.stdout.write(`  ${workflow.name.padEnd(50, ' ')}`);

      const wfResult = await runWorkflow(
        page,
        workflow,
        script,
        sharedVars,   // mutations are visible across workflows
        reportDir,
        opts.timeout
      );

      scriptResult.workflows.push(wfResult);

      const passed  = wfResult.steps.filter(s => s.status === 'pass').length;
      const failed  = wfResult.steps.filter(s => s.status === 'fail').length;
      const skipped = wfResult.steps.filter(s => s.status === 'skip').length;

      const statusStr = wfResult.status === 'pass'
        ? C.green('PASS')
        : C.red('FAIL');

      console.log(
        `${statusStr}  ${C.grey(`${passed}✓ ${failed}✗ ${skipped}– · ${(wfResult.duration / 1000).toFixed(1)}s`)}`
      );

      if (wfResult.status === 'fail') {
        scriptFailed = true;
        hasAnyFailure = true;
        const failStep = wfResult.steps.find(s => s.status === 'fail');
        if (failStep) {
          const errLines = (failStep.error || '').split('\n').slice(0, 3).join('\n    ');
          console.log(`    ${C.red('↳')} ${failStep.description}: ${C.red(errLines)}`);
        }
      }
    }

    await browserCtx.close();

    scriptResult.duration = Date.now() - scriptResult.startTime;
    runResults.push(scriptResult);

    if (scriptFailed && !opts.noStopOnFail && targetScripts.length > 1) {
      console.log(C.yellow('\n  Script failed — use --no-stop-on-fail to continue.\n'));
      break;
    }
  }

  await browser.close();

  // ── Phase 5: Report ───────────────────────────────────────────────────

  const reportPath = generateReport(runResults, validationResults, reportDir, new Date().toISOString());

  // ── Summary ───────────────────────────────────────────────────────────

  let totalWf = 0, passWf = 0, failWf = 0;
  for (const sr of runResults) {
    for (const wf of sr.workflows) {
      totalWf++;
      if (wf.status === 'pass') passWf++; else failWf++;
    }
  }

  console.log(C.bold('\n── Summary ──────────────────────────────────────────────\n'));
  console.log(`  Workflows : ${C.green(passWf + ' passed')}  ${failWf > 0 ? C.red(failWf + ' failed') : C.grey('0 failed')}`);
  console.log(`  Report    : ${reportPath}\n`);

  process.exit(hasAnyFailure ? 1 : 0);
}

main().catch(err => {
  console.error(`\n${C.red('Fatal error:')} ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
