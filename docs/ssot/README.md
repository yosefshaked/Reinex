# Control DB SSOT

Primary artifacts:

- `docs/ssot/control-db-setup.sql`: the canonical idempotent SQL script to paste into the Supabase SQL Editor
- `docs/ssot/control-db-setup.html`: a local copy-friendly page that embeds the same SQL

Reference artifact:

- `docs/ssot/control-db-schema.sql`: raw schema dump snapshot from the live control DB

Archive:

- legacy fragmented control DB scripts were moved to `scripts/archive/control-db/`

Notes:

- `control-db-setup.sql` is the SSOT for manual schema application.
- `control-db-schema.sql` is useful for diffing against the live database, but it is not the paste-ready SSOT.
- The HTML file is generated from `control-db-setup.sql`, so the SQL file remains the real source.
