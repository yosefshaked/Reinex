/* eslint-env node */

function normalizeIdentifier(raw) {
  const value = String(raw || '').trim();
  if (!value) {
    return '';
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

function findMatchingParen(text, openParenIndex) {
  let depth = 0;
  for (let index = openParenIndex; index < text.length; index += 1) {
    const ch = text[index];
    if (ch === '(') {
      depth += 1;
      continue;
    }
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function splitTopLevelCommaList(value) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const ch = value[index];
    if (ch === '(') depth += 1;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  const tail = value.slice(start).trim();
  if (tail) {
    parts.push(tail);
  }
  return parts.filter(Boolean);
}

function parseColumnDefinition(entry) {
  const trimmed = entry.trim();
  if (!trimmed) {
    return null;
  }

  const upper = trimmed.toUpperCase();
  const constraintStarters = ['CONSTRAINT ', 'PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE ', 'CHECK ', 'EXCLUDE '];
  if (constraintStarters.some((starter) => upper.startsWith(starter))) {
    return null;
  }

  const match = trimmed.match(/^("[^"]+"|[A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/);
  if (!match) {
    return null;
  }

  const name = normalizeIdentifier(match[1]);
  const remainder = match[2];
  const notNull = /\bNOT\s+NULL\b/i.test(remainder);

  const defaultMatch = remainder.match(/\bDEFAULT\s+(.+?)(\bNOT\s+NULL\b|\bPRIMARY\s+KEY\b|\bUNIQUE\b|\bREFERENCES\b|\bCHECK\b|$)/i);
  const columnDefault = defaultMatch ? defaultMatch[1].trim().replace(/,$/, '') : null;

  const typeSplit = remainder.split(/\bDEFAULT\b|\bNOT\s+NULL\b|\bPRIMARY\s+KEY\b|\bUNIQUE\b|\bREFERENCES\b|\bCHECK\b/i);
  const type = String(typeSplit[0] || '').trim().replace(/,$/, '');

  return {
    name,
    type,
    nullable: !notNull,
    default: columnDefault,
    raw: trimmed,
  };
}

function parseCreateTableBlocks(ssotText) {
  const tables = new Map();
  const regex = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.("[^"]+"|[A-Za-z_][A-Za-z0-9_]*)/gi;

  for (const match of ssotText.matchAll(regex)) {
    const rawTable = match[1];
    const tableName = normalizeIdentifier(rawTable);
    const afterMatch = match.index + match[0].length;
    const openParen = ssotText.indexOf('(', afterMatch);
    if (openParen === -1) {
      continue;
    }
    const closeParen = findMatchingParen(ssotText, openParen);
    if (closeParen === -1) {
      continue;
    }

    const columnBlob = ssotText.slice(openParen + 1, closeParen);
    const items = splitTopLevelCommaList(columnBlob);
    const columns = [];
    for (const item of items) {
      const parsed = parseColumnDefinition(item);
      if (parsed) {
        columns.push(parsed);
      }
    }

    const statementEnd = ssotText.indexOf(';', closeParen);
    const createSql = statementEnd !== -1
      ? ssotText.slice(match.index, statementEnd + 1).trim()
      : ssotText.slice(match.index, closeParen + 1).trim();

    tables.set(tableName, {
      name: tableName,
      createSql,
      columns: new Map(columns.map((col) => [col.name, col])),
    });
  }

  return tables;
}

function parseAlterAddColumns(ssotText, tables) {
  const regex = /ALTER\s+TABLE\s+public\.("[^"]+"|[A-Za-z_][A-Za-z0-9_]*)\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+([^;]+);/gi;

  for (const match of ssotText.matchAll(regex)) {
    const tableName = normalizeIdentifier(match[1]);
    const definition = String(match[2] || '').trim();
    const column = parseColumnDefinition(definition);
    if (!column) {
      continue;
    }

    if (!tables.has(tableName)) {
      tables.set(tableName, { name: tableName, createSql: null, columns: new Map() });
    }

    const table = tables.get(tableName);
    if (!table.columns.has(column.name)) {
      table.columns.set(column.name, column);
    }
  }
}

function parseCreateIndexes(ssotText) {
  const indexes = [];
  const regex = /CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+("[^"]+"|[A-Za-z_][A-Za-z0-9_]*)\s+ON\s+public\.("[^"]+"|[A-Za-z_][A-Za-z0-9_]*)([\s\S]*?);/gi;

  for (const match of ssotText.matchAll(regex)) {
    const isUnique = Boolean(match[1]);
    const indexName = normalizeIdentifier(match[2]);
    const tableName = normalizeIdentifier(match[3]);
    const sql = `CREATE ${isUnique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${match[2]} ON public.${match[3]}${match[4]};`.trim();

    indexes.push({
      name: indexName,
      table: tableName,
      unique: isUnique,
      sql,
    });
  }

  return indexes;
}

function parseEnableRlsStatements(ssotText) {
  const enabled = new Set();
  const regex = /ALTER\s+TABLE\s+public\.("[^"]+"|[A-Za-z_][A-Za-z0-9_]*)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY\s*;/gi;

  for (const match of ssotText.matchAll(regex)) {
    enabled.add(normalizeIdentifier(match[1]));
  }

  return enabled;
}

function parseAddConstraints(ssotText) {
  const constraints = [];
  const regex = /ALTER\s+TABLE\s+public\.("[^"]+"|[A-Za-z_][A-Za-z0-9_]*)\s+ADD\s+CONSTRAINT\s+("[^"]+"|[A-Za-z_][A-Za-z0-9_]*)\s+([^;]+);/gi;

  for (const match of ssotText.matchAll(regex)) {
    constraints.push({
      table: normalizeIdentifier(match[1]),
      name: normalizeIdentifier(match[2]),
      definition: String(match[3] || '').trim(),
      sql: `ALTER TABLE public.${match[1]} ADD CONSTRAINT ${match[2]} ${match[3]};`.trim(),
    });
  }

  return constraints;
}

export function parseSsotExpectations(ssotText) {
  if (typeof ssotText !== 'string' || !ssotText.trim()) {
    throw new Error('invalid_ssot_text');
  }

  const tables = parseCreateTableBlocks(ssotText);
  parseAlterAddColumns(ssotText, tables);

  const indexes = parseCreateIndexes(ssotText);
  const constraints = parseAddConstraints(ssotText);
  const rlsEnabledTables = parseEnableRlsStatements(ssotText);

  const tableExpectations = [...tables.values()].map((table) => {
    const policyName = `Allow full access to authenticated users on ${table.name}`;
    return {
      name: table.name,
      createSql: table.createSql,
      columns: [...table.columns.values()],
      expectedPolicies: [policyName],
      expectsRlsEnabled: rlsEnabledTables.has(table.name) || true,
    };
  });

  return {
    tables: tableExpectations,
    indexes,
    constraints,
    rlsEnabledTables: [...rlsEnabledTables],
  };
}
