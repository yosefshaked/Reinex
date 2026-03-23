# Employees Feature Implementation Plan

**Date:** 2026-03-23  
**Status:** Phase 1 - Implemented and re-aligned toward Option A  
**Primary Direction:** Option A information architecture with a broad workspace, a right-side directory for RTL usage, row-based section details, and a new overview layer before deep employee management.

## 1. Schema Check

Source of truth reviewed in [setup-sql.js](C:/dev/Reinex/src/lib/setup-sql.js).

### 1.1 Confirmed Existing Tables / Columns

**Employees**
- `id`
- `user_id`
- `first_name`
- `middle_name`
- `last_name`
- `employee_id`
- `employee_type`
- `current_rate`
- `phone`
- `email`
- `start_date`
- `is_active`
- `notes`
- `working_days`
- `annual_leave_days`
- `leave_pay_method`
- `leave_fixed_day_rate`
- `employment_scope`
- `instructor_types`
- `metadata`

**Instructor overlays**
- `public.instructor_profiles`
  - `employee_id`
  - `working_days`
  - `break_time_minutes`
  - `metadata`
- `public.instructor_service_capabilities`
  - `employee_id`
  - `service_id`
  - `max_students`
  - `base_rate`
  - `metadata`

**Operational / payroll support**
- `public.WorkSessions`
- `public.LeaveBalances`
- `public.RateHistory`
- `public.lesson_instances`
- `public.lesson_participants`

### 1.2 Important Gaps

The schema supports:
- employee profile editing
- employment start date
- leave policy fields
- payroll placeholders
- instructor capability overlays
- instance history via calendar tables

The schema does **not** yet provide a dedicated leave request / leave calendar workflow table.  
That means the first implementation should:
- show leave-related information already backed by schema
- avoid inventing fake persistence for leave-request workflows
- keep a clear placeholder for richer leave management in the next phase

## 2. Product Structure

We will keep `/employees` as the route for now and implement two layers inside it:

1. **Overview layer**
   - quick summary
   - attention items
   - upcoming employee activity
   - quick actions
   - fast access to employee selection

2. **Employee workspace layer**
   - selected employee deep view
   - editing
   - communication actions
   - leave/employment information
   - past and scheduled instances
   - finance/report placeholders

## 3. Phase 1 Scope

### 3.0 Current Delivery Status

Implemented in the first pass:
- widened `/api/instructors` contract to surface real `Employees` columns already present in schema
- widened create/update validation for employee profile fields
- replaced the shallow employee edit flow with a fuller employee profile editor
- expanded employee creation to support `employee_type` and `start_date`
- rebuilt `/employees` into:
  - overview summary band
  - searchable employee selector
  - selected employee workspace
  - communication actions
  - first-pass scheduled/completed instance visibility for instructors
  - broad Option A-style split layout with:
    - right-side directory in RTL flow
    - wide operational workspace for the selected employee
    - hero header + metrics + operational sections
    - field rows ordered for Hebrew usage: label on the right, value on the left

Still intentionally pending:
- dedicated leave workflow over `LeaveBalances` / `WorkSessions`
- accountant export and financial reporting flows
- richer unlinked-member assignment UX
- documents / certifications / communication history

### 3.1 API alignment
- Expand `GET /api/instructors` payload to include real employee columns already present in `Employees`
- Expand `POST /api/instructors` to accept:
  - `employee_type`
  - `start_date`
- Expand `PUT /api/instructors` to update:
  - name fields
  - `employee_id`
  - `employee_type`
  - `email`
  - `phone`
  - `start_date`
  - `notes`
  - `is_active`
  - `annual_leave_days`
  - `leave_pay_method`
  - `leave_fixed_day_rate`
  - `employment_scope`
  - `current_rate`
  - instructor overlay fields already supported

### 3.2 Employees page UX
- Replace the old list-only experience with:
  - summary header
  - overview cards / feed
  - searchable employee directory
  - selected employee workspace
- Avoid field-per-card UI
- Use section cards with row-based details
- Preserve RTL semantics in layout order instead of relying on forced text alignment utilities

### 3.3 Communication
- Quick call / mail / WhatsApp actions
- If no phone exists, WhatsApp stays unavailable until data is added

### 3.4 Instances
- Reuse `GET /api/calendar/instances`
- Show for selected employee:
  - upcoming scheduled instances
  - recent completed instances

### 3.5 Leave / finance
- Surface current policy fields now
- Mark advanced leave workflow and finance exports as upcoming phases

## 4. Phase 2 Candidates

- Leave request workflow UI backed by dedicated API/table design
- Accountant export flow
- Payroll / financial summary
- Documents / certifications
- Availability editor beyond basic working days
- Communication history / audit surface

## 5. Implementation Notes

- Keep route stable: `/employees`
- Prefer reusing current dialogs where practical, but replace shallow ones if they block the new UX
- Continue using the existing employees endpoint (`/api/instructors`) until a dedicated domain rename is planned
- Do not invent non-existent schema fields

## 6. Next Implementation Steps

1. Deepen the unlinked-member flow
   - support linking an org member to an existing manual employee
   - surface pending invitations more clearly

2. Add a dedicated leave management section
   - policy summary
   - balance timeline using `LeaveBalances`
   - later: request/approval workflow once backing persistence is designed

3. Add finance/report actions
   - employee earnings summary
   - accountant export entry point
   - payroll history drill-down

