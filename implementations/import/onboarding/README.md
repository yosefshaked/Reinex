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
   - First and last name and a valid identity number are present.
   - A valid contact path exists: either the student has a valid phone number, or a
     linked guardian has a valid phone number or email address. A student email alone
     does not satisfy the student contact-path rule.
   - Duplicate decisions are resolved.
   - The commit is explicit and batch-scoped.
   - Records are marked inactive and hidden from active workflows by default.

2. **Kept in import staging**
   - Rows remain reviewable/searchable inside the Import Workspace.
   - They do not create `client_profiles`, `students`, guardians, schedules, billing, forms, or document records.
   - They can be revisited later without polluting live data.

There is no "create partial inactive profile now, fill it someday" mode.

Missing or invalid values may be corrected upstream and re-uploaded, or repaired in the
Import Workspace's existing candidate review/editor. Both paths lead back through analysis;
neither bypasses blockers or invents source values.

## First Supported Import Scope
Phase 1 should support:
- Active students
- Inactive students as an all-or-nothing archive slice
- Guardians and guardian links
- Basic services mapping
- Student notes/intake notes
- Duplicate detection and saved decisions

The current extension imports lesson shells and participants, but does not activate historical
attendance or import payments, commitments, documents, or HMO claims. Historical attendance is
kept as source provenance until its finance/payroll behavior is designed.

## Lesson And Instructor Import Extension

The current extension supports `instructor`, `lesson`, and `lesson_participant` candidates
in addition to the original customer/guardian/service scope:

- Instructor candidates may link to an existing `Employees` instructor or create an
  unlinked instructor overlay with no user account. External source IDs are retained for
  idempotent lesson resolution.
- Lessons require an explicit source namespace/id, timezone-aware start, instructor source
  id, service, status, and a duration either on the candidate or service.
- Past imported lessons are historical references and are excluded from pending session
  reports. Future imported lessons are scheduled normally and become report-eligible after
  they occur.
- Historical participant status suggestions are retained in import metadata, while the
  live `participant_status` remains `scheduled`. This prevents later calendar/HMO resyncs
  from creating historical billing or payroll artifacts before that policy is designed.
- Future participants must be `scheduled`; normal attendance resolution later invokes the
  existing organization billing rules.
- No import commit calls billing or payroll synchronization. Historical finance/payroll is
  a separate future design.

Source-specific extractors may prepare a checksummed multi-file bundle, but the Import
Workspace remains source-agnostic. The Amir Access extractor follows this boundary: its
normalized customer/guardian/link/service/instructor/lesson/participant CSVs can be mapped
without adding source-specific assumptions to the core importer.
Do not add Amir table/query names or field assumptions to the core importer.

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
