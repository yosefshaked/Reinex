# Finance, Attendance, and Leaves Investigation Report

Date: 2026-03-24

## Scope

This report audits the current implementation against the agreed finance, attendance, and leaves plan.

The goal is to distinguish between:
- implemented foundations
- missing functionality
- backend-only work that is not complete end to end
- shortcut-based implementation that should be replaced with the planned domain model

## Executive Summary

The implementation is materially incomplete.

The most important gap is student billing. The current codebase includes commitments, consumption entries, and some attendance-driven synchronization, but the flow is still partially built around patching `lesson_participants.price_charged` from the selected commitment's `default_charge_amount`. That is not the complete operational billing model we agreed to build.

Employee leave, attendance, and payroll are further along than student billing, but there are still important end-to-end gaps in policy management, instructor attendance handling, calendar conflict UX, and financial operations surfaces.

## What Is Clearly Implemented

- New schema bootstrap exists in `src/lib/setup-sql.js` for:
  - `employee_attendance_records`
  - `employee_leave_entries`
  - `employee_leave_days`
  - `employee_leave_balance_events`
  - `finance_corrections`
  - commitments and consumption extensions
  - lesson earnings uniqueness
- Employee leave API/UI exists and supports leave requests, cancellation, and manual balance events.
- Employee payroll preview API exists.
- Employee finance corrections API exists.
- Student commitments and manual consumption entries exist in backend and UI.
- Calendar attendance sync updates instructor earnings and billing artifacts.

## Findings

### 1. Student billing is still implemented as a shortcut, not as the planned full domain workflow

Severity: High

Evidence:

- `api/consumption-entries/index.js:122-155` assigns a commitment to a lesson participant by directly updating `lesson_participants.commitment_id` and `lesson_participants.price_charged`.
- `api/_shared/employee-finance.js:834-907` derives `price_charged` from `commitment.default_charge_amount`, patches `lesson_participants.price_charged`, and then upserts or deletes `consumption_entries`.
- `src/features/students/components/StudentFinancialTab.jsx:188-201` exposes assignment from the UI, but the broader lifecycle is still incomplete.

Why this matters:

- This means the pricing behavior is still centered on mutating the lesson participant row, with consumption records following that mutation.
- That is a shortcut compared to the agreed plan, where student billing should exist as a full operational workflow around commitments, billing eligibility, consumption, adjustments, balances, and transfers.

Missing from the planned billing architecture:

- no true transfer workflow between commitments
- no end-to-end reassignment/clear flow from the main UI
- no completed billing operations surface on the Financials page
- no clear admin-managed policy surface for consumption behavior by attendance outcome
- no stronger separation between lesson attendance data and billing/financial state

Conclusion:

- Your observation is correct. Student financials are not fully built yet, and the current implementation still contains a patch-style shortcut around `lesson_participants.price_charged`.

### 2. Policy configuration is seeded in the database, but not implemented as a real product surface

Severity: High

Evidence:

- `src/lib/setup-sql.js:1988-1991` seeds:
  - `leave_policy`
  - `leave_pay_policy`
  - `billing_consumption_policy`
  - `instructor_earnings_policy`
- `api/_shared/employee-finance.js:176-186` loads and normalizes these settings.
- `src/features/settings/api/index.js:46-57` still disables the leave policy fetchers by throwing errors.

Impact:

- The backend behaves as if policy exists, but the organization cannot actually manage it through the application.
- In practice, these are still system defaults, not implemented admin controls.

### 3. Manual attendance is still available for instructors, even though instructor attendance is supposed to be lesson-derived

Severity: High

Evidence:

- `src/components/settings/employee-management/UnifiedEmployeeList.jsx:1018-1023` renders the attendance panel without restricting it to office employees.
- `api/employee-attendance/index.js:117-223` resolves the employee and allows attendance record creation/update/delete without enforcing an office-only/manual-attendance rule.

Impact:

- This violates the intended architecture:
  - office attendance is manual
  - instructor presence is derived from lesson delivery and attendance outcomes
- It creates a path for inconsistent instructor payroll inputs.

### 4. Leave conflict rules exist in the backend, but the calendar UX is not complete end to end

Severity: Medium

Evidence:

- `api/_shared/employee-finance.js:543-585` returns structured conflict responses:
  - `attendance_conflicts_with_leave`
  - `lesson_conflicts_with_leave`
  - `leave_conflicts_with_attendance`
  - `leave_conflicts_with_lessons`
- `src/features/calendar/components/AddLessonDialog.jsx:253-271` currently falls back to a generic error message path.
- `src/features/calendar/components/LessonInstanceDialog.jsx:129-223` also surfaces raw API errors without a complete guided workflow.

Impact:

- The hard block exists technically.
- The user-facing workflow is still incomplete. The UI does not fully translate these conflicts into the expected operational guidance such as:
  - edit/remove leave first
  - move or cancel lessons first
  - clear attendance first

### 5. The Financials page is still an overview, not the management surface from the plan

Severity: Medium

Evidence:

- `src/pages/FinancialsPage.jsx:54-62` only loads payroll, commitments, and consumption data.
- The rendered UI is summary-oriented:
  - payroll summary
  - commitments overview
  - billing queue
  - movement history table

What is missing from the plan:

- real payroll operations
- real billing operations
- transfer workflows
- export workflows
- stronger action surfaces for finance administration

Impact:

- Financials exists visually, but it is not yet the operational control surface that was planned.

### 6. Student billing lifecycle is incomplete even within the current partial model

Severity: Medium

Evidence:

- `api/consumption-entries/index.js:169-190` supports `clear_participant_commitment`.
- `src/features/students/components/StudentFinancialTab.jsx:193` uses `assign_participant_commitment`, but there is no corresponding UI flow for `clear_participant_commitment`.
- `api/consumption-entries/index.js` supports `transfer_ref`, but there is no transfer UI/workflow.

Impact:

- A mistaken assignment can be difficult or impossible to undo from the intended operational surface.
- Transfer support exists in shape, but not as a usable feature.

### 7. Employee finance corrections are only partially surfaced in the employee UI

Severity: Low

Evidence:

- `api/payroll-adjustments/index.js:89-157` supports create and update.
- `api/payroll-adjustments/index.js:159-177` supports delete.
- `src/components/settings/employee-management/EmployeeFinancePanel.jsx:111-144` currently surfaces create and delete, but no edit flow.

Impact:

- The backend capability exists, but the employee-facing financial correction workflow is still incomplete.

### 8. The planned test matrix was not implemented

Severity: Medium

Evidence:

- Repository tests are still limited to a small number of generic files under `test/` and `src/runtime/`.
- Search did not reveal dedicated automated tests for:
  - employee leave flows
  - employee attendance flows
  - payroll preview
  - finance corrections
  - commitments
  - consumption entries
  - lesson earnings sync

Impact:

- Even where functionality exists, it is not well protected against regression.
- The plan explicitly called for a much broader test matrix than what is currently present.

## Bottom Line

The new finance/attendance/leaves work is only partially complete.

The biggest architectural issue is student billing: it is not yet implemented at the level we agreed on and still relies on a shortcut that patches `lesson_participants.price_charged`.

If implementation continues, the next work should not be more patching around the current student billing flow. It should be a deliberate completion of the planned commitments, billing, consumption, transfer, policy, and finance operations model.
