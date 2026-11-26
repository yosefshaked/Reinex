# Database

The schema of the one Supabase Postgres project that every organisation shares.

- [`setup-sql.js`](setup-sql.js) exports `SETUP_SQL_SCRIPT`, the snapshot of the schema as it should be. It is safe to run again; the Setup Assistant in the app shows the same script.
- [`migrations/`](migrations/README.md) holds the numbered one-time changes an existing database needs (drops, data moves).

**A new database:** run the snapshot only.

**An existing database:** run the migrations it has not run yet, in order, then the snapshot.

Both are applied by hand; nothing in CI or the deploy touches a database. Rules for changing the schema: [`docs/project-rules/00-core-rules.md`](../docs/project-rules/00-core-rules.md) "Schema"; checks: `npm run lint:sql` and `npm run lint:upsert-conflicts`.
