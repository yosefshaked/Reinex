# Backup Rebuild - Implementation Plan

## Status: Complete

## Audit Findings
- The old backup flow has been replaced with storage-backed, env-keyed encryption and org-scoped restore/list endpoints.
- Backup history lives on `public.organizations` and the current tenant export set has 42 tables in dependency order.
- System/control tables and auth-managed tables remain excluded from per-org backups.

## Table Export List
Dependency order for restore: parent tables before child tables.

1. Settings
2. Services
3. Employees
4. hmo_providers
5. guardians
6. client_profiles
7. payroll_runs
8. claim_batches
9. dashboard_tasks
10. forms
11. shared_form_blocks
12. Documents
13. instructor_profiles
14. instructor_service_capabilities
15. RateHistory
16. hmo_provider_tracks
17. client_guardians
18. students
19. form_shared_block_links
20. employee_attendance_records
21. employee_leave_entries
22. employee_leave_days
23. employee_leave_balance_events
24. finance_corrections
25. otp_challenges
26. form_submissions
27. hmo_authorizations
28. waiting_list_entries
29. commitments
30. ledger_transactions
31. lesson_templates
32. lesson_template_overrides
33. lesson_instances
34. lesson_participants
35. lesson_earnings
36. grace_cancellation_requests
37. instance_locks
38. participant_locks
39. calendar_instance_corrections
40. ledger_accounts
41. hmo_invoice_batches
42. hmo_invoice_batch_items

Excluded from per-org backup:
- organizations
- profiles
- org_memberships
- org_invitations
- permission_registry
- active_routing
- audit_log
- impersonation_sessions
- admin_data
- error_events
- email_log

## Decisions Made
- Preserve `backup_local_enabled` exactly as-is. It remains the only user-facing backup gate.
- Remove password-based encryption and replace it with `BACKUP_ENCRYPTION_KEY` managed server-side.
- Keep AES-256-GCM and gzip compression.
- Use the existing managed storage driver for R2 access; do not introduce a separate storage client.
- The later code changes will update the existing Azure Function directories in place unless a later step proves a delete-and-recreate move is safer. Dead function directories will not be left behind.
- Backup history will continue to live on `public.organizations`.

## Reference Inventory
Disposition legend: keep = leave as-is, update = rewrite to the new flow, delete = remove.

### nightly_backup_workflow
- .github/workflows/nightly-backup.yml:1 - keep

### org_backup_ui
- src/components/settings/BackupManager.jsx:1 - keep
- src/pages/Settings.jsx:1 - update

### system_admin_backup_ui
- api/system-admin-backups/index.js:1 - keep
- api/system-admin-backups/function.json:1 - keep
- src/admin/modules/BackupManagementView.jsx:1 - keep
- src/admin/ui/navConfig.js:1 - update
- src/admin/AdminApp.jsx:1 - update

### backup_local_enabled
- src/lib/setup-sql.js:4167 - keep
- docs/permissions-registry.md:32 - update
- docs/permissions-registry.md:38 - update
- docs/permissions-registry.md:57 - update
- docs/permissions-registry.md:69 - update
- ProjectDoc/TutTiud_Agents.md:247 - update
- ProjectDoc/TutTiud_Agents.md:261 - update
- ProjectDoc/TutTiud_Agents.md:265 - update
- src/pages/Settings.jsx:94 - update
- src/pages/Settings.jsx:399 - update
- src/components/settings/BackupManager.jsx:1 - keep
- api/backup/index.js:34 - update
- api/restore/index.js:29 - update
- api/system-admin-backups/index.js:1 - keep

