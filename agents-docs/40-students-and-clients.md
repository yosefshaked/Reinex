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
- `saveFilterState`, `loadFilterState`
- `describeSchedule`, `formatDefaultTime`, `formatStudentName`

## Known patterns / do not reinvent
- Student responses are composed from `students` + `client_profiles` + optional guardian data; keep the merged shape consistent.
- Student writes are split between student fields and client-profile fields in [`../api/students-list/index.js`](../api/students-list/index.js); do not hand-merge updates in a new way.
- Suspending a student from the student header or by saving the edit form as inactive must go through the shared suspend flow, so future lessons are cancelled together with the status change. Do not introduce a separate "inactive only" path in edit UI that skips lesson cancellation.
- One-time customers stay in `client_profiles` and may remain non-students.
- Instructors are scoped to their own students via lesson-template-derived IDs in [`../api/_shared/instructor-student-scope.js`](../api/_shared/instructor-student-scope.js).
- Roster pages persist filter state and reuse shared role helpers in [`../src/features/students/utils/endpoints.js`](../src/features/students/utils/endpoints.js).
- Student detail lesson-balance displays must reuse backend-provided lesson-count buckets (`consumed_lessons`, `reserved_lessons`, `available_lessons_to_book`) rather than recomputing "lessons left" inside React components.
