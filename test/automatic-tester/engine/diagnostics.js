/**
 * diagnostics.js
 *
 * Pre-flight environment checks and post-failure "what to do" diagnosis.
 *
 * Pre-flight checks run before the browser is launched and catch the most
 * common configuration problems immediately, before spending time navigating.
 *
 * Post-failure diagnosis inspects the error message, the captured browser
 * console output, and the current env to suggest specific remediation steps.
 */

// ─── Pre-flight checks ────────────────────────────────────────────────────

const REQUIRED_ENV = [
  { key: 'ADMIN_EMAIL',    label: 'Admin email' },
  { key: 'ADMIN_PASSWORD', label: 'Admin password' },
];

/**
 * Run checks before the browser is launched.
 *
 * @param {object} env - The resolved env map from runner.js
 * @returns {{ issues: string[], warnings: string[], hints: string[] }}
 */
export async function preflightCheck(env) {
  const issues   = [];
  const warnings = [];
  const hints    = [];

  // ── 1. Required credential checks ───────────────────────────────────────

  for (const { key, label } of REQUIRED_ENV) {
    if (!env[key]) {
      issues.push(`${label} (${key}) is not set in .env`);
    }
  }

  if (!env.TEST_ORG_ID) {
    warnings.push('TEST_ORG_ID is not set — org-specific API calls will fail and ' +
                  'the "select-org" screen may not auto-advance.');
    hints.push('Fix: run  node setup.js  to create a test org and write TEST_ORG_ID to .env');
  }

  if (!env.SERVICE_ROLE_KEY) {
    warnings.push('SERVICE_ROLE_KEY is not set — direct API calls (apiCall steps) will be unauthenticated.');
    hints.push('Fix: run  node setup.js  to populate SERVICE_ROLE_KEY from api/local.settings.json');
  }

  if (issues.length > 0) {
    hints.push('The fastest fix for missing credentials is:');
    hints.push('  1.  supabase start          (if not already running)');
    hints.push('  2.  npm run dev             (in the repo root)');
    hints.push('  3.  node setup.js           (auto-discovers everything and writes .env)');
  }

  // ── 2. App reachability check ────────────────────────────────────────────

  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res   = await fetch(`${env.BASE_URL}/`, { signal: ctrl.signal });
    clearTimeout(timer);

    if (!res.ok) {
      warnings.push(`App at ${env.BASE_URL} responded with HTTP ${res.status}`);
    } else {
      const ct   = res.headers.get('content-type') || '';
      const body = ct.includes('text/html') ? await res.text() : '';
      if (body && !body.includes('<div id="root">')) {
        warnings.push(
          `${env.BASE_URL} responded but does not look like the Reinex app ` +
          `(missing <div id="root">). Make sure you are running the correct server.`
        );
      }
      // reachable — no issue
    }
  } catch {
    issues.push(`App is NOT reachable at ${env.BASE_URL}`);
    hints.push('Start the app before running tests:');
    hints.push('  SWA emulator (recommended):  swa start');
    hints.push('  Vite dev server:             npm run dev   (in repo root)');
    hints.push(`  Then verify manually:         open ${env.BASE_URL} in your browser`);
  }

  return { issues, warnings, hints };
}

// ─── Post-failure diagnosis ───────────────────────────────────────────────

/**
 * Known error patterns mapped to actionable hints.
 * Each entry: { match: string | RegExp, hints: string[] }
 */
