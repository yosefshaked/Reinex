# Migrations

`src/lib/setup-sql.js` is the snapshot of the schema as it should be. It only creates and
replaces; it never drops a table or a column and holds no one-time data fixes.

A change that an existing database needs once (dropping a table or a column, moving data,
replacing a constraint) is a numbered file here. Each file:

- is safe to run more than once;
- runs in one transaction;
- records itself in `public.schema_migrations`.

## Order

- Existing database: the new migration files in order, then `setup-sql.js`.
- New database: `setup-sql.js` only. Running the migrations on it afterwards changes nothing
  and records them as applied.

The files are applied by hand for now, the same way `setup-sql.js` is. Applying them from CI
on deploy is planned and not built yet.
