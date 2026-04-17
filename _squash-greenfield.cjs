const fs = require('fs');
const path = 'src/lib/setup-sql.js';
let text = fs.readFileSync(path, 'utf8');
let lines = text.split(/\r?\n/);

function parseCreateTables(linesArr) {
  const tables = new Map();
  for (let i = 0; i < linesArr.length; i++) {
    const m = linesArr[i].match(/^CREATE TABLE IF NOT EXISTS\s+([^\s(]+)\s*\(/i);
    if (!m) continue;
    const table = m[1];
    let depth = 0;
    let started = false;
    let end = i;
    for (let j = i; j < linesArr.length; j++) {
      const ln = linesArr[j];
      for (const ch of ln) {
        if (ch === '(') { depth++; started = true; }
        else if (ch === ')') depth--;
      }
      if (started && depth === 0 && /\);\s*$/.test(ln)) { end = j; break; }
    }
    tables.set(table, { start: i, end });
    i = end;
  }
  return tables;
}

function normalizeTableName(t) {
  return t.replace(/\s+/g, ' ').trim();
}

function hasConstraint(linesArr, tbl, cname) {
  const tables = parseCreateTables(linesArr);
  const meta = tables.get(tbl);
  if (!meta) return false;
  for (let i = meta.start; i <= meta.end; i++) {
    if (new RegExp(`\\bCONSTRAINT\\s+"?${cname}"?\\b`, 'i').test(linesArr[i])) return true;
  }
  return false;
}

function injectConstraint(linesArr, tbl, cname, defSql) {
  const tables = parseCreateTables(linesArr);
  const meta = tables.get(tbl);
  if (!meta) return false;
  if (hasConstraint(linesArr, tbl, cname)) return true;
  const closeIdx = meta.end;
  let prev = closeIdx - 1;
  while (prev > meta.start && linesArr[prev].trim() === '') prev--;
  if (!linesArr[prev].trim().endsWith(',')) linesArr[prev] = linesArr[prev] + ',';
  const insert = `  CONSTRAINT ${cname} ${defSql}`;
  linesArr.splice(closeIdx, 0, insert);
  return true;
}

function updateColumn(linesArr, tbl, col, mode, expr) {
  const tables = parseCreateTables(linesArr);
  const meta = tables.get(tbl);
  if (!meta) return false;
  const colRe = new RegExp(`^\\s*"?${col}"?\\s+`, 'i');
  for (let i = meta.start + 1; i < meta.end; i++) {
    if (!colRe.test(linesArr[i])) continue;
    let ln = linesArr[i];
    if (mode === 'notnull') {
      if (!/\bNOT\s+NULL\b/i.test(ln)) {
        ln = ln.replace(/\s*(,)?\s*$/, ' NOT NULL$1');
      }
    } else if (mode === 'default') {
      if (!/\bDEFAULT\b/i.test(ln)) {
        ln = ln.replace(/\s*(,)?\s*$/, ` DEFAULT ${expr}$1`);
      }
    }
    linesArr[i] = ln;
    return true;
  }
  return false;
}

// 1) Convert direct ALTER TABLE ... ALTER COLUMN ... lines.
for (let i = 0; i < lines.length; i++) {
  let m = lines[i].match(/^ALTER TABLE\s+([^\s]+)\s+ALTER COLUMN\s+"?([a-zA-Z0-9_]+)"?\s+SET\s+NOT\s+NULL;\s*$/i);
  if (m) {
    updateColumn(lines, normalizeTableName(m[1]), m[2], 'notnull');
    lines.splice(i, 1); i--; continue;
  }
  m = lines[i].match(/^ALTER TABLE\s+([^\s]+)\s+ALTER COLUMN\s+"?([a-zA-Z0-9_]+)"?\s+SET\s+DEFAULT\s+(.+);\s*$/i);
  if (m) {
    updateColumn(lines, normalizeTableName(m[1]), m[2], 'default', m[3]);
    lines.splice(i, 1); i--; continue;
  }
}

// 2) Convert simple DO blocks.
for (let i = 0; i < lines.length; i++) {
  if (!/^DO \$\$\s*$/.test(lines[i])) continue;
  let end = -1;
  for (let j = i + 1; j < lines.length; j++) {
    if (/^END \$\$;\s*$/.test(lines[j])) { end = j; break; }
  }
  if (end === -1) continue;
  const block = lines.slice(i, end + 1).join('\n');

  // ADD CONSTRAINT block (single statement, no DROP CONSTRAINT)
  let m = block.match(/ALTER TABLE\s+([^\s]+)\s+\n\s*ADD CONSTRAINT\s+"?([a-zA-Z0-9_]+)"?\s+([\s\S]*?);\nEXCEPTION\s+\n\s*WHEN duplicate_object THEN/mi);
  if (m && !/DROP CONSTRAINT/i.test(block)) {
    const tbl = normalizeTableName(m[1]);
    const cname = m[2];
    const defSql = m[3].replace(/\n\s+/g, ' ').trim();
    injectConstraint(lines, tbl, cname, defSql);
    lines.splice(i, end - i + 1); i--; continue;
  }

  // ALTER COLUMN SET DEFAULT / SET NOT NULL in DO blocks
  m = block.match(/ALTER TABLE\s+([^\s]+)\s+\n\s*ALTER COLUMN\s+"?([a-zA-Z0-9_]+)"?\s+SET\s+DEFAULT\s+(.+?);\nEXCEPTION/mi);
  if (m) {
    updateColumn(lines, normalizeTableName(m[1]), m[2], 'default', m[3].trim());
    lines.splice(i, end - i + 1); i--; continue;
  }
  m = block.match(/ALTER TABLE\s+([^\s]+)\s+\n\s*ALTER COLUMN\s+"?([a-zA-Z0-9_]+)"?\s+SET\s+NOT\s+NULL;\nEXCEPTION/mi);
  if (m) {
    updateColumn(lines, normalizeTableName(m[1]), m[2], 'notnull');
    lines.splice(i, end - i + 1); i--; continue;
  }
}

fs.writeFileSync(path, lines.join('\n'));
console.log('Greenfield squash pass complete');
