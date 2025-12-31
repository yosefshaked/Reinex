/* eslint-env node */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function extractSetupSqlScriptFromSource(sourceText) {
  const marker = 'export const SETUP_SQL_SCRIPT = String.raw`';
  const markerIndex = sourceText.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }

  const start = markerIndex + marker.length;
  const end = sourceText.indexOf('`;', start);
  if (end === -1) {
    return null;
  }

  return sourceText.slice(start, end);
}

async function tryImportSetupScript(absolutePath) {
  try {
    const mod = await import(pathToFileURL(absolutePath).href);
    if (mod && typeof mod.SETUP_SQL_SCRIPT === 'string' && mod.SETUP_SQL_SCRIPT.trim()) {
      return mod.SETUP_SQL_SCRIPT;
    }
  } catch {
    // ignore
  }

  return null;
}

export async function readSsotSqlText() {
  const candidates = [
    path.resolve(process.cwd(), 'src', 'lib', 'setup-sql.js'),
    path.resolve(process.cwd(), '..', 'src', 'lib', 'setup-sql.js'),
  ];

  for (const candidate of candidates) {
    const imported = await tryImportSetupScript(candidate);
    if (imported) {
      return imported;
    }

    try {
      const source = await fs.readFile(candidate, 'utf8');
      const extracted = extractSetupSqlScriptFromSource(source);
      if (extracted && extracted.trim()) {
        return extracted;
      }
    } catch {
      // ignore
    }
  }

  throw new Error('failed_to_load_ssot_setup_sql');
}
