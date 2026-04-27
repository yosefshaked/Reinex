/**
 * executor.js
 *
 * Runs a single workflow from a script sheet against a live Playwright page.
 * Each workflow gets a shared variable context; variables set by one step are
 * available to all later steps in the same workflow AND carried across workflows
 * within the same script run (via the returned `vars` map).
 *
 * Supported step actions:
 *   navigate, fill, type, click, check, uncheck, hover, select, pressKey,
 *   waitForSelector, waitForURL, waitForNetwork, screenshot, sleep,
 *   store, storeFromUrl, assert, apiCall, login, logout, clearStorage, scrollTo, focusAndFill
 *
 * click extras:   first (boolean), nth (0-based index)
 * apiCall extras: storeField supports dot-notation (e.g. "created.id", "participants.0.id")
 *                 stores: [{ variable, field }] to capture multiple fields from one response
 */

import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// ─── Variable interpolation ────────────────────────────────────────────────

function interpolate(value, vars) {
  if (typeof value !== 'string') return value;
  return value.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : `{{${key}}}`
  );
}

function interpolateDeep(obj, vars) {
  if (typeof obj === 'string') return interpolate(obj, vars);
  if (Array.isArray(obj)) return obj.map(v => interpolateDeep(v, vars));
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, interpolateDeep(v, vars)])
    );
  }
  return obj;
}

// ─── Login helper ──────────────────────────────────────────────────────────

async function performLogin(page, role, ctx) {
  const roleMap = {
    admin:      { email: ctx.vars.ADMIN_EMAIL,      password: ctx.vars.ADMIN_PASSWORD,      firstName: 'Admin',      lastName: 'Test', phone: '0500000001', identityNumber: '000000001' },
    owner:      { email: ctx.vars.ADMIN_EMAIL,      password: ctx.vars.ADMIN_PASSWORD,      firstName: 'Admin',      lastName: 'Test', phone: '0500000001', identityNumber: '000000001' },
    office:     { email: ctx.vars.OFFICE_EMAIL,     password: ctx.vars.OFFICE_PASSWORD,     firstName: 'Office',     lastName: 'Test', phone: '0500000002', identityNumber: '000000002' },
    instructor: { email: ctx.vars.INSTRUCTOR_EMAIL, password: ctx.vars.INSTRUCTOR_PASSWORD, firstName: 'Instructor', lastName: 'Test', phone: '0500000003', identityNumber: '000000003' },
    member:     { email: ctx.vars.INSTRUCTOR_EMAIL, password: ctx.vars.INSTRUCTOR_PASSWORD, firstName: 'Instructor', lastName: 'Test', phone: '0500000003', identityNumber: '000000003' },
  };

  const creds = roleMap[role] || roleMap.admin;
  if (!creds.email || !creds.password) {
    throw new Error(
      `No credentials configured for role "${role}". Check ADMIN_EMAIL/PASSWORD, ` +
      `OFFICE_EMAIL/PASSWORD, or INSTRUCTOR_EMAIL/PASSWORD in .env`
    );
  }

  await page.goto(`${ctx.vars.BASE_URL}/#/login`);
  await page.waitForSelector('input[type="email"]', { timeout: ctx.timeout });

  await page.fill('input[type="email"]', creds.email);
  await page.fill('input[type="password"]', creds.password);
  await page.click('button[type="submit"]');

  // Wait until we leave the login page
  await page.waitForFunction(
    () => !window.location.hash.startsWith('#/login'),
    { timeout: ctx.timeout }
  );

  // If landed on /select-org, pick the configured org (or the first one)
  const hash = await page.evaluate(() => window.location.hash);
  if (hash.startsWith('#/select-org')) {
    if (ctx.vars.TEST_ORG_ID) {
      const btn = page.locator(`button`).filter({ hasText: '' }).first();
      // Try clicking a button that contains the org id as data attribute
      const orgButton = page.locator(`[data-org-id="${ctx.vars.TEST_ORG_ID}"]`);
      const count = await orgButton.count();
      if (count > 0) {
        await orgButton.click();
      } else {
        // Fall back: click the first organisation button in the list
        await page.locator('.w-full.border.border-slate-200').first().click();
      }
    } else {
      // Click the first org
      await page.locator('.w-full.border.border-slate-200').first().click();
    }
    await page.waitForFunction(
      () => !window.location.hash.startsWith('#/select-org'),
      { timeout: ctx.timeout }
    );
  }

  // If account setup is required, fill in the form automatically
  const hashAfter = await page.evaluate(() => window.location.hash);
  if (hashAfter.startsWith('#/account/setup')) {
    // Fill in required profile fields using test defaults
    const firstName = creds.firstName || 'Test';
    const lastName  = creds.lastName  || 'User';
    const phone     = creds.phone     || '0500000001';
    const idNumber  = creds.identityNumber || '000000001';

    await page.waitForSelector('#account-first-name', { timeout: ctx.timeout });
    await page.fill('#account-first-name', firstName);
    await page.fill('#account-last-name', lastName);
    await page.fill('#account-identity-number', idNumber);
    await page.fill('#account-phone', phone);
    await page.click('button[type="submit"]');
    // Wait until redirected away from setup
    await page.waitForFunction(
      () => !window.location.hash.startsWith('#/account/setup'),
      { timeout: ctx.timeout }
    );
  }
}

