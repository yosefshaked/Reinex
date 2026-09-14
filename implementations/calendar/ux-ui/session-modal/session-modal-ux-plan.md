# Session Modal — UX Improvement + Bug Sweep Plan

Date: 2026-09-14
Branch: `improve-import-workspace` (to be moved to a dedicated branch before implementation)

Decision legend: `Undecided` · `Do` · `Later` · `Do not do`
Status legend: `Not started` · `In progress` · `Implemented` · `Verified`
Evidence legend: `Confirmed (code)` = traced end-to-end in source · `Likely (code)` = strong code signal, needs browser repro · `Needs repro`

## Scope

The calendar "session modal" = everything opened by clicking a lesson on the calendar grid:

| File | Lines | Role |
|---|---|---|
| `src/features/calendar/components/LessonInstanceDialog.jsx` | 2,760 | Shell, tabs, edit mode, all mutations, cancel + fee-waiver sub-dialogs |
| `src/features/calendar/components/LessonParticipantRoster.jsx` | 686 | Participant cards: attendance, reminders, absence form, status-change preview, session-report CTA |
| `src/features/calendar/components/LessonResolutionStatus.jsx` | 132 | Closure checklist ("מצב סגירה") |
| `src/features/calendar/components/LockedCorrectionPanel.jsx` | 403 | Append-only correction flow for locked lessons |
| `src/features/calendar/components/useVersionConflictResolver.js` | 115 | OCC conflict orchestration |
| `src/features/calendar/utils/calendarWorkspace.js` → `getLessonOpenActions` | — | Fact-derived "open actions" |

Backend it drives: `PUT calendar/instances` (edit, preview-update, preview-cancel, cancel, complete), `POST calendar/attendance` (mark, status-requirements, preview-restore, preview-status-change, update-reminder), `PATCH lesson-instances` (add-participant), `GET lesson-instances/:id`, `GET session-reports`, `POST calendar/corrections`.

Relationship to the master plan (`../calendar-ux-ui-implementation-plan.md`): this plan executes items **1.3, 1.4, 3.1–3.4, 7.1–7.3** for the modal only, and respects every owner decision recorded there (open actions over "next action", hover explanations over text labels on icon buttons, data integrity > ease of use > professionality, desktop first without new mobile debt, conflict blocking stays `Later`).

## Current State (as a user experiences it)

- **Header** (non-scrolling): generic title "פרטי שיעור" + "עריכה". Below it, stacked: error banner, OCC conflict panel, billing warning, locked-correction panel, paid-claim block.
- **View mode, 4 tabs**:
  - `סקירה`: open-actions list → summary card (emoji status icon, 2–5 badges, date/time/duration/participants/instructor/service, "סמן כהושלם") → exception reason → red "פעולה רגישה" cancel card.
  - `משתתפים`: count + "הוסף תלמיד" → inline search → participant cards.
  - `מצב שיעור`: closure checklist + documentation badge.
  - `ניהול`: `created_source`, short id, version.
- **Edit mode** replaces the tabs with one long single-column form (service, instructor, date, time, read-only duration, exception override, status). Save is two-step: "הצג תצוגה מקדימה" → "אשר ושמור".
- **Nested dialogs**: cancel-with-preview, fee-waiver confirm, correction AlertDialog.

---

## Part A — Bugs Found During Onboarding

Fix these first. Each one is small and independently shippable. Ranked by user impact.

### A1. Modal state leaks across lessons and across close/reopen — `Confirmed (code)`
- **Where**: `LessonInstanceDialog.jsx:695-721` resets on `instance.id` change but never resets `isEditMode`, `error`, or `feeWaiverConfirmOpen`. `CalendarPage.jsx:202-204` closes by flipping `showInstanceDialog` only, so the component (and its state) stays mounted.
- **Scenario**: open lesson A → "עריכה" → close with X → click lesson B → **B opens directly in edit mode**. Any error banner from A shows on B. Reopening the same lesson restores the last tab/edit mode/error because the id didn't change.
- **Fix**: reset view state when `open` goes true (and on id change): `isEditMode=false`, `error=null`, `activeViewTab` default, sub-dialogs closed, `clearConflict()`.
- Decision: `Do` (owner reproduced it, 2026-09-14) · Status: `Verified` — owner tested it in the local test environment (2026-09-14)

