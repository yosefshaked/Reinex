# Reinex Roadmap (PRD-aligned)

**Last updated:** 2026-01-05

This roadmap tracks Reinex progress against the PRD ([Reinex-PRD.md](../Reinex-PRD.md)).

## Status legend
- ✅ Done (in repo)
- 🟡 In progress
- ⬜ Not started
- ⚠️ Blocked / needs decision

## Non‑negotiables (always true)
- Tenant DB schema is **public only**.
- API routes are domain-based; do **not** include product names in route names.
- Instructor (non-admin) access is limited to their own data; admin/owner can access all.
- Hebrew-first + RTL-first UI.

---

## Milestone 0 — Foundation & Cleanup
Goal: PRD-first groundwork, remove legacy friction, stabilize navigation.

- ✅ Public-schema SSOT direction (no `tuttiud` tenant schema dependency)
- ✅ Students canonical identifier: `identity_number` (+ `phone`, `email`)
- ✅ Desktop RTL sidebar + mobile bottom navigation (AppShell)
- ✅ Dedicated Employees page (no longer embedded as Settings modal)
- ✅ Folder refactor: employee management UI moved to `src/components/settings/employee-management/`
- ✅ Setup assistant RPC call fixed (avoid `public.public.*` double-qualification)

---

## Milestone 1 — Scheduling MVP (Daily view first)
Goal: usable daily operations screen for staff.

**Data model (tenant public)**
- ⬜ `lesson_templates`
- ⬜ `lesson_instances`
- ⬜ `lesson_participants`
- ⬜ Basic indexes for date/instructor queries

**API (Azure Functions)**
- ⬜ List day schedule: `GET /api/lesson-instances?date=YYYY-MM-DD`
- ⬜ Create one-time lesson instance
- ⬜ Update status (scheduled/completed/cancel/no-show)
- ⬜ Conflict detection in responses (simple: same instructor time overlap; same student overlap)

**UI**
- ⬜ Calendar day view (primary)
- ⬜ Instructor columns, 15-min grid rows
- ⬜ Status icons + quick status change

---

## Milestone 2 — Weekly Templates + Generation Engine
Goal: recurring schedules and safe generation behavior.

- ⬜ Weekly lesson templates CRUD
- ⬜ Generation job: creates 14 days ahead
- ⬜ Never overwrites existing instances
- ⬜ Template overrides (cancel/modify per date)
- ⬜ Manual “Generate week” diff preview
- ⬜ Undo generation window + audit log entry
- ⬜ Dry-run mode

---

## Milestone 3 — Attendance, Documentation State, and History
Goal: complete operational lifecycle per lesson.

- ⬜ Attendance tracking per participant
- ⬜ Documentation status (`undocumented`/`documented`)
- ⬜ Lesson history per student (past lessons + filters)
- ⬜ Surface conflicts and admin-attention flags

---

## Milestone 4 — Commitments & Consumption (Payments Layer)
Goal: prepaid/HMO commitments and consumption per completed lesson.

- ⬜ Commitments CRUD (packages/HMO/private)
- ⬜ Consumption entry creation on completion
- ⬜ Balance view per commitment
- ⬜ Cancellation charging rules (org-configured)

---

## Milestone 5 — Payroll (Lesson Earnings)
Goal: instructor payroll based on completed lessons.

- ⬜ Earnings rows per completed lesson (`lesson_earnings`)
- ⬜ Rate resolution rules (service base rate + per-student overrides)
- ⬜ Export/bridge to existing payroll model where needed

---

## Milestone 6 — Forms + OTP Onboarding (External)
Goal: legally defensible onboarding flows.

- ⬜ Forms builder (schema + rules)
- ⬜ OTP challenges (WhatsApp/email)
- ⬜ Form submissions + audit logging (IP, timestamps)
- ⬜ Student onboarding status transitions

---

## Milestone 7 — Notifications (MVP: manual copy/paste)
Goal: operational reminders without full bot automation yet.

- ⬜ Notification templates in settings
- ⬜ “Copy message” reminders from daily schedule
- ⬜ Confirmation intake UI (coming / not coming)

---

## Milestone 8 — Waiting List
Goal: match open slots and reduce churn.

- ⬜ Waiting list entries CRUD
- ⬜ Match suggestions (open slots vs preferences)
- ⬜ Admin action: create template or one-time lesson from match

---

## Known follow-ups (refactor debt)
These are cleanup items that improve maintainability but are not PRD features.

- ⬜ Rename internal identifiers from “instructor” → “employee” where appropriate (non-breaking, gradual)
- ⬜ Replace current Calendar placeholder with real schedule UI backed by `lesson_instances`