// ─── Assertion helper ──────────────────────────────────────────────────────

async function runAssert(page, params, ctx) {
  const { type, selector, value, pattern, not } = params;

  switch (type) {
    case 'visible': {
      const state = not ? 'hidden' : 'visible';
      await page.waitForSelector(selector, { state, timeout: ctx.timeout });
      break;
    }
    case 'hidden': {
      await page.waitForSelector(selector, { state: 'hidden', timeout: ctx.timeout });
      break;
    }
    case 'text': {
      const el = await page.waitForSelector(selector, { timeout: ctx.timeout });
      const text = await el.textContent();
      if (not ? text.includes(value) : !text.includes(value)) {
        throw new Error(
          `Assert text ${not ? 'not' : ''}contains failed.\n` +
          `  Selector: ${selector}\n` +
          `  Expected ${not ? 'NOT to contain' : 'to contain'}: "${value}"\n` +
          `  Actual text: "${text.trim()}"`
        );
      }
      break;
    }
    case 'url': {
      const currentUrl = page.url();
      const rx = new RegExp(pattern);
      if (not ? rx.test(currentUrl) : !rx.test(currentUrl)) {
        throw new Error(
          `Assert URL ${not ? 'not' : ''}matches failed.\n` +
          `  Pattern: ${pattern}\n` +
          `  Current URL: ${currentUrl}`
        );
      }
      break;
    }
    case 'count': {
      const count = await page.locator(selector).count();
      const expected = parseInt(value, 10);
      if (count !== expected) {
        throw new Error(
          `Assert count failed.\n` +
          `  Selector: ${selector}\n` +
          `  Expected: ${expected}\n` +
          `  Actual: ${count}`
        );
      }
      break;
    }
    case 'exists': {
      const n = await page.locator(selector).count();
      if (not ? n > 0 : n === 0) {
        throw new Error(
          `Assert exists${not ? ' (not)' : ''} failed.\n` +
          `  Selector: ${selector}\n` +
          `  Count found: ${n}`
        );
      }
      break;
    }
    case 'value': {
      const inputEl = await page.waitForSelector(selector, { timeout: ctx.timeout });
      const actual = await inputEl.inputValue();
      if (not ? actual === value : actual !== value) {
        throw new Error(
          `Assert value failed.\n` +
          `  Selector: ${selector}\n` +
          `  Expected: "${value}"\n` +
          `  Actual: "${actual}"`
        );
      }
      break;
    }
    default:
      throw new Error(`Unknown assert type: "${type}"`);
  }
}

// ─── API call helper ───────────────────────────────────────────────────────

