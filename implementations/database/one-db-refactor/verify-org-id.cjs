const path = require('path');
const s = require(path.resolve(__dirname, '../../../src/lib/setup-sql.js')).SETUP_SQL_SCRIPT;

// Split on CREATE TABLE to find each block
const blocks = s.split(/CREATE TABLE IF NOT EXISTS public\./);
const tables = [];
const missing = [];
const skip = new Set(['organizations','profiles','org_memberships','org_invitations','permission_registry','active_routing','audit_log']);

for (let i = 1; i < blocks.length; i++) {
  const nameMatch = blocks[i].match(/^"?(\w+)"?\s*\(/);
  if (!nameMatch) continue;
  const name = nameMatch[1];
  if (skip.has(name)) continue;
  // Check first 30 lines for org_id
  const first30 = blocks[i].split('\n').slice(0, 30).join('\n');
  if (first30.includes('org_id')) {
    tables.push(name);
  } else {
    missing.push(name);
  }
}
console.log('Tables with org_id:', tables.length);
tables.forEach(t => console.log(' +', t));
if (missing.length) {
  console.log('\nMISSING org_id:', missing.length);
  missing.forEach(t => console.log(' !', t));
}
