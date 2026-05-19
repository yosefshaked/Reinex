# Reinex Finance, Attendance, and Leaves Plan

## Summary
- Keep the full three-layer leave model:
  - `employee_leave_entries` = one leave action
  - `employee_leave_days` = actual blocked/paid/deducted dates
  - `employee_leave_balance_events` = leave entitlement history
- Add `finance_corrections` as a separate payroll-only table for bonuses, manual corrections, and other non-flow pay changes.
- Remove legacy `WorkSessions` from fresh schema design and stop all new code from depending on it.
- Keep `setup-sql.js` idempotent by adding explicit cleanup for removed legacy sections with `DROP ... IF EXISTS` / `DROP COLUMN IF EXISTS` / `DROP CONSTRAINT IF EXISTS`.

## Key Changes
- Extend `Employees` with explicit payroll fields:
  - `payroll_model`
  - `monthly_salary_amount`
- Keep current v1 payroll matrix:
  - office + hourly
  - office + monthly salary
  - instructor + lesson-based
- Keep `current_rate` as the office-hourly compatibility field.
- Keep `instructor_service_capabilities.base_rate` as the instructor lesson payout source.
- Keep `RateHistory` as the effective-dated rate history table.

- Add `employee_attendance_records`:
  - one row per employee per date
  - manual office/hourly attendance
  - optional worked minutes
  - audit fields
  - unique `(employee_id, date)`

- Add `employee_leave_entries`:
  - stores one admin leave action
  - reason, note, source, approver, status
  - one place to edit/cancel/review the leave as a whole

- Add `employee_leave_days`:
  - one row per affected day or half-day
  - drives calendar blocking
  - drives payroll leave effects
  - links back to `employee_leave_entries`

- Add `employee_leave_balance_events`:
  - dedicated leave entitlement history
  - supports allocation, carryover, deduction, reversal, correction
  - does not mention payroll corrections
  - does not depend on `WorkSessions`

- Add `finance_corrections`:
  - employee payroll-only manual financial changes
  - supports bonus, deduction, correction, manual adjustment
  - independent from leave entitlement
  - used by payroll preview/reporting, not by leave balance

- Keep `lesson_earnings` as the instructor earning artifact and make it unique per `(employee_id, lesson_instance_id)`.

- Extend `commitments` with explicit billing terms needed for “price derived from commitment”, at minimum:
  - `commitment_type`
  - `default_charge_amount`

## Workflow Rules
- If a user tries to add attendance on a leave day:
  - hard block
  - show the leave details
  - user must edit/remove leave first

- If a user tries to add a lesson on a leave day:
  - hard block
  - show the leave details
  - user must edit/remove leave first

- If a user tries to create/edit leave on a date with existing lessons:
  - hard block
  - tell them to move or cancel the lessons first

- If a user tries to create/edit leave on a date with existing attendance records:
  - hard block
  - tell them to clear/edit attendance first

- Default instructor earnings policy:
  - `attended = earns`
  - `no_show = earns`
  - `cancelled_student = does not earn`
  - `cancelled_clinic = does not earn`
  - keep this configurable at org level

- Instructor paid leave valuation:
  - use the old smart model from Employee-Management conceptually
  - source it from delivered lesson earnings, not `WorkSessions`
  - default method:
    - trailing 3-month delivered-lesson average per worked day
    - 12-month fallback if better
  - allow employee override via `leave_pay_method` / `leave_fixed_day_rate`

- Student billing:
  - `lesson_participants.price_charged` is derived from the selected commitment’s `default_charge_amount`
  - charging policy by attendance outcome is org-configurable
  - default is attended-only charging

## API / Surface Changes
- Extend `/api/employee-leave` into full CRUD + summary + history.
- Add `/api/employee-attendance`.
- Add `/api/payroll`.
- Add `/api/payroll-adjustments` backed by `finance_corrections`.
- Add `/api/commitments` and `/api/consumption-entries`.
- Extend `/api/calendar/attendance` so attendance changes also sync:
  - `lesson_earnings`
  - `consumption_entries`
  - attendance confirmation metadata

- Employees page:
  - real Attendance tab
  - real Leaves tab
  - Finance tab for payroll config, preview, and corrections

- Financials page:
  - Payroll tab
  - Billing tab

- Student financial tab:
  - replace placeholder with real commitment/billing surface

## setup-sql.js Changes
- Remove fresh-schema creation of legacy `WorkSessions`.
- Remove fresh-schema dependencies on `WorkSessions`, including:
  - old foreign keys
  - old indexes
  - RLS lines
  - grant lists
  - diagnostics table lists
- Replace legacy sections with explicit idempotent cleanup blocks for approved destructive migration work:
  - `DROP TABLE IF EXISTS`
  - `DROP INDEX IF EXISTS`
  - `DROP COLUMN IF EXISTS`
  - `DROP CONSTRAINT IF EXISTS`
- Apply the same cleanup discipline to deprecated `LeaveBalances` once replaced by `employee_leave_balance_events`.

## Test Plan
- Fresh `setup-sql.js` succeeds with no `WorkSessions` section and no broken references.
- Legacy databases remain safe until destructive cleanup is explicitly approved/applied.
- Leave/attendance/lesson blocking works in all overlap directions.
- Instructor earnings sync correctly from lesson outcomes and org policy.
- Instructor paid leave valuation matches the intended historical-earnings logic.
- Office hourly payroll uses attendance worked minutes.
- Office monthly payroll prorates correctly.
- `finance_corrections` affect payroll preview correctly.
- Leave balance history is explainable from `employee_leave_balance_events`.
- Student billing covers commitments, pricing from commitment, consumption, transfers, adjustments, and balances.
- Permissions enforce admin-wide access and self-only employee reads where required.

## Assumptions
- `finance_corrections` is employee-payroll-only, not a student billing table.
- `employee_leave_balance_events` remains separate from `finance_corrections`.
- Hard blocking is the chosen stale-data strategy; no automatic carve-out of leave days in v1.
- Destructive cleanup in `setup-sql.js` is implemented only after your approval.
