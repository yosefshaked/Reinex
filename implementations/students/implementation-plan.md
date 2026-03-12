# Students Feature — Implementation Plan

**Created:** 2025-01  
**Status:** In Progress  
**Architect:** Reinex AGENTS

---

## Background

Students are the primary base entity in Reinex. They link to lesson templates (schedule), lesson instances (attendance), commitments (financial), forms (documents/medical), and guardians (contacts). This plan brings the student feature to production quality: accurate edit form, proper role permissions, paginated list, and a fully redesigned detail page.

---

## Decisions Recorded

| # | Decision | Detail |
|---|----------|--------|
| 1 | first_name, last_name — mandatory | Always required |
| 2 | identity_number — mandatory + unique | Required for deduplication |
| 3 | date_of_birth — mandatory at creation | Required going forward; existing records may be null until reconciled |
| 4 | phone required if no guardian | API enforces; form shows conditional requirement |
| 5 | default_notification_method = 'whatsapp' | Auto-defaulted |
| 6 | onboarding_status — system-managed | Not user-selectable; driven by form submissions and approvals |
| 7 | Guardian — optional | Can be added later; editing guardian relationships = Phase 2 |
| 8 | Office role — can create and edit students | Both POST and PUT open to `isAdminOrOffice` |
| 9 | Tab structure approved | Overview (dashboard), Schedule, Forms, Financial, Documents, History |
| 10 | Action buttons in dropdown | Single "פעולות" dropdown button; primary action = Edit |
| 11 | Back button at top of page | Redesigned, prominent, at the top of StudentDetailPage |
| 12 | List pagination = server-side | 25/50/100 page sizes |
| 13 | List position memory = sessionStorage | Key: `reinex_students_list_{orgId}` — restored on back-navigation |

---

## Phases

### Phase 1 — Edit Form Fix (IMMEDIATE) ✅ In Progress

**Goal:** Bring EditStudentForm to parity with AddStudentForm.

**Files:**
- `src/features/admin/components/EditStudentForm.jsx`
- `api/students-list/index.js` (role permission only)

**Changes to EditStudentForm:**

| Remove (Legacy) | Add (Reinex) |
|-----------------|--------------|
| `contactName` TextField | `dateOfBirth` TextField type="date" |
| `contactPhone` PhoneField | `notificationMethod` SelectField |
| `defaultService` ComboBoxField | `specialRate` TextField type="number" |
| `defaultDayOfWeek` DayOfWeekField | `notesInternal` TextAreaField |
| `defaultSessionTime` TimeField | `PhoneField` (replaces plain TextField for phone) |
| `useServices` import | Guardian: read-only info block (Phase 2 for editing) |
| `DayOfWeekField`, `TimeField`, `ComboBoxField` imports | |
| `notes` → rename to `notesInternal` field | |

**Validation changes:**
- Remove: `contactPhone` validation, `defaultDayOfWeek` required, `defaultSessionTime` required
- Add: `dateOfBirth` optional (currently); phone optional in edit (guardian state unknown)
- Keep: `firstName`, `lastName`, `identityNumber` required

**Submit payload changes:**
```js
// Remove
contactName, contactPhone, defaultService, defaultDayOfWeek, defaultSessionTime, notes

// Add  
dateOfBirth, notificationMethod, specialRate, notesInternal

// Rename internal
notes → notesInternal (fixes silent data loss bug)
```

**Backend change (api/students-list/index.js):**
```js
// Line ~610 in POST handler, and before PUT handler
// Before:
if (!isAdmin) {
  return respond(context, 403, { message: 'forbidden' });
}

// After:
if (!canManageRoster) {
  return respond(context, 403, { message: 'forbidden' });
}
```
Note: `canManageRoster` = `isAdminOrOffice(role)` — already declared at the top of the handler.

---

### Phase 2 — Guardian Editing in Edit Form

**Goal:** Allow changing or clearing a student's linked guardian from within the edit form.

**Requires:**
1. Students GET endpoint must return linked guardian (join `student_guardians` and `guardians`)
2. `buildStudentUpdates` in students-list API must accept `guardian_id` + `guardian_relationship`
3. PUT handler: after updating student, upsert `student_guardians` (if guardianId provided) or delete primary row (if guardianId = null)
4. EditStudentForm: add back `GuardianSelector` component + conditional `guardianRelationship`

**Not blocking Phase 1.**

---

