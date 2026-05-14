/* eslint-env node */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { MANIFEST_TABLE_SET, PLATFORM_TABLES, PURGE_MANIFEST } from './purge-manifest.js';

function normalizeTableName(value) {
  return String(value || '').replace(/^public\./, '').replace(/^"|"$/g, '');
}

function extractCreateTableBlocks(sql) {
  const blocks = [];
  const matches = Array.from(sql.matchAll(/CREATE TABLE IF NOT EXISTS public\.((?:"[^"]+")|[A-Za-z_][A-Za-z0-9_]*)\s*\(/g));

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const table = normalizeTableName(match[1]);
    const bodyStart = match.index + match[0].length;
    const bodyEnd = matches[index + 1]?.index ?? sql.length;
    blocks.push({
      table,
      body: sql.slice(bodyStart, bodyEnd),
    });
  }

  return blocks;
}

test('purge manifest classifies every setup-sql table with org_id FK to organizations', () => {
  const sql = readFileSync(new URL('../../src/lib/setup-sql.js', import.meta.url), 'utf8');
  const knownTables = new Set([...MANIFEST_TABLE_SET, ...PLATFORM_TABLES.keys()]);

  const orgScopedTables = extractCreateTableBlocks(sql)
    .filter((block) => block.body.includes('REFERENCES public.organizations(id)'))
    .filter((block) => block.body.includes('org_id uuid') || block.body.includes('"org_id" uuid'))
    .map((block) => block.table);

  const missing = orgScopedTables.filter((table) => !knownTables.has(table));
  assert.deepEqual(missing, []);
});

test('purge manifest has unique table names and ordered step ids', () => {
  const names = PURGE_MANIFEST.map((entry) => entry.table);
  assert.equal(new Set(names).size, names.length);

  const phaseSteps = PURGE_MANIFEST.map((entry) => `${entry.phase}:${entry.step}`);
  assert.equal(new Set(phaseSteps).size, phaseSteps.length);
});
