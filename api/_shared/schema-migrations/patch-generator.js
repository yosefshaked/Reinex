/* eslint-env node */

function groupByRisk(changes) {
  const buckets = { SAFE: [], CAUTION: [], DESTRUCTIVE: [] };
  for (const change of changes) {
    const level = change.risk_level;
    if (level === 'SAFE' || level === 'CAUTION' || level === 'DESTRUCTIVE') {
      buckets[level].push(change);
    }
  }
  return buckets;
}

function normalizeSql(sql) {
  return String(sql || '').trim();
}

function buildManualMarkdown(changes) {
  const lines = [];
  const buckets = groupByRisk(changes);

  function section(title, risk) {
    const list = buckets[risk];
    if (!list.length) {
      return;
    }
    lines.push(`## ${title}`);
    lines.push('');
    for (const change of list) {
      lines.push(`### ${change.title}`);
      lines.push(`- סיכון: ${risk}`);
      lines.push(`- למה: ${change.reason}`);
      lines.push('');
      const sql = normalizeSql(change.sql_preview);
      if (sql) {
        lines.push('```sql');
        lines.push(sql);
        lines.push('```');
        lines.push('');
      }
    }
  }

  section('שינויים זהירים (CAUTION)', 'CAUTION');
  section('שינויים מסוכנים (DESTRUCTIVE)', 'DESTRUCTIVE');

  return lines.join('\n');
}

export function generatePatchArtifacts(diffResult) {
  const changes = Array.isArray(diffResult?.changes) ? diffResult.changes : [];
  const safeStatements = changes
    .filter((change) => change.risk_level === 'SAFE')
    .map((change) => normalizeSql(change.sql_preview))
    .filter(Boolean);

  const manualStatements = changes
    .filter((change) => change.risk_level === 'CAUTION' || change.risk_level === 'DESTRUCTIVE')
    .map((change) => normalizeSql(change.sql_preview))
    .filter((sql) => sql && !sql.startsWith('--') && sql.includes(';'));

  const patchSqlSafe = safeStatements.join('\n\n');
  const manualSql = manualStatements.join('\n\n');
  const manualSteps = buildManualMarkdown(changes);

  return {
    patch_sql_safe: patchSqlSafe,
    manual_sql: manualSql,
    manual_steps: manualSteps,
  };
}
