# Onboarding Import Implementation Plan

## Purpose
Design a durable import system for new organizations that arrive with existing, messy data: active students, inactive students, guardians, services, historical notes, schedules, and eventually finance/history. The import flow must handle hundreds or thousands of records over multiple work sessions without creating stale or half-trusted live data.

## Core Product Decision
Imports are not a one-shot CSV upload. They are an **Import Workspace**: a resumable migration project with stored files, parsed rows, mapping decisions, validation issues, review queues, dry-run plans, and controlled commits.

## Phase 1 Schema Decision
Phase 1 intentionally uses a maximum of four import tables:

1. `import_workspaces`
2. `import_rows`
3. `import_candidates`
4. `import_commit_ledger`

All file metadata, sheet metadata, mappings, issues, decisions, operation progress, and dry-run previews are stored in JSONB fields. Do not introduce additional import-specific tables in Phase 1.

## Hard Invariant: Inactive Students Are Not Partly Imported
Inactive students must never be dripped into live student/client tables as incomplete records. That creates stale data immediately and makes normal product screens untrustworthy.

Inactive student data has only two valid paths:

1. **Committed as a complete inactive archive slice**
   - All required identity/contact/name fields for that archive policy are valid.
   - Duplicate decisions are resolved.
   - The commit is explicit and batch-scoped.
   - Records are marked inactive and hidden from active workflows by default.

2. **Kept in import staging**
   - Rows remain reviewable/searchable inside the Import Workspace.
   - They do not create `client_profiles`, `students`, guardians, schedules, billing, forms, or document records.
   - They can be revisited later without polluting live data.

There is no "create partial inactive profile now, fill it someday" mode.

## First Supported Import Scope
Phase 1 should support:
- Active students
- Inactive students as an all-or-nothing archive slice
- Guardians and guardian links
- Basic services mapping
- Student notes/intake notes
- Duplicate detection and saved decisions

Phase 1 should not import historical sessions, attendance, payments, commitments, documents, or HMO claims directly into live tables. Those can be staged and profiled, but commit support belongs to later phases.

## Architecture Fit
- Single Supabase project, tenant data in `public`.
- Every import table is tenant-scoped with `org_id uuid NOT NULL`.
- Backend APIs use `createSingleClient(env)`, `ensureMembership()`, `withOrgScope(...)`, and `respond(...)`.
- Import commits should reuse existing domain helpers for live writes:
  - `createOrReuseClientProfile`
  - `ensureStudentForClientProfile`
  - `createOrReuseGuardian`
  - `upsertClientGuardianLink`
  - existing student validation helpers

## Documents
- [workflow.md](workflow.md): user-facing import workspace flow.
- [data-model.md](data-model.md): proposed staging tables and state machines.
- [phases.md](phases.md): implementation phases.
- [acceptance-criteria.md](acceptance-criteria.md): behavioral checks before release.
