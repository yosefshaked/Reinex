# Amir System Migration

Small discovery helper for the legacy Access `.mdb` file.

For day-to-day work, use the job CLI in `migration_cli.py`.

## What it does

- lists tables and saved queries
- prints columns for a table or query
- prints sample rows for a table or query
- surfaces duplicate `RiderParents` rows by `RiderId`

## Usage

```powershell
python .\tools\Amir-System-Migration\inspect_access_mdb.py list C:\path\to\legacy.mdb --password your-password
python .\tools\Amir-System-Migration\inspect_access_mdb.py count C:\path\to\legacy.mdb --password your-password Riders
python .\tools\Amir-System-Migration\inspect_access_mdb.py columns C:\path\to\legacy.mdb --password your-password Riders
python .\tools\Amir-System-Migration\inspect_access_mdb.py sample C:\path\to\legacy.mdb --password your-password RiderParents --rows 5
python .\tools\Amir-System-Migration\inspect_access_mdb.py compare-rider-parents C:\path\to\legacy.mdb --password your-password --rider-id 12345
```

## Prerequisites

- Run this on **Windows** with Python 3.
- Install the `pywin32` dependency (provides `win32com`) for the Python you run this with:

  ```powershell
  python -m pip install -r tools/Amir-System-Migration/requirements.txt
  # or simply:  python -m pip install pywin32
  ```

  > If you see `ModuleNotFoundError: No module named 'win32com'`, this step was skipped —
  > or you installed it for a different Python than the launcher uses.

## Notes

- The script tries `Microsoft.ACE.OLEDB.12.0` first, then `Microsoft.Jet.OLEDB.4.0`.
- If both providers are unavailable, install the Access Database Engine.

## Suggested next commands for this migration

Run these first and share the outputs:

```powershell
python .\tools\Amir-System-Migration\inspect_access_mdb.py columns C:\path\to\legacy.mdb --password your-password Riders
python .\tools\Amir-System-Migration\inspect_access_mdb.py columns C:\path\to\legacy.mdb --password your-password RiderParents
python .\tools\Amir-System-Migration\inspect_access_mdb.py count C:\path\to\legacy.mdb --password your-password Riders
python .\tools\Amir-System-Migration\inspect_access_mdb.py count C:\path\to\legacy.mdb --password your-password RiderParents
python .\tools\Amir-System-Migration\inspect_access_mdb.py compare-rider-parents C:\path\to\legacy.mdb --password your-password --rows 20000 --json
python .\tools\Amir-System-Migration\inspect_access_mdb.py sample C:\path\to\legacy.mdb --password your-password Riders --rows 10 --json
python .\tools\Amir-System-Migration\inspect_access_mdb.py sample C:\path\to\legacy.mdb --password your-password RiderParents --rows 20 --json
```

## Easy job CLI (recommended)

### Interactive wizard

```powershell
python .\tools\Amir-System-Migration\migration_cli.py wizard
```

Or with MDB path prefilled:

```powershell
python .\tools\Amir-System-Migration\migration_cli.py wizard --mdb C:\path\to\legacy.mdb
```

PowerShell launcher equivalent:

```powershell
.\tools\Amir-System-Migration\run-migration-cli.ps1 -Mode wizard -MdbPath C:\path\to\legacy.mdb
```

Menu-first launcher (recommended):

```powershell
.\tools\Amir-System-Migration\run-migration-cli.ps1
```

This now shows:

- `wizard`
- `run`
- `summarize-report`

Notes:

- The launcher now pauses before closing by default, so you can read messages.
- Default report folder is always `tools/Amir-System-Migration/output` (next to the launcher).
- Add `-NoPause` if you run from an existing terminal and do not want the pause.

### Non-interactive jobs

```powershell
python .\tools\Amir-System-Migration\migration_cli.py run inventory --mdb C:\path\to\legacy.mdb
python .\tools\Amir-System-Migration\migration_cli.py run riders-core --mdb C:\path\to\legacy.mdb
python .\tools\Amir-System-Migration\migration_cli.py run lessons-candidates --mdb C:\path\to\legacy.mdb
python .\tools\Amir-System-Migration\migration_cli.py run extract --mdb C:\path\to\legacy.mdb
python .\tools\Amir-System-Migration\migration_cli.py run all --mdb C:\path\to\legacy.mdb
```