async function runApiCall(page, params, ctx) {
  const { method = 'GET', endpoint, body, headers: extraHeaders = {}, store, storeField, ignoreStatus = [] } = params;

  // Try to pull the Supabase auth token from localStorage (works when logged in)
  let authToken = null;
  try {
    authToken = await page.evaluate(() => {
      // Try known Reinex storage key first, then fall back to any key containing auth
      const KNOWN_KEYS = ['app-main-auth-session'];
      const allKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k) allKeys.push(k);
      }
      const candidates = [
        ...KNOWN_KEYS.filter(k => allKeys.includes(k)),
        ...allKeys.filter(k => !KNOWN_KEYS.includes(k) && (k.includes('auth-token') || k.includes('auth-session'))),
      ];
      for (const key of candidates) {
        try {
          const parsed = JSON.parse(localStorage.getItem(key) || '{}');
          const token = parsed.access_token || parsed.currentSession?.access_token || null;
          if (token) return token;
        } catch { /* continue */ }
      }
      return null;
    });
  } catch { /* page might not be on a real URL yet */ }

  const url = `${ctx.vars.BASE_URL}${endpoint}`;
  const resolvedBody = body ? interpolateDeep(body, ctx.vars) : undefined;

  const response = await page.request.fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authToken
        ? `Bearer ${authToken}`
        : ctx.vars.SERVICE_ROLE_KEY
          ? `Bearer ${ctx.vars.SERVICE_ROLE_KEY}`
          : '',
      ...(ctx.vars.TEST_ORG_ID ? { 'x-org-id': ctx.vars.TEST_ORG_ID } : {}),
      ...extraHeaders,
    },
    data: resolvedBody ? JSON.stringify(resolvedBody) : undefined,
  });

  if (!response.ok() && !ignoreStatus.includes(response.status())) {
    const text = await response.text();
    throw new Error(
      `API call ${method} ${endpoint} returned ${response.status()}\n  Body: ${text.slice(0, 500)}`
    );
  }

  const data = await response.json().catch(() => ({}));

  function resolveField(obj, fieldPath) {
    if (!fieldPath) return obj;
    const parts = String(fieldPath).split('.');
    const value = parts.reduce(
      (o, key) => (o !== null && o !== undefined ? o[key] : undefined),
      obj
    );
    return value === undefined ? obj : value;
  }

  if (store) {
    const storedValue = resolveField(data, storeField);
    ctx.vars[store] = typeof storedValue === 'string'
      ? storedValue
      : JSON.stringify(storedValue);
  }

  if (Array.isArray(params.stores)) {
    for (const entry of params.stores) {
      if (!entry?.variable) continue;
      const storedValue = resolveField(data, entry.field);
      ctx.vars[entry.variable] = typeof storedValue === 'string'
        ? storedValue
        : JSON.stringify(storedValue);
    }
  }

  return data;
}

// ─── Screenshot helper ────────────────────────────────────────────────────

async function takeScreenshot(page, name, ctx) {
  const screenshotsDir = join(ctx.reportDir, 'screenshots');
  if (!existsSync(screenshotsDir)) mkdirSync(screenshotsDir, { recursive: true });

  const safeName = (name || `step-${Date.now()}`).replace(/[^a-z0-9-_]/gi, '-');
  const filename = `${safeName}.png`;
  const filePath = join(screenshotsDir, filename);
  await page.screenshot({ path: filePath, fullPage: false });
  return `screenshots/${filename}`;
}

// ─── Single step executor ─────────────────────────────────────────────────

