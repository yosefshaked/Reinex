/**
 * Step 2: Add org_id to all tenant tables in setup-sql.js
 * Run: node implementations/database/one-db-refactor/add-org-id.cjs
 */
const fs = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, '../../../src/lib/setup-sql.js');

// Control tables — do NOT add org_id
const SKIP = new Set([
  'organizations', 'profiles', 'org_memberships',
  'org_invitations', 'permission_registry', 'active_routing', 'audit_log'
]);

// Quoted-identifier tables — need "org_id" instead of org_id
const QUOTED = new Set([
  'Employees', 'Services', 'RateHistory', 'Settings', 'Documents'
]);

const src = fs.readFileSync(FILE, 'utf8');
const lines = src.split('\n');

// Track stats
let createInserts = 0;
let alterInserts = 0;
const result = [];

// States
let inCreateTable = null;   // table name if inside CREATE TABLE
let sawIdLine = false;
let inAlterTable = null;    // table name if inside ALTER TABLE
let sawFirstAddCol = false;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  // Detect CREATE TABLE IF NOT EXISTS public.<name> (
  const createMatch = line.match(
    /CREATE TABLE IF NOT EXISTS public\.("?(\w+)"?)\s*\(/
  );
  if (createMatch) {
    const rawName = createMatch[2]; // unquoted table name
    if (!SKIP.has(rawName)) {
      inCreateTable = rawName;
      sawIdLine = false;
    }
    result.push(line);
    continue;
  }

  // Inside CREATE TABLE — look for id line to insert org_id after it
  if (inCreateTable && !sawIdLine) {
    const isIdLine =
      line.match(/^\s+"?id"?\s+uuid\s/) ||
      line.match(/^\s+CONSTRAINT\s+"?\w+_pkey"?\s+PRIMARY KEY/);

    if (line.match(/^\s+"?id"?\s+uuid\s/)) {
      sawIdLine = true;
      result.push(line);
      // Insert org_id line
      if (QUOTED.has(inCreateTable)) {
        result.push('  "org_id" uuid NOT NULL REFERENCES public.organizations(id),');
      } else {
        result.push('  org_id uuid NOT NULL REFERENCES public.organizations(id),');
      }
      createInserts++;
      continue;
    }
  }

  // Detect end of CREATE TABLE
  if (inCreateTable && line.match(/^\);/)) {
    inCreateTable = null;
    sawIdLine = false;
    result.push(line);
    continue;
  }

  // Detect ALTER TABLE public.<name>
  const alterMatch = line.match(
    /^ALTER TABLE public\.("?(\w+)"?)\s*$/
  );
  if (alterMatch) {
    const rawName = alterMatch[2];
    if (!SKIP.has(rawName)) {
      inAlterTable = rawName;
      sawFirstAddCol = false;
    }
    result.push(line);
    continue;
  }

  // Inside ALTER TABLE — look for first ADD COLUMN to prepend org_id
  if (inAlterTable && !sawFirstAddCol && line.match(/^\s+ADD COLUMN IF NOT EXISTS/)) {
    sawFirstAddCol = true;
    // Insert org_id ADD COLUMN before first existing ADD COLUMN
    if (QUOTED.has(inAlterTable)) {
      result.push('  ADD COLUMN IF NOT EXISTS "org_id" uuid,');
    } else {
      result.push('  ADD COLUMN IF NOT EXISTS org_id uuid,');
    }
    alterInserts++;
    result.push(line);
    continue;
  }

  // Detect end of ALTER TABLE block (line not starting with ADD or whitespace)
  if (inAlterTable && sawFirstAddCol && !line.match(/^\s+ADD COLUMN/) && !line.match(/^\s*$/)) {
    inAlterTable = null;
    sawFirstAddCol = false;
  }

  result.push(line);
}

fs.writeFileSync(FILE, result.join('\n'), 'utf8');

console.log(`Done. CREATE TABLE insertions: ${createInserts}, ALTER TABLE insertions: ${alterInserts}`);
console.log('Expected: 43 CREATE + ~43 ALTER (some tables may lack ALTER blocks)');
