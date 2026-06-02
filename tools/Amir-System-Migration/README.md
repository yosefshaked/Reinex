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

## Notes

- Run this on Windows.
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
python .\tools\Amir-System-Migration\migration_cli.py run all --mdb C:\path\to\legacy.mdb
```

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