async function executeStep(page, rawStep, ctx) {
  // Interpolate all string values in the step
  const step = interpolateDeep(rawStep, ctx.vars);
  const { action, selector, timeout: stepTimeout } = step;
  const t = stepTimeout ?? ctx.timeout;

  switch (action) {
    // ── Navigation ────────────────────────────────────────────────────────
    case 'navigate': {
      await page.goto(step.url, { waitUntil: step.waitUntil || 'domcontentloaded' });
      break;
    }

    // ── Form interactions ─────────────────────────────────────────────────
    case 'fill': {
      await page.waitForSelector(selector, { state: 'visible', timeout: t });
      await page.fill(selector, step.value ?? '');
      break;
    }
    case 'type': {
      // Slower character-by-character typing (useful for autocomplete inputs)
      await page.waitForSelector(selector, { state: 'visible', timeout: t });
      await page.type(selector, step.value ?? '', { delay: step.delay ?? 50 });
      break;
    }
    case 'focusAndFill': {
      // Click to focus first, then fill — useful for controlled React inputs
      await page.waitForSelector(selector, { state: 'visible', timeout: t });
      await page.click(selector);
      await page.fill(selector, step.value ?? '');
      break;
    }
    case 'select': {
      await page.waitForSelector(selector, { state: 'visible', timeout: t });
      await page.selectOption(selector, step.value);
      break;
    }
    case 'check': {
      await page.waitForSelector(selector, { state: 'visible', timeout: t });
      await page.check(selector);
      break;
    }
    case 'uncheck': {
      await page.waitForSelector(selector, { state: 'visible', timeout: t });
      await page.uncheck(selector);
      break;
    }

    // ── Click / Hover / Keyboard ──────────────────────────────────────────
    case 'click': {
      if (step.nth != null) {
        await page.locator(selector).nth(step.nth).waitFor({ state: 'visible', timeout: t });
        await page.locator(selector).nth(step.nth).click();
      } else if (step.first) {
        // Use locator().first() when multiple elements may match (e.g. dropdown options)
        await page.locator(selector).first().waitFor({ state: 'visible', timeout: t });
        await page.locator(selector).first().click();
      } else {
        await page.waitForSelector(selector, { state: 'visible', timeout: t });
        await page.click(selector);
      }
      break;
    }
    case 'hover': {
      await page.waitForSelector(selector, { state: 'visible', timeout: t });
      await page.hover(selector);
      break;
    }
    case 'pressKey': {
      await page.keyboard.press(step.key);
      break;
    }
    case 'scrollTo': {
      await page.waitForSelector(selector, { timeout: t });
      await page.locator(selector).scrollIntoViewIfNeeded();
      break;
    }

    // ── Waits ─────────────────────────────────────────────────────────────
    case 'waitForSelector': {
      await page.waitForSelector(selector, {
        state: step.state || 'visible',
        timeout: t,
      });
      break;
    }
    case 'waitForURL': {
      await page.waitForURL(new RegExp(step.pattern), { timeout: t });
      break;
    }
    case 'waitForNetwork': {
      await page.waitForResponse(
        res => res.url().includes(step.pattern),
        { timeout: t }
      );
      break;
    }
    case 'sleep': {
      await page.waitForTimeout(step.ms ?? 500);
      break;
    }

    // ── Assertions ────────────────────────────────────────────────────────
    case 'assert': {
      await runAssert(page, step, ctx);
      break;
    }

    // ── Data capture ──────────────────────────────────────────────────────
    case 'store': {
      await page.waitForSelector(selector, { timeout: t });
      const el = page.locator(selector).first();
      let value;
      if (step.attribute) {
        value = await el.getAttribute(step.attribute);
      } else if (step.property === 'value') {
        value = await el.inputValue();
      } else {
        value = await el.textContent();
      }
      ctx.vars[step.variable] = (value ?? '').trim();
      break;
    }

    // ── Screenshot ────────────────────────────────────────────────────────
    case 'screenshot': {
      const path = await takeScreenshot(page, step.name, ctx);
      ctx.screenshots.push({ name: step.name || 'manual', path });
      return path;
    }

    // ── URL capture ───────────────────────────────────────────────────────
    case 'storeFromUrl': {
      const currentUrl = page.url();
      if (step.pattern) {
        const rx = new RegExp(step.pattern);
        const match = currentUrl.match(rx);
        ctx.vars[step.variable] = match
          ? (match[step.group != null ? step.group : 1] || '')
          : '';
      } else {
        ctx.vars[step.variable] = currentUrl;
      }
      break;
    }

    // ── API calls ─────────────────────────────────────────────────────────
    case 'apiCall': {
      await runApiCall(page, step, ctx);
      break;
    }

    // ── Auth helpers ──────────────────────────────────────────────────────
    case 'login': {
      await performLogin(page, step.role || 'admin', ctx);
      break;
    }
    case 'logout': {
      // Clear storage, then force a full page reload to reinitialise the Supabase client
      // (clearing localStorage alone does not invalidate the in-memory session)
      await page.evaluate(() => {
        try { window.localStorage.clear(); } catch {}
        try { window.sessionStorage.clear(); } catch {}
      });
      // Navigate to root (no hash) to guarantee a full document + JS reload
      await page.goto(ctx.vars.BASE_URL + '/', { waitUntil: 'load' });
      // Then change the hash to /login so the SPA shows the login route
      await page.evaluate(() => { window.location.hash = '/login'; });
      await page.waitForSelector('input[type="email"]', { state: 'visible', timeout: t });
      break;
    }
    case 'clearStorage': {
      await page.evaluate(() => {
        try { window.localStorage.clear(); } catch {}
        try { window.sessionStorage.clear(); } catch {}
      });
      break;
    }

    default:
      throw new Error(`Unknown action: "${action}"`);
  }
}

