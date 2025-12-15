# Loose Session Reports – Progress

## Phases & Tasks

### Phase 0: Planning & Foundations
- [x] Create progress tracker file
- [x] Confirm feature scope, constraints, and acceptance criteria
- [x] Identify affected code areas (DB schema, API, instructor UI, admin UI)
- [x] Align with AGENTS/ProjectDoc conventions and logging/auth patterns

### Phase 1: Database & Schema
- [x] Make `tuttiud."SessionRecords".student_id` nullable (idempotent migration)
- [x] Update setup script version + document schema change in AGENTS/ProjectDoc
- [x] Ensure API validation tolerates nullable student_id
- [x] Add metadata merge helper to preserve existing keys on writes
- [x] Verify SessionRecords queries that assume student_id NOT NULL (backend + frontend)

### Phase 2: Backend API (Capture & Resolution)
- [x] Update `/api/sessions` create flow to accept loose reports
- [x] Validate required fields for loose reports (name, reason, date, time, service)
- [x] Write unassigned_details into metadata additively (no clobber)
- [x] Exclude loose reports from standard student history endpoints
- [x] Add admin resolution endpoints (list pending, assign existing, create+assign)
- [x] Resolution: set student_id, remove only `unassigned_details` from metadata
- [x] Add audit logging for creation and resolution actions
- [ ] Add tests/validation scripts updates (where applicable)

### Phase 3: Instructor UI (Capture in New Session Modal)
- [x] Add "Student not in list?" trigger next to student select
- [x] Switch to loose mode: text input for name, disable defaults
- [x] Require manual date, time, service, reason (Other 	 required text)
- [x] Show warning/alert that admin approval is required
- [x] Wire submission payload for loose reports (metadata structure)

### Phase 4: Admin UI (Resolution Workspace)
- [x] Add Pending Reports entry point + badge count on Student page header
- [x] Build list view of `student_id IS NULL` reports with name/reason display
- [x] Action: match to existing student (search + update)
- [x] Action: create new student (prefill name) then update report; surface failure warning if update fails
- [x] Remove `unassigned_details` during resolution only

### Phase 5: Verification & Docs
- [x] Lint touched files (targeted eslint per AGENTS)
- [x] Run API validation script if required (`npm run lint:api`, `node scripts/validate-api-endpoints.js`)
- [x] Add notes to AGENTS/ProjectDoc about schema change and feature behavior
- [ ] Manual QA checklist: capture loose report, view exclusion from standard history, resolve via existing and new student flows

### Phase 6: Edge Cases & Enhancements
- [x] **#2**: Add "reject report" action (duplication/wrong filling/error/custom reason)
  - ✅ Backend: POST /api/loose-sessions with action='reject', validates reject_reason
  - ✅ Backend: Soft-deletes session (deleted=true) with rejection metadata (reason, rejected_by, rejected_at)
  - ✅ Backend: Logs SESSION_DELETED audit event with mode='reject_loose_report'
  - ✅ Frontend: RejectReportDialog with pre-defined reasons + custom textarea option
  - ✅ Frontend: Individual reject button on each report card
  - ✅ Frontend: Bulk reject button for multiple reports with shared reason
  - ✅ Error catalog: Hebrew error messages for missing_reject_reason, session_not_found, etc.
- [x] **#3**: Implement instructor assignment rules (instructor-only, admin/owner with override, non-instructor admin selection)
  - Note: Current implementation preserves original instructor_id from session creation; student's assigned_instructor is separate
- [x] **#4**: Change "default service" to "report service" and make required in both loose capture and resolution
  - Frontend: Label changed to "שירות דיווח *", field marked required, validation added
  - Backend: Service field already required for loose reports in `api/_shared/validation.js`
- [x] **#5**: Sort pending reports by `SessionRecords.date` (oldest first by default)
  - Backend: Changed sort order in GET /api/loose-sessions from `created_at DESC` to `date ASC`
- [x] **#6**: Add bulk selection (checkboxes + "select all with same name") and bulk assign/create actions
  - ✅ Frontend: Checkboxes per report, "Select All" toggle, "Select all with same name" button
  - ✅ UI: Selection highlighting, clear selection, bulk action buttons
  - ✅ Backend: Bulk reject uses sequential API calls to existing endpoint
  - ✅ Frontend: BulkResolvePendingReportsDialog with mode selection (assign existing / create new)
  - ✅ Bulk assign: Select one student, assign all reports to it with progress feedback
  - ✅ Bulk create: Create new student, assign all reports to it (warns if multiple names selected)
