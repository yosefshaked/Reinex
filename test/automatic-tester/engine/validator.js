/**
 * validator.js
 *
 * Checks a script sheet for two things:
 *
 * 1. INTEGRITY — declared dependencies actually exist in the repo:
 *    - routes     → looks for the path string inside src/ (main.jsx routes)
 *    - api_endpoints → checks whether api/<name>/index.js exists on disk
 *
 * 2. FRESHNESS — warns when repo files that the script depends on have been
 *    modified more recently than the script's `meta.last_validated_at` date.
 *    This surfaces "the code changed; the script might be outdated" signals
 *    WITHOUT blocking execution — it only produces warnings.
 *
 * Returns: { valid: boolean, issues: string[], warnings: string[] }
 */

import { existsSync, statSync, readdirSync } from 'fs';
import { readFile } from 'fs/promises';
import { join, resolve } from 'path';

// ─── Route check ──────────────────────────────────────────────────────────

/**
 * A route is "valid" if its path literal (e.g. "/dashboard") appears somewhere
 * inside src/main.jsx (which is the single source of truth for routes).
 * Dynamic segments like :id are checked as the prefix.
 */
async function checkRouteExists(routePath, repoRoot) {
  const mainJsx = join(repoRoot, 'src', 'main.jsx');
  if (!existsSync(mainJsx)) return true; // can't verify — don't block

  const content = await readFile(mainJsx, 'utf8');

  // Try exact match first (handles routes with dynamic segments like /students/:id/:tab?)
  if (content.includes(`"${routePath}"`) || content.includes(`'${routePath}'`)) return true;

  // Fallback: strip dynamic segments and match the static prefix
  // e.g. the script declares "/students" but the code has "/students/:id"
  const base = routePath.replace(/:[^/]*/g, '').replace(/\/$/, '');
  return content.includes(`"${base}"`) || content.includes(`'${base}'`)
    || content.includes(`"${base}/`) || content.includes(`'${base}/`);
}

// ─── API endpoint check ───────────────────────────────────────────────────

/**
 * API endpoints live at  api/<name>/index.js  (Azure SWA functions convention).
 * e.g.  "POST /api/intake"  →  api/intake/index.js
 */
function apiPathToFile(endpointDecl, repoRoot) {
  // "POST /api/students-list" → "students-list"
  const parts = endpointDecl.trim().split(/\s+/);
  const urlPath = parts.length === 2 ? parts[1] : parts[0];
  // strip leading /api/
  const name = urlPath.replace(/^\/api\//, '').split('/')[0];
  return join(repoRoot, 'api', name, 'index.js');
}

function checkApiEndpointExists(endpointDecl, repoRoot) {
  const filePath = apiPathToFile(endpointDecl, repoRoot);
  return existsSync(filePath);
}

// ─── Staleness check ──────────────────────────────────────────────────────

/**
 * Returns the mtime of a file, or null if the file does not exist.
 */
function fileMtime(filePath) {
  try {
    return statSync(filePath).mtime;
  } catch {
    return null;
  }
}

/**
 * For a declared dependency, figure out which source files are "relevant"
 * and return any that are newer than lastValidated.
 */
function findStaleFiles(dependencies, lastValidated, repoRoot) {
  const stale = [];

  // Routes → src/main.jsx + the page component file (best-effort)
  for (const route of (dependencies.routes || [])) {
    const mainJsx = join(repoRoot, 'src', 'main.jsx');
    const mtime = fileMtime(mainJsx);
    if (mtime && mtime > lastValidated) {
      if (!stale.includes('src/main.jsx')) stale.push('src/main.jsx');
    }

    // Try to locate a page component matching the route segment
    const segment = route.replace(/^\//, '').replace(/:[^/]*/g, '').split('/')[0];
    if (segment) {
      const candidates = [
        join(repoRoot, 'src', 'pages', `${capitalize(segment)}Page.jsx`),
        join(repoRoot, 'src', 'pages', `${segment}.jsx`),
        join(repoRoot, 'src', 'features', segment),
      ];
      for (const c of candidates) {
        const m = fileMtime(c);
        if (m && m > lastValidated) {
          const rel = c.replace(repoRoot + '/', '').replace(repoRoot + '\\', '');
          if (!stale.includes(rel)) stale.push(rel);
        }
      }
    }
  }

  // API endpoints → api/<name>/index.js
  for (const ep of (dependencies.api_endpoints || [])) {
    const filePath = apiPathToFile(ep, repoRoot);
    const m = fileMtime(filePath);
    if (m && m > lastValidated) {
      const rel = filePath.replace(repoRoot + '/', '').replace(repoRoot + '\\', '');
      if (!stale.includes(rel)) stale.push(rel);
    }
  }

  return stale;
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ─── Script structure checks ──────────────────────────────────────────────

function checkScriptStructure(script) {
  const issues = [];

  if (!script.meta?.id)   issues.push('Missing meta.id');
  if (!script.meta?.name) issues.push('Missing meta.name');
  if (!Array.isArray(script.workflows) || script.workflows.length === 0) {
    issues.push('Script has no workflows');
  }

  for (const wf of (script.workflows || [])) {
    if (!wf.id)   issues.push(`Workflow missing "id"`);
    if (!wf.name) issues.push(`Workflow "${wf.id || '?'}" missing "name"`);
    if (!Array.isArray(wf.steps) || wf.steps.length === 0) {
      issues.push(`Workflow "${wf.id || '?'}" has no steps`);
    }

    for (const step of (wf.steps || [])) {
      if (!step.action) {
        issues.push(`Workflow "${wf.id}": a step is missing "action"`);
      }
    }
  }

  return issues;
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * @param {string} scriptPath  - Absolute path to the script JSON file
 * @param {object} script      - Parsed script object
 * @param {string} repoRoot    - Absolute path to repo root
 * @returns {Promise<{ valid: boolean, issues: string[], warnings: string[] }>}
 */
export async function validateScript(scriptPath, script, repoRoot) {
  const issues = [];
  const warnings = [];

  // 1. Structure checks (synchronous)
  issues.push(...checkScriptStructure(script));

  const { dependencies, last_validated_at } = script.meta || {};

  // 2. Route existence checks
  for (const route of (dependencies?.routes || [])) {
    const exists = await checkRouteExists(route, repoRoot);
    if (!exists) {
      issues.push(`Route not found in src/main.jsx: "${route}"`);
    }
  }

  // 3. API endpoint existence checks
  for (const ep of (dependencies?.api_endpoints || [])) {
    const exists = checkApiEndpointExists(ep, repoRoot);
    if (!exists) {
      const filePath = apiPathToFile(ep, repoRoot)
        .replace(repoRoot + '/', '')
        .replace(repoRoot + '\\', '');
      issues.push(`API endpoint file not found for "${ep}" (expected: ${filePath})`);
    }
  }

  // 4. Freshness check (warnings only)
  if (last_validated_at && dependencies) {
    const validatedDate = new Date(last_validated_at);
    if (isNaN(validatedDate.getTime())) {
      warnings.push(`meta.last_validated_at is not a valid ISO date: "${last_validated_at}"`);
    } else {
      const stale = findStaleFiles(dependencies, validatedDate, repoRoot);
      if (stale.length > 0) {
        warnings.push(
          `Script may be out of date — these files changed after last_validated_at ` +
          `(${last_validated_at}):\n    ${stale.join('\n    ')}`
        );
      }
    }
  } else if (!last_validated_at) {
    warnings.push('meta.last_validated_at is not set — staleness cannot be checked');
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings,
  };
}
