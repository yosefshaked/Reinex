# Tenant DB Notes (public schema only)

## Non-negotiables
- Reinex uses tenant `public` schema only.
- Reinex ships a full, idempotent tenant setup SQL script (SSOT): see `src/lib/setup-sql.js`.
- The tenant DB is product-agnostic: table naming must be domain-based.

## Important collision warning (case-sensitive tables)
Postgres treats unquoted identifiers as lower-case. That means `students` and `"Students"` are different tables.

If a tenant already has legacy quoted/capitalized tables (e.g., `"Students"`, `"Instructors"`), the setup script may create new lower-case tables alongside them.

Action item (recommended for every tenant):
- Inventory existing `public` tables before running SSOT in production.
- Prefer one canonical set of tables for Reinex MVP (lower-case names from SSOT).

## Time zone requirement
- Time zone must be per-tenant configurable.
- Store lesson times as `timestamptz`.
- Treat UI-selected local time in the tenant time zone as the source of truth; convert safely when reading/writing.

## Scheduling data model (MVP)
- `lesson_templates` define recurring weekly schedule
- weekly generation creates `lesson_instances` without overwriting existing rows
- group lessons are represented by `lesson_participants` rows linked to a single `lesson_instance`