### A2. Group attendance: the 2nd quick mark hits a false "lesson changed" conflict — `Confirmed (code)`, race window → `Needs repro`
- **Chain**: every attendance write calls `syncLessonClosureState` → it always rewrites `lesson_instances` because `workflow_state.evaluated_at` is a fresh timestamp, so `hasChanged` is always true (`api/_shared/calendar-workflow.js:344-364`) → trigger `trg_lesson_instances_set_updated_at_version` bumps `version` (`setup-sql.js:3901`). The dialog sends `instance_version: instance.version` from props (`LessonInstanceDialog.jsx:1160`), which only refreshes after the whole-calendar refetch completes.
- **Scenario**: in a group lesson, mark participant 1, then participant 2 before the calendar refetch lands → 409 → amber panel "השיעור השתנה מאז שפתחתם אותו" describing the user's *own* change, with a risky "החל בכל זאת".
- **Fix (recommend both)**:
  - (b) Backend: compute `hasChanged` excluding `evaluated_at`, so no-op syncs stop bumping the version. This removes spurious 409s system-wide (drag/drop, edit after attendance, corrections). Side effect: "נבדק לאחרונה" would mean "last changed". → **needs owner OK (D4)**. Run `npm run test:finance-calendar`.
  - (a) Frontend: after any successful mutation, re-fetch `lesson-instances/:id` into dialog-local state (or have the endpoints return the new versions) so the next action uses fresh versions without waiting for the grid refetch.
- Decision: `Do` — both (a) and (b); owner approved D4 on 2026-09-14 · Status: `Verified` — owner tested it in the local test environment (2026-09-14)

### A3. Edit mode "סטטוס = בוטל" can never succeed — `Confirmed (code)`
- **Where**: the edit save always sends `datetime_start`, `instructor_employee_id`, `service_id`, `metadata` (`LessonInstanceDialog.jsx:1049-1063`). The API rejects a cancellation combined with any of those: 422 `cancel_instance_requires_dedicated_action` (`api/calendar/index.js:1428-1439`).
- **Worse**: preview-update returns *before* that check (`api/calendar/index.js:1360-1390`), so the preview shows "ניתן לשמור", then "אשר ושמור" fails. The code isn't in `COMMON_API_ERROR_MESSAGES` or `resolveMutationError`, so the user sees the raw English code.
- **Fix**: remove status from the edit form. Cancellation already has a dedicated server-previewed flow, and completion has "סמן כהושלם". Edit mode becomes schedule-only (service/instructor/date/time/exception). Also add a Hebrew mapping for the code. → **D3**
- Decision: `Do` (owner reproduced it; D3 approved, 2026-09-14) · Status: `Verified` — owner tested it in the local test environment (2026-09-14)

### A4. Correction form is clipped inside the non-scrolling header — `Likely (code)`
- **Where**: `LockedCorrectionPanel` renders inside the `shrink-0` header (`LessonInstanceDialog.jsx:1951-2072`). `DialogContent` is `overflow-hidden`, `max-h-[90vh]`.
- **Scenario**: locked lesson → "צור תיקון" → the form (mode, reason, text, lesson status, one select per participant, impact preview) grows the header, and the scroll body collapses to zero. On a group lesson the "תצוגת השפעה / החל תיקון" buttons can end up off-screen and unreachable.
- **Fix**: keep only a compact lock banner in the header. Move the correction flow into the scrollable body (its own section/tab).
- Decision: `Undecided` — owner asked for a clearer explanation; see the "שיעור נעול" scenario in `mockups/` · Status: `Not started`

