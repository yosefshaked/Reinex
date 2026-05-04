# 90 Settings Documents Storage

## When to read
- Settings page work.
- Document upload/download work.
- Storage config, backup, or audit-log work.

## Load these files first
- [`../src/pages/Settings.jsx`](../src/pages/Settings.jsx)
- [`../src/components/settings/`](../src/components/settings/)
- [`../src/features/settings/api/settings.js`](../src/features/settings/api/settings.js)
- [`../src/features/settings/api/storage.js`](../src/features/settings/api/storage.js)
- [`../src/hooks/useDocuments.js`](../src/hooks/useDocuments.js)
- [`../api/settings/index.js`](../api/settings/index.js)
- [`../api/org-settings-storage/index.js`](../api/org-settings-storage/index.js)
- [`../api/documents/index.js`](../api/documents/index.js)
- [`../api/documents-download/index.js`](../api/documents-download/index.js)
- [`../api/backup/index.js`](../api/backup/index.js)
- [`../api/backup-status/index.js`](../api/backup-status/index.js)
- [`../api/local-export/index.js`](../api/local-export/index.js)
- [`../api/local-import/index.js`](../api/local-import/index.js)
- [`../api/audit-log/index.js`](../api/audit-log/index.js)
- [`../api/cross-platform/storage-drivers/index.js`](../api/cross-platform/storage-drivers/index.js)
- [`../api/_shared/backup-utils.js`](../api/_shared/backup-utils.js)
- [`../api/_shared/local-export-import.js`](../api/_shared/local-export-import.js)
- [`../api/_shared/storage-encryption.js`](../api/_shared/storage-encryption.js)
- [`../api/_shared/history-quota.js`](../api/_shared/history-quota.js)

## Shared helpers to reuse
- `fetchSettings`, `fetchSettingsValue`, `fetchSettingsValueWithMeta`, `upsertSettings`, `upsertSetting`
- `fetchStorageConfiguration`, `saveStorageConfiguration`, `deleteStorageConfiguration`, `reconnectStorageConfiguration`, `testStorageConnection`
- `useDocuments` for document flows
- `getStorageDriver` and provider adapters under [`../api/cross-platform/storage-drivers/`](../api/cross-platform/storage-drivers/)
- Backup helpers in [`../api/_shared/backup-utils.js`](../api/_shared/backup-utils.js)
- Local export/import helpers in [`../api/_shared/local-export-import.js`](../api/_shared/local-export-import.js); use the explicit table allow-list and import sanitizer rather than ad hoc table iteration.
- `ensureCapacity`, `computeApproxEntryBytes` in [`../api/_shared/history-quota.js`](../api/_shared/history-quota.js) — call before appending to versioned Settings keys; currently observe-only (logs when quota would be exceeded, never blocks)
- `normalizeExternalHttpUrl`

## Known patterns / do not reinvent
- Settings reads/writes should go through the settings API wrappers and endpoint; do not probe `Settings` directly from random components.
- Supabase connection/setup assistant is system-admin owned and should live under `/system-admin` (not the regular Settings page).
- The settings endpoint already diagnoses missing table/policy/metadata-column problems; keep that behavior centralized.
- Documents are unified under `/api/documents` with `entity_type` + `entity_id`; do not add new student/instructor/org-specific file APIs.
- For employee/instructor documents, `entity_type='instructor'` is historical naming only; the canonical entity id is the `Employees.id` row, and self-service permission checks must resolve through `Employees.user_id`.
- Storage supports managed mode and BYOS through the driver factory; do not branch provider logic in every endpoint.
- Backup permissions and cooldown live in control DB `org_settings` and are enforced server-side.
- Local export/import is an MVP data portability aid, not a full backup/restore mechanism. UI copy must use `ייצוא מקומי` / `ייבוא מקומי`, not backup/restore claims.
- Local export/import endpoints must remain org-scoped, owner/admin only, audit-logged, and non-destructive. Import must dry-run first, must never trust file `org_id`, must force the current authorized org, and must not implement `clearExisting`.
- Document binary files are excluded from local export/import v1. Only `Documents` metadata may be included, and imported metadata must not point to the original provider URL/path as if the binary was available.
- Audit logs redact sensitive values before returning them.
