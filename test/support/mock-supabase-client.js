// @ts-check
/* eslint-env node */

class MockTable {
  constructor(store, tableName) {
    this._store = store;
    this._table = tableName;
    this._filters = [];
    this._insertPayload = null;
    this._upsertPayload = null;
    this._upsertOptions = null;
    this._updatePayload = null;
    this._deleteMode = false;
    this._singleMode = false;
    this._maybeSingleMode = false;
    this._limitN = null;
    this._inFilters = [];
    this._isFilters = [];
    this._gteFilters = [];
    this._lteFilters = [];
    this._notFilters = [];
  }

  select() { return this; }
  insert(payload) { this._insertPayload = payload; return this; }
  upsert(payload, opts) { this._upsertPayload = payload; this._upsertOptions = opts || {}; return this; }
  update(payload) { this._updatePayload = payload; return this; }
  delete() { this._deleteMode = true; return this; }
  single() { this._singleMode = true; return this._execute(); }
  maybeSingle() { this._maybeSingleMode = true; return this._execute(); }
  eq(col, val) { this._filters.push({ col, val }); return this; }
  in(col, vals) { this._inFilters.push({ col, vals }); return this; }
  is(col, val) { this._isFilters.push({ col, val }); return this; }
  gte(col, val) { this._gteFilters.push({ col, val }); return this; }
  lte(col, val) { this._lteFilters.push({ col, val }); return this; }
  not(col, op, val) { this._notFilters.push({ col, op, val }); return this; }
  order() { return this; }
  limit(n) { this._limitN = n; return this; }
  filter(col, op, val) { this._filters.push({ col, val, op }); return this; }

  then(resolve, reject) {
    return Promise.resolve(this._execute()).then(resolve, reject);
  }

  _execute() {
    const rows = this._store[this._table] || [];

    if (this._insertPayload !== null) {
      const items = Array.isArray(this._insertPayload) ? this._insertPayload : [this._insertPayload];
      const inserted = items.map((item) => ({
        id: item?.id || `uuid-${Math.random().toString(36).slice(2)}`,
        ...item,
      }));
      this._store[this._table] = [...rows, ...inserted];
      if (this._singleMode || this._maybeSingleMode) {
        return { data: inserted[0] || null, error: null };
      }
      return { data: inserted, error: null };
    }

    if (this._upsertPayload !== null) {
      const items = Array.isArray(this._upsertPayload) ? this._upsertPayload : [this._upsertPayload];
      const results = [];
      const conflictColumns = String(this._upsertOptions?.onConflict || '')
        .split(',')
        .map((col) => col.trim())
        .filter(Boolean);
      for (const item of items) {
        const existingIdx = conflictColumns.length > 0
          ? rows.findIndex((row) => conflictColumns.every((col) => row[col] === item[col]))
          : -1;
        if (existingIdx >= 0) {
          const updated = { ...rows[existingIdx], ...item };
          this._store[this._table][existingIdx] = updated;
          results.push(updated);
        } else {
          const newRow = {
            id: item?.id || `uuid-${Math.random().toString(36).slice(2)}`,
            ...item,
          };
          this._store[this._table] = [...(this._store[this._table] || []), newRow];
          results.push(newRow);
        }
      }
      if (this._singleMode || this._maybeSingleMode) {
        return { data: results[0] || null, error: null };
      }
      return { data: results, error: null };
    }

    if (this._updatePayload !== null) {
      const matched = this._applyFilters(this._store[this._table] || []);
      const updatedRows = [];
      this._store[this._table] = (this._store[this._table] || []).map((row) => {
        if (!matched.includes(row)) return row;
        const updated = { ...row, ...this._updatePayload };
        updatedRows.push(updated);
        return updated;
      });
      if (this._singleMode || this._maybeSingleMode) {
        return { data: updatedRows[0] || null, error: null };
      }
      return { data: updatedRows, error: null };
    }

    if (this._deleteMode) {
      const toDelete = this._applyFilters(this._store[this._table] || []);
      this._store[this._table] = (this._store[this._table] || []).filter((row) => !toDelete.includes(row));
      return { data: null, error: null };
    }

    let result = this._applyFilters(rows);
    if (this._limitN !== null) {
      result = result.slice(0, this._limitN);
    }

    if (this._maybeSingleMode || this._singleMode) {
      return { data: result[0] || null, error: null };
    }
    return { data: result, error: null };
  }

  _applyFilters(rows) {
    let result = rows;
    for (const { col, val, op } of this._filters) {
      if (op === 'neq') {
        result = result.filter((row) => row[col] !== val);
      } else {
        result = result.filter((row) => row[col] === val);
      }
    }
    for (const { col, vals } of this._inFilters) {
      result = result.filter((row) => vals.includes(row[col]));
    }
    for (const { col, val } of this._isFilters) {
      result = val === null
        ? result.filter((row) => row[col] == null)
        : result.filter((row) => row[col] === val);
    }
    for (const { col, val } of this._gteFilters) {
      result = result.filter((row) => String(resolveDottedValue(row, col) ?? '') >= String(val));
    }
    for (const { col, val } of this._lteFilters) {
      result = result.filter((row) => String(resolveDottedValue(row, col) ?? '') <= String(val));
    }
    for (const { col, op, val } of this._notFilters) {
      if (op === 'is' && val === null) {
        result = result.filter((row) => row[col] != null);
      }
    }
    return result;
  }
}

function resolveDottedValue(row, column) {
  const path = String(column || '').split('.');
  let value = row;
  for (const key of path) {
    if (value == null) return undefined;
    value = value[key];
  }
  return value;
}

export function createMockSupabaseClient(initialStore = {}) {
  const store = {
    Settings: [],
    Services: [],
    Employees: [],
    client_profiles: [],
    students: [],
    lesson_templates: [],
    lesson_instances: [],
    lesson_participants: [],
    ledger_accounts: [],
    ledger_transactions: [],
    hmo_providers: [],
    hmo_provider_tracks: [],
    hmo_authorizations: [],
    hmo_invoice_batches: [],
    hmo_invoice_batch_items: [],
    dashboard_tasks: [],
    participant_locks: [],
    ...initialStore,
  };

  for (const [tableName, rows] of Object.entries(store)) {
    if (!Array.isArray(rows)) continue;
    store[tableName] = rows.map((row) => {
      if (row && typeof row === 'object' && !Object.prototype.hasOwnProperty.call(row, 'org_id')) {
        return { org_id: 'org-1', ...row };
      }
      return row;
    });
  }

  return {
    _store: store,
    from(tableName) {
      if (!store[tableName]) {
        store[tableName] = [];
      }
      return new MockTable(store, tableName);
    },
    rpc() {
      return Promise.resolve({ data: null, error: null });
    },
  };
}

