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
- Inactive students require a valid identity number.
- A student can be committed only when the student has a valid phone or a linked guardian
  has a valid phone or email; a student email alone does not satisfy this rule.
- Inactive rows are not imported one-by-one as partial live records.
- Inactive candidates stay in staging until an explicit inactive archive commit.
- Inactive archive commit marks all created student/client records inactive immediately.
- Inactive archive commit does not create schedules, billing, forms, or document requirements.
- Active product screens hide imported inactive records by default.
- Uncommitted inactive rows remain visible only in the Import Workspace.
- Missing values can be corrected in the candidate editor and re-analyzed.
- Systematic source corrections can be re-uploaded and analyzed without removing the
  candidate-level correction path.

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

## Instructor And Lesson Commit
- Instructor candidates can link to an existing instructor.
- A newly imported instructor has an `Employees` row and `instructor_profiles` overlay but
  no user account, invitation, availability, capability, rate, or payroll artifact.
- Re-importing the same source-system instructor or lesson ID reuses the live record.
- Lessons resolve their service and instructor before commit and require a valid duration.
- Future lessons and participants must be scheduled, and future lessons require an active instructor.
- Past imported lessons do not appear in pending session-report queues.
- Historical inferred participant status and its source note remain in metadata; the live
  participant stays scheduled until historical finance/payroll activation is designed.
- Importing lessons or participants never writes ledger, payroll, attendance, or HMO task artifacts.

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
