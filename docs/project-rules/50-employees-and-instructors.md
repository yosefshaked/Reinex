# 50 Employees And Instructors

## When to read
- Employees page work.
- Instructor roster/profile/capability changes.
- Employee attendance, leave, activity, payroll, or user-linking work.

## Start here
These files are an entry point, not a boundary: follow imports, callers (grep the symbol), dependencies, cross-domain effects and tests as far as the change needs.
- [`../../src/pages/EmployeesPage.jsx`](../../src/pages/EmployeesPage.jsx)
- [`../../src/components/settings/employee-management/InstructorManagementHub.jsx`](../../src/components/settings/employee-management/InstructorManagementHub.jsx)
- [`../../src/components/settings/employee-management/UnifiedEmployeeList.jsx`](../../src/components/settings/employee-management/UnifiedEmployeeList.jsx)
- [`../../src/components/settings/employee-management/`](../../src/components/settings/employee-management/)
- [`../../api/instructors/index.js`](../../api/instructors/index.js)
- [`../../api/instructors-link-user/index.js`](../../api/instructors-link-user/index.js)
- [`../../api/employee-attendance/index.js`](../../api/employee-attendance/index.js)
- [`../../api/employee-leave/index.js`](../../api/employee-leave/index.js)
- [`../../api/employee-activity/index.js`](../../api/employee-activity/index.js)
- [`../../api/payroll/index.js`](../../api/payroll/index.js)
- [`../../api/payroll-adjustments/index.js`](../../api/payroll-adjustments/index.js)
- [`../../api/_shared/employee-finance.js`](../../api/_shared/employee-finance.js)
- [`../../api/_shared/instructor-availability.js`](../../api/_shared/instructor-availability.js)
- [`../../src/lib/instructor-availability.js`](../../src/lib/instructor-availability.js)

## Shared helpers to reuse
- `useInstructors`, `useServices`
- `normalizeAvailabilityWindows`, `hasConfiguredAvailability`, `getAvailabilitySummary`, `buildAvailabilityTimeSlots`
- `ensureInstructorColors`
- Finance/policy helpers in [`../../api/_shared/employee-finance.js`](../../api/_shared/employee-finance.js)

## Known patterns / do not reinvent
- **The leave rules** the business requires (entitlement, days worked, carry-over, leave pay, half days) are `LV-*` and `PAY-G*` in [`../product/payroll.md`](../product/payroll.md), with the legal research in [`../research/israel-payroll-components.md`](../research/israel-payroll-components.md). The notes below are how the code applies them.
- Employees/instructors use an overlay model:
  - `Employees` is the base record
  - `instructor_profiles` adds profile-only fields
  - `instructor_service_capabilities` stores per-service capability rows
