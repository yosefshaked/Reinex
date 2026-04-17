const fs = require('fs');
const diff = fs.readFileSync('_setup_sql.diff', 'utf8');
const cur = fs.readFileSync('src/lib/setup-sql.js', 'utf8');
const lines = diff.split(/\r?\n/);
const deleted = lines.filter((l) => l.startsWith('-') && !l.startsWith('---'));
let currentTable = null;
const addCols = [];
const alterDefault = [];
const alterNotNull = [];
const addConstraint = [];
for (const l of deleted) {
  const s = l.slice(1);
  let m = s.match(/^ALTER TABLE\s+(.+)$/i);
  if (m) currentTable = m[1].trim();

  m = s.match(/^\s*ADD COLUMN IF NOT EXISTS\s+"?([a-zA-Z0-9_]+)"?\s+/i);
  if (m && currentTable) addCols.push({ table: currentTable, col: m[1] });

  m = s.match(/^\s*ALTER COLUMN\s+"?([a-zA-Z0-9_]+)"?\s+SET DEFAULT\s+(.+);?$/i);
  if (m && currentTable) alterDefault.push({ table: currentTable, col: m[1], expr: m[2] });

  m = s.match(/^\s*ALTER COLUMN\s+"?([a-zA-Z0-9_]+)"?\s+SET NOT NULL\s*;?$/i);
  if (m && currentTable) alterNotNull.push({ table: currentTable, col: m[1] });

  m = s.match(/^\s*ADD CONSTRAINT\s+"?([a-zA-Z0-9_]+)"?\s+(.*)$/i);
  if (m && currentTable) addConstraint.push({ table: currentTable, name: m[1], rest: m[2] });
}

function findCreateBlock(tbl) {
  const esc = tbl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`CREATE TABLE IF NOT EXISTS\\s+${esc}\\s*\\(([^]*?)\\);`, 'i');
  const m = cur.match(re);
  return m ? m[1] : null;
}

const missingCols = [];
for (const it of addCols) {
  const block = findCreateBlock(it.table);
  if (!block) {
    missingCols.push({ ...it, reason: 'missing_create_table' });
    continue;
  }
  const colRe = new RegExp(`(^|\\n)\\s*"?${it.col}"?\\s+`, 'i');
  if (!colRe.test(block)) missingCols.push({ ...it, reason: 'missing_column_in_create' });
}

const missingDefaults = [];
for (const it of alterDefault) {
  const block = findCreateBlock(it.table);
  if (!block) continue;
  const lineRe = new RegExp(`(^|\\n)\\s*"?${it.col}"?\\s+[^,\\n]*\\sDEFAULT\\s`, 'i');
  if (!lineRe.test(block)) missingDefaults.push(it);
}

const missingNotNull = [];
for (const it of alterNotNull) {
  const block = findCreateBlock(it.table);
  if (!block) continue;
  const lineRe = new RegExp(`(^|\\n)\\s*"?${it.col}"?\\s+[^,\\n]*\\sNOT\\s+NULL`, 'i');
  if (!lineRe.test(block)) missingNotNull.push(it);
}

console.log('DELETED add cols:', addCols.length);
console.log('DELETED alter default:', alterDefault.length);
console.log('DELETED alter not null:', alterNotNull.length);
console.log('DELETED add constraint:', addConstraint.length);
console.log('MISSING columns:', missingCols.length);
if (missingCols.length) console.log(JSON.stringify(missingCols, null, 2));
console.log('MISSING defaults:', missingDefaults.length);
if (missingDefaults.length) console.log(JSON.stringify(missingDefaults, null, 2));
console.log('MISSING not null:', missingNotNull.length);
if (missingNotNull.length) console.log(JSON.stringify(missingNotNull, null, 2));
