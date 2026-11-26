# Prevent partial student creation during imports and lesson scheduling

## Resume here

Read this block first when you continue this plan in a new conversation.

- **Plan status:** the overall status of this plan is recorded only in [`docs/plans/index.csv`](../index.csv).
- **Current stage:** not started. F2 in the [repository restructure plan](../repository/directory-restructure.md) is done (2026-11-26), but that does not start this plan: it starts by an owner decision, after the restructure. The first subtask is 1.1 (design review).
- **Origin:** split on 2026-11-24 out of the restructure plan's F1. That plan keeps only the narrow org-isolation fix of the four link writes. This plan owns the reliability work. The evidence gathered there is moved here, not copied. Its history stays in that plan's Progress log.
- **GitHub issue:** [#63](https://github.com/yosefshaked/Reinex/issues/63), opened on 2026-11-24 with a permanent link to this plan at `d0aeaf3`.
- **Last update:** 2026-11-26. F2 done; the start waits for the owner, after the restructure. The plan stays `planned`.

---

## Goal

Three user operations either succeed completely or leave no trace:
- importing one customer record;
- creating a lesson template;
- assigning a waiting-list entry to a free place.

The user always learns the real outcome, even when a response is lost.

## Decisions already taken (owner, 2026-11-24)

1. **Order.** F2 in the restructure plan (the support code must point to a saved `error_events` record) is done **before** this plan's implementation. After F2, work continues here.
2. **All or nothing.** In the three operations the business operation succeeds in full.
   - A failure leaves no new student and no partial change.
   - Records that existed before the operation are kept.
   - Leaving a new student, or some of the links, for a retry to finish was rejected.
3. **A lost response.** If the response is lost, the UI asks for the outcome of **that specific operation** and updates the user.
   - Success is shown only once it is verified.
   - A retry never creates a duplicate.
   - A different request is never mistaken for an earlier success.
4. **Measurement.** It must be possible to see a failed attempt followed by a success with the same input.
   - The evidence of the failure must survive the rollback.
   - The input fingerprint of the success must be stored at the time of the success.
5. **F3 (blocking error tracking in CI)** stays approved. Since 2026-11-26 it is the deferred plan [`api/strict-error-tracking.md`](../api/strict-error-tracking.md). It is not part of this plan.

## Subtasks

- [x] 0.1 Done on 2026-11-24: [#63](https://github.com/yosefshaked/Reinex/issues/63). When this plan is on GitHub at a stable link, open one issue titled "Prevent partial student creation during imports and lesson scheduling". The body has a short example of the failure, the outcome the user should get, and a link to this plan. Then add the issue link to "Resume here". The owner pushed `d0aeaf3`; before opening, a search found no duplicate (#35 covers the broader import migration, not partial writes).
- [ ] 1.1 Design review of the [proposed solution](#f17-proposed-solution-one-database-transaction-per-user-operation) against the decisions above. Points the review must settle:
  - **Operation identity.** Decision 3 needs a per-operation id that the UI creates and the server stores with the result, so that the UI can ask for that operation's outcome. The earlier `already_applied` idea and the earlier "accept a 409 on a lost direct create" option are both superseded by decision 3.
  - **The success fingerprint (decision 4)** is stored in the same transaction as the success. The earlier idea of computing the import fingerprint again from `candidate_data` later is superseded.
  - **The scope** of the three RPCs and of removing `ensureStudentForClientProfile`.
- [ ] 1.2 Write the tests first (acceptance below), against the local `automatic-tester` stack only.
- [ ] 1.3 Implement, path by path: import, template create, capacity assign.
- [ ] 1.4 The UI: query the operation's outcome after a lost response, and show success only once verified.
- [ ] 1.5 Update the domain docs (`docs/project-rules/30`, `40`, `60`) under "Keep documentation current".
- [ ] 1.6 **Joint review.** Set this plan to `completed` in `index.csv`.

## Acceptance

Proved against local PostgreSQL. The method is in [F1.8](#f18-proof-against-the-local-postgresql-the-automatic-tester-stack); it must also show what the user receives.

- **A failure after an early write** leaves the business data exactly as it was, and records that existed before are kept. This applies to each of the three operations.
- **A successful attempt completes once.** Repeating it, or retrying it, writes nothing more.
- **Another organisation's data** stays unchanged, row by row.
- **Cases raised in review, each with its own test:**
  1. **The response is lost on the last record that closed the import.** The workspace status flips to `committed` in that request. The UI must learn that the record and the workspace were committed, without committing anything twice.
  2. **A late failure mark after a concurrent success.** One request fails after another request has already committed the same candidate or entry. The failing request must not overwrite the success; today's unconditional `status = 'failed'` update would. It may record its failure evidence, but the business state stays committed.
  3. **Two requests for one free place:** exactly one gets the place. The other gets a clear outcome and writes nothing.
  4. **Two requests that create conflicting templates:** exactly one template is created. The other gets the conflict and writes nothing, including no student.
- **Measurement:** a failed attempt followed by a successful one with the same input can be found by operation and fingerprint, after the rollback.

## Progress log

- **2026-11-24, plan created.** Moved from the restructure plan's stage 3F (F1.1–F1.9) when the owner split the narrow isolation fix from this reliability work. Nothing is implemented yet. The design in the moved sections predates decisions 3 and 4, and subtask 1.1 reconciles it with them.

- **2026-11-24, issue opened.** [#63](https://github.com/yosefshaked/Reinex/issues/63): "Prevent partial student creation during imports and lesson scheduling". It has one failure example (a template from a waiting-list entry with a missing required form), the expected result for the user, and the permanent plan link at `d0aeaf3`. Before opening, the open and closed issues were searched for a duplicate.

---

## Evidence and design moved from the restructure plan (2026-11-24)

The sections below were written in the restructure plan between 2026-11-24 `a5c3819` and `3bca317`. They are kept here as the starting point for 1.1. Line numbers refer to the commits named in them.

## F1 findings and proposal (for joint review)

**F1.1 The existing explanation [V at `e553f38`]:**
- The comment above the four updates in `api/_shared/client-profiles.js` reads: "Keyed by a profile just read in this organisation, so these touch only its own rows." It was added in #55 (`dce8f2e`).
- **The evidence for it:** the profile is read with `withOrgScope(…, 'client_profiles', scopedOrgId)` earlier in the same function.
- **Why that is not enough:** the comment assumes that no row of another organisation carries the same `client_profile_id`. The four tables have their own `org_id` column [V], and nothing in the update enforces it. Under C1, an ID read in the org does not replace the org filter.
- **Unknown:** any motive beyond that evidence. No commit message or document explains it.

**F1.2 The real flow [V]:**

| Caller | What the user did | What `ensureStudentForClientProfile` does there | What happens on failure today |
|---|---|---|---|
| `api/import-commit-chunk/index.js:159` (`commitCustomer`) | Commits an import whose customer type is "student", after `createOrReuseClientProfile`. A reused profile can already have form submissions, OTP challenges, waiting-list entries or lesson participants. | Creates the student, or returns the existing one, and links those earlier rows. | A returned `error` is thrown. Any throw marks the candidate `failed`, and the user can retry only the failed IDs (the header comment, and the `catch` near line 754). On a retry the import ledger records `link` instead of `create` for the student. |
| `api/lesson-templates/index.js:858` | Creates a fixed lesson template from a waiting-list entry, when the entry has no student yet. | Turns the entry's client profile into a student and links its rows, including that waiting-list entry. Then the entry is marked `matched` (near line 1140); `student_id` is not written there. | Returns `tracked500('failed_to_activate_student_from_waiting_list')`; no template is created. |
| `api/lesson-templates/index.js:894` | Creates a template for a client profile directly, without a waiting-list entry. | As above. | Returns `tracked500('failed_to_create_lesson_template')`. |
| `api/lesson-templates/index.js:1434` | Assigns a waiting-list entry to a template's free place (capacity assign). | Used only when `waitingEntry.student_id` is empty. | Returns `tracked500('failed_to_activate_student_from_waiting_list')`. |

**Today's behaviour in a partial failure.** The four updates sit in a `Promise.all`, and no result's `error` is read.
- A Supabase error comes back as `{ error }`, not as a rejection. A failed update is therefore silent: the student exists, some rows stay unlinked, and the caller receives `created: true` with no sign of a problem.
- A network failure rejects instead. The function then throws after the student was created, and the caller fails as shown in the table.
- **On any retry,** the early exit for an existing student (it returns before the link step) means rows that were left unlinked stay unlinked.
- **The practical effect:** a `lesson_participants` row without `student_id` is missing from everything keyed by student. A waiting-list entry without `student_id` sends the capacity-assign path back through `ensureStudentForClientProfile`, which returns the existing student but still links nothing.

**No second student is possible today, or after the change [V].** `src/lib/setup-sql.js` has `students_client_profile_id_uidx`, UNIQUE ON `students (org_id, client_profile_id)` WHERE `client_profile_id IS NOT NULL`. A concurrent second insert fails, and the function throws.

**F1.3 and F1.4 Proposed solution** *(rejected by the owner on 2026-11-24; kept as history, see "F1 revised" below)*:
1. **One link step, org-scoped.** Move the four updates into an internal `linkClientProfileRowsToStudent(client, orgId, clientProfileId, studentId)`. Each update is:

   `withOrgScope(client, table, orgId).update({ student_id }).eq('client_profile_id', clientProfileId).is('student_id', null)`

   Rows of another org, and rows that already have a student, are never touched.
2. **Read every result.** Use `Promise.allSettled`, so all four are attempted. Collect a table as failed when its Supabase result has an `error` or its promise rejected.
3. **Run the link step on both paths:**
   - after creating the student;
   - on the early exit for an existing student.

   It is safe to repeat because of `student_id IS NULL`. When there is nothing left to link it is a no-op, at the cost of four small updates per call.
4. **What the caller receives in a partial failure:** the function throws `Error('client_profile_link_failed')`, with `failedTables` and the first cause attached.
   - The student stays created. There is no rollback and no new transaction mechanism.
   - Every caller already treats a throw as failure: the import marks the candidate `failed` and allows a retry, and the template paths return a tracked 500 without creating the template.
   - A returned `error` stays reserved for the business cases it already covers (`invalid_client_profile_id`, `client_profile_not_found`).
5. **On a retry after the student was created:** the early exit finds the student, and the link step links the rows that are still unlinked. The function returns the same student with `created: false`. The unique index guarantees there is no second student.
   - **Visible consequence:** the import ledger records `link`, and the template response reports `student_created: false`, for a student that the failed attempt created. Today's behaviour is the same after any throw.
   - **Owner choice:** accept this, or add a follow-up that reports the original creation. The default proposal accepts it.
6. **Also:** replace the comment with one that states the C1 reason, and keep the `scopedOrgId` UUID check.

**How the proof works (Node tests, extending the fake client in `tests/org-scope-reads.test.js`):**
- **The fake client:** it records each write's table, payload and filters, and can be told to return `{ error }` or reject for one table.
- **Correct linking in the authorised org:** two orgs hold rows with the same `client_profile_id` value. After the call:
  - only org A's rows with `student_id IS NULL` carry the new id;
  - org B's rows and org A's already-linked rows are unchanged;
  - each of the four recorded updates carries `org_id = ORG_A`.
- **Partial failure:** `lesson_participants` returns `{ error }`. The call rejects with `client_profile_link_failed` and `failedTables: ['lesson_participants']`. The other three tables are linked, and exactly one student exists.
- **Retry:** a second call with the failure removed returns the same student id with `created: false`, links `lesson_participants`, and still leaves exactly one student in org A.
- **Existing student with leftovers:** the early-exit path links unlinked rows and creates nothing.
- **Network-style rejection:** a rejected promise for one table is reported the same way as an `{ error }` result.
- **Callers:**
  - The existing `org-scope-reads` case (org B's profile from org A gives `client_profile_not_found` and no writes) keeps passing.
  - The success path of a user flow does not change, so no tester scenario is needed (C7 rule). This is reviewed again if the review changes the caller contract.
- **Checks:** `npm run test:finance-calendar` (the test file is in it; the identity changes only by the added tests), `npm run lint:api`, `npm run lint:upsert-conflicts` and `npm run lint:doc-links`.

## F1 revised: each user operation commits whole or not at all (owner decision, 2026-11-24)

**Decision.** The operation must succeed in full during the user's request. Leaving a new student, or some of the links, to be completed by a retry is **rejected**. The proposal above ("F1.3 and F1.4 Proposed solution") is kept only as history.

**What follows from it.** The four links cannot be made atomic on their own. In every path, `ensureStudentForClientProfile` sits in the middle of a longer chain of writes. A later step can fail, or can return a 4xx after the student already exists. So the unit that must be atomic is the **whole user operation**, not the helper.

### F1.6 The operation boundary in each path [V at `a5c3819`]

**Path A: one import record** (`api/import-commit-chunk/index.js`, a `customer` candidate with `customer_type = 'student'`). Writes in order:

| # | Write | Code |
|---|---|---|
| A1 | `client_profiles`: fill-empty update of a linked profile (`link_to_existing`); or, through `createOrReuseClientProfile`, update an existing profile found by identity, or insert a new one | `commitCustomer` ~107-150; `client-profiles.js` ~139-175 |
| A2 | `students` insert (when the profile has no student) | `ensureStudentForClientProfile` |
| A3 | the four links (`form_submissions`, `otp_challenges`, `waiting_list_entries`, `lesson_participants`) | same |
| A4 | `students` update with the note (when `note_text` is set) | `commitCustomer` ~176-187 |
| A5 | `import_commit_ledger` rows, one per resource. Best effort: an error is ignored | `writeLedgerRow` |
| A6 | `import_candidates.status = 'committed'` | chunk loop ~748 |
| on throw | `import_candidates.status = 'failed'`. No reason is stored; the message goes only to `context.log` and the response's `failures[]`. No `error_events` row is written for a candidate failure. | `catch` ~754 |

- **Existed before the request:** the candidate (`ready` or `failed`), possibly the profile (link or reuse), and that profile's earlier rows in the four tables.
- **To undo if a later step fails:** A1–A5. The candidate must end as `failed`, with evidence (F1.9).
- **Example of today's state after a failure.** A new person; A3 fails on `lesson_participants` with a network error.
  - The new `client_profiles` row stays.
  - The new `students` row stays.
  - Three of four tables are linked, and there is no note and no ledger row.
  - The candidate is `failed`.
  - A retry reuses the profile (A1 becomes `update` or `link`) and the student (`link`). The ledger then never says the student was created.

**Path B: create a template** (`POST` in `api/lesson-templates/index.js`), either from a waiting-list entry (`~858`) or for a client profile (`~894`). Writes in order:

| # | Write or exit | Code |
|---|---|---|
| B1 | `ensureStudentForClientProfile`: `students` insert and the four links. The waiting-list entry's `student_id` is set here. | ~858 / ~894 |
| exits after B1 | 409 `duplicate_template_conflict`; 409 `required_form_missing`; **200 `required_form_warnings`** (the UI asks for acknowledgement and sends the request again); 500s | ~932, ~958, ~1006, ~1013 |
| B2 | `lesson_templates` insert (the DB trigger rejects an instructor overlap with 409) | ~1025 |
| B3 | `lesson_template_participants` insert; on error, `rollbackCreatedTemplate` | ~1060 |
| B4 | `client_profiles` reactivation (when the profile was inactive); on error, the template is rolled back | ~1098 |
| B5 | `waiting_list_entries.status = 'matched'` plus metadata; on error, the template and the reactivation are rolled back by hand | ~1140-1185 |
| B6 | tenant audit and `logAuditEvent` | ~1190-1240 |

- **Existed before the request:** the waiting-list entry (`open`), the profile (active or inactive), its earlier rows, and the instructor's other templates.
- **To undo:** B1–B5. B6 is written only after success.
- **Example of today's state after a "failure".** The office creates a template from a waiting-list entry, and a required form gives a warning.
  - The response is 200 with `required_form_warnings` and no template.
  - A new student exists, and the entry carries its `student_id` while its status stays `open`.
  - If the office then cancels, the student and the links stay.
  - Each manual rollback (B3–B5) leaves the student in place.

**Path C: assign a waiting-list entry to a free place** (`PATCH` in `api/lesson-templates/index.js`, with `waiting_list_entry_id`). Writes in order:

| # | Write or exit | Code |
|---|---|---|
| C1 | `ensureStudentForClientProfile`, **only when** `waiting_list_entries.student_id` is empty | ~1434 |
| C2 | `client_profiles` reactivation, when inactive. It runs **before** the later validations. | ~1465 |
| exits after C1/C2 | 400 `invalid_service_id`, `invalid_service_duration`, `invalid_valid_until`, `reactivation_requires_new_valid_range`; 409 availability and conflict; 500s | ~1489-1621 |
| C3 | `lesson_templates` update (the other fields in the same PATCH) | ~1634 |
| C4 | `lesson_template_participants` insert. **On error, C3 is not reverted.** | ~1664 |
| C5 | `waiting_list_entries.status = 'matched'`; on error, C4's rows are deleted, but C3 and C2 are not reverted | ~1683-1708 |
| C6 | participant removals in the same PATCH | ~1714 |
| C7 | `logAuditEvent` | ~1755 |

- **The path where the entry already has `student_id`** skips C1, but C2–C6 are just as non-atomic. It is covered by the same solution.
- **Existed before the request:** the entry (`open`, with or without `student_id`), the profile, the template and its participants.
- **To undo:** C1–C6.
- **Example of today's state after a failure.** The entry has no student, the profile is inactive, and availability returns 409.
  - A new student exists.
  - The entry carries its `student_id`.
  - The profile is now active.
  - The template is unchanged.

  With a C5 failure instead, the template's own field changes (C3) stay, the participant is removed, and the entry stays `open`.

### F1.7 Proposed solution: one database transaction per user operation

**The shape:**
- **Validate first, write last.** Each endpoint keeps its business logic in JavaScript and runs every check that needs no lock *before* any write: conflicts, required forms, availability, service, dates and rates. It then builds the complete set of writes as data.
- **One RPC per operation applies that set in one PostgreSQL transaction.** A PL/pgSQL function runs in a single transaction, so any exception rolls back every write it made. The repository already uses this pattern: `complete_lesson_instance_with_participants`, `cancel_lesson_instance_with_participants` and `cancel_selected_scheduled_participants_and_reconcile_instance`, called through `client.rpc(...)` from `api/_shared/lesson-instance-status.js`.

**Three new functions in `src/lib/setup-sql.js`** (the snapshot only adds functions and grants, so no migration file is needed):

| Function | Applies, in one transaction |
|---|---|
| `commit_import_customer_candidate(p_org_id, p_workspace_id, p_candidate_id, p_actor_user_id, p_plan jsonb)` | lock the candidate row (`FOR UPDATE`), check `status IN ('ready','failed')`; the profile write (A1); ensure the student (A2) and link (A3); the note (A4); the ledger rows (A5, no longer best effort); `status = 'committed'` (A6). Returns the ids and the ledger actions. |
| `create_lesson_template_atomic(p_org_id, p_actor_user_id, p_plan jsonb)` | lock the waiting-list entry and the profile (`FOR UPDATE`), check the entry is still `open`; ensure the student and link (B1); insert the template (B2, the overlap trigger still runs) and its participants (B3); reactivate (B4); mark the entry matched (B5). |
| `assign_waiting_list_entry_to_template(p_org_id, p_actor_user_id, p_template_id, p_plan jsonb)` | lock the template, the entry and the profile; recheck that the entry is `open` and the template's capacity under the lock; ensure the student only when the entry has none (C1); reactivate (C2); update the template (C3); add (C4) and remove (C6) participants; mark the entry matched (C5). |

**Ensuring the student and the links** becomes one shared internal SQL function, `ensure_student_and_link_client_profile_rows(p_org_id, p_client_profile_id)`. The three functions call it. Every statement in it filters on `org_id = p_org_id` (C1 in SQL), and the links keep `client_profile_id = …` and `student_id IS NULL`. The JavaScript helper `ensureStudentForClientProfile` is removed, so there is one path, not two. Its other read callers, if any are found at implementation time, are listed for review first.

**Organisation isolation and authorisation:**
- The endpoints keep authorisation exactly as today: bearer token, `ensureMembership` with a stop on `null`, then the role checks. They pass only the authorised `orgId` and `userId` into the RPC.
- Inside each function, every read, insert, update and delete filters by, or sets, `p_org_id`. A row of another org is "not found" and raises an error that rolls the transaction back.
- **Grants:** `REVOKE ALL … FROM PUBLIC, anon, authenticated` and `GRANT EXECUTE … TO service_role` only. The functions are **not** `SECURITY DEFINER`.
  - *Finding:* the three existing lesson RPCs revoke only `authenticated` and leave the default `PUBLIC` grant. That is outside F1 and is recorded as an open item for a separate fix.
- `onConflict` contracts are unaffected (no new upserts). `lint:sql` covers the new functions.

**What the caller and the user get:**
- **Success:** the same response shapes as today.
- **Any failure inside the function:** nothing is written. The endpoint returns its existing error (4xx for business codes raised in SQL, mapped from the exception code; a tracked 500 otherwise).
- **For the import,** the candidate ends as `failed` in a separate write after the rollback, with the failure evidence (F1.9). The chunk still returns 200 with `failures[]`.

**Two concurrent requests:**
- Each function takes its row locks (`FOR UPDATE`) in a fixed order: candidate or entry, then profile, then template.
- The second request waits, then sees the first request's committed state: the candidate is `committed`, or the entry is `matched`, or the student exists. It returns the matching outcome and writes nothing twice.
- The unique index `students (org_id, client_profile_id)` remains the last guard against a second student.
- **Not covered today:** the duplicate-student template check, which is JavaScript only; only the instructor overlap is a DB trigger. Under the template lock it becomes a recheck inside the function.

**A retry after the server committed but the response was lost:**
- **Import:** the candidate is `committed` in the same transaction, so a retry returns `already_committed` (existing behaviour). The ledger shows the real actions once.
- **Waiting-list paths (B from an entry, and C):** the entry is `matched`, with `matched_template_id` and `matched_by_user_id` in its metadata. **Proposed:** when the same user repeats the same operation on an entry that is already matched to the same template, return the existing result with `already_applied: true` instead of 409 `waiting_list_entry_not_open`.
- **A direct template create (B without an entry):** there is no natural key. A retry gets 409 `duplicate_template_conflict` with `conflicting_template_id`, so nothing is written twice, but the user sees a conflict instead of a success. A full fix needs a client request id (`Idempotency-Key`), which means a frontend change and somewhere to store the key. **This is outside F1 as defined and needs owner approval (F1-Q2).**

**Scope, for approval (F1-Q1).** This is wider than F1 as defined (four writes in one helper). It touches:
- `src/lib/setup-sql.js` (4 functions with their grants);
- `api/import-commit-chunk/index.js` (`commitCustomer` builds a plan; the profile matching stays in JavaScript);
- `api/lesson-templates/index.js` (POST and the capacity-assign PATCH are reordered to validate first; the manual rollbacks are removed);
- `api/_shared/client-profiles.js` (the helper is removed or reduced to building the plan);
- the docs `40`, `60` and `30` (the new atomic pattern, under D8).

The rest of each endpoint's behaviour, and the frontend, do not change, except for `already_applied`. Two alternatives were considered and rejected:
- **Compensating JavaScript rollbacks:** they cannot cover a crash or timeout between steps, and they repeat today's partial rollbacks.
- **Moving only the four links into SQL:** it does not meet the decision, because the student would still survive a later failure.

### F1.8 Proof against the local PostgreSQL (the `automatic-tester` stack)

**Where.** New integration tests in `tests/integration/f1-atomic-student.test.js`, run directly (`node --test …`).
- They need the running local stack. They refuse to run unless `SUPABASE_URL` is `http://127.0.0.1:54321`, so production is never touched.
- They read the local keys from the environment at run time and never print them.
- Each test creates its own two orgs, a user with membership in org A, profiles and rows, and removes them at the end.

**A deliberate failure after an early write.** The test installs a temporary trigger, named per test run, on one late table: for example on `waiting_list_entries` (`BEFORE UPDATE … WHEN NEW.status = 'matched'`) for paths B and C, and on `import_commit_ledger` for path A. The trigger raises an exception for that test's row only, so earlier statements in the function, such as the student insert and the links, have already run when the error comes. The test drops the trigger afterwards. This is run against the local stack only, through `psql` in the `supabase_db_automatic-tester` container.

**Assertions, for each path:**
1. **Failure leaves the business data as it was.** After the failed call, compare before and after snapshots of:
   - the students for the profile;
   - the four link tables;
   - the profile's `is_active`, `onboarding_status` and `metadata`;
   - the template and its participants;
   - the waiting-list entry;
   - the candidate's profile and ledger rows.

   They must be identical. The only allowed change is the import candidate's `status = 'failed'`.
2. **What existed before the request is kept:** a pre-existing profile, earlier rows already linked to another student, and the entry's `student_id` in the "already has a student" case of path C.
3. **A successful attempt (trigger dropped) completes once:**
   - exactly one student for the profile;
   - all four tables linked in org A;
   - one template or participant;
   - the entry `matched`;
   - the ledger with `create` for the student.

   Calling again gives `already_committed`, or `already_applied`, with no new rows.
4. **Isolation:** org B holds rows with the same `client_profile_id` value, and a waiting-list entry and a template of its own. A row-by-row snapshot before and after both attempts is identical.
5. **Concurrency:** two simultaneous calls for the same candidate or entry end with one success, one "already" outcome, and one student.

**What the user receives.** Each path is also driven through its HTTP handler: the function's default export, imported and called with a request built from a real local auth token, against the local DB.
- **Path A** (`import-commit-chunk`): the failed attempt returns 200 with the candidate in `failures[]` and `outcome: 'failed'`. The retry returns `outcome: 'committed'`, and `GET` on the workspace shows the candidate as committed.
- **Path C** (`lesson-templates` PATCH): the failed attempt returns a tracked 500 with an `error_id`. Under F2, that code points to a saved `error_events` row; F1 asserts the row exists. The retry returns 200 with the participant and the entry `matched`.
- **Path B** is covered at the RPC level, plus one handler test for the `required_form_warnings` 200: no rows at all are written, because validation now runs first.

**Also:**
- the Node unit tests for the plan builders (pure functions) in `tests/`;
- a tester scenario (`tests/automatic-tester/scripts/`) for the waiting-list-to-template flow, because the user-visible behaviour on warnings and failures changes (C7 rule);
- `npm run lint:sql`, `lint:api`, `lint:upsert-conflicts`, `test:finance-calendar`, `lint:doc-links`.

### F1.9 Measuring a failed first attempt and a successful retry

**What exists today [V]:**
- **Template paths:** a 500 goes through `tracked500`, so an `error_events` row exists, with `route`, `org_id`, `actor_user_id`, `metadata` (jsonb), and a 90-day retention. Success writes a tenant audit and `logAuditEvent`.
- **Import:**
  - a candidate failure writes **no** `error_events` row; it goes to `context.log` and the response only;
  - `import_candidates.status` is overwritten from `failed` to `committed`, and no reason or attempt count is kept;
  - `import_commit_ledger` records only the actions that were saved (and stays so).
- Nothing links one failed attempt to a later one.

**The smallest addition proposed** (no new table, no new column):
1. **Correlation metadata** on every failure and success record of the three operations:
   - `operation`: `import.customer_commit`, `lesson_template.create`, or `lesson_template.assign_waiting_list`;
   - `operation_key`: the candidate id; the waiting-list entry id, or the client profile id for a direct create; or the template id plus the entry id;
   - `input_fingerprint`: a SHA-256 of the normalised input the operation acted on (the candidate's `candidate_data` and `decisions`, or the relevant request fields).
2. **Failure evidence that survives the rollback.** After the RPC fails, the endpoint writes an `error_events` row outside the rolled-back transaction, through the shared tracking helpers, with that metadata and the failed step. For import candidates this is new: one row per failed candidate, with the chunk still returning 200.
3. **Success evidence:**
   - **Templates:** the existing audit rows get the same three fields.
   - **Import:** none is needed. The ledger already carries `candidate_id`, and `candidate_data` at commit time gives the fingerprint again. The business ledger keeps describing only what was saved.
4. **The measurement.** For each `operation_key`, count failure events followed by a success:
   - same fingerprint: **a retry with the same input**;
   - different fingerprint: **the user corrected the data**.

   This is a read-only query for the system-admin error view or for an ad-hoc report.

**Limits:**
- `error_events` keep 90 days.
- A failure before the client exists cannot be tracked (the C2 exemption).
- A user who edits the data and is then rejected by validation (4xx, no RPC call) is not counted as a failure. Tracking 4xx is outside the C2 rule.
- The success record depends on F2 being in place, so that the code the user sees is always saved.

### Open questions for the owner (F1)

- **F1-Q1:** approve the widened scope in F1.7: three atomic RPCs, validate first, and the helper removed.
- **F1-Q2:** idempotency for a direct template create. Accept a 409 with `conflicting_template_id` on a lost-response retry, or add an `Idempotency-Key` (frontend and storage).
- **F1-Q3:** approve the `already_applied` replay response on the waiting-list paths.
- **F1-Q4:** order against F2. F1's handler tests assert the `error_events` row, which F2 guarantees. The proposal is to do F2 before F1.5, or to accept that F1 asserts the row only when the insert succeeded.

## Status of the moved open questions (2026-11-24)

- **F1-Q1 (scope):** open; settled in subtask 1.1.
- **F1-Q2 (idempotency of a direct create)** and **F1-Q3 (`already_applied`):** superseded by decision 3 (an outcome query per operation).
- **F1-Q4 (F2 first):** decided. F2 is done before this plan's implementation (decision 1).