const ERROR_PATTERNS = [
  {
    match: 'Target page, context or browser has been closed',
    heading: 'The browser page closed or crashed mid-test.',
    hints: [
      'Most common cause: the app threw a fatal JavaScript error after an action.',
      'Open the app manually, reproduce the failing step, and check the browser console.',
      'If this happens on the Login step, the test user probably does not exist in the DB.',
      '  Fix: run  node setup.js  to create test users.',
      'Check the "Browser console errors" section below for the specific JS error.',
    ],
  },
  {
    match: /waitForSelector.*input\[type="email"\]/,
    heading: 'Login form was not found on the page.',
    hints: [
      'The app did not render the login screen in time.',
      'Check that the app is running and the login route is accessible:',
      `  Open  {BASE_URL}/#/login  in your browser.`,
      'If the page is blank: run  npm run dev  (repo root) and try again.',
    ],
  },
  {
    match: /waitForFunction.*Timeout/i,
    heading: 'A page condition never became true (likely login redirect timed out).',
    hints: [
      'Login was attempted but the app never left the /login route.',
      'Possible causes:',
      '  • Wrong credentials — check ADMIN_EMAIL / ADMIN_PASSWORD in .env',
      '  • Test user does not exist in Supabase — run  node setup.js',
      '  • Supabase is not running — run  supabase start',
      '  • Network error between the app and Supabase (check app console for 5xx errors)',
    ],
  },
  {
    match: /waitForURL.*Timeout/i,
    heading: 'The URL did not change to the expected pattern.',
    hints: [
      'Navigation did not complete.  The app may have shown an error or stayed on the same page.',
      'Check the screenshot in the report for the state of the page at the time of failure.',
    ],
  },
  {
    match: /waitForSelector.*Timeout/i,
    heading: 'An expected element was not found on the page.',
    hints: [
      'The selector in the script no longer matches any visible element.',
      'This usually means the UI has changed since the script was last validated.',
      'Steps to fix:',
      '  1. Open the app and navigate to the failing step manually.',
      '  2. Inspect the element and find the new selector.',
      '  3. Update the step in scripts/<script-id>.json.',
      '  4. Update meta.last_validated_at to today\'s date.',
      'Tip: run  node runner.js --validate  to see which source files are stale.',
    ],
  },
  {
    match: 'No credentials configured for role',
    heading: 'Credentials for the required role are missing.',
    hints: [
      'The test needs credentials that are not set in .env.',
      'Fix: run  node setup.js  — it creates all three test accounts automatically.',
      'Or set the missing variables manually in test/automatic-tester/.env.',
    ],
  },
  {
    match: /API call .* returned [45]\d\d/,
    heading: 'An API call returned an error status.',
    hints: [
      'The backend returned a 4xx/5xx response for a direct API call step.',
      'Check the error body printed above for details.',
      'Common causes:',
      '  • TEST_ORG_ID is empty or wrong — the API needs an org context.',
      '  • SERVICE_ROLE_KEY is wrong or expired — check api/local.settings.json.',
      '  • The API function was changed — run  node runner.js --validate  to check.',
    ],
  },
  {
    match: 'net::ERR_EMPTY_RESPONSE',
    heading: 'The browser received no response from Supabase (ERR_EMPTY_RESPONSE).',
    hints: [
      'The Supabase API port is open but not responding to HTTP — classic Docker Desktop + WSL2 issue.',
      'Fix options (try in order):',
      '  1. Restart Docker Desktop  (Settings → Restart)',
      '     Then re-run: node setup.js',
      '  2. Restart WSL2 from an admin PowerShell:',
      '       wsl --shutdown',
      '     Then restart Docker Desktop.',
      '  3. As a workaround, run the SWA emulator instead of Vite:',
      '       swa start    (in the repo root)',
      '     Then update .env:  BASE_URL=http://localhost:4280',
      '  Supabase containers are running — this is a Windows networking quirk, not a code bug.',
    ],
  },
  {
    match: 'net::ERR_CONNECTION_REFUSED',
    heading: 'Connection refused — a server the app depends on is not running.',
    hints: [
      'Either Supabase or the app itself is not listening on the expected port.',
      'Fix:',
      '  1.  supabase start   (in the supabase-tenant directory)',
      '  2.  npm run dev      (start the Reinex app)',
      '  3.  node setup.js    (refresh credentials in .env)',
    ],
  },
  {
    match: 'Unknown action',
    heading: 'A step uses an action name that the executor does not recognise.',
    hints: [
      'The script references an action that has not been implemented in engine/executor.js.',
      'Supported actions: navigate, fill, type, click, check, uncheck, hover, select,',
      '  pressKey, waitForSelector, waitForURL, waitForNetwork, screenshot, sleep,',
      '  store, storeFromUrl, assert, apiCall, login, logout, clearStorage, scrollTo, focusAndFill',
      'Fix: correct the "action" value in the failing step inside scripts/<script-id>.json.',
    ],
  },
];

