# Import Workspace Workflow

## Design Principle
The user should be able to upload messy files, work through the import over days, safely commit clean data in chunks, and leave unresolved data in staging without affecting live operations.

## Workspace Lifecycle

### 1. Create Import Workspace
User creates an import workspace for an organization.

Fields:
- name
- source description, for example "Old clinic Excel export"
- intended scope: students, guardians, services, schedules, finance, mixed
- created by user
- status: `draft`

### 2. Upload Files
User uploads one or more files.

Supported first:
- `.xlsx`
- `.csv`

Later:
- Google Sheets import
- zipped multi-file exports
- document metadata files

Raw uploaded `.xlsx` / `.csv` files are not permanent system records. The frontend uploads them directly to Cloudflare R2 using pre-signed URLs for short-term debugging only. The R2 bucket must have a 30-day Lifecycle Rule (TTL) that automatically deletes these raw files.

The durable audit source of truth is `import_rows.raw_data`, not the temporary R2 object. Parsed row JSON must contain enough decoded raw values, normalized values, source labels, and warnings to support mapping, validation, audit, and support review after the R2 object expires.

When a user re-uploads a corrected file, the frontend must generate a new `source_reference` by appending a timestamp or content hash, for example `students.xlsx_1715694200` or `students.xlsx_sha256ab12`. This prevents collisions with the unique `(workspace_id, source_reference, row_index)` import row key.

The upload step accepts multiple files. Every CSV is one source; every non-empty Excel sheet is a separate source labeled with its filename and sheet name. Users can therefore add a student file and a separate parent file, or use separate sheets in one workbook. Each source is mapped and processed independently inside the same workspace.

### 3. Profile Files
System profiles each sheet/file:
- row count
- headers
- likely entity type
- detected languages and aliases
- sample values
- empty columns
- duplicate-looking rows
- invalid phone/date/identity examples

The system should suggest:
- "This sheet looks like active students"
- "This sheet looks like inactive students"
- "This column looks like identity number"
- "This column looks like guardian phone"

No live records are created during profiling.

### 4. Map Columns
User confirms or edits mappings.

Mappings are saved per source reference. Switching from a student sheet to a parent sheet must never overwrite the first sheet's mapping. Parent sources expose first name, last name, phone, and email through the canonical `guardian` candidate fields.

The mapping UI exposes independently enabled collapsible sections for `customer`, `guardian`, `guardian_link`, and `service`. Any combination can be mapped in parallel, and one source row emits one candidate per enabled section. Customer type and active status are mapped or selected inside the customer section. The guardian section uses distinct mapping inputs (`guardian_first_name`, `guardian_last_name`, `guardian_phone`, `guardian_email`) so guardian data cannot be confused with customer fields; the analyzer normalizes these into the canonical guardian record shape.

The customer section also exposes optional `note_text`. It is appended to `students.notes_internal` only after a student customer has been created or reused. The commit records the candidate id in student metadata so retrying a partially completed commit cannot append the same imported note twice. One-time customers do not have a student row, so their note is ignored with a warning. There is no standalone note mapping section for new imports.

The mapping editor shows qualified choices from all uploaded sources at once, for example `students.xlsx · תעודת זהות` and `parents.xlsx · שם פרטי`. If one candidate uses more than one source, the user must choose a join column in every participating source. The system joins by the normalized shared value, records all source-row provenance, and blocks missing or ambiguous matches instead of joining by row number.

A source used only to supply joined fields does not require a separate mapping or analysis pass. It must be ingested so its rows are available to the analyzer, but saving the cross-source mapping advances directly to ingestion instead of forcing the user through every uploaded file.

Mapping features:
- source column to target field
- combine source columns into one target field
- split source column into several target fields, when supported
- fixed values, for example every row in this sheet is `inactive`
- dictionary mappings, for example `פעיל`, `active`, `כן` -> `active`
- skip column
- save mapping template

The mapping UI must show examples from actual rows next to each field.

### 5. Normalize Into Candidate Entities
Mapped rows become candidate entities inside staging:
- candidate customer (client profile, plus a student row when `customer_type = student`)
- candidate guardian
- candidate guardian link
- candidate service mapping

Candidates have normalized fields and validation issues. They are not live rows.

### 6. Analyze And Group Issues
The workspace groups rows into review queues:
- ready customers
- customers needing review
- duplicate candidates
- invalid identity numbers
- invalid or missing phones
- unknown services
- guardian relationship missing
- rows waiting for dependency

The UI should avoid a giant error table. It should present counts and focused queues.

### 7. Resolve Decisions
User resolves issues with durable decisions:
- link candidate to existing live record
- create new live record on commit
- merge duplicate candidates
- skip row
- fix value
- map unknown service to existing service
- create service later

Decisions are stored per import workspace and reusable where safe.

### 8. Dry Run
Before commit, the backend builds a commit plan:
- records to create
- records to update
- records to link
- records to skip
- blocked rows
- irreversible warnings

The dry run must be repeatable and must not mutate live tables.

### 9. Commit In Slices
Commit buttons are scoped:
- Commit ready customers
- Commit guardian links for committed students
- Commit service mappings

Each commit creates an audit trail and marks staged rows/candidates as committed.

Commit chunks must be orchestrated in topological entity order:

1. `customer`
2. `guardian` and `service`
3. `guardian_link`

The frontend must fully finish all chunks of one entity type before starting the next dependent type. Guardian links must never be committed before their related customer and guardian candidates are committed.

### 10. Continue Later
The user can close the workspace at any point. On return, the workspace shows:
- last activity
- committed counts
- remaining review queues
- blocked dependency queues
- next recommended action

## Inactive Student Workflow
Inactive student imports have a separate path:

1. User marks a file/sheet/filter as inactive archive.
2. System validates the full inactive archive policy.
3. Rows with unresolved duplicates or missing minimum fields block the archive commit.
4. User may commit only the clean inactive archive slice.
5. Rows not in the clean slice remain staged and do not create live records.

Minimum inactive archive policy for Phase 1:
- first name
- last name
- at least one stable locator: identity number, phone, email, or explicit accepted duplicate decision
- active state resolved to inactive
- duplicate decision resolved

Inactive committed records:
- are hidden from active roster by default
- do not create schedules
- do not create billing artifacts
- do not trigger required forms
- can be reactivated later through normal student/client flows
