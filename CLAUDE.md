# Reinex — Coding Agent Instructions

## After editing these files, always run the corresponding check

| Files edited | Command to run |
|---|---|
| `src/lib/setup-sql.js` | `npm run lint:sql` |
| `src/lib/setup-sql.js` (migration added) | `npm run lint:sql && npm run lint:upsert-conflicts` |
| `api/**/*.js` (any upsert with `onConflict`) | `npm run lint:upsert-conflicts` |
| `scripts/validate-upsert-conflicts.js` | `npm run lint:upsert-conflicts` |
| `scripts/validate-setup-sql.js` | `npm run lint:sql` |
| `api/**/*.js` (general API changes) | `npm run lint:api` |
| `src/**/*.jsx` or `src/**/*.js` | `npm run lint` |
| Finance/billing logic | `npm run test:finance-calendar` |
| Before any deploy | `npm run build` (runs lint:api + lint:api-responses:strict-ux + lint:sql + vite build) |

## Key rules

### DB schema (setup-sql.js)
- Every `CREATE TABLE` must use `IF NOT EXISTS`
- Every `CREATE INDEX` must use `IF NOT EXISTS`
- Every `ALTER TABLE ... ADD COLUMN` must use `IF NOT EXISTS`
- Every `ADD CONSTRAINT ... UNIQUE` must be inside a `DO $$ BEGIN IF NOT EXISTS ... END $$` guard
- Tables used in `withOrgScope().upsert({ onConflict: '...' })` **must** have a matching `CREATE UNIQUE INDEX` or named `UNIQUE` constraint in this file — without it, PostgreSQL throws `42P10` at runtime
- When adding a new upsert conflict key to `api/`, also add it to `EXPECTED_CONFLICTS_BY_TABLE` in `scripts/validate-upsert-conflicts.js` AND add the index/constraint to `setup-sql.js`

### API files (api/**)
- All DB writes must go through `withOrgScope(client, tableName, orgId)` — never raw `client.from(tableName)`
- Upserts must always specify `onConflict` explicitly
- New Azure Functions need a `function.json` sibling

### Dates and time zones
- Instants stay UTC (`timestamptz`); calendar dates are `YYYY-MM-DD` keys. Every local day/month/time decision goes through `api/_shared/local-time.js` (frontend: `src/lib/local-time.js`) in the org's zone — never `.toISOString().slice(0, 10)` / `.split('T')[0]`, never the `'Asia/Jerusalem'` literal (ESLint enforces both). See "Dates and time zones" in `agents-docs/00-core-rules.md`.

### Frontend (src/**)
- Currency values are stored in **agorot** (integers). Use `toAgorot()` / `toShekel()` from `src/lib/currency.js`
- API calls go through `authenticatedFetch()` from `src/lib/api-client.js`

## Project structure
- `api/` — Azure Functions (Node.js, ESM)
- `api/_shared/` — shared helpers (org-bff, client-profiles, form-routing, etc.)
- `src/` — React frontend (Vite)
- `src/lib/setup-sql.js` — single source of truth for the entire DB schema
- `scripts/` — lint and validation scripts run as part of build
