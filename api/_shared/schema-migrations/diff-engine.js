/* eslint-env node */

function quoteIdent(name) {
  const value = String(name || '');
  if (!value) {
    return '""';
  }
  if (/^[a-z_][a-z0-9_]*$/.test(value)) {
    return value;
  }
  return '"' + value.replaceAll('"', '""') + '"';
}

function buildTitle(change) {
  const { category, action, object } = change;
  const target = object?.table ? `${object.table}.${object.name || ''}` : object?.name || '';
  if (category === 'TABLE' && action === 'CREATE') {
    return `Create table ${object?.name}`;
  }
  if (category === 'COLUMN' && action === 'ADD') {
    return `Add column ${target}`;
  }
  if (category === 'INDEX' && action === 'CREATE') {
    return `Create index ${object?.name}`;
  }
  if (category === 'CONSTRAINT' && action === 'ADD') {
    return `Add constraint ${object?.name}`;
  }
  if (category === 'RLS' && action === 'ALTER') {
    return `Enable RLS on ${object?.name}`;
  }
  if (category === 'POLICY' && action === 'CREATE') {
    return `Create policy ${object?.name}`;
  }
  return `${action} ${category} ${target}`.trim();
}

function isLockedTable(tableName) {
  return String(tableName || '').toLowerCase() === 'lesson_template_overrides';
}

function normalizeDbSnapshot(dbSnapshot) {
  const snapshot = dbSnapshot && typeof dbSnapshot === 'object' ? dbSnapshot : {};
  const tables = Array.isArray(snapshot.tables) ? snapshot.tables : [];
  const indexes = Array.isArray(snapshot.indexes) ? snapshot.indexes : [];
  const constraints = Array.isArray(snapshot.constraints) ? snapshot.constraints : [];
  const policies = Array.isArray(snapshot.policies) ? snapshot.policies : [];
  const rls = Array.isArray(snapshot.rls) ? snapshot.rls : [];

  const tablesByName = new Map();
  for (const table of tables) {
    if (!table?.name) continue;
    const cols = Array.isArray(table.columns) ? table.columns : [];
    const columnsByName = new Map();
    for (const col of cols) {
      if (!col?.name) continue;
      columnsByName.set(col.name, col);
    }
    tablesByName.set(table.name, { ...table, columnsByName });
  }

  const indexesByTable = new Map();
  for (const idx of indexes) {
    if (!idx?.table || !idx?.name) continue;
    const list = indexesByTable.get(idx.table) ?? [];
    list.push(idx);
    indexesByTable.set(idx.table, list);
  }

  const constraintsByTable = new Map();
  for (const constraint of constraints) {
    if (!constraint?.table || !constraint?.name) continue;
    const list = constraintsByTable.get(constraint.table) ?? [];
    list.push(constraint);
    constraintsByTable.set(constraint.table, list);
  }

  const policiesByTable = new Map();
  for (const policy of policies) {
    if (!policy?.table || !policy?.name) continue;
    const list = policiesByTable.get(policy.table) ?? [];
    list.push(policy);
    policiesByTable.set(policy.table, list);
  }

  const rlsByTable = new Map();
  for (const entry of rls) {
    if (!entry?.table) continue;
    rlsByTable.set(entry.table, Boolean(entry.enabled));
  }

  return {
    tablesByName,
    indexesByTable,
    constraintsByTable,
    policiesByTable,
    rlsByTable,
  };
}

function columnAddRisk(column) {
  if (!column) {
    return { risk: 'SAFE', reason: 'Missing column can be added idempotently.' };
  }
  if (column.nullable === false && !column.default) {
    return {
      risk: 'CAUTION',
      reason: 'Adding a NOT NULL column without a default can fail when existing rows exist.',
    };
  }
  return { risk: 'SAFE', reason: 'Missing column can be added idempotently.' };
}

function buildAddColumnSql(tableName, column) {
  const type = column.type || 'text';
  const notNull = column.nullable === false ? ' NOT NULL' : '';
  const defaultClause = column.default ? ` DEFAULT ${column.default}` : '';
  return `ALTER TABLE public.${quoteIdent(tableName)} ADD COLUMN IF NOT EXISTS ${quoteIdent(column.name)} ${type}${defaultClause}${notNull};`;
}

