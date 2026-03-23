# Employees Feature Implementation Plan

**Date:** 2026-03-23  
**Status:** In Progress  
**Primary Direction:** Option A information architecture with a calmer, row-based detail UI and a new overview layer before deep employee management.

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
