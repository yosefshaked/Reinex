# 40 Students And Clients

## When to read
- Student roster or student detail work.
- Client profiles, one-time customers, guardians, tags, filters, or student search work.

## Load these files first
- [`../src/features/students/pages/StudentsPage.jsx`](../src/features/students/pages/StudentsPage.jsx)
- [`../src/features/students/pages/StudentDetailPage.jsx`](../src/features/students/pages/StudentDetailPage.jsx)
- [`../src/features/students/components/`](../src/features/students/components/)
- [`../src/features/clients/pages/OneTimeCustomersPage.jsx`](../src/features/clients/pages/OneTimeCustomersPage.jsx)
- [`../api/students-list/index.js`](../api/students-list/index.js)
- [`../api/client-profiles/index.js`](../api/client-profiles/index.js)
- [`../api/guardians/index.js`](../api/guardians/index.js)
- [`../api/_shared/client-profiles.js`](../api/_shared/client-profiles.js)
- [`../api/_shared/student-validation.js`](../api/_shared/student-validation.js)
- [`../api/_shared/student-search.js`](../api/_shared/student-search.js)
- [`../api/_shared/instructor-student-scope.js`](../api/_shared/instructor-student-scope.js)
- [`../src/features/students/utils/`](../src/features/students/utils/)

## Shared helpers to reuse
- `useStudents`, `useClientProfiles`, `useGuardians`
- `createOrReuseClientProfile`, `createOrReuseGuardian`, `upsertClientGuardianLink`, `fetchPrimaryGuardianForClientProfile`
- Student validators/search helpers in [`../api/_shared/student-validation.js`](../api/_shared/student-validation.js) and [`../api/_shared/student-search.js`](../api/_shared/student-search.js)
- `normalizeTagIdsForWrite`, `normalizeTagCatalog`, `buildTagDisplayList`
- `updateStudentFromForm`, `updateStudentStatus`, `fetchStudentById` in [`../src/features/students/api/students.js`](../src/features/students/api/students.js) for student detail/status updates; keep edit modals on the shared PUT form path and header/suspend status actions on the shared verified status path. Header status actions must verify with a fresh student read before showing success.
- `saveFilterState`, `loadFilterState`
- `describeSchedule`, `formatDefaultTime`, `formatStudentName`

## Known patterns / do not reinvent
- Student responses are composed from `students` + `client_profiles` + optional guardian data; keep the merged shape consistent.
- Student writes are split between student fields and client-profile fields in [`../api/students-list/index.js`](../api/students-list/index.js); do not hand-merge updates in a new way.
- Client-profile-to-student promotion must copy `org_id` from `client_profiles` into `students`; `ensureStudentForClientProfile` in [`../api/_shared/client-profiles.js`](../api/_shared/client-profiles.js) is the shared path and must remain tenant-safe.
- Suspending a student from the student header or by saving the edit form as inactive must go through the shared suspend flow, so future lessons are cancelled together with the status change. Do not introduce a separate "inactive only" path in edit UI that skips lesson cancellation.
- One-time customers stay in `client_profiles` and may remain non-students.
- Instructors are scoped to their own students via lesson-template-derived IDs in [`../api/_shared/instructor-student-scope.js`](../api/_shared/instructor-student-scope.js).
- Roster pages persist filter state and reuse shared role helpers in [`../src/features/students/utils/endpoints.js`](../src/features/students/utils/endpoints.js).
- Roster rows may display `finance_payment_source` from `students-list`: active HMO authorization shows the provider as a small finance tag; no active HMO authorization is displayed as regular billing and is not an error state.
- Student detail lesson-balance displays must reuse backend-provided lesson-count buckets (`consumed_lessons`, `reserved_lessons`, `available_lessons_to_book`) rather than recomputing "lessons left" inside React components.
- Student detail and one-time-customer detail should share the same tabs-shell layout source where possible; differ by tab set/capabilities, not by inventing a separate page framework for each profile type.
- Student detail and one-time-customer detail headers should reuse the shared master-strip UI in [`../src/components/ui/ProfileMasterStrip.jsx`](../src/components/ui/ProfileMasterStrip.jsx); keep identity, KPI, and action layout aligned across both profile types, and only vary the data/actions passed into the strip.
- One-time customers use `client_profiles` as their canonical subject record and should reuse form-submission flows by `client_profile_id` rather than inventing a second forms-delivery path.
- When `session_reports_enabled` is on, student detail exposes the read-only "דוחות מפגשים" tab through [`../src/features/students/components/StudentReportsTab.jsx`](../src/features/students/components/StudentReportsTab.jsx). Its data must come from the org-scoped `session-reports` API and remain limited to internal lesson-anchored submissions; do not query all `form_submissions` as though every form were a session report.