export function diffSchema(ssot, dbSnapshot) {
  const changes = [];
  const preflightQueries = [];

  const normalized = normalizeDbSnapshot(dbSnapshot);
  const expectedTables = Array.isArray(ssot?.tables) ? ssot.tables : [];

  for (const expectedTable of expectedTables) {
    const tableName = expectedTable.name;
    if (!tableName) continue;

    const dbTable = normalized.tablesByName.get(tableName);

    if (!dbTable) {
      changes.push({
        change_id: `table:create:${tableName}`,
        category: 'TABLE',
        action: 'CREATE',
        object: { name: tableName },
        sql_preview: expectedTable.createSql || `-- Missing CREATE TABLE statement for ${tableName} in SSOT parser output`,
        risk_level: isLockedTable(tableName) ? 'CAUTION' : 'SAFE',
        reason: 'The table exists in SSOT but is missing from the tenant database.',
      });
      continue;
    }

    const expectedColumns = Array.isArray(expectedTable.columns) ? expectedTable.columns : [];
    for (const expectedColumn of expectedColumns) {
      const colName = expectedColumn.name;
      if (!colName) continue;

      const dbCol = dbTable.columnsByName.get(colName);

      if (!dbCol) {
        const risk = columnAddRisk(expectedColumn);
        changes.push({
          change_id: `column:add:${tableName}:${colName}`,
          category: 'COLUMN',
          action: 'ADD',
          object: { table: tableName, name: colName },
          sql_preview: buildAddColumnSql(tableName, expectedColumn),
          risk_level: isLockedTable(tableName) && risk.risk === 'SAFE' ? 'CAUTION' : risk.risk,
          reason: risk.reason,
        });
        continue;
      }

      if (expectedColumn.type && dbCol.type && String(expectedColumn.type).toLowerCase() !== String(dbCol.type).toLowerCase()) {
        changes.push({
          change_id: `column:type:${tableName}:${colName}`,
          category: 'COLUMN',
          action: 'ALTER',
          object: { table: tableName, name: colName },
          sql_preview: `-- Type mismatch: SSOT expects ${expectedColumn.type}, DB has ${dbCol.type}\n-- Manual migration required.`,
          risk_level: 'DESTRUCTIVE',
          reason: 'Column type differs between SSOT and the tenant database.',
        });
      }

      if (expectedColumn.nullable === false && dbCol.nullable === true) {
        const query = `SELECT COUNT(*)::integer AS null_count FROM public.${quoteIdent(tableName)} WHERE ${quoteIdent(colName)} IS NULL;`;
        preflightQueries.push({
          id: `preflight:nulls:${tableName}:${colName}`,
          risk_level: 'CAUTION',
          description: `Check for NULL values before setting NOT NULL on ${tableName}.${colName}.`,
          sql: query,
        });

        changes.push({
          change_id: `column:not_null:${tableName}:${colName}`,
          category: 'COLUMN',
          action: 'ALTER',
          object: { table: tableName, name: colName },
          sql_preview: `ALTER TABLE public.${quoteIdent(tableName)} ALTER COLUMN ${quoteIdent(colName)} SET NOT NULL;`,
          risk_level: 'CAUTION',
          reason: 'SSOT expects the column to be NOT NULL but it is nullable in the tenant database.',
        });
      }
    }

    if (expectedTable.expectsRlsEnabled) {
      const enabled = normalized.rlsByTable.get(tableName);
      if (enabled === false) {
        changes.push({
          change_id: `rls:enable:${tableName}`,
          category: 'RLS',
          action: 'ALTER',
          object: { name: tableName },
          sql_preview: `ALTER TABLE public.${quoteIdent(tableName)} ENABLE ROW LEVEL SECURITY;`,
          risk_level: 'SAFE',
          reason: 'RLS is enabled in SSOT but disabled on this table in the tenant database.',
        });
      }
    }

    const expectedPolicies = Array.isArray(expectedTable.expectedPolicies) ? expectedTable.expectedPolicies : [];
    for (const policyName of expectedPolicies) {
      if (!policyName) continue;
      const existing = normalized.policiesByTable.get(tableName) ?? [];
      const has = existing.some((policy) => policy.name === policyName);
      if (!has) {
        changes.push({
          change_id: `policy:create:${tableName}:${policyName}`,
          category: 'POLICY',
          action: 'CREATE',
          object: { table: tableName, name: policyName },
          sql_preview: `CREATE POLICY ${quoteIdent(policyName)} ON public.${quoteIdent(tableName)} FOR ALL TO authenticated, app_user USING (true) WITH CHECK (true);`,
          risk_level: 'SAFE',
          reason: 'Expected RLS policy is missing in the tenant database.',
        });
      }
    }
  }

  const expectedIndexes = Array.isArray(ssot?.indexes) ? ssot.indexes : [];
  for (const idx of expectedIndexes) {
    if (!idx?.name || !idx?.table) continue;
    const existing = normalized.indexesByTable.get(idx.table) ?? [];
    const has = existing.some((entry) => entry.name === idx.name);
    if (!has) {
      changes.push({
        change_id: `index:create:${idx.table}:${idx.name}`,
        category: 'INDEX',
        action: 'CREATE',
        object: { table: idx.table, name: idx.name },
        sql_preview: idx.sql,
        risk_level: 'SAFE',
        reason: 'Index exists in SSOT but is missing in the tenant database.',
      });
    }
  }

  const expectedConstraints = Array.isArray(ssot?.constraints) ? ssot.constraints : [];
  for (const constraint of expectedConstraints) {
    if (!constraint?.name || !constraint?.table) continue;
    const existing = normalized.constraintsByTable.get(constraint.table) ?? [];
    const has = existing.some((entry) => entry.name === constraint.name);
    if (!has) {
      const risk = isLockedTable(constraint.table) ? 'CAUTION' : 'CAUTION';
      changes.push({
        change_id: `constraint:add:${constraint.table}:${constraint.name}`,
        category: 'CONSTRAINT',
        action: 'ADD',
        object: { table: constraint.table, name: constraint.name },
        sql_preview: constraint.sql,
        risk_level: risk,
        reason: 'Constraint exists in SSOT but is missing in the tenant database. Adding it can fail if existing data violates it.',
      });

      if (/FOREIGN\s+KEY/i.test(constraint.definition)) {
        preflightQueries.push({
          id: `preflight:fk:${constraint.table}:${constraint.name}`,
          risk_level: 'CAUTION',
          description: `Foreign key ${constraint.name} may fail if orphaned rows exist in ${constraint.table}.`,
          sql: `-- Review ${constraint.table} rows before adding ${constraint.name}.\n-- Consider validating orphaned rows manually (depends on FK definition).`,
        });
      }
    }
  }

  for (const change of changes) {
    change.title = buildTitle(change);
  }

  const counts = { SAFE: 0, CAUTION: 0, DESTRUCTIVE: 0 };
  for (const change of changes) {
    counts[change.risk_level] = (counts[change.risk_level] ?? 0) + 1;
  }

  return {
    summary: counts,
    changes,
    preflightQueries,
  };
}
