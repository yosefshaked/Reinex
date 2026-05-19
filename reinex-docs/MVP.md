# Reinex MVP (v0)

## Core workflows (must work end-to-end)
1. Students and instructors
   - Create and deactivate students
   - Create and deactivate instructors
   - Instructor visibility rules: instructors see only their own lessons/students; admin-instructors can see all

2. Scheduling
   - Weekly schedule management (templates + generation)
   - Daily calendar view
   - Ability to view past schedules and plan future schedules
   - Supports both 1:1 lessons and group lessons

3. History
   - Access historic sessions/schedules (past lesson instances)

## Operational requirements
- Staff-only system for MVP (no external client portal)
- Security: no data leakage across roles; no easy bypass for accessing medical/personal data
- Regulars vs casuals:
  - Default: regular = at least once a week
  - Regular rule: student attending at least once every 2 weeks
  - Generation must respect regulars so planning is realistic

## Conflict rules
- Instructor double-booking: always flagged, not blocked
- Student double-booking: always flagged, not blocked
- Capacity limits (per admin configuration): blocked by default
  - Allow explicit override only with deliberate acknowledgement + permission from management

## Notifications (MVP)
- Track two booleans per lesson instance:
  - "sent reminder"
  - "student seen reminder"
- No server-side message logging in MVP (kept on device / user workflow)

## What is out of scope for MVP
- Payroll exports/sync (may come later)
- Automated WhatsApp sending
- Full audit-grade message retention
