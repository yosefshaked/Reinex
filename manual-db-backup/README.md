# Supabase Manual DB Backup

Double-click `backup.bat` (or run `python backup.py`) to start the interactive backup tool.

## Prerequisites

| Tool | Install |
|------|---------|
| Python 3.8+ | https://www.python.org/downloads/ |
| Supabase CLI | `scoop install supabase` or `npm install -g supabase` |

## What it does

Uses [`supabase db dump`](https://supabase.com/docs/reference/cli/supabase-db-dump) to create a logical backup of your remote Supabase database.

## Interactive options

1. **Connection method**
   - `--linked` — uses a previously linked project (`supabase link --project-ref <ref>`)
   - `--db-url` — direct PostgreSQL connection string
   - Auto-link — enter a project ref and the tool runs `supabase link` for you

2. **Schema filter** — leave blank for all schemas, or specify e.g. `public,auth`

3. **Dump type**
   - Schema only (DDL — default)
   - Data only (`--data-only`)
   - Roles only (`--role-only`)
   - Full backup (all three, saved as separate files)

## Output

Backups are saved under `backups/YYYY-MM-DD_HH-MM-SS/`:

```
backups/
  2026-05-25_14-30-00/
    schema.sql      ← table definitions, functions, policies …
    data.sql        ← row data (full backup only)
    roles.sql       ← cluster roles (full backup only)
```

## Notes

- The DB password for custom roles is **not** stored in schema dumps (Supabase security policy). Reset custom role passwords after restoring from a backup.
- Storage objects (files) are **not** included — only database metadata.
- For first-time use, link your project once: `supabase link --project-ref <your-ref>`
