# 50 Employees And Instructors

## When to read
- Employees page work.
- Instructor roster/profile/capability changes.
- Employee attendance, leave, activity, payroll, or user-linking work.

## Load these files first
- [`../src/pages/EmployeesPage.jsx`](../src/pages/EmployeesPage.jsx)
- [`../src/components/settings/employee-management/InstructorManagementHub.jsx`](../src/components/settings/employee-management/InstructorManagementHub.jsx)
- [`../src/components/settings/employee-management/UnifiedEmployeeList.jsx`](../src/components/settings/employee-management/UnifiedEmployeeList.jsx)
- [`../src/components/settings/employee-management/`](../src/components/settings/employee-management/)
- [`../api/instructors/index.js`](../api/instructors/index.js)
- [`../api/instructors-link-user/index.js`](../api/instructors-link-user/index.js)
- [`../api/employee-attendance/index.js`](../api/employee-attendance/index.js)
- [`../api/employee-leave/index.js`](../api/employee-leave/index.js)
- [`../api/employee-activity/index.js`](../api/employee-activity/index.js)
- [`../api/payroll/index.js`](../api/payroll/index.js)
- [`../api/payroll-adjustments/index.js`](../api/payroll-adjustments/index.js)
- [`../api/_shared/employee-finance.js`](../api/_shared/employee-finance.js)
- [`../api/_shared/instructor-availability.js`](../api/_shared/instructor-availability.js)
- [`../src/lib/instructor-availability.js`](../src/lib/instructor-availability.js)

## Shared helpers to reuse
- `useInstructors`, `useServices`
- `normalizeAvailabilityWindows`, `hasConfiguredAvailability`, `getAvailabilitySummary`, `buildAvailabilityTimeSlots`
- `ensureInstructorColors`
- Finance/policy helpers in [`../api/_shared/employee-finance.js`](../api/_shared/employee-finance.js)

## Known patterns / do not reinvent
- Employees/instructors use an overlay model:
  - `Employees` is the base record
  - `instructor_profiles` adds profile-only fields
  - `instructor_service_capabilities` stores per-service capability rows
- `employee_type` (`instructor` / `office`) is not the same thing as the organization membership role (`member` / `admin` / `owner`). Employee screens may surface both, but org-level authority changes must go through the shared org-membership flow instead of inventing a second role system.
- Employee documents now live directly inside the unified employee profile UI (`UnifiedEmployeeList` documents tab) and reuse `InstructorDocumentsSection`; do not rebuild a separate employee-files surface.
- `GET /api/instructors` manually loads and merges those tables; keep that response shape stable.
- `working_days` currently lives on `Employees`; UI already documents that source.
- New employee creation should omit `annual_leave_days` when the client has no explicit value so the `Employees.annual_leave_days` database default applies; explicit create/update values still override it.
- `leave_pay_method` may remain null on `Employees`; payroll/leave calculations resolve null to the org `leave_pay_policy.default_method` in force on the leave day (`leave_pay_policy` is a dated setting; `legal` in the seeded default policy).
- Service capabilities include `availability_windows`; scheduling rules depend on them.
- A service capability carries no pay. Every rate (per service, hourly, monthly, leave day) is a dated `RateHistory` row written only by `api/employee-rates`; `Employees` has no rate or pay-model columns (removed in `migrations/0002_remove_legacy_rate_columns.sql`).
- User linking and invitations are handled inside employee management, not a separate team-management system.
- Employee invite flows may rotate an existing pending invite instead of failing hard:
  - a fresh resend should keep the same pending `org_invitations` row and rotate its token/expiry in place
  - if the auth user is still unconfirmed, the resend should generate a fresh Auth invite link and deliver it through Brevo
  - if the auth user already has a confirmed account, the invite remains an org-level pending approval but should still send a direct org-invite email through Brevo into the accept flow
- Accepting an employee-originated org invitation must do more than create `org_memberships`: the accept path must also consume the pending employee invitation link and set `Employees.user_id` for that employee record, then clear the pending marker.
- If Supabase Auth email sending fails for an employee invite, the flow should keep Supabase as the invite-token source (`generateLink`) and fall back to Brevo for actual email delivery instead of aborting the invite.
- Employee invite emails should carry the same core metadata as org invites (`inviter_name`, `organization_name`, invitation token) and default to a 3-day expiry window unless a stricter explicit expiration is supplied.
- Employee invite lifecycle events should be audited against the invitation resource itself, not only the employee record. Send/resend/failure/expiry events belong under `resourceType: 'invitation'`, with employee context kept inside audit details.
- Manual employee sync from linked user profile is merge-safe, not destructive: copy only profile fields that actually have values, never blank out existing org employee fields because the linked profile is missing data, and do not flag "not synced" solely because the org employee record contains extra information beyond the user profile.
- Unified documents treat employee/instructor files as `entity_type='instructor'` with `entity_id = Employees.id` (not `auth.users.id`). Self-service access must be validated through `Employees.user_id` on the backend, not by swapping frontend entity IDs.
- Leave, attendance, and payroll rules live in [`../api/_shared/employee-finance.js`](../api/_shared/employee-finance.js); do not recode them in UI panels.
- The employee card has no leave tab. The "נוכחות" tab (`EmployeeAttendancePanel.jsx`) is the month grid of hours and leave: clicking a day opens the day editor below it, which records either hours (`api/employee-attendance`) or leave (`api/employee-leave`: who carries it, full or half day, an end date for a range starting on the picked day, a reason), and on a leave day edits or removes the whole leave entry. Pure helpers (leave request body, labels, refusal messages, balance line) are in `attendance-month-grid.js` with tests in `test/attendance-month-grid.test.js`. The leave balance is one line above the grid (`LeaveBalanceLine.jsx`): figures on hover, manual balance movements (allocation, carryover, adjustment) behind a small popover. Leave still cannot be recorded on a day with hours or lessons (server 409).
- The leave-pay method is chosen in the finance tab's leave-pay box for every employee type; `EditEmployeeDialog` keeps only the annual leave quota (office employees).
- Personal session-report preanswers live at `Employees.metadata.report_preanswers`. Writes go through the narrow `POST /api/session-reports/preanswers` path, which resolves the employee by the authenticated caller's `Employees.user_id`; never accept a caller-supplied employee id for this self-service bank.
- Import Workspace instructor candidates may link to an existing instructor or create an
  `Employees` + `instructor_profiles` overlay with `user_id = null`. Imported external IDs
  live in `Employees.metadata.import_external_ids`; do not create invitations, membership
  roles, capabilities, availability, rates, or payroll artifacts during import. Future
  imported lessons require the resolved instructor to be active.