### Extract import-ready CSVs (`extract` job)

The `extract` job is the one that produces files you upload straight into the app's
**Import Workspaces** screen. It writes **one full CSV per table** (every row, every
column) to the output folder, encoded UTF-8 with a BOM so Hebrew survives in both Excel
and the import parser.

```powershell
# Default: Riders + RiderParents
python .\tools\Amir-System-Migration\migration_cli.py run extract --mdb C:\path\to\legacy.mdb

# Custom set of tables
python .\tools\Amir-System-Migration\migration_cli.py run extract --mdb C:\path\to\legacy.mdb --tables Riders,RiderParents,OrgRiders
```

PowerShell launcher equivalent:

```powershell
.\tools\Amir-System-Migration\run-migration-cli.ps1 -Mode run -Job extract -MdbPath C:\path\to\legacy.mdb
.\tools\Amir-System-Migration\run-migration-cli.ps1 -Mode run -Job extract -MdbPath C:\path\to\legacy.mdb -Tables "Riders,RiderParents"
```

What you get:

- `YYYYMMDD-HHMMSS_Riders.csv`, `YYYYMMDD-HHMMSS_RiderParents.csv`, … (the data) in the
  output folder.
- A matching `…_extract.json` **manifest** that records only row counts, column names,
  and file paths — **no row content** — so it is safe to share.

How it maps to the import:

1. Create one **Import Workspace** and upload **both** CSVs to it (two sources).
2. Map the **riders** CSV to the **`customer`** entity (first name / last name / id /
   phone / email / date of birth; set `customer_type` to *student* and `is_active`
   either by column or as a fixed value).
3. Map the **rider-parents** CSV to **`guardian`** and **`guardian_link`**. For the link,
   join the two sources on the shared rider key (e.g. `RiderId`) so the parent resolves
   to the correct student's identity number — the import never joins by row position.
4. Review, dry-run, and commit from the app. The columns are mapped in the UI, so the
   extract intentionally keeps the raw legacy column names rather than guessing them.

`lessons-candidates` now includes `recommended_lesson_source` in the JSON report, prioritizing:

1. `qryRiderLessonsDiary`
2. `qryRidersLessonsDiary`
3. `qryRiderLessons`
4. `qryLessonsList`
5. `qryMasterLessons`

PowerShell launcher equivalent:

```powershell
.\tools\Amir-System-Migration\run-migration-cli.ps1 -Mode run -Job riders-core -MdbPath C:\path\to\legacy.mdb
```

### Summarize an existing report (safe sharing)

If you moved the full report to a safe location, create a compact summary that keeps counts and column names but drops raw row content:

```powershell
python .\tools\Amir-System-Migration\migration_cli.py summarize-report --report C:\safe\path\report.json
```

Write to file:

```powershell
python .\tools\Amir-System-Migration\migration_cli.py summarize-report --report C:\safe\path\report.json --output C:\safe\path\report-summary.json
```

PowerShell launcher equivalent:

```powershell
.\tools\Amir-System-Migration\run-migration-cli.ps1 -Mode summarize-report -ReportPath C:\safe\path\report.json -SummaryOutput C:\safe\path\report-summary.json
```

Use an environment variable instead of typing password each time:

```powershell
$env:MDB_PASSWORD = "your-password"
python .\tools\Amir-System-Migration\migration_cli.py run all --mdb C:\path\to\legacy.mdb --password-env MDB_PASSWORD
```

Reports are written to:

- `tools/Amir-System-Migration/output`

Each report includes:

- provider used
- job name and timestamp
- read-only flag
- sha256 of report payload

Equivalent single job:

```powershell
python .\tools\Amir-System-Migration\migration_cli.py run riders-core --mdb C:\path\to\legacy.mdb
```