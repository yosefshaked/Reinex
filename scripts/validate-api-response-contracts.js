/**
 * Validates frontend-facing API error response contracts.
 *
 * This is intentionally static. A live crawler would need real auth/org data and
 * could trigger writes; this check catches risky response shapes before deploy.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT_DIR = join(__dirname, '..');
const API_DIR = join(ROOT_DIR, 'api');

const errors = [];
const warnings = [];
const STRICT_UX = process.argv.includes('--strict-ux');

const SKIPPED_DIRS = new Set(['node_modules', '_shared', 'cross-platform']);
const FRONTEND_ERROR_KEYS = new Set(['message', 'error', 'details', 'title', 'description']);
const TRACKED_5XX_REQUIRED_FUNCTIONS = new Map([
  ['api/calendar/index.js', ['handleUpdateInstance']],
]);

function toRepoPath(filePath) {
  return relative(ROOT_DIR, filePath).replace(/\\/g, '/');
}

async function collectIndexFiles(dir, files = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
        await collectIndexFiles(join(dir, entry.name), files);
      }
      continue;
    }

    if (entry.isFile() && entry.name === 'index.js') {
      files.push(join(dir, entry.name));
    }
  }
  return files;
}

function findMatchingDelimiter(source, openIndex, openChar, closeChar) {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }

    if (char === openChar) {
      depth += 1;
    } else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function splitTopLevelArgs(argsSource) {
  const args = [];
  let start = 0;
  let quote = null;
  let escaped = false;
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let index = 0; index < argsSource.length; index += 1) {
    const char = argsSource[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }

    if (char === '(') parenDepth += 1;
    if (char === ')') parenDepth -= 1;
    if (char === '{') braceDepth += 1;
    if (char === '}') braceDepth -= 1;
    if (char === '[') bracketDepth += 1;
    if (char === ']') bracketDepth -= 1;

    if (char === ',' && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      args.push(argsSource.slice(start, index).trim());
      start = index + 1;
    }
  }

  args.push(argsSource.slice(start).trim());
  return args;
}

function parseStatus(statusSource) {
  const normalized = String(statusSource || '').trim();
  if (/^[1-5]\d\d$/.test(normalized)) {
    return Number(normalized);
  }
  return null;
}

function collectRespondCalls(source) {
  const calls = [];
  let searchFrom = 0;

  while (searchFrom < source.length) {
    const callIndex = source.indexOf('respond(', searchFrom);
    if (callIndex === -1) break;

    const openIndex = source.indexOf('(', callIndex);
    const closeIndex = findMatchingDelimiter(source, openIndex, '(', ')');
    if (closeIndex === -1) {
      searchFrom = callIndex + 'respond('.length;
      continue;
    }

    const args = splitTopLevelArgs(source.slice(openIndex + 1, closeIndex));
    const status = parseStatus(args[1]);
    if (status) {
      calls.push({ status, body: args[2] || '', index: callIndex, kind: 'respond' });
    }
    searchFrom = closeIndex + 1;
  }

  return calls;
}

function collectReturnedBodies(source) {
  const responses = [];
  const pattern = /return\s*{\s*status:\s*([1-5]\d\d)\s*,\s*body:\s*{/g;
  let match;

  while ((match = pattern.exec(source)) !== null) {
    const status = Number(match[1]);
    const bodyOpenIndex = source.indexOf('{', match.index + match[0].lastIndexOf('body:'));
    const bodyCloseIndex = findMatchingDelimiter(source, bodyOpenIndex, '{', '}');
    if (bodyCloseIndex === -1) continue;

    responses.push({
      status,
      body: source.slice(bodyOpenIndex, bodyCloseIndex + 1),
      index: match.index,
      kind: 'returned-body',
    });
  }

  return responses;
}

function collectFunctionRanges(source, functionNames) {
  const ranges = [];
  for (const functionName of functionNames) {
    const pattern = new RegExp(`\\b(?:async\\s+)?function\\s+${functionName}\\s*\\(`, 'g');
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const bodyOpenIndex = source.indexOf('{', match.index);
      if (bodyOpenIndex === -1) continue;
      const bodyCloseIndex = findMatchingDelimiter(source, bodyOpenIndex, '{', '}');
      if (bodyCloseIndex === -1) continue;
      ranges.push({
        name: functionName,
        start: bodyOpenIndex,
        end: bodyCloseIndex,
      });
    }
  }
  return ranges;
}

function findContainingFunction(functionRanges, index) {
  return functionRanges.find((range) => index >= range.start && index <= range.end) || null;
}

function lineNumberFor(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function hasHebrew(value) {
  return /[\u0590-\u05ff]/.test(value);
}

function isStableErrorCode(value) {
  return /^[a-z][a-z0-9_.:-]*$/.test(value) && !value.includes(' ');
}

function isEnglishProse(value) {
  return /[A-Za-z]/.test(value) && /\s/.test(value) && !hasHebrew(value) && !isStableErrorCode(value);
}

function stringLiteralPatternForKey(key) {
  return new RegExp(`\\b${key}\\s*:\\s*(['"\`])([\\s\\S]*?)\\1`, 'g');
}

function validateNoRaw5xxLeaks(filePath, source, response) {
  if (response.status < 500 || response.status > 599) {
    return;
  }

  const body = response.body || '';
  const line = lineNumberFor(source, response.index);
  const location = `${toRepoPath(filePath)}:${line}`;

  if (/\b(details|stack|debug|type)\s*:/.test(body)) {
    errors.push(`${location}: 5xx response exposes details/stack/debug/type. Return a stable code and keep raw detail in logs.`);
  }

  if (/\b(?:message|error|details|stack|type)\s*:\s*[^,}\n]*(?:\b\w*Error\b|\berror\b|\berr\b|\bexception\b)\??\.(?:message|details|stack|hint|name)/i.test(body)) {
    errors.push(`${location}: 5xx response returns raw Error/DB/provider fields. Return a stable code instead.`);
  }
}

function validateTracked5xxForCriticalFunctions(filePath, source, response, functionRanges) {
  if (response.status < 500 || response.status > 599 || response.kind !== 'respond') {
    return;
  }

  const containingFunction = findContainingFunction(functionRanges, response.index);
  if (!containingFunction) {
    return;
  }

  const line = lineNumberFor(source, response.index);
  const location = `${toRepoPath(filePath)}:${line}`;
  errors.push(`${location}: 5xx response inside ${containingFunction.name} bypasses respondTrackedError, so users may see a raw/non-Hebrew failure and support will not get an error_id.`);
}

function validateNoEnglishProseError(filePath, source, response) {
  if (response.status < 400) {
    return;
  }

  const line = lineNumberFor(source, response.index);
  const location = `${toRepoPath(filePath)}:${line}`;

  for (const key of FRONTEND_ERROR_KEYS) {
    const pattern = stringLiteralPatternForKey(key);
    let match;
    while ((match = pattern.exec(response.body || '')) !== null) {
      const value = match[2].trim();
      if (isEnglishProse(value)) {
        const finding = `${location}: frontend-facing ${response.status} ${key} uses English prose "${value}". Use Hebrew copy or a stable snake_case code mapped by the frontend.`;
        if (STRICT_UX) {
          errors.push(finding);
        } else {
          warnings.push(finding);
        }
      }
    }
  }
}

// ─── Rule: respondTracked must not be used for 2xx success responses ────────
//
// respondTracked routes through respondTrackedError when error-tracking is
// attached.  That pipeline normalises the HTTP status into the 4xx/5xx range,
// generates a support code, inserts into error_events, and returns
// { message, error_id } instead of the actual data — so callers see a
// support-code error even on a fully successful operation.
// Use plain respond() for 2xx; reserve respondTracked for 4xx/5xx paths.
//
function collectRespondTrackedCalls(source) {
  const calls = [];
  let searchFrom = 0;

  while (searchFrom < source.length) {
    const callIndex = source.indexOf('respondTracked(', searchFrom);
    if (callIndex === -1) break;

    // Skip respondTrackedError — that's the correct error helper
    const charAfter = source.slice(callIndex + 'respondTracked('.length - 1, callIndex + 'respondTrackedError('.length);
    if (charAfter.startsWith('Error(')) {
      searchFrom = callIndex + 'respondTracked('.length;
      continue;
    }

    const openIndex = source.indexOf('(', callIndex);
    const closeIndex = findMatchingDelimiter(source, openIndex, '(', ')');
    if (closeIndex === -1) {
      searchFrom = callIndex + 'respondTracked('.length;
      continue;
    }

    const args = splitTopLevelArgs(source.slice(openIndex + 1, closeIndex));
    const status = parseStatus(args[1]);
    if (status !== null) {
      calls.push({ status, args, index: callIndex });
    }
    searchFrom = closeIndex + 1;
  }

  return calls;
}

function validateRespondTrackedNotUsedFor2xx(filePath, source) {
  const calls = collectRespondTrackedCalls(source);
  for (const call of calls) {
    if (call.status >= 200 && call.status <= 299) {
      const line = lineNumberFor(source, call.index);
      errors.push(
        `${toRepoPath(filePath)}:${line}: respondTracked() called with ${call.status} — ` +
        `use respond() for success responses. respondTracked routes through respondTrackedError ` +
        `when error-tracking is attached, which overwrites the status and returns a support-code ` +
        `error payload instead of the actual data.`,
      );
    }
  }
}

// ─── Rule: attachErrorTracking must receive req and supabase ─────────────────
//
// attachErrorTracking(context) with only one argument sets up no supabase
// client.  respondTracked then detects no tracking client and silently
// degrades to respond(), meaning error events are never stored and
// support-code diagnostics are silently skipped.
//
function validateAttachErrorTrackingArgs(filePath, source) {
  let searchFrom = 0;

  while (searchFrom < source.length) {
    const callIndex = source.indexOf('attachErrorTracking(', searchFrom);
    if (callIndex === -1) break;

    const openIndex = source.indexOf('(', callIndex);
    const closeIndex = findMatchingDelimiter(source, openIndex, '(', ')');
    if (closeIndex === -1) {
      searchFrom = callIndex + 'attachErrorTracking('.length;
      continue;
    }

    const args = splitTopLevelArgs(source.slice(openIndex + 1, closeIndex));
    // Needs at least: context, req, supabase  (3 args minimum)
    if (args.length < 3) {
      const line = lineNumberFor(source, callIndex);
      errors.push(
        `${toRepoPath(filePath)}:${line}: attachErrorTracking() called with only ${args.length} arg(s). ` +
        `It requires (context, req, supabase[, options]) — without req and a supabase client, ` +
        `error events are never persisted and respondTracked silently skips tracking.`,
      );
    }

    searchFrom = closeIndex + 1;
  }
}

async function validateFile(filePath) {
  const source = await readFile(filePath, 'utf8');
  const repoPath = toRepoPath(filePath);
  const trackedFunctionRanges = collectFunctionRanges(
    source,
    TRACKED_5XX_REQUIRED_FUNCTIONS.get(repoPath) || [],
  );
  const responses = [
    ...collectRespondCalls(source),
    ...collectReturnedBodies(source),
  ];

  for (const response of responses) {
    validateNoRaw5xxLeaks(filePath, source, response);
    validateTracked5xxForCriticalFunctions(filePath, source, response, trackedFunctionRanges);
    validateNoEnglishProseError(filePath, source, response);
  }

  validateRespondTrackedNotUsedFor2xx(filePath, source);
  validateAttachErrorTrackingArgs(filePath, source);
}

async function main() {
  const files = await collectIndexFiles(API_DIR);
  for (const filePath of files) {
    await validateFile(filePath);
  }

  if (errors.length > 0) {
    console.error(`API response contract validation failed (${errors.length} issue${errors.length === 1 ? '' : 's'}):`);
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  console.log(`API response contract validation passed (${files.length} endpoint file${files.length === 1 ? '' : 's'} scanned).`);
  if (warnings.length > 0) {
    console.log(`Frontend English error copy report: ${warnings.length} existing issue${warnings.length === 1 ? '' : 's'} found.`);
    console.log('Run npm run lint:api-responses:strict-ux to fail on these after the legacy responses are cleaned up.');
    for (const warning of warnings.slice(0, 25)) {
      console.log(`  - ${warning}`);
    }
    if (warnings.length > 25) {
      console.log(`  ... ${warnings.length - 25} more`);
    }
  }
}

main().catch((error) => {
  console.error('API response contract validation crashed:', error);
  process.exit(1);
});
