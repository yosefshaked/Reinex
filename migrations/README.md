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

## Files

- `0001_live_pay_remove_stored_copies.sql` - stored pay copies removed; pay is computed live.
- `0002_remove_legacy_rate_columns.sql` - every rate lives only in `RateHistory`.
- `0003_dated_settings.sql` - the settings that affect instructor pay (`instructor_earnings_policy`,
  `leave_pay_policy`) move from `Settings` to `SettingsHistory` as a first version from 2000-01-01;
  pay decisions the system stored by itself on attended participants and on whole-lesson
  cancellations are cleared so the policy in force on the lesson's date decides.
- `0004_leave_entitlement_default.sql` - `Employees.annual_leave_days` loses its default of 12 and
  becomes the manual yearly leave number (null = the organisation's `leave_entitlement_policy`);
  existing 12s (the old default) become null, once.
