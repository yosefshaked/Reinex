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
- `GET /api/instructors` manually loads and merges those tables; keep that response shape stable.
- `working_days` currently lives on `Employees`; UI already documents that source.
- Service capabilities include `availability_windows`; scheduling rules depend on them.
- Instructor service capability pay setup is hybrid:
  - `base_rate` remains the canonical hourly payout in agorot for payroll math
  - the admin-facing original entry choice is preserved in `metadata.compensation_input`
  - supported preserved modes are `hourly` and `duration_based`
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
- Leave, attendance, and payroll rules live in [`../api/_shared/employee-finance.js`](../api/_shared/employee-finance.js); do not recode them in UI panels.