### A5. Billing warning always claims "שיעור הושלם" — `Confirmed (code)`
- `handleMarkAttendance` also populates `billingWarnings` (`:1178`), but the banner hard-codes "שיעור הושלם — אך ישנה בעיית חיוב" (`:2045`). It also never dismisses until another lesson is opened.
- **Fix**: neutral copy ("החיוב לא נוצר עבור: …"), a dismiss control, and a link to the participant's financial tab.
- Decision: `Do` · Status: `Implemented` (copy + dismiss). The financial-tab link comes with the redesign.

### A6. Reminder failures are silent — `Confirmed (code)`
- `markReminderSent` only `console.error`s (`:1604-1606`), but WhatsApp/mail has already opened, so the user believes it was recorded. The email path doesn't `await`. `handleSetReminderConfirmation` shows raw `err.message` (`:1656`).
- **Fix**: toast on failure via `resolveMutationError`, await consistently, keep the optimistic state only on success.
- Decision: `Do` · Status: `Implemented`

### A7. Add participant: no in-flight guard, no debounce, raw capacity error — `Confirmed (code)` / double-submit `Needs repro`
- `handleAddParticipant` has no loading state, so a double-click fires two PATCHes. Search hits `students-search` on every keystroke. `capacity_exceeded` (`api/lesson-instances/index.js:1201`) isn't mapped to Hebrew. There is no success feedback.
- **Fix**: pending state per row, ~250ms debounce, Hebrew mapping including `max_capacity`, success toast.
- Decision: `Do` · Status: `Implemented`

### A8. Same error shown three times, far from the action — `Confirmed (code)`
- Absence-form failures set the inline `absenceFormError`, the header `error`, **and** a toast (`:1296-1316`, `:1212-1214`). The header banner may be scrolled out of view.
- **Fix**: one channel per context. Inline for form-scoped errors, toast for transient action results, header only for dialog-level states (load, lock, conflict).
- Decision: `Do` · Status: `Deferred to the redesign` (error placement changes with the new layout)

### A9. Cancel dialog's financial rows ignore the server preview — `Confirmed (code)`
- The "הלקוח/ה יחויב / המדריך/ה יקבל שכר" rows are computed from client-side org policy (`:2693-2716`). That contradicts the server-backed-preview contract in `agents-docs/60-calendar-and-sessions.md` and ignores HMO/grace nuances.
- **Fix**: render from the `preview-cancel-instance` payload. Extend `buildCancelInstancePreview` with per-participant billing/payroll impacts if they're missing. Verify what it returns first.
- Decision: `Do` · Status: `Deferred to the redesign` (the cancel dialog is rebuilt there)

### A10. Terminology and raw values leak into the UI — `Confirmed (code)`
- `cancelled_clinic` is called "המכון" in the roster (`LessonParticipantRoster.jsx:34,453`) but "המרפאה" in the cancel dialog (`:2642,2681`) and the correction panel (`LockedCorrectionPanel.jsx:336`).
- Correction panel: raw `participant_status` ("מצב נוכחי: attended", `:322`), raw lock `lock_source_type: lock_reason` (`:234`), English "append-only" (`:222,383`).
- `ניהול` tab: raw `created_source` enum (`:2556`).
- `DetailField` applies `uppercase tracking-wide` to Hebrew labels (no effect, visual noise).
- **Fix**: one label map, shared by the dialog, roster, and correction panel (feeds master-plan 7.1).
- Decision: `Do` · Status: `Partially implemented`
  - Done: correction panel status/lock/jargon labels are in Hebrew, and "המכון" is used everywhere.
  - Remaining for Part C: one shared label map, plus aligning the older "נכח" / "אי הגעה" / "ע״י תלמיד" wording in the roster badge and dropdowns.