/**
 * Given a failed step and the current environment, return diagnostic lines
 * to print in the CLI and include in the report.
 *
 * @param {object} step     - The failed step result (from executor)
 * @param {object} workflow - The workflow result (for context)
 * @param {object} env      - The resolved env map
 * @returns {string[]}      - Lines to print as "What to do" hints
 */
export function diagnoseFailure(step, workflow, env) {
  if (!step?.error) return [];

  const err   = step.error;
  const lines = [];

  // ── Match known patterns ─────────────────────────────────────────────────

  let matched = false;
  for (const pattern of ERROR_PATTERNS) {
    const hit = typeof pattern.match === 'string'
      ? err.includes(pattern.match)
      : pattern.match.test(err);

    if (hit) {
      matched = true;
      lines.push(`  Diagnosis: ${pattern.heading}`);
      for (const h of pattern.hints) {
        lines.push(`    ${h.replace('{BASE_URL}', env.BASE_URL || 'http://localhost:5173')}`);
      }
      break;
    }
  }

  if (!matched) {
    lines.push('  Diagnosis: Unexpected error — see the full message above.');
    lines.push('    Enable verbose output with:  DEBUG=1 node runner.js ...');
  }

  // ── Extra context from browser console ──────────────────────────────────

  const consoleErrors = workflow?.consoleErrors ?? [];
  if (consoleErrors.length > 0) {
    lines.push('  Browser console errors captured during this workflow:');
    consoleErrors.slice(0, 5).forEach(e => lines.push(`    [browser] ${e}`));
    if (consoleErrors.length > 5) {
      lines.push(`    … and ${consoleErrors.length - 5} more (see report.html)`);
    }

    // Surface Supabase-specific hints from console errors
    const allConsole = consoleErrors.join('\n');
    if (allConsole.includes('ERR_EMPTY_RESPONSE')) {
      lines.push('  Root cause: Supabase port is open but silently dropping HTTP (Docker WSL2 bug).');
      lines.push('    Fix: restart Docker Desktop, then re-run: node setup.js');
      lines.push('    Or restart WSL2 (admin PowerShell):  wsl --shutdown  → restart Docker Desktop');
    } else if (allConsole.includes('ERR_CONNECTION_REFUSED')) {
      lines.push('  Supabase is not running. Start it:  supabase start  (in supabase-tenant dir)');
    } else if (allConsole.includes('signInWithPassword') || allConsole.includes('Failed to fetch')) {
      lines.push('  Supabase auth call failed. Check that supabase is running and credentials are correct.');
    }
  }

  // ── Page state at failure ────────────────────────────────────────────────

  if (step.failureUrl) {
    lines.push(`  Page URL at failure: ${step.failureUrl}`);
  }

  // ── Env-specific hints ───────────────────────────────────────────────────

  const envHints = [];
  if (!env.ADMIN_PASSWORD)  envHints.push('ADMIN_PASSWORD is empty');
  if (!env.TEST_ORG_ID)     envHints.push('TEST_ORG_ID is empty');
  if (!env.SERVICE_ROLE_KEY) envHints.push('SERVICE_ROLE_KEY is empty');

  if (envHints.length > 0) {
    lines.push(`  Config gaps detected: ${envHints.join(', ')}`);
    lines.push('    Run  node setup.js  to fix all of these automatically.');
  }

  return lines;
}
