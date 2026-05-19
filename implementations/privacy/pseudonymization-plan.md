# Pseudonymization (Right to be Forgotten) — Architecture Blueprint

**Status:** Specification locked — implementation approved (Encrypted Bucket model, revised 2026-05-04c).  
**Scope:** Backend endpoint, data model changes, read-layer contract, guardian edge case, UI sketch.

---

## 1. Goals & Compliance Context

Israeli Privacy Protection Law (תשמ"א–1981) and its 2023 reform require data controllers to erase or anonymize personal data on a verified subject access / erasure request, subject to retention obligations.

We cannot delete historical financial and attendance records (legal retention requirement). The solution is **Searchable Encrypted-Bucket Pseudonymization**: collect all sensitive fields into a single JSON object, AES-256-GCM-encrypt the serialized string, and store the ciphertext in a single `pii_encrypted_data text` column. The original sensitive columns are NULLed. `first_name` and `last_name` remain plaintext on all tables, so students stay visible and searchable in rosters, lesson reports, and financial logs. The encrypted bucket preserves re-identification capability for court orders or regulatory access.

---

## 2. Affected Data

### 2.1 Primary PII tables

**Encrypted Bucket strategy:** All sensitive fields per table are collected into a single JSON object, serialized, and encrypted as one AES-256-GCM ciphertext stored in `pii_encrypted_data text`. Original sensitive columns are NULLed. Existing column types are never changed.

| Table | Plaintext (retained, untouched) | Bucketed into `pii_encrypted_data` |
|---|---|---|
| `students` | `medical_flags`, `special_rate`, `created_at`, `updated_at` | `notes_internal`, `medical_provider`, `metadata` |
| `client_profiles` | `first_name`, `middle_name`, `last_name`, `default_notification_method`, `tags`, `onboarding_status`, `is_active`, `created_at`, `updated_at` | `identity_number`, `phone`, `email`, `date_of_birth`, `metadata` |
| `guardians` | `first_name`, `middle_name`, `last_name`, `created_at` | `phone`, `email`, `metadata` |

> **Searchability:** Names stay plaintext on all three tables. Records remain findable by name in rosters, lesson reports, and financial audit logs after anonymization.

> **Schema verified 2026-05-04c** — exact column names confirmed from `CREATE TABLE` definitions in `setup-sql.js`:
> - `students`: `notes_internal text`, `medical_provider text`, `metadata jsonb`. No name columns.
> - `client_profiles`: `identity_number text`, `phone text`, `email text`, `date_of_birth date`, `metadata jsonb`. **No `address_line1`** — column does not exist, never did.
> - `guardians`: `phone text`, `email text`, `metadata jsonb`.
> - `date_of_birth` stays `date`. `metadata` stays `jsonb`. Neither column type is changed.
> - `client_profiles.tags` — org-controlled taxonomy, not PII, excluded.
> - `client_profiles.onboarding_status` / `is_active` — operational state, excluded.

### 2.2 Junction / link tables (NOT encrypted, NOT deleted)

| Table | Action |
|---|---|
| `client_guardians` | Preserved; links `client_profile_id ↔ guardian_id`. Guardian anonymization is governed by section 5. |
| `lesson_participants` | Not touched — student_id FK intact for audit/billing. |
| `ledger_transactions` | Not touched — financial retention obligation. |
| `calendar_lesson_instances` | Not touched. |
| `form_submissions` | Out of scope MVP (see section 11). |
| `documents` | Out of scope MVP (see section 11). |

### 2.3 New schema columns

Migrations applied in `src/lib/setup-sql.js` (patches 2026-05-04 and 2026-05-04b):

```sql
-- Patch 2026-05-04:  privacy_status text NOT NULL DEFAULT 'active' on students + client_profiles
--                    INDEX (org_id, privacy_status) on both tables
-- Patch 2026-05-04b: ADD COLUMN pii_encrypted_data text NULL on students, client_profiles, guardians
```

> `privacy_status` is NOT added to `guardians` — their anonymization is a side-effect of the linked student's request (see section 5).
> No existing column types are altered. `date_of_birth` remains `date`. `metadata` remains `jsonb`.

---

## 3. Encryption Scheme

### 3.1 Algorithm

- **Algorithm:** `aes-256-gcm` (Node.js `crypto` built-in)
- **Key:** 32-byte (256-bit) random secret, stored as a 64-character hex string in environment variable `STUDENT_PII_ENCRYPTION_KEY`
- **IV:** 12 random bytes per encryption operation (`crypto.randomBytes(12)`) — **unique per field per call**
- **Auth tag:** 16 bytes, retrieved via `cipher.getAuthTag()` after `cipher.final()`

### 3.2 Stored format

The entire sensitive-field JSON object for a row is encrypted as a **single ciphertext** and stored in `pii_encrypted_data`. Original sensitive columns are NULLed. Stored as a colon-delimited Base64 string:

```
<base64-iv>:<base64-ciphertext>:<base64-authtag>
```

Example bucket payload before encryption:
```json
{ "identity_number": "123456789", "phone": "0501234567", "email": "a@b.com", "date_of_birth": "1990-01-15", "metadata": "{\"key\":\"value\"}" }
```

Fields whose value was already `NULL` at time of anonymization are omitted from the bucket object (no point encrypting nulls). `date_of_birth` is serialized as its ISO string (`date.toISOString().split('T')[0]`) before JSON.stringify. `metadata` (jsonb) arrives from Supabase as a parsed object — JSON.stringify before inclusion.

The read layer checks `privacy_status` to decide masking. The ciphertext in `pii_encrypted_data` is **never returned** to API callers.

### 3.3 Decryption (authorized use only)

```js
// Pseudocode — not production code
const [ivB64, ctB64, tagB64] = storedValue.split(':');
const iv = Buffer.from(ivB64, 'base64');
const ciphertext = Buffer.from(ctB64, 'base64');
const authTag = Buffer.from(tagB64, 'base64');
const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv);
decipher.setAuthTag(authTag);
const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
```

Decryption is only invoked by an explicitly authorized system-admin data-subject-access-request endpoint (out of scope MVP).

### 3.4 Key management

| Stage | Approach |
|---|---|
| MVP | `STUDENT_PII_ENCRYPTION_KEY` env var in `local.settings.json` / Azure Function App Settings |
| Post-MVP | Migrate key to Azure Key Vault. Key is never stored in source control or DB. |

**Key rotation:** Changing `STUDENT_PII_ENCRYPTION_KEY` requires a re-encryption job over all `privacy_status = 'anonymized'` rows. This job is out of scope MVP but must be documented as a prerequisite for key rotation.

**Key loss = permanent data loss.** Azure Key Vault backup is mandatory before any rotation or key deletion.

---

## 4. Eligibility Check

Before executing pseudonymization, the system must verify:

| Check | Pass condition | Error code |
|---|---|---|
| Student exists in org | Row found in `students` with `org_id = orgId` | `student_not_found` |
| Not already anonymized | `students.privacy_status = 'active'` | `already_anonymized` |
| Zero outstanding balance | `snapshot.summary.balance === 0` (agorot — exact zero) | `outstanding_balance` |
| Student is not active | Either policy allows anonymizing active students, OR `is_active = false` on `client_profiles`. See note below. |  `student_is_active` |

**Active student gate — LOCKED:** Option B is enforced. The `client_profiles.is_active` field must be `false` before pseudonymization is permitted. This prevents accidental erasure of currently-enrolled students and creates an explicit paper trail (deactivate first, then request erasure).

Balance check implementation:

```js
// Uses existing helper from api/_shared/student-billing.js
const snapshot = await fetchBillingSnapshot(tenantClient, { orgId, studentId });
if (snapshot.summary.balance !== 0) {
  throw { code: 'outstanding_balance', balance: snapshot.summary.balance };
}
```

---

## 5. Guardian Edge Case

Guardians can be linked to **multiple students** via the `client_guardians` junction table. Three scenarios:

### 5.1 Guardian linked only to this student (sole link)

The guardian has no remaining active links after this student is anonymized.  
**Action:** Encrypt guardian `phone` and `email` only. `first_name`, `middle_name`, `last_name` remain plaintext (same searchability rationale as profiles). Preserve the `client_guardians` junction row (referential integrity).

### 5.2 Guardian linked to multiple students (shared guardian)

The guardian has at least one other `client_profile_id` link that is NOT anonymized.  
**Action:** Do NOT encrypt the guardian row. Document the decision in the audit log. The guardian will be anonymized when the last linked active student is anonymized (cascade policy).

### 5.3 Implementation check

```js
// Pseudocode
const { data: links } = await client
  .from('client_guardians')
  .select('client_profile_id, client_profile:client_profiles(privacy_status)')
  .eq('guardian_id', guardianId)
  .eq('org_id', orgId);

const otherActiveLinks = links.filter(
  (l) => l.client_profile_id !== targetClientProfileId
       && l.client_profile?.privacy_status === 'active'
);

if (otherActiveLinks.length === 0) {
  // encrypt guardian PII
} else {
  // skip — log reason: 'guardian_has_other_active_links'
}
```

---

## 6. Execution Flow

### 6.1 New backend endpoint

**Route:** `POST /api/system-admin-pseudonymize`  
**File:** `api/system-admin-pseudonymize/index.js` + `function.json`  
**Auth:** `ensureSystemAdmin(req, client, authorization, { context })` — AAL2 + `is_system_admin`

### 6.2 Request body

```json
{
  "student_id": "<uuid>",
  "org_id": "<uuid>",
  "reason": "Subject erasure request #2025-04-001",
  "actor_confirmation": "I confirm this action is irreversible"
}
```

### 6.3 Step-by-step execution

1. **Auth** — `ensureSystemAdmin(...)` → `{ userId, email }`
2. **Input validation** — `student_id` and `org_id` are valid UUIDs; `reason` is non-empty string; `actor_confirmation` equals the required phrase exactly.
3. **Load student + profile** — SELECT from `students` JOIN `client_profiles` WHERE `students.id = student_id AND students.org_id = org_id`. 404 if not found.
4. **Eligibility checks** — (see section 4). Return structured 409 errors per check.
5. **Load encryption key** — `Buffer.from(env.STUDENT_PII_ENCRYPTION_KEY, 'hex')`. Return `500 server_misconfigured` if missing or not 64 hex chars.
6. **Build students bucket** — Collect non-null values of `notes_internal`, `medical_provider`, `metadata` into a plain object. `metadata` (jsonb) → JSON.stringify before inclusion. Encrypt the JSON.stringify of the bucket object → ciphertext.
   - UPDATE `students`: `pii_encrypted_data = ciphertext`, NULL out bucketed source columns, `privacy_status = 'anonymized'`.
7. **Build client_profiles bucket** — Collect non-null values of `identity_number`, `phone`, `email`, `date_of_birth`, `metadata`. `date_of_birth` (date object) → `.toISOString().split('T')[0]` string. `metadata` (jsonb) → JSON.stringify. Encrypt the JSON.stringify of the bucket object → ciphertext.
   - UPDATE `client_profiles`: `pii_encrypted_data = ciphertext`, NULL out bucketed source columns, `privacy_status = 'anonymized'`.
   - `first_name` / `last_name` / `middle_name` are **never touched**.
8. **Handle guardians** — For each guardian linked to this `client_profile_id`:
   - Run the sole-link check (section 5).
   - If sole link: collect non-null `phone`, `email`, `metadata` into bucket object. Encrypt → ciphertext.
     UPDATE `guardians`: `pii_encrypted_data = ciphertext`, NULL out source columns.
   - If shared: skip, record `{ guardian_id, reason: 'guardian_has_other_active_links' }` in skipped list.
9. **Audit log** — `logAuditEvent(...)` with `original_name`, `reason`, `guardians_anonymized`, `guardians_skipped`, `partial_failure`.
10. **Respond** — `respond(context, 200, { student_id, status: 'anonymized', partial_failure, guardians_anonymized, guardians_skipped })`

### 6.4 Atomicity

Steps 6–10 are NOT wrapped in a Postgres transaction (Supabase JS client does not expose transactional multi-table UPDATEs without RPCs). To mitigate partial failure:
- Execute in order: `students` → `client_profiles` → each guardian.
- If any step fails after `students` is already updated, the audit log still fires with `partial_failure: true`.
- A compensating "re-attempt" endpoint may re-encrypt already-encrypted fields safely (idempotent: encrypting an already-encrypted value produces a double-encrypted blob — so the endpoint MUST check `privacy_status` before encrypting to prevent this).

**Post-MVP:** Wrap in a Postgres stored procedure or use a Supabase RPC for true atomicity.

---

## 7. Read-Layer Contract

All API endpoints that return student or client_profile data MUST check `privacy_status` and mask accordingly. This is the **most critical change** for system correctness.

### 7.1 Masking rules

When `privacy_status = 'anonymized'`, the source columns are already NULL in the database (NULLed by the anonymize endpoint). The read layer additionally ensures `pii_encrypted_data` is never exposed in API responses.

| Column | Value returned to caller | Notes |
|---|---|---|
| `first_name` | **real value** | Plaintext — never touched |
| `middle_name` | **real value** | Plaintext — never touched |
| `last_name` | **real value** | Plaintext — never touched |
| `identity_number` | `null` | Bucketed and NULLed at source |
| `date_of_birth` | `null` | Bucketed and NULLed at source |
| `phone` | `null` | Bucketed and NULLed at source |
| `email` | `null` | Bucketed and NULLed at source |
| `notes_internal` | `null` | Bucketed and NULLed at source |
| `medical_provider` | `null` | Bucketed and NULLed at source |
| `metadata` | `null` | Bucketed and NULLed at source |
| `pii_encrypted_data` | **never selected** | Omit from all SELECT queries in read endpoints |

Names (`first_name`, `last_name`, `middle_name`) pass through unchanged on all tables. `default_notification_method` is operational state — not bucketed, not masked.

### 7.2 Where to apply

At minimum, masking must be applied in:
- `mergeStudentWithClientProfile()` in `api/students-list/index.js`
- Any endpoint that selects directly from `client_profiles` (e.g., `api/client-profiles/`, calendar endpoints that hydrate participant names)
- The guardian serializer in `api/guardians/index.js`

A shared helper `maskIfAnonymized(profileRow)` should be created in `api/_shared/client-profiles.js` to centralize this logic.

### 7.3 Search impact

Name searches (`first_name`, `last_name`) continue to work on anonymized records — names are plaintext. Sensitive field searches (`phone`, `email`, `identity_number`) will NOT match anonymized records since those columns contain ciphertext.

Anonymized records:
- MUST appear in roster/list endpoints with **their real name**.
- MUST be filterable by `student_id` for billing/attendance purposes.
- Phone/email autocomplete searches will not surface anonymized records — this is correct behavior.

---

## 8. Environment Variable

Add to `api/local.settings.example.json`:

```json
{
  "STUDENT_PII_ENCRYPTION_KEY": "REPLACE_WITH_64_HEX_CHARS_32_RANDOM_BYTES"
}
```

Generate a key: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

---

## 9. UI Plan (to be implemented separately)

A new system-admin module `PrivacyRequestsView.jsx` at route `/system-admin/privacy-requests`.

**Flow:**
1. Admin enters `student_id` (UUID) or searches by name.
2. System performs live eligibility check and shows pass/fail for each gate (balance, active status, already anonymized).
3. If all gates pass: display a confirmation dialog requiring:
   - Admin types the student's full name exactly.
   - Admin enters a reason / ticket reference (e.g., `GDPR-2025-001`).
   - Admin clicks a red "Execute Pseudonymization" button.
4. On success: show success card with summary of what was anonymized. On failure: show structured error.

---

## 10. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Key loss = permanent unrecoverable data | Mandatory Azure Key Vault backup before any key rotation or deletion. Document in runbook. |
| Double-encryption on re-attempt | Endpoint MUST gate on `privacy_status = 'active'` before encrypting. |
| Partial failure (students updated, client_profiles fails) | Audit log records `partial_failure: true`. A recovery endpoint re-checks and re-applies remaining steps. |
| Read-layer misses (new endpoints added later) | `maskIfAnonymized` shared helper + CI lint rule checking that any `client_profiles` select includes `privacy_status`. |
| Guardian still searchable after student anonymized | Sole-link check ensures guardian row is encrypted in the same call. |
| Financial records expose name via JOIN | `ledger_transactions` does not store names — only FK IDs. Read-layer masking covers the join at response-build time. |
| Audit log itself contains PII in `before_state` | Only store `original_name` in audit log as a one-time record for the erasure event. This is compliant: retention of the erasure request itself is legally required. |

---

## 11. Out of Scope — MVP

The following are explicitly excluded from the initial implementation and tracked as follow-up:

- **`form_submissions`** — May contain free-text PII in JSON bodies. Requires field-level schema analysis before masking can be applied safely.
- **`documents`** (Supabase Storage) — Binary files (PDFs, images). Full file deletion or re-upload with redacted content is required. Complex; deferred.
- **Standalone guardian erasure requests** — No direct subject access right for a guardian without an associated student request in current data model. Deferred.
- **Key rotation tooling** — Re-encryption job over all `anonymized` rows when `STUDENT_PII_ENCRYPTION_KEY` changes. Deferred post-MVP.
- **Data Subject Access Request (DSAR) / decryption endpoint** — System-admin endpoint to decrypt and return plaintext for a specific student on court order. Deferred.
- **Bulk / batch anonymization** — Process multiple students in one API call. Deferred.
- **RPC / transactional atomicity** — Single Postgres transaction wrapping all UPDATEs. Deferred; current approach uses ordered sequential UPDATEs with partial-failure logging.

---

## 12. Resolved Decisions (Locked 2026-05-04)

| # | Question | Decision |
|---|---|---|
| 1 | Active student gate | **Option B approved.** `client_profiles.is_active` must be `false` before pseudonymization. |
| 2 | `notes` vs `notes_internal` on `students` | **Schema confirmed:** only `notes_internal` exists. `notes` is a legacy dead column reference in the API. Only `notes_internal` is encrypted. |
| 3 | `client_profiles.metadata` encryption | **Approved (revised 2026-05-04c).** `metadata` is included in the encrypted bucket as a JSON-serialized string. The `metadata` column type stays `jsonb` — it is NULLed after bucket encryption. No type migration. |
| 6 | Pseudonymization model | **Encrypted Bucket model adopted (2026-05-04c).** All sensitive fields per table are collected into a single JSON object, encrypted as one AES-256-GCM ciphertext, stored in `pii_encrypted_data text`. `first_name`/`last_name`/`middle_name` stay plaintext on all tables. No existing column types are changed. `address_line1` does not exist in schema and is excluded. |
| 4 | Audit log storing `original_name` | **Approved.** Retention of the erasure event record (including the pre-anonymization name) is a standard compliance requirement. |
| 5 | Endpoint naming | **`system-admin-pseudonymize`** — consistent with the existing system-admin prefix convention. |