### A11. Disabled "סמן כהושלם" explains itself only via `title` — `Confirmed (code)`
- The reason (unmarked participants) lives in a `title` on a disabled button (`:2363-2377`). That is unreliable on disabled elements and invisible on keyboard/touch. The icon-only attendance buttons in the roster also rely on `title` without `aria-label` (`LessonParticipantRoster.jsx:261-293`).
- **Fix**: visible helper text next to the disabled primary action. Tooltip + `aria-label` on icon buttons (the owner's "hover explanation" decision).
- Decision: `Do` · Status: `Partially implemented` (roster icon buttons have aria-labels; the visible disabled reason comes with the new footer)

### A12. Minor robustness
- `onClick={confirmAbsenceForm}` passes the click event as the options object (`LessonParticipantRoster.jsx:549`). Harmless today, but it will break as soon as someone reads another option.
- `getDisplayInstance`/`getDisplayParticipants` are duplicated in `LockedCorrectionPanel.jsx:23-53`.
- Decision: `Do` (fold into Part C) · Status: `Partially implemented` (click handler fixed; helper de-duplication in Part C)

---

## Part B — UX Problems and Proposed Direction

### B1. The header doesn't say which lesson this is
The title is "פרטי שיעור". Service, time, instructor, and participants are one tab away and disappear entirely in edit mode.
→ **Identity header**, always visible (view and edit): service color + name · date · `HH:MM–HH:MM` · instructor · participant names (up to 3, then "+N") · one primary status pill. Secondary indicators (corrected, exception, locked) become small icons with hover explanations.

### B2. The most frequent job lives on the second tab
Attendance is the daily task, but the modal lands on `סקירה`, which is dominated by the open-actions list and a red "פעולה רגישה" cancel card shown on every open lesson.
→ **Merge `סקירה` + `משתתפים` into one main view**: identity header → compact open-actions strip (each item jumps/scrolls to its target) → participant roster. Secondary tabs: `סגירה וכספים` (closure checklist, documentation, finance blockers) and `פרטים והיסטוריה` (exception reason, correction history, source/audit meta). → **D1**

### B3. Destructive and primary actions are scattered
"סמן כהושלם" sits inside the summary card, "עריכה" in the title row, and "בטל שיעור" in a red card.
→ **Persistent footer action bar in view mode too**: primary "סמן כהושלם" (with a visible reason when disabled), secondary "עריכה", overflow menu ("⋯") → "בטל שיעור" (still opens the server-backed preview). This matches Material dialog guidance already cited in the master plan.

### B4. Attendance costs two clicks per participant, with no bulk path
✓ opens a status-change preview, then "אשר שינוי". A 6-person group means 12 clicks. The master plan's 3.3 acceptance criterion is "attendance marking is fast for simple cases".
→ Options for the owner (**D2**):
  - (a) Keep the per-participant preview, but render it as a compact inline strip ("אין השפעה כספית נוספת" collapses to one line) so confirm is one click away and scanning is fast.
  - (b) Add "סמן את כל המתוכננים כנוכחים" with one combined preview. This needs a backend bulk preview + apply action and an atomicity decision. It must still go through `BillingLedgerService` per participant.
  - Recommend (a) now, (b) as a follow-up once A2 is fixed.

### B5. Status overload and jargon
Up to 5 badges plus a 3xl emoji. "פתוח תפעולית / סגור תפעולית" is internal workflow language. The participant badge mixes attendance with reminder state ("ממתין לאישור").
→ One primary lesson status. Closure shown as progress in `סגירה וכספים` in operational language ("מה נשאר כדי לסגור את השיעור"). Participant card: attendance pill + separate small reminder indicator with a tooltip.

### B6. Edit mode is a long, single-column form with the preview below the fold
→ Compact 2-column grid (date+time / service+instructor). Availability feedback inline next to time. Exception override collapsed until the time is outside availability. Status removed (A3). Before→after diff rendered in the footer zone where the confirm button is. **Dirty-state tracking + discard confirmation** when closing with unsaved edits.

### B7. The closure checklist is abstract
"התקדמות סגירה: 2/4", each row showing both "הושלם" and a "סגור" badge.
→ List only what's open, each with an owner and a link to the right screen (billing → student financial tab, payroll → payroll page, HMO → claims). Keep "not relevant" and "waiting for an earlier step" visibly different (master plan 3.4). Routes need verification.

### B8. Locked lessons explain themselves only to admins
Instructors see attendance controls vanish with no reason, because the correction panel and paid-claim alert are gated by `canManageAll`.
→ "למה השיעור נעול" banner for every role, in Hebrew (source: payroll run / claim batch / paid claim), with the correction CTA shown only to admins (master plan 1.4). → **D5**

### B9. Participant card density
The contact line is always visible, notes are low-contrast italic, and the reminder zone, report zone, and financial alerts stack as separate bands.
→ Keep the good bones (identity, per-row actions). Move contact details into a hover/expand, and turn the stacked bands into a single secondary row. Use the earlier explorations in `../participants-tab/html-suggestions/` (01-row-command-center, 02-workflow-groups, 03-split-detail) as Phase 4 input.

---

## Part C — Structural Enabler (behavior-preserving)

The dialog holds ~40 `useState`s and passes ~45 props into the roster, including pure helper functions (`deriveDisplayWorkflowDecisions`, `formatAgorotPreview`, `shortId`, label getters). Any UX change today produces a diff that's hard to review.

- `utils/lessonDialogModel.js`: pure helpers (display instance/participants, labels, workflow decisions, conflict diff lines, impact grouping) plus `node --test` coverage.
- Hooks: `useLessonAttendance`, `useLessonReminders`, `useLessonEdit`, `useLessonCancel`, `useLessonSessionReports`.
- Components: `LessonDialogHeader`, `LessonOpenActionsStrip`, `LessonEditForm`, `LessonCancelDialog`, `LessonFooterActions`.
- No UX change in this step. Update `agents-docs/60-calendar-and-sessions.md` with the new module map (AGENTS.md "keep the hub alive").

---

## Phasing

| Phase | Content | Size | Gate |
|---|---|---|---|
| 0 | Baseline: run the app, screenshot every modal state (regular, group, past-unmarked, completed, cancelled, locked, corrected, exception, instructor role), reproduce A2/A4/A7 | S | Needs a logged-in session. Claude can't enter credentials. |
| 1 | Bug fixes A1, A3, A5–A11 (one commit each). A2 after D4. | M | `npm run lint`, `npm run build`; A2(b) also `npm run test:finance-calendar` |
| 2 | Part C extraction, no behavior change | M | lint + build + manual smoke of every flow |
| 3 | Shell: identity header, footer action bar, tab restructure, feedback placement (B1–B3, B5, B8) | M | owner answers D1, D5 |
| 4 | Participants & attendance (B4, B9) | M–L | D2; HTML mockups first |
| 5 | Edit mode redesign (B6) | M | D3 |
| 6 | Closure/finance tab + correction UX (B7, A4 polish) | M | route check |
| 7 | Terminology + a11y pass on everything touched (A10, A11, master plan 7.1/7.2) | S | — |

**Manual verification matrix (every phase)**: admin/owner/office and instructor roles × {single lesson, group lesson, past lesson with unmarked participants, completed, cancelled, locked by payroll, locked by claim batch, corrected, scheduling exception} × {mark attended, absence with compensation decision, fee waiver, restore to scheduled, reminder WA/email/confirm, add participant, edit reschedule, cancel lesson, quick complete, session report CTA, OCC conflict}.

**Regression invariants** (from the master plan): org scope via `authenticatedFetch`, instructor self-scope, expected-version handling, locked states not bypassable, billing/payroll/closure sync still triggered by every mutation.

## Open Decisions for the Owner

Owner answers, 2026-09-14. An interactive prototype of the approved direction is in `mockups/index.html`.

- **D1** Merge `סקירה` + `משתתפים` into one main view with 2 secondary tabs → **Approved**.
- **D2** Fast attendance → **Compact inline strip only. No "mark all attended"**; option (b) is dropped. The strip is demonstrated in the prototype.
- **D3** Remove status from edit mode → **Approved**.
- **D4** Skip the closure rewrite when only `evaluated_at` changed → **Approved**.
- **D5** Instructor view of locks/closure → **Pending**. The owner leans toward "doesn't matter to them". The prototype's "צפייה בתור מדריך/ה" toggle shows the reduced view.
- **D6** Doc drift: `AGENTS.md` / `agents-docs/00-core-rules.md` say instructors are self-scoped unless `admin`/`owner`, but frontend and backend both treat `office` as manage-all (`isAdminOrOffice`). Update the docs?

## Prototype Feedback — Round 1 (2026-09-14)

Owner verdict: the direction is good, but v1 was too dense and the layout wasn't tight. v2 (`mockups/`) applies these changes:

**Keep as-is**: the reminder bell + popover, the session-report icon, the absence form, the compact confirm strip, the HMO badge.

**Reduce density**
- The header shows only what must always be visible: **service, date, time range, instructor**. The participant count is removed (the list is right there). Lesson status appears only when it isn't "מתוכנן".
- The "פעולות פתוחות" chip row is removed from the main view. Its content lives in the `סגירה` tab (with a count badge), which lists only open and waiting steps. Done and not-relevant steps collapse into one summary line.
- Participant rows: no avatar, no contact line, no "פרטי" chip, and no pill for unmarked participants ("טרם סומן" in muted text instead). Contact details moved into the reminder popover and the ⋯ menu.
- Tabs renamed `משתתפים` / `סגירה` / `היסטוריה`. "Add participant" moved to the bottom of the list.

**Layout**: rows now sit on fixed columns (name · status · reminder/report · actions), so every row lines up. The modal is narrower (780px).

**New requirements**
- **Absence form prefill**: prefill the instructor-pay decision from the org's `instructor_earnings_policy` when it's configured. The dialog already loads it (`LessonInstanceDialog.jsx:731-769`). Show it as a default ("לפי הגדרות השכר") that the user can change. If there's no configuration, nothing is preselected.
- **HMO badge hover**: provider · track, **מספר אישור**, sessions remaining out of the authorized total, and expiry date.
  - Backend gap: the calendar coverage payload (`api/_shared/calendar-hmo-coverage.js:37-48`) returns `remaining_authorized_lessons` and the provider/track names, but not `authorization_reference`, `authorized_lessons` or `expires_at` (all on `hmo_authorizations`, `setup-sql.js:2107-2110`).
  - Add them to that read-only enrichment. No write-path changes.

## Prototype Feedback — Round 2 (2026-09-14)

Owner verdict on v2: worse in both layout and design. The only improvement they valued was the HMO hover details (kept). The owner supplied a header sketch.

**Header (owner's sketch, now fixed):** one row with three balanced columns: **service** (right), **date + time range** (center, time emphasized), **instructor** (left). The ✕ is a round button centered on the modal's top edge. Tabs sit centered on the header's bottom edge, echoing the ✕. The frame is a white header and footer around a lightly tinted content area.

**Participant area:** three switchable directions in v3 (`mockups/`, top-bar "כיוון עיצוב"), awaiting the owner's pick:
- **A · רשימה** — refined list: avatar, name + HMO badge, status chip under the name, all controls grouped at the row end.
- **B · כרטיסים** — two-column cards with labeled "נכח/ה" / "לא הגיע/ה" buttons. The confirm strip / absence form expands the card to full width.
- **C · לוח נוכחות** — each row has a visible נכח/ה | לא הגיע/ה toggle showing the state at a glance. Selecting still opens the confirm strip / absence form.

All three keep the approved pieces: reminder bell + popover, report icon, absence form (with policy prefill), compact confirm strip, HMO hover.

## Prototype Feedback — Round 3 (2026-09-14)

**Chosen:** direction A (list). The owner likes the new frame and layout.

**Bring back:**
- A small, muted contact line under each name (guardian/contact · phone).
- The participant count above the list ("4 משתתפים · מקום פנוי אחד"), with "הוספת משתתף/ת" on the same line.

**Closure tab → removed.** The owner found it complicated and redundant with the main tab. Attendance and reports are already visible on the rows, and billing, payroll and HMO claims aren't actionable from this modal. What remains useful ("why is this lesson still open?") becomes one quiet footer line, with details on hover:
- "נותר לסגירה: שכר מדריך/ה · תביעה לכללית · דיווחי מפגש", or
- "השיעור סגור — אין משימות פתוחות".

Tabs are now `משתתפים` / `היסטוריה`.

**History → redesigned.** Entries are grouped by day ("היום", "אתמול", date). Each entry has a type icon (attendance, absence, reminder, edit, participant, report, pay, correction), a one-line sentence, an optional note, the actor, and the time in a fixed column. Edits show their before → after chips. New actions from this session are marked "חדש". The scheduling-exception reason sits as a note at the top; technical details are collapsed at the bottom.
- Data implication for the real build: history needs typed audit events (type, actor, participant, note, diff). Check what `audit_log` already stores for lesson/attendance mutations before designing the read endpoint.

Owner approved v4 as the target design (2026-09-14).

## Implementation Progress — Phase 1 (2026-09-14)

Uncommitted, on the working branch.

| Item | Result | Files |
|---|---|---|
| A1 state leak | Transient state (edit mode, errors, sub-dialogs, previews, tab, conflict) resets on lesson change **and** on every reopen | `LessonInstanceDialog.jsx` |
| A2 false version conflicts | (b) `syncLessonClosureState` writes only on a real change (key-sorted compare, `evaluated_at` excluded — jsonb reorders keys, so a naive compare would still always write). (a) The dialog re-reads versions after each own write (attendance, reminders, add participant, attendance-conflict retry) and sends the fresher ones | `api/_shared/calendar-workflow.js`, `LessonInstanceDialog.jsx` |
| A3 edit-mode cancel | Status removed from edit mode (D3); Hebrew message for `cancel_instance_requires_dedicated_action` | `LessonInstanceDialog.jsx`, `src/lib/api-client.js` |
| A5 billing banner | Neutral "החיוב לא נוצר" copy + dismiss | `LessonInstanceDialog.jsx` |
| A6 reminder failures | Failure toast; email path awaited; resolved error text | `LessonInstanceDialog.jsx` |
| A7 add participant | In-flight guard + spinner, 250ms debounced search, Hebrew capacity error with `max_capacity`, success toast | `LessonInstanceDialog.jsx`, `src/lib/api-client.js` |
| A10 labels (partial) | Correction panel status/lock/jargon in Hebrew; "המכון" everywhere | `LockedCorrectionPanel.jsx`, `LessonInstanceDialog.jsx` |
| A11 (partial), A12 (partial) | Roster icon-button aria-labels; absence-confirm click handler | `LessonParticipantRoster.jsx` |
| A4, A8, A9 | Deferred into the redesign phases | — |

**Validation:**
- `npm run lint` ✓.
- `npm run lint:api` ✓.
- `npm run test:finance-calendar` 96/96 ✓. This includes the new `api/_shared/calendar-workflow.test.js`, which covers the no-op-write rule with a jsonb-style key-reordering mock. It was proven to fail against the old comparison.
- `npm run build` ✓ (typecheck is warn-only; 3,073 pre-existing issues, none introduced here).
- Owner verified A1, A2 and A3 in the local test environment (2026-09-14).
- Automatic tester:
  - New `test/automatic-tester/scripts/lesson-dialog-regressions.json` covers A1 (reopen and switching lessons land in view mode), A2 (back-to-back attendance with no conflict panel) and A3 (no status field in edit mode). It sets up its own instructors, students and lessons through the API. It passes `node runner.js --validate`; it hasn't been run live yet.
  - No existing scenario touched the changed dialog UI.
  - `setup.js` now probes `Services.report_form_id`, so `node setup.js` re-applies the schema when the local DB is missing the Session Reports columns. The local tester DB was stale and made `GET /api/services` fail with `failed_to_load_services`. It was brought up to date by applying `SETUP_SQL_SCRIPT` (0 SQL errors).

**Docs:** `agents-docs/60-calendar-and-sessions.md` now records the closure-sync write rule and the dialog's refresh-versions-after-own-writes rule.

**Found during Phase 1 (out of scope, spun off as a separate task):**
- `evaluateLessonClosureState` treats instructor pay as resolved only via `payroll_run` locks, but no production code creates them. Only claim-batch locks are written (`BillingLedgerService.js:~2527`), plus the debug UAT tool.
- Lessons that owe instructor pay may therefore never close, and paid payroll never hard-locks lessons.
- This also affects the footer closure line in the redesign ("נותר לסגירה: שכר מדריך/ה" would never clear).
- Tracked as GitHub issue #49; the owner will return to it after the lesson-modal work.

Phase 1 committed as `da0bbfb` on `improve-import-workspace`.

## Implementation Progress — Phase 2 (2026-09-14)

The refactor is behavior-preserving.

| Step | Result |
|---|---|
| Pure helpers | 30 helpers/constants moved verbatim (by declaration name, via script) to `src/features/calendar/utils/lessonDialogModel.js`. The module has no React and no `@/` aliases, so it's importable by `node:test`. Kept in the component: `DetailField`, `EmptyTabState` (JSX), and `getDayTokenForDateString` / `resolveLessonSchedulingAvailability` (they depend on the `@/`-aliased `instructor-availability.js`). |
| De-duplication (A12) | `LockedCorrectionPanel.jsx` imports `getDisplayInstance` / `getDisplayParticipants` from the model instead of keeping its own copies. |
| Hooks | `src/features/calendar/hooks/useLessonDialogData.js` holds `useLessonSessionReports`, `useLessonFinancePolicies`, `useAbsenceRequirements` (keyed results replace four manual resets) and `useLessonVersions`. Wired in by an assert-every-match script. |
| Size | `LessonInstanceDialog.jsx`: 2,760 → 2,274 lines. |
| Docs | `agents-docs/60` lists the new building blocks. |

| Tests | `test/lesson-dialog-model.test.js`: 89 characterization tests for the model, wired into `test:finance-calendar`. |

**Bug found by the characterization tests, and fixed:**
- `resolveMutationError` returned the generic 409 text ("השיעור עודכן על ידי משתמש אחר") before checking specific codes.
- So "can't cancel, attendance already marked for X" (`instance_cancelled_has_attended_participants`, sent as 409 by `api/calendar/index.js`) never reached the user, and neither did the documented-report guard (`report_has_documentation`, 409).
- The status fallbacks now run last. A 409 with a translated message shows that message; untranslated 409s still get the version-conflict text.

**Backlog from the characterization notes** (documented in the tests, not fixed; low impact):
- `toUtcIsoString` turns an unparseable time into midnight and lets out-of-range dates roll over.
- `deriveDisplayWorkflowDecisions` ignores the instructor earnings policy (no_show compensation shows "unknown"), and shows billing as not_applicable when no policy is passed.
- `buildConflictLines` doesn't report a cleared note, a participant removed on the server, or a no_show ↔ cancelled_* change.
- `getParticipantStatusLabel` labels unknown statuses as "מתוכנן".

**Still to do:**
- Owner smoke test in the local env.
- Then Phase 3 (v4 design).
