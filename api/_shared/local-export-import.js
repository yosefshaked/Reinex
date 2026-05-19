/* eslint-env node */
import { randomUUID } from 'crypto';

export const LOCAL_EXPORT_FORMAT = 'reinex-local-export';
export const LOCAL_EXPORT_VERSION = 1;

const EXPORTABLE_TABLES = [
  { name: 'client_profiles' },
  { name: 'guardians' },
  { name: 'client_guardians', references: { client_profile_id: 'client_profiles', guardian_id: 'guardians' } },
  { name: 'students', references: { client_profile_id: 'client_profiles' } },
  { name: 'Employees', clearColumns: ['user_id'] },
  { name: 'Services' },
  { name: 'Settings' },
  { name: 'RateHistory', references: { employee_id: 'Employees', service_id: 'Services' } },
  { name: 'employee_attendance_records', references: { employee_id: 'Employees' } },
  { name: 'employee_leave_entries', references: { employee_id: 'Employees' } },
  { name: 'employee_leave_days', references: { leave_entry_id: 'employee_leave_entries' } },
  { name: 'employee_leave_balance_events', references: { employee_id: 'Employees', leave_entry_id: 'employee_leave_entries' } },
  { name: 'instructor_profiles', references: { employee_id: 'Employees' } },
  { name: 'instructor_service_capabilities', references: { employee_id: 'Employees', service_id: 'Services' } },
  { name: 'hmo_providers' },
  { name: 'hmo_provider_tracks', references: { provider_id: 'hmo_providers', service_id: 'Services' } },
  { name: 'hmo_authorizations', references: { student_id: 'students', service_id: 'Services', provider_id: 'hmo_providers', provider_track_id: 'hmo_provider_tracks' } },
  { name: 'commitments', references: { student_id: 'students', service_id: 'Services', hmo_authorization_id: 'hmo_authorizations', transfer_ref: 'commitments' } },
  { name: 'ledger_accounts', references: { client_profile_id: 'client_profiles', student_id: 'students', hmo_provider_id: 'hmo_providers', service_id: 'Services' } },
  { name: 'lesson_templates', references: { student_id: 'students', instructor_employee_id: 'Employees', service_id: 'Services' } },
  { name: 'lesson_template_overrides', references: { template_id: 'lesson_templates', new_instructor_employee_id: 'Employees', new_service_id: 'Services' } },
  { name: 'lesson_instances', references: { template_id: 'lesson_templates', applied_override_id: 'lesson_template_overrides', instructor_employee_id: 'Employees', service_id: 'Services' } },
  { name: 'lesson_participants', references: { lesson_instance_id: 'lesson_instances', client_profile_id: 'client_profiles', student_id: 'students', hmo_authorization_id: 'hmo_authorizations', commitment_id: 'commitments' } },
  { name: 'ledger_transactions', references: { client_profile_id: 'client_profiles', student_id: 'students', commitment_id: 'commitments', lesson_instance_id: 'lesson_instances', lesson_participant_id: 'lesson_participants', ledger_account_id: 'ledger_accounts', hmo_provider_id: 'hmo_providers', hmo_authorization_id: 'hmo_authorizations', service_id: 'Services', reverses_transaction_id: 'ledger_transactions', source_ref: '*', source_id: '*' } },
  { name: 'hmo_invoice_batches', references: { hmo_provider_id: 'hmo_providers' }, userColumnsToCurrentUser: ['submitted_by'] },
  { name: 'hmo_invoice_batch_items', references: { batch_id: 'hmo_invoice_batches', ledger_transaction_id: 'ledger_transactions', lesson_participant_id: 'lesson_participants', hmo_authorization_id: 'hmo_authorizations', hmo_provider_id: 'hmo_providers' } },
  { name: 'instance_locks', references: { lesson_instance_id: 'lesson_instances' } },
  { name: 'participant_locks', references: { lesson_participant_id: 'lesson_participants' } },
  { name: 'calendar_instance_corrections', references: { lesson_instance_id: 'lesson_instances' }, userColumnsToCurrentUser: ['corrected_by'] },
  { name: 'payroll_runs', userColumnsToCurrentUser: ['finalized_by'] },
  { name: 'finance_corrections', references: { employee_id: 'Employees', lesson_instance_id: 'lesson_instances', payroll_run_id: 'payroll_runs' } },
  { name: 'claim_batches', userColumnsToCurrentUser: ['submitted_by', 'paid_by'] },
  { name: 'lesson_earnings', references: { employee_id: 'Employees', lesson_instance_id: 'lesson_instances', payroll_run_id: 'payroll_runs' } },
  { name: 'forms', userColumnsToCurrentUser: ['created_by', 'updated_by'] },
  { name: 'shared_form_blocks', userColumnsToCurrentUser: ['created_by'] },
  { name: 'form_shared_block_links', references: { form_id: 'forms', shared_block_id: 'shared_form_blocks' } },
  { name: 'form_submissions', references: { form_id: 'forms', client_profile_id: 'client_profiles', student_id: 'students', submitted_by_guardian_id: 'guardians' } },
  { name: 'waiting_list_entries', references: { client_profile_id: 'client_profiles', student_id: 'students', desired_service_id: 'Services', assigned_instructor_id: 'Employees' }, arrayReferences: { instructor_preferences: 'Employees' } },
  { name: 'dashboard_tasks', importable: false, reason: 'operational tasks are exported for review only in v1' },
  { name: 'Documents', transform: 'documentMetadataOnly' },
];