- `employee_type` (`instructor` / `office`) is not the same thing as the organization membership role (`member` / `admin` / `owner`). Employee screens may surface both, but org-level authority changes must go through the shared org-membership flow instead of inventing a second role system.
- Employee documents now live directly inside the unified employee profile UI (`UnifiedEmployeeList` documents tab) and reuse `InstructorDocumentsSection`; do not rebuild a separate employee-files surface.
- `GET /api/instructors` manually loads and merges those tables; keep that response shape stable.
- `working_days` currently lives on `Employees`; UI already documents that source.
- `Employees.annual_leave_days` is the employee's **manual** yearly leave number; null (the column has no default since `migrations/0004_leave_entitlement_default.sql`) means "the organisation default". It is set only from the "נוכחות" tab (below), through `PUT /api/instructors { annual_leave_days }` (0-365 in half days, or null).
- **Leave entitlement** (owner decision 2026-11-16) — how many leave days a calendar year gives, for every employee type. One pure, isomorphic module: [`../../api/_shared/leave-entitlement.js`](../../api/_shared/leave-entitlement.js) (frontend: `src/lib/leave-entitlement.js` re-export; tests `tests/leave-entitlement.test.js`). Its header carries the Kol Zchut sources and every decision; in short:
  - Source order: the manual number, else the org setting `leave_entitlement_policy` (a dated setting): `fixed` (the org's table, days per seniority year, last row onwards; the default when no version exists, owner decision 2026-11-22) or `legal` (shown in the UI as "מומלץ: לפי ותק וימי עבודה" — the words "לפי החוק" never appear in the UI; the assumptions are tracked in issue #56).
  - `legal`: seniority = calendar year − start year + 1; gross table 16×5, 18, 21, 22 … 28; net tables (5-day 12×5, 14, 15 … 20; 6-day 14×5, 16, 18 … 24) — kept as data and equal to `grossToNet(gross)` = W × ⌊g/7⌋ + min(g mod 7, W). Whole year (start ≤ 1 January): full from 200 days worked; part year (started during it): full from 240; below that net_full × days / threshold (2 decimals, not rounded down; 3 of 200 days of a 12-day year = 0.18). A day of paid leave (employee_paid, system_paid, half_day) counts as a day worked once per date; unpaid does not. `days_to_next_leave_day` = more counted days until the entitlement grows by 1 or reaches the full year. 6 defined `working_days` → 6-day table, anything else → 5-day.
  - Days worked = `loadWorkedDates` in `pay-calculation.js`: the local dates with a counted lesson (`loadCountedLessons` + `summarizeLessonsByDate`) or `other_minutes > 0`, each once. There is no sick-leave type, so paid sick days are 0. Read only when the law can compute (`needsDaysWorked`), from 1 January (or the start date) to today / 31 December.
  - Not computed (asks for a manual number, `status: 'manual_needed'`): no start date (law and fixed table); fewer than 75 calendar days since the start date (law only, applied to everyone). There is no end date on `Employees`, so "left during the year" and a re-start cannot be expressed.
  - The fixed table and a manual number are pro-rated by calendar days in the year the employee started (the old quota rule).
  - The org setting version for a year: the one in force on 31 December, or today for the current year (`entitlementPolicyDateForYear`).
  - Nothing computed is stored; `computeLeaveSummary({ entitlement, balanceEvents, year, leavePolicy })` takes the entitlement as its quota. `GET /api/employee-leave?employee_id&year` returns `entitlement` and `summary` (`available` = everything the year gives).
  - Carry-over stays manual ("צבירה משנה קודמת"). `leave_policy.carryover_cap_days`, if set, only caps how many carried days count; `carryover_enabled` is read but does nothing.
- An employee's own leave pay method is a dated setting (`SettingsHistory`, key `leave_pay_method`, `employee_id` set; the column on `Employees` is gone). A leave day is valued by the version in force on that day; with none (or a version that says "follow the organisation") it resolves to the org `leave_pay_policy.default_method` in force on that day (`leave_pay_policy` is a dated setting; `legal` in the seeded default policy). Written by `POST /api/employee-leave { entity_type: 'leave_pay_method_version' }`, a future version is cancelled with `DELETE`.
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
- Leave, attendance, and payroll rules live in [`../../api/_shared/employee-finance.js`](../../api/_shared/employee-finance.js); do not recode them in UI panels.
- The employee card has no leave tab. The "נוכחות" tab (`EmployeeAttendancePanel.jsx`) is the month grid of hours and leave: clicking a day opens the day editor below it, which records either hours (`api/employee-attendance`) or leave (`api/employee-leave`: who carries it, full or half day, an end date for a range starting on the picked day, a reason), and on a leave day edits or removes the whole leave entry. Pure helpers (leave request body, labels, refusal messages, balance line, "הסבר מלא" sentences, the entitlement choice body) are in `attendance-month-grid.js` with tests in `tests/attendance-month-grid.test.js` and `tests/leave-entitlement.test.js`. The leave balance is one line above the grid (`LeaveBalanceLine.jsx`): "מגיעים N ימי חופשה השנה · נוצלו X · נשארו Y" (figures on hover), "הסבר מלא" (plain sentences from the real figures, no legal wording) and "שינוי יתרה" (manual balance movements). Under it is the employee's one leave control, the "חופשה" row (`EmployeeLeaveSettings.jsx`, owner decision 2026-11-17): read first as one line (`employeeLeaveSummaryText`: "ימים: 9 בשנה · תשלום: ממוצע מומלץ", or "לפי ברירת המחדל (...)"), and one "שינוי" that opens the same two steps as the Settings "חופשה" dialog — step 1 "לפי ברירת המחדל של הארגון" / "מספר ימים קבוע לשנה" (`annual_leave_days`), step 2 "לפי ברירת המחדל של הארגון" / "ממוצע מומלץ" / "ממוצע היסטורי" / "ערך קבוע ליום" (`leave_pay_method`; the fixed value is the dated `leave_day` rate, `LeaveDayRateEditor`). One save sends only the changed fields in one `PUT /api/instructors` (`buildEmployeeLeaveBody`); the row reads its values and the org pay default from `GET /api/employee-leave` (`policy`, `leave_pay_policy`). There is no other leave control for an employee: no "שינוי" on the balance line, no leave box in "פיננסים". The panel reads the balance once per employee and calendar year (`year` param), and again after a change on the tab; month navigation inside a year does not reread it. Leave still cannot be recorded on a day with hours or lessons (server 409).
- The leave entitlement and the leave-pay method are both chosen in the "חופשה" row of the "נוכחות" tab, for every employee type; the organisation defaults in the one "חופשה" tile on the Settings page. `EditEmployeeDialog` and the "פיננסים" tab have neither.
- Personal session-report preanswers live at `Employees.metadata.report_preanswers`. Writes go through the narrow `POST /api/session-reports/preanswers` path, which resolves the employee by the authenticated caller's `Employees.user_id`; never accept a caller-supplied employee id for this self-service bank.
- Import Workspace instructor candidates may link to an existing instructor or create an
  `Employees` + `instructor_profiles` overlay with `user_id = null`. Imported external IDs
  live in `Employees.metadata.import_external_ids`; do not create invitations, membership
  roles, capabilities, availability, rates, or payroll artifacts during import. Future
  imported lessons require the resolved instructor to be active.