// ─── Workflow runner ───────────────────────────────────────────────────────

/**
 * Run all steps in a single workflow.
 *
 * @param {import('playwright').Page} page
 * @param {object} workflow   - Workflow definition from the script sheet
 * @param {object} script     - Full script sheet
 * @param {object} sharedVars - Mutable variable map shared across workflows
 * @param {string} reportDir  - Directory for screenshots / report artifacts
 * @param {number|null} timeoutOverride
 * @returns {Promise<WorkflowResult>}
 */
export async function runWorkflow(page, workflow, script, sharedVars, reportDir, timeoutOverride) {
  const timeout = timeoutOverride
    ?? script.config?.timeout_ms
    ?? parseInt(process.env.DEFAULT_TIMEOUT_MS ?? '12000', 10);

  const continueOnStepFailure = script.config?.continue_on_step_failure ?? false;

  // Build a context object that steps can mutate (e.g. via `store`)
  const ctx = {
    vars: sharedVars,         // reference — mutations are visible to caller
    timeout,
    reportDir,
    screenshots: [],
  };

  const result = {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description || '',
    status: 'pass',
    duration: 0,
    steps: [],
    vars: sharedVars,         // updated vars returned to runner
  };

  const workflowStart = Date.now();
  let workflowFailed = false;

  for (const step of (workflow.steps || [])) {
    // Skip remaining steps if a prior step failed and we're not continuing
    if (workflowFailed && !continueOnStepFailure) {
      result.steps.push({
        id: step.id || step.action,
        description: step.description || step.action,
        action: step.action,
        status: 'skip',
        duration: 0,
        error: null,
        screenshot: null,
      });
      continue;
    }

    const stepStart = Date.now();
    let stepStatus = 'pass';
    let stepError = null;
    let stepScreenshot = null;

    try {
      const stepResult = await executeStep(page, step, ctx);
      if (typeof stepResult === 'string') stepScreenshot = stepResult;
    } catch (err) {
      stepStatus = 'fail';
      stepError = err.message || String(err);
      workflowFailed = true;
      result.status = 'fail';

      // Always take a failure screenshot
      try {
        stepScreenshot = await takeScreenshot(
          page,
          `FAIL-${workflow.id}-${step.id || step.action}-${Date.now()}`,
          ctx
        );
      } catch { /* screenshot failed too — not critical */ }
    }

    result.steps.push({
      id: step.id || step.action,
      description: step.description || step.action,
      action: step.action,
      status: stepStatus,
      duration: Date.now() - stepStart,
      error: stepError,
      screenshot: stepScreenshot,
    });
  }

  result.duration = Date.now() - workflowStart;
  return result;
}