### Phase 3 — Backend API Enhancements

**Goal:** Server-side pagination + expanded filtering.

**File:** `api/students-list/index.js`

**Changes:**
- GET: add `limit` (default 25, max 100), `offset` (default 0) query params
- GET: return `{ data: [...], total: N, page_size: N, page: N, has_more: bool }` instead of raw array
- GET: add server-side `search` param (full-text on first_name, last_name, identity_number)
- GET: add `tags` filter (array of tag IDs, intersection)
- POST: `date_of_birth` — currently optional in API; defer making it strictly required until UI is updated and existing records are reconciled (see Phase 4 cleanup)

---

### Phase 4 — StudentsPage Pagination + State Memory

**Goal:** Replace full client-side list with paginated server-driven UI.

**File:** `src/features/students/pages/StudentsPage.jsx`

**Changes:**
- Remove heavy client-side filter/sort logic
- Add pagination controls (page size selector: 25/50/100, prev/next buttons)
- Send `search`, `status`, `limit`, `offset`, `tags` to server
- Session state: save `{ page, scrollY, filters, sort }` to `sessionStorage` on unmount / route change
- Restore state on mount if arriving via back-navigation (`history.state` or `navigation.navigationType`)
- Session key: `reinex_students_list_{orgId}`

---

### Phase 5 — StudentDetailPage Full Refactor

**Goal:** Replace monolithic detail page with tabbed dashboard layout.

**File:** `src/features/students/pages/StudentDetailPage.jsx`

**New Layout:**
```
[← חזרה לרשימת תלמידים]   [שם התלמיד]   [פעולות ▾]
─────────────────────────────────────────────────
[Overview] [לוח שנה] [טפסים] [כספים] [מסמכים] [היסטוריה]
─────────────────────────────────────────────────
<tab content>
```

**Action dropdown contents:**
- ✏️ עריכת פרטי תלמיד (opens EditStudentModal — existing)
- 📋 שיבוץ לשיעור קבוע (opens AssignInstructorModal or lesson template form)
- 📄 שליחת טופס
- 🔴 השהיית תלמיד / ביטול השהיה
- 🗑️ מחיקת תלמיד (admin only, with confirmation)

**Tab: Overview (ברירת מחדל)**
- Attention flags strip (amber/red banners if any flags)
- Quick stats row: next lesson date, current monetary balance, pending forms count, active packages count (secondary)
- Upcoming lesson instances (next 3, card format)
- Active commitment summary (inline balance cards)
- Recent form submissions (latest 2)
- Guardian info card (if guardian linked)

**Tab: Schedule (לוח שנה)**
- List of active lesson templates (service, instructor, day, time, max_students)
- "הוסף תבנית שיעור" button (admin/office only)
- Each card shows upcoming instances generated from template
- Toggle to show inactive templates

**Tab: Forms (טפסים)**
- List of form submissions (sorted: pending first, then by date)
- Each row: template name, sent date, status badge, OTP badge, flag count
- Expandable: shows all field answers; flagged answers highlighted
- "שלח טופס חדש" button → pick from existing form templates → generates OTP link
- Optional: show OTP code to admin for manual relay

**Tab: Financial (כספים)**
- Active commitment balance cards (one per active commitment)
  - Shows: type, total, consumed, remaining, expires_at if set
  - Attention badge if balance < 2 lessons or expiry < 30 days
- "הוסף התחייבות" button
- Lesson charge history table (from lesson_participants: date, lesson, price_charged, pricing_breakdown summary, commitment used)
- Special rate badge (if student has special_rate override)

**Tab: Documents (מסמכים)**
- Moved from current StudentDetailPage
- Shows uploaded files (PDFs, photos)
- Requires storage feature to be enabled; shows upgrade message if not

**Tab: History (היסטוריה)**
- Audit log entries for this student
- Events: created, updated (what changed), status changes, guardian linked/removed, commitment added, form submitted
- Shows: timestamp, user who performed action, what changed

---

### Phase 6 — Forms Feature (Separate Epic)

**Goal:** Full form lifecycle: templates, OTP links, submissions, flags.

**Scope:**
- Global Forms Builder page (admin-only, separate route)
- Form template CRUD
- Sending forms to students (OTP link generation)
- Manual OTP display for admin relay
- National ID + OTP self-serve access (Phase 6b)
- Validation UX: use a generic failure message `ID or OTP were wrong` (never indicate which field failed)
- Validation UX: keep entered fields visible so the user can review and retry without retyping everything
- Submission viewer (built into Phase 5 Forms tab)

