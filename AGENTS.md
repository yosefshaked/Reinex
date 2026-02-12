# AGENTS (Reinex)

This repo started as a duplication of TutTiud. The content below contains Reinex's notes.
There's a legacy agents.md that contains many TutTiud-specific notes, use it to understand the system's integrity and build the new AGENTS.md (this file). The legacy agents.md can be found at ProjectDoc\TutTiud_Agents.md

The rules in this **Reinex section override everything below**.

## Reinex Non‑Negotiables
- Tenant DB schema is **public only**.
- Control DB is shared with TutTiud (organizations/memberships/auth).
- Do **not** use "reinex" in API route names; routes must be domain-based.
- Instructors (non-admin) can only access their own lessons/students; admin/owner can access all.

## Reinex Instructors Pattern (2025-01)
- **Overlay table architecture**: Instructors use base `Employees` table + domain-specific overlay tables
- **instructor_profiles table**: One-to-one with Employees, stores:
  - `working_days` (integer array, 0-6 for Sunday-Saturday)
  - `break_time_minutes` (integer, break duration)
  - `metadata` (jsonb for extensibility)
- **instructor_service_capabilities table**: One-to-many with Employees, stores per-service data:
  - `service_id` (FK to Services)
  - `max_students` (integer, capacity per session)
  - `base_rate` (numeric, hourly rate for payroll)
  - `metadata` (jsonb for extensibility)
  - UNIQUE constraint on (employee_id, service_id)
- **API pattern**: `/api/instructors` GET handler must manually join overlay tables:
  1. Query Employees for base instructor data
  2. Query instructor_profiles for all employee IDs
  3. Query instructor_service_capabilities for all employee IDs
  4. Build Map objects for efficient O(1) lookup
  5. Merge data into response: `{ ...employee, instructor_profile, service_capabilities }`
- **Response structure**:
  ```javascript
  {
    id, first_name, middle_name, last_name, email, phone, is_active, notes, metadata, instructor_types,
    instructor_profile: { working_days, break_time_minutes, metadata } | null,
    service_capabilities: [{ service_id, max_students, base_rate, metadata }]
  }
  ```
- **POST handler**: After creating Employee, upsert into instructor_profiles if working_days/break_time_minutes provided
- **Backward compatibility**: Instructors without overlay data return `instructor_profile: null` and `service_capabilities: []`
- **Use cases**: Scheduling (working_days), capacity planning (max_students), payroll (base_rate)
- **See**: `docs/instructors-api-response-structure.md` for complete API contract

## Invitation Integration (2025-01)
- **User invitations moved to Employees page**: `DirectoryView` component now includes "הזמן משתמש" button
- **Reusable component**: `InviteUserDialog.jsx` extracted from Settings for use in employee management
- **Deprecated**: `OrgMembersCard` in Settings now shows amber deprecation notice directing users to Employees page
- **Migration path**: Settings team members card kept for backward compatibility but will be removed in next major version
- **Rationale**: Centralized employee management (existing employees + new user invitations in same location)

## Azure Functions (CRITICAL)
- Always set `context.res` before returning (use `respond()` helper).
- Always extract JWT via `resolveBearerAuthorization()`.
- `supabase.auth.getUser(token)` returns `{ data, error }` and user is `result.data.user`.

## Services Integration (2026-01)
- Services now use `is_active` (boolean) for enable/disable instead of deletions; UI toggles should update this flag and list both active and inactive services.