### backup_history
- src/lib/setup-sql.js:123 - keep
- ProjectDoc/TutTiud_Agents.md:257 - update
- ProjectDoc/TutTiud_Agents.md:258 - update
- ProjectDoc/TutTiud_Agents.md:259 - update
- implementations/database/one-db-refactor/one-db-refactor.md:15 - keep
- implementations/database/one-db-refactor/one-db-refactor.md:36 - keep
- implementations/admin-page/org-nuke/README.md:211 - keep
- implementations/admin-page/org-nuke/README.md:274 - keep
- implementations/admin-page/org-nuke/README.md:401 - keep
- implementations/admin-page/org-nuke/README.md:405 - keep
- implementations/admin-page/org-nuke/README.md:408 - keep
- api/restore/index.js:39 - update
- api/restore/index.js:43 - update
- api/restore/index.js:51 - update
- api/backup/index.js:78 - update
- api/backup/index.js:82 - update
- api/backup/index.js:90 - update
- api/backup/index.js:150 - update
- api/backup/index.js:170 - update
- api/org-purge/execute-phases.js:122 - keep
- api/org-purge/drift-check.js:455 - keep
- api/org-purge/drift-check.js:489 - keep

### encryptBackup
- api/_shared/backup-utils.js:34 - update
- api/backup/index.js:13 - update
- api/backup/index.js:192 - update
- ProjectDoc/TutTiud_Agents.md:250 - update

### decryptBackup
- api/_shared/backup-utils.js:55 - update
- api/restore/index.js:14 - update
- api/restore/index.js:162 - update
- test/verify-backup.cjs:6 - update
- test/verify-backup.cjs:20 - update
- ProjectDoc/TutTiud_Agents.md:251 - update

### exportTenantData
- api/_shared/backup-utils.js:120 - update
- api/backup/index.js:13 - update
- api/backup/index.js:188 - update
- ProjectDoc/TutTiud_Agents.md:252 - update

### restoreTenantData
- api/_shared/backup-utils.js:183 - update
- api/restore/index.js:14 - update
- api/restore/index.js:192 - update
- ProjectDoc/TutTiud_Agents.md:254 - update

### validateBackupManifest
- api/_shared/backup-utils.js:160 - update
- api/restore/index.js:14 - update
- api/restore/index.js:168 - update
- ProjectDoc/TutTiud_Agents.md:253 - update

## Steps
- [x] Step 0 - Audit
- [x] Step 1 - Encryption update
- [x] Step 2 - Table export update
- [x] Step 3 - backup-run endpoint
- [x] Step 4 - backup-list endpoint
- [x] Step 5 - restore endpoint
- [x] Step 6 - GitHub Actions workflow
- [x] Step 7 - Org admin UI page
- [x] Step 8 - System admin UI page
- [x] Step 9 - verify-backup script
- [x] Step 10 - Cleanup

## Blockers / Notes
- `api/cross-platform/storage-drivers/s3-adapter.js` now exposes `listByPrefix` for backup listing and retention cleanup.
- The org admin backup manager now lives in `src/components/settings/BackupManager.jsx` and is gated by `backup_local_enabled` in Settings.
- The system-admin backup surface now lives in `src/admin/modules/BackupManagementView.jsx` and uses `api/system-admin-backups` for list, toggle, run-now, and restore-bypass actions.

## Verification
- Search for `backup_cooldown_override`, `generateProductKeyPassword`, `tuttiud_v1`, `tuttiud-backup`, and `incorrect_password` returned no matches in the codebase.
- `api/backup-status/` no longer exists.
- `src/lib/setup-sql.js` now defines `public.get_public_base_tables()` as a `SECURITY DEFINER` RPC helper (`SET search_path = public`) that reads `information_schema.tables` for `public` `BASE TABLE` rows.
- Execute permission for `public.get_public_base_tables()` is restricted to `service_role` only (no `authenticated` / `app_user`) because this helper is infrastructure-only and should not be callable from client-scoped roles.
- `api/_shared/backup-utils.js` now performs runtime schema coverage through `rpc('get_public_base_tables')` instead of querying `information_schema` directly through PostgREST.
- The prior fallback that silently skipped the coverage check when `information_schema` was not exposed has been removed. If the RPC fails, backup hard-fails because this is treated as an infrastructure/configuration problem.
- When `EXPORT_TABLES` contains tables missing from the current live schema, backup logs a warning and continues (supports environments with pending migrations).
- `api/_shared/backup-utils.js` uses `withOrgScope(...)` for both export and restore table queries.
- `BACKUP_SERVICE_KEY` is only read server-side from `process.env` / Azure Function env and is not referenced in `src/`.
- `npm run build` completed successfully after the backup cleanup and contract fix.