---

### Phase 7 — Financial Feature (Separate Epic)

**Goal:** Full commitment and billing lifecycle.

**Scope:**
- Commitment creation (type: HMO quota, private package, cash balance)
- Hybrid model: commitments keep package-level accounting, while UI and ops read system-wide student monetary balance first
- Query-time balance computation from `commitments` + `consumption_entries` (no precomputed balance table)
- Transfers are implemented via existing ledger tables: one `commitments` credit row + one `consumption_entries` debit row
- `consumption_entries.commitment_id` always references the source student's commitment; pair linkage is via shared `transfer_ref`
- `consumption_entries.lesson_participant_id` is optional for transfer entries and required for lesson-occurrence entries
- Data trust guardrail: add deterministic balance query fixtures and reconciliation checks in test/diagnostic mode
- `lesson_participants.price_charged` / `pricing_breakdown` filling on lesson completion
- Outstanding attention flag computation
- Export: student financial summary

---

### Phase 8 — Security Hardening (Final Phase)

**Goal:** Protect self-serve form access from enumeration and brute-force attempts.

**Scope:**
- Rate limit National ID + OTP validation endpoints (per IP and per ID, with sliding window)
- Add attempt throttling and temporary lockouts after repeated failures
- Keep all auth failure responses generic (`ID or OTP were wrong`)
- Add audit logging for failed attempts and lockouts
- Add monitoring/alerts for suspicious spikes in validation failures

---

## Field Reference: Student Create vs Edit Parity

| Field | Create Form | Edit Form (Before) | Edit Form (After) |
|-------|-------------|--------------------|--------------------|
| firstName | ✅ required | ✅ required | ✅ required |
| middleName | ✅ optional | ✅ optional | ✅ optional |
| lastName | ✅ required | ✅ required | ✅ required |
| identityNumber | ✅ required | ✅ required | ✅ required |
| dateOfBirth | ✅ optional | ❌ missing | ✅ added |
| guardianId | ✅ selector | ❌ missing | 📋 Phase 2 |
| guardianRelationship | ✅ conditional | ❌ missing | 📋 Phase 2 |
| phone | ✅ conditional | ✅ plain TextField | ✅ PhoneField |
| email | ✅ optional | ✅ optional | ✅ optional |
| medicalProvider | ✅ optional | ✅ optional | ✅ optional |
| notificationMethod | ✅ required | ❌ missing | ✅ added |
| specialRate | ✅ optional | ❌ missing | ✅ added |
| notesInternal | ✅ present | ❌ broken (sends `notes`) | ✅ fixed |
| tags | ✅ present | ✅ present | ✅ present |
| isActive | N/A | ✅ present | ✅ present |
| contactName | ❌ removed | ✅ LEGACY present | ❌ removed |
| contactPhone | ❌ removed | ✅ LEGACY present | ❌ removed |
| defaultService | ❌ removed | ✅ LEGACY present | ❌ removed |
| defaultDayOfWeek | ❌ removed | ✅ LEGACY present | ❌ removed |
| defaultSessionTime | ❌ removed | ✅ LEGACY present | ❌ removed |

---

## Files Index

| File | Purpose | Phase |
|------|---------|-------|
| `api/students-list/index.js` | Students CRUD API | 1, 3 |
| `src/features/admin/components/EditStudentForm.jsx` | Edit student form | 1 |
| `src/features/admin/components/EditStudentModal.jsx` | Edit modal wrapper | 1 (minimal) |
| `src/features/students/pages/StudentsPage.jsx` | Students list | 4 |
| `src/features/students/pages/StudentDetailPage.jsx` | Student profile | 5 |
| `src/features/students/utils/form-state.js` | Form state util | Already correct |
| `api/guardians/index.js` | Guardian CRUD | 2 |

---

## Known Data Issues

- Existing students created before Reinex migration may have null `date_of_birth`, null `default_notification_method`. The edit form should handle null gracefully (pre-fill `notificationMethod` to 'whatsapp' from form-state default).
- Legacy `contact_name` / `contact_phone` fields in `students` table may still have data — do not delete that data; it will be migrated to `guardians` separately.
- Legacy `default_service`, `default_day_of_week`, `default_session_time` in `students` table also preserved but UI no longer exposes them.