- [x] **#7**: Add admin-only role guard to PendingReportsPage (redirect non-admin to /my-students)
  - Implemented: Uses `normalizeMembershipRole` + `isAdminRole` check, redirects before rendering content
- [x] **#8**: Add search/filter to pending reports (name, date range, service, instructor)
  - ✅ Search: Free text search across name, reason, reason_other, service, created_by
  - ✅ Service filter: Dropdown with unique services from reports
  - ✅ Reason filter: Dropdown with unique reasons (localized labels)
  - ✅ Date range filter: From/to date inputs
  - ✅ Reset filters button (only shown when filters active)
  - ✅ Filter logic in filteredReports useMemo with proper null checks
- [x] **#9**: Add national_id validation during student creation to prevent duplicates
  - Frontend: Added national_id input field (required, maxLength 9) in ResolvePendingReportDialog
  - Backend: Checks for duplicate national_id before creating student, returns 409 with helpful error
  - Error handling: Displays Hebrew message "מספר זהות כבר קיים במערכת" on conflict
  - **Duplication status:** Shared hooks now in place; ResolvePendingReportDialog uses them. Optional future step: embed `AddStudentForm` to reuse dedup validation hooks.
  - **📋 DUPLICATION SUMMARY UPDATED:** See `docs/code-duplication-summary.md` (hooks rolled out; remaining minor candidates tracked there).
- [x] **#10**: Verify audit logging includes user_id, user_email, user_role for resolution actions
  - Verified: All resolution actions in `/api/loose-sessions` log userId, userEmail, userRole via `logAuditEvent`
- [x] **#11**: Allow instructors to track their own loose reports
  - ✅ Backend: Modified GET /api/loose-sessions to support instructor filtering
  - ✅ Backend: Non-admin instructors can only see their own reports (filtered by instructor_id)
  - ✅ Backend: Admin/owner can see all loose reports (no filtering)
  - ✅ Backend: POST operations remain admin-only (instructors cannot resolve)
  - ✅ Frontend: MyPendingReportsCard component displays instructor's loose reports
  - ✅ Frontend: Shows pending reports (not yet assigned) and resolved reports (assigned by admin)
  - ✅ Frontend: Auto-refreshes when data changes, displays with amber badges for pending
  - ✅ Frontend: Integrated into Settings page for non-admin instructors only
  - ✅ UI: Clear message that only admins can assign reports
  - ✅ Permission: Read-only view for instructors, no resolution capabilities
- [x] **#12**: Refactor code duplication (see `docs/code-duplication-summary.md`)
  - Hooks created (`useStudents/useInstructors/useServices`) and adopted in primary consumers (ResolvePendingReportDialog, NewSessionModal, StudentManagementPage, DataMaintenanceModal, Add/Edit Student forms, StudentDetailPage, MyStudentsPage, settings instructor views, ServiceManager)
  - Remaining candidates: none (cleanup complete; track future additions in summary doc)

## Key Architectural Decisions
- [x] Metadata safety: ensure additive merge when writing `metadata.unassigned_details` (preserve created_by/user_agent/etc.)
  - Implementation: `mergeMetadata` helper in `api/_shared/validation.js` used by `/api/sessions` create flow
- [x] Exclusion strategy: how to omit loose reports from standard student history endpoints without breaking aggregates
  - Implementation: Loose reports excluded in `WHERE student_id IS NOT NULL` clause in student detail queries
- [x] Resolution atomicity: approach for create-student-then-update-report (transaction vs. UI warning fallback)
  - Implementation: Backend creates student in transaction, then updates session; errors surfaced to UI with clear messages
- [x] Validation: enforce loose-report required fields server-side and client-side
  - Server: `api/_shared/validation.js` enforces `service_context`, `time`, `unassigned_details.name`, `.reason`
  - Client: `NewSessionForm.jsx` validates loose mode fields before submission
- [x] Logging/Audit: which actions are logged and how (creation, resolution)
  - Creation: `SESSION_CREATED` action with `is_loose: true` in details
  - Resolution: `SESSION_RESOLVED` action with resolution mode (`assign_existing` or `create_and_assign`)
