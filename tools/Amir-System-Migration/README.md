# Amir System Migration

Small discovery helper for the legacy Access `.mdb` file.

For day-to-day work, use the job CLI in `migration_cli.py`.

## What it does

- lists tables and saved queries
- prints columns for a table or query
- prints sample rows for a table or query
- surfaces duplicate `RiderParents` rows by `RiderId`
- builds a complete, checksummed migration bundle with normalized relationship CSVs

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
- Install the tool dependencies (`pywin32` for Access COM and `tzdata` for historical
  `Asia/Jerusalem` daylight-saving conversion) for the Python you run this with:

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
python .\tools\Amir-System-Migration\migration_cli.py run bundle --mdb C:\path\to\legacy.mdb
python .\tools\Amir-System-Migration\migration_cli.py run all --mdb C:\path\to\legacy.mdb
```

### Raw CSV extraction (`extract` job)

The `extract` job writes **one complete CSV per requested table or saved query** (every
row, every column). It is useful for ad-hoc inspection and mapping. For the actual Amir
migration, prefer `bundle`: a raw `RiderParents` row contains both a father and a mother,
so mapping that raw file as one guardian entity is not lossless.

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
  checksums, and relative file names — **no row content or absolute MDB path**.

The raw riders file can be mapped to a customer. Do not map raw `RiderParents` directly
unless you intentionally want only one of its two parent column groups.

### Reinex migration bundle (`bundle` job, recommended)

```powershell
python .\tools\Amir-System-Migration\migration_cli.py run bundle --mdb C:\path\to\legacy.mdb

# Only when automatic lesson-source selection needs a manual override
python .\tools\Amir-System-Migration\migration_cli.py run bundle --mdb C:\path\to\legacy.mdb --lesson-source qryRiderLessons

.\tools\Amir-System-Migration\run-migration-cli.ps1 -Mode run -Job bundle -MdbPath C:\path\to\legacy.mdb
```

The bundle produces a timestamped folder and ZIP containing:

- `manifest.json`: source fingerprint, row counts, field names, checksums, relationships,
  compatibility flags, and validation totals; it contains no row values or local path.
- `raw/*.csv`: complete source objects, retained so no source fields are lost.
- `normalized/customers.csv`: one row per rider.
- `normalized/guardians.csv`: father and mother are expanded into separate rows.
- `normalized/guardian_links.csv`: explicit guardian-to-student relationships.
- `normalized/services.csv`: service suggestions from lesson sections/history.
- `normalized/lessons.csv`, `lesson_participants.csv`, and `instructors.csv`: linked
  historical and future operational data, including explicit source IDs and status suggestions.

How it maps to the current Import Workspace:

1. Create one workspace and upload the seven normalized CSVs individually: customers,
   guardians, guardian links, services, instructors, lessons, and lesson participants.
   ZIP upload is not supported yet.
2. Map each file to its matching entity; headers already use the canonical field names.
3. Review all warnings, especially missing/duplicate identities, missing parent contacts,
   name/surname suggestions, and orphan relationships. Amir usually stores only a parent's
   first name; the bundle suggests the student's family name in a separately labeled field
   so it can be reviewed. Nothing is committed automatically.
   Legacy identity `0` placeholders become empty, and eight-digit numeric identities get
   a leading-zero suggestion; the original value and normalization action remain in the CSV.
   Recognized birth dates are exported as date-only `YYYY-MM-DD` values; unrecognized
   formats are preserved for explicit correction in the Import Workspace.
4. Review service durations before commit; the legacy source does not provide them.
   Instructors commit before lessons, and lessons before participants. A new imported
   instructor has no user account or service capabilities; future lessons require the
   linked/imported instructor to be active.
5. The extractor labels its attendance inference and preserves the original attendance
   note. Historical inferred attendance remains deferred metadata in Reinex while its live
   participant status stays `scheduled`, until historical finance/payroll behavior is
   designed. Future lessons enter the normal scheduled-attendance workflow.
6. Past imported lessons are excluded from pending-report queues. Future imported lessons
   become eligible normally after they occur.

`lessons-candidates` selects by relationship quality first (`RiderId`, `RecordId`, then
`WorkerID`, date, time, and service fields), followed by row count. This prevents a
human-readable diary query with no rider identifier from being selected over a usable
relational query.

PowerShell launcher equivalent:

```powershell
.\tools\Amir-System-Migration\run-migration-cli.ps1 -Mode run -Job riders-core -MdbPath C:\path\to\legacy.mdb
```

### Summarize an existing report (safe sharing)

Discovery reports contain sample row values and therefore personal data. Create a compact
summary that keeps counts and column names but drops raw row content before sharing:

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

This directory is ignored by Git. Treat all CSV/ZIP files in it as sensitive. Metadata-only
extract/bundle manifests are designed for sharing; discovery and failure reports are not.

Each report includes:

- provider used
- job name and timestamp
- read-only flag
- sha256 of report payload

Equivalent single job:

```powershell
python .\tools\Amir-System-Migration\migration_cli.py run riders-core --mdb C:\path\to\legacy.mdb
```