const EXPORT_ONLY_TABLES = [
  { name: 'audit_log', reason: 'audit records are exported for reference only and are not re-imported' },
  { name: 'email_log', reason: 'email delivery history is exported for reference only and is not re-imported' },
];

export const LOCAL_EXPORT_TABLES = EXPORTABLE_TABLES;
export const LOCAL_EXPORT_ONLY_TABLES = EXPORT_ONLY_TABLES;

export const LOCAL_EXPORT_EXCLUDED = {
  document_binary_files: 'not included in v1',
  provider_backups: 'not included',
  profiles: 'not exported because it is not organization-scoped',
  org_memberships: 'not exported to avoid recreating user access',
  org_invitations: 'not exported to avoid recreating pending access invitations',
  impersonation_sessions: 'not exported because it may contain privileged support/session data',
  admin_data: 'not exported because it is global system-admin data',
  raw_secrets: 'not exported: service role keys, BYOS credentials, provider/API keys, encryption secrets',
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeError(error) {
  return error?.message || String(error || 'unknown_error');
}

function getTablesFromExport(localExport) {
  return isPlainObject(localExport?.tables) ? localExport.tables : {};
}

function makeIdMaps(localExport) {
  const tables = getTablesFromExport(localExport);
  const idMaps = {};
  for (const config of EXPORTABLE_TABLES) {
    if (config.importable === false) continue;
    const rows = Array.isArray(tables[config.name]) ? tables[config.name] : [];
    const tableMap = new Map();
    for (const row of rows) {
      if (row?.id) {
        tableMap.set(String(row.id), randomUUID());
      }
    }
    idMaps[config.name] = tableMap;
  }
  return idMaps;
}

function remapId(idMaps, tableName, value) {
  if (!value) return value;
  if (tableName === '*') {
    return remapAnyId(idMaps, value);
  }
  return idMaps[tableName]?.get(String(value)) || null;
}

function remapAnyId(idMaps, value) {
  if (!value) return value;
  const key = String(value);
  for (const tableMap of Object.values(idMaps)) {
    if (tableMap?.has(key)) {
      return tableMap.get(key);
    }
  }
  return value;
}

function remapArray(idMaps, tableName, value) {
  if (!Array.isArray(value)) return value;
  return value.map((entry) => remapId(idMaps, tableName, entry)).filter(Boolean);
}

function transformDocumentMetadata(row, targetOrgId, idMaps) {
  const transformed = { ...row };
  const originalId = row?.id ? String(row.id) : '';
  const newId = originalId ? idMaps.Documents?.get(originalId) : randomUUID();
  transformed.id = newId;
  transformed.org_id = targetOrgId;
  transformed.path = `local-export-v1/${targetOrgId}/${newId}`;
  transformed.url = null;
  transformed.storage_provider = 'metadata_only';
  transformed.uploaded_by = null;
  transformed.size = row?.size ?? null;

  if (row?.entity_type === 'student') {
    transformed.entity_id = remapId(idMaps, 'students', row.entity_id);
  } else if (row?.entity_type === 'instructor') {
    transformed.entity_id = remapId(idMaps, 'Employees', row.entity_id);
  } else if (row?.entity_type === 'organization') {
    transformed.entity_id = targetOrgId;
  } else {
    transformed.entity_id = remapAnyId(idMaps, row?.entity_id);
  }

  transformed.metadata = {
    ...(isPlainObject(row?.metadata) ? row.metadata : {}),
    local_export_note: 'binary file excluded from local export v1',
  };

  return transformed;
}

function sanitizeRowsForExport(config, rows) {
  if (config.name !== 'Documents') {
    return rows;
  }

  return rows.map((row) => ({
    ...row,
    url: null,
    path: null,
    metadata: {
      ...(isPlainObject(row?.metadata) ? row.metadata : {}),
      local_export_note: 'binary file and original provider path excluded from local export v1',
    },
  }));
}

function transformRow(config, row, targetOrgId, userId, idMaps) {
  if (!isPlainObject(row)) return null;
  if (config.transform === 'documentMetadataOnly') {
    return transformDocumentMetadata(row, targetOrgId, idMaps);
  }

  const transformed = { ...row };
  if (row.id && idMaps[config.name]?.has(String(row.id))) {
    transformed.id = idMaps[config.name].get(String(row.id));
  }
  transformed.org_id = targetOrgId;

  for (const column of config.clearColumns || []) {
    if (Object.prototype.hasOwnProperty.call(transformed, column)) {
      transformed[column] = null;
    }
  }

  for (const column of config.userColumnsToCurrentUser || []) {
    if (Object.prototype.hasOwnProperty.call(transformed, column)) {
      transformed[column] = userId;
    }
  }

  for (const [column, referencedTable] of Object.entries(config.references || {})) {
    if (!Object.prototype.hasOwnProperty.call(transformed, column)) continue;
    const mapped = remapId(idMaps, referencedTable, transformed[column]);
    transformed[column] = mapped || null;
  }

  for (const [column, referencedTable] of Object.entries(config.arrayReferences || {})) {
    if (!Object.prototype.hasOwnProperty.call(transformed, column)) continue;
    transformed[column] = remapArray(idMaps, referencedTable, transformed[column]);
  }

  return transformed;
}

export function validateLocalExport(localExport) {
  if (!isPlainObject(localExport)) {
    return { valid: false, message: 'invalid_export_payload' };
  }
  if (localExport.format !== LOCAL_EXPORT_FORMAT) {
    return { valid: false, message: 'invalid_export_format' };
  }
  if (localExport.version !== LOCAL_EXPORT_VERSION) {
    return { valid: false, message: 'unsupported_export_version' };
  }
  if (!isPlainObject(localExport.tables)) {
    return { valid: false, message: 'missing_tables' };
  }
  return { valid: true };
}

export function analyzeLocalExport(localExport) {
  const validation = validateLocalExport(localExport);
  if (!validation.valid) {
    return { valid: false, message: validation.message };
  }

  const tables = getTablesFromExport(localExport);
  const configuredNames = new Set([
    ...EXPORTABLE_TABLES.map((table) => table.name),
    ...EXPORT_ONLY_TABLES.map((table) => table.name),
  ]);
  const tableCounts = {};
  const unsupportedTables = [];
  const importableCounts = {};
  const exportOnlyCounts = {};

  for (const [tableName, rows] of Object.entries(tables)) {
    const count = Array.isArray(rows) ? rows.length : 0;
    tableCounts[tableName] = count;
    if (!configuredNames.has(tableName)) {
      unsupportedTables.push(tableName);
    }
  }

  for (const config of EXPORTABLE_TABLES) {
    const count = Array.isArray(tables[config.name]) ? tables[config.name].length : 0;
    importableCounts[config.name] = config.importable === false ? 0 : count;
    if (config.importable === false && count > 0) {
      exportOnlyCounts[config.name] = count;
    }
  }

  for (const config of EXPORT_ONLY_TABLES) {
    const count = Array.isArray(tables[config.name]) ? tables[config.name].length : 0;
    if (count > 0) exportOnlyCounts[config.name] = count;
  }

  return {
    valid: true,
    format: localExport.format,
    version: localExport.version,
    exported_at: localExport.exported_at || null,
    source_org_id: localExport.source_org_id || null,
    table_counts: tableCounts,
    importable_counts: importableCounts,
    export_only_counts: exportOnlyCounts,
    unsupported_tables: unsupportedTables,
    excluded: localExport.excluded || {},
    warnings: [
      'import_will_target_current_org_only',
      'import_inserts_new_records_only',
      'document_binary_files_excluded_v1',
    ],
  };
}

export function buildImportRows(localExport, targetOrgId, userId) {
  const validation = validateLocalExport(localExport);
  if (!validation.valid) {
    throw new Error(validation.message);
  }

  const tables = getTablesFromExport(localExport);
  const idMaps = makeIdMaps(localExport);
  const rowsByTable = {};
  const counts = {};

  for (const config of EXPORTABLE_TABLES) {
    if (config.importable === false) continue;
    const sourceRows = Array.isArray(tables[config.name]) ? tables[config.name] : [];
    const transformedRows = sourceRows
      .map((row) => transformRow(config, row, targetOrgId, userId, idMaps))
      .filter(Boolean);
    rowsByTable[config.name] = transformedRows;
    counts[config.name] = transformedRows.length;
  }

  return { rowsByTable, counts };
}

export async function collectLocalExport(client, orgId) {
  const tables = {};
  const tableErrors = {};
  const configs = [...EXPORTABLE_TABLES, ...EXPORT_ONLY_TABLES];

  for (const config of configs) {
    const { data, error } = await client
      .from(config.name)
      .select('*')
      .eq('org_id', orgId);

    if (error) {
      tableErrors[config.name] = sanitizeError(error);
      tables[config.name] = [];
      continue;
    }

    tables[config.name] = sanitizeRowsForExport(config, Array.isArray(data) ? data : []);
  }

  const manifest = {
    format: LOCAL_EXPORT_FORMAT,
    version: LOCAL_EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    source_org_id: orgId,
    app: 'reinex',
    schema_version: null,
    tables,
    excluded: LOCAL_EXPORT_EXCLUDED,
  };

  return { manifest, tableErrors };
}

export async function applyLocalImport(client, localExport, targetOrgId, userId) {
  const { rowsByTable, counts } = buildImportRows(localExport, targetOrgId, userId);
  const inserted = {};
  const errors = {};

  for (const config of EXPORTABLE_TABLES) {
    if (config.importable === false) continue;
    const rows = rowsByTable[config.name] || [];
    inserted[config.name] = 0;
    if (!rows.length) continue;

    const { error } = await client
      .from(config.name)
      .insert(rows);

    if (error) {
      errors[config.name] = sanitizeError(error);
      continue;
    }

    inserted[config.name] = rows.length;
  }

  return {
    counts,
    inserted,
    errors,
    success: Object.keys(errors).length === 0,
  };
}
