# Acceptance Criteria

## Workspace And Resumability
- User can create an import workspace.
- User can upload multiple files.
- User can leave and reopen the workspace without losing:
  - files
  - parsed rows
  - mappings
  - decisions
  - issue statuses
  - dry-run results
  - commit history
- Workspace dashboard shows clear next action.

## Staging Safety
- Uploading files never creates live `client_profiles`, `students`, guardians, services, schedules, forms, billing, or documents.
- Profiling never creates live records.
- Mapping never creates live records.
- Candidate analysis never creates live records.
- Dry run never creates live records.

## Inactive Student Integrity
- Inactive rows with unresolved blocking issues cannot be committed.
- Inactive rows are not imported one-by-one as partial live records.
- Inactive candidates stay in staging until an explicit inactive archive commit.
- Inactive archive commit marks all created student/client records inactive immediately.
- Inactive archive commit does not create schedules, billing, forms, or document requirements.
- Active product screens hide imported inactive records by default.
- Uncommitted inactive rows remain visible only in the Import Workspace.

## Active Student Commit
- Clean active students can be committed before the entire workspace is finished.
- Active student commits create/update live records through existing student/client helpers.
- Duplicate active students require a decision before commit.
- Commit creates provenance metadata.
- Retrying a commit does not duplicate records.

## Guardian Commit
- Guardian candidates can be reviewed separately from students.
- Guardian links wait for committed or matched client profiles.
- Guardian relationship is required before link commit unless explicitly skipped.
- Retrying guardian commit does not duplicate guardian links.

## Duplicate Handling
- Exact identity-number matches are flagged.
- Probable duplicate name matches are flagged.
- User can link to existing record.
- User can accept candidate as a distinct person.
- User can skip the row.
- Decisions are stored and visible later.

## Mapping
- User can map common Hebrew and English column names.
- User can set fixed values for a sheet, such as `inactive`.
- User can map source status values to canonical statuses.
- User can save mapping templates.
- Re-running mapping updates candidates and issue queues.

## Audit And Support
- Every commit has a commit run record.
- Every committed candidate has a commit item record.
- Live records created by import include import provenance metadata.
- User can export issue reports for offline cleanup.

## Validation Commands
When implementing:
- Changes to `src/lib/setup-sql.js`: run `npm run lint:sql`.
- API changes: run `npm run lint:api`.
- Frontend changes: run `npm run lint`.
- Upsert changes: run `npm run lint:upsert-conflicts` and ensure matching unique indexes.

