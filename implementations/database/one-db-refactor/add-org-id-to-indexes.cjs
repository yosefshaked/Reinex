/**
 * Step 4: Add org_id prefix to all tenant-table regular indexes in setup-sql.js.
 * Control tables are skipped. Quoted tables use "org_id".
 */
const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '../../../src/lib/setup-sql.js');
let content = fs.readFileSync(filePath, 'utf8');

const CONTROL_TABLES = new Set([
  'organizations', 'profiles', 'org_memberships',
  'org_invitations', 'permission_registry', 'active_routing', 'audit_log',
]);

// Quoted tenant tables need "org_id" with quotes
const QUOTED_TABLES = new Set([
  '"Employees"', '"Services"', '"RateHistory"', '"Settings"', '"Documents"',
]);

// Pattern for single-line: CREATE INDEX IF NOT EXISTS <name> ON public.<table> (<cols>)...;
// Pattern for multi-line:  CREATE INDEX IF NOT EXISTS <name>\n  ON public.<table> (<cols>)...;
// We need to handle both.

let replaced = 0;
let skipped = 0;
const details = [];

// --- SINGLE-LINE indexes ---
// e.g. CREATE INDEX IF NOT EXISTS foo_idx ON public.bar (col1, col2);
// e.g. CREATE INDEX IF NOT EXISTS foo_idx ON public.bar (col1) WHERE ...;
content = content.replace(
  /^(CREATE INDEX IF NOT EXISTS \S+) ON public\.(\S+) \(([^)]+)\)/gm,
  (match, prefix, table, cols) => {
    // Skip if this is inside a string/comment context (the diagnostics function LIKE pattern)
    if (match.includes("LIKE '")) return match;
    
    // Determine bare table name (strip quotes for lookup)
    const bareTable = table.replace(/"/g, '');
    
    if (CONTROL_TABLES.has(bareTable)) {
      skipped++;
      return match; // leave control-table indexes alone
    }

    // Already has org_id?
    if (/\borg_id\b/i.test(cols)) {
      skipped++;
      return match;
    }

    const orgCol = QUOTED_TABLES.has(table) ? '"org_id", ' : 'org_id, ';
    replaced++;
    details.push(`  ${prefix} → (${orgCol}${cols})`);
    return `${prefix} ON public.${table} (${orgCol}${cols})`;
  }
);

// --- MULTI-LINE indexes ---
// e.g. CREATE INDEX IF NOT EXISTS foo_idx\n  ON public.bar (col1, col2)
content = content.replace(
  /^(CREATE INDEX IF NOT EXISTS \S+)\r?\n(\s+ON public\.(\S+)) \(([^)]+)\)/gm,
  (match, prefix, onClause, table, cols) => {
    const bareTable = table.replace(/"/g, '');
    
    if (CONTROL_TABLES.has(bareTable)) {
      skipped++;
      return match;
    }

    if (/\borg_id\b/i.test(cols)) {
      skipped++;
      return match;
    }

    const orgCol = QUOTED_TABLES.has(table) ? '"org_id", ' : 'org_id, ';
    replaced++;
    details.push(`  ${prefix.trim()} → (${orgCol}${cols})`);
    return `${prefix}\n${onClause} (${orgCol}${cols})`;
  }
);

fs.writeFileSync(filePath, content, 'utf8');

console.log(`Done. Replaced: ${replaced}, Skipped (control/already done): ${skipped}`);
console.log('\nDetails:');
details.forEach(d => console.log(d));

// Verify JS parse
try {
  require(filePath);
  console.log('\n✅ JS parse OK');
} catch (e) {
  console.error('\n❌ JS parse FAILED:', e.message);
  process.exit(1);
}
