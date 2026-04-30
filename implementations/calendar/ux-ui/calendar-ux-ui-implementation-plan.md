# Calendar UX/UI Implementation Plan

Date: 2026-04-29

Owner decision status legend:
- Decision: `Undecided`
- Decision: `Do`
- Decision: `Later`
- Decision: `Do not do`

This document is the persistent to-do list for moving the calendar from "working" to "comfortable to use and easy to understand".

Primary priorities, in order:
1. Data integrity
2. Ease of use
3. Professionality

## Current Context

The calendar is not only a visual scheduler. It controls lesson creation, instructor availability, participant attendance, reminders, cancellations, workflow closure, corrections, finance locks, billing sync, payroll sync, HMO claim tasks, and manual generation from templates.

Relevant current source areas:
- `src/features/calendar/pages/CalendarPage.jsx`
- `src/features/calendar/components/ReinexFullCalendar.jsx`
- `src/features/calendar/components/CalendarWorkspaceDock.jsx`
- `src/features/calendar/components/AddLessonDialog.jsx`
- `src/features/calendar/components/LessonInstanceDialog.jsx`
- `src/features/calendar/components/LessonParticipantRoster.jsx`
- `src/features/calendar/components/LessonResolutionStatus.jsx`
- `src/features/calendar/components/ManualGenerationDialog.jsx`
- `src/features/calendar/utils/calendarWorkspace.js`
- `api/calendar/index.js`
- `api/calendar-conflicts/index.js`
- `api/calendar-attendance/index.js`
- `api/calendar-corrections/index.js`
- `api/_shared/BillingLedgerService.js`
- `api/_shared/calendar-workflow.js`
- `api/_shared/lesson-instance-status.js`

Implementation rules:
- Read `agents-docs/60-calendar-and-sessions.md` before calendar work.
- Calendar writes must preserve org scope, membership checks, instructor self-scope, expected-version conflict handling, locked-state handling, audit logging, billing sync, payroll sync, and workflow closure sync.
- Risky UX changes should use existing backend helpers before creating new patterns.
- If a new shared helper, architectural pattern, or cross-domain side effect is created, update the relevant `agents-docs` file.

## UX Principles

Every calendar interaction should answer these questions clearly:
- What am I looking at?
- What needs my attention?
- What action should I take next?
- What will this action change?
- Is this safe to save?
- What happened after I saved?

Interaction model:
- Low-risk actions can be direct.
- Medium-risk actions should show clear confirmation.
- High-risk actions must show server-backed impact preview before commit.
- Exceptions must be explicit, named, and auditable.

## Best-Practice Backing

The plan is grounded in these UX/UI principles and references:

- [Nielsen Norman Group: 10 usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) and [NN/g heuristic summary PDF](https://media.nngroup.com/media/articles/attachments/Heuristic_Summary1_A4_compressed.pdf): visibility of system status, match with users' language, user control/freedom, consistency, error prevention, recognition rather than recall, progressive efficiency, minimalist design, error recovery, and contextual help.
- [W3C WCAG 2.2 Understanding](https://w3c.github.io/wcag/understanding/): keyboard access, visible focus, use of color, labels, error identification, target size, and drag alternatives.
- [Material Design dialogs](https://m1.material.io/components/dialogs.html): use descriptive confirmation actions, disable/guard confirmation until mandatory inputs are valid, and confirm discard when users have unsaved changes.
- [Atlassian empty-state guidance](https://atlassian.design/foundations/content/designing-messages/empty-state): empty states should explain why nothing is shown and provide a clear next action.
- [Atlassian error-message guidance](https://atlassian.design/foundations/content/designing-messages/error-messages): errors should explain what happened, what it means, and how to move forward in concise nontechnical language.
- [Atlassian warning-message guidance](https://design-system-docs-proxy.services.atlassian.com/foundations/content/designing-messages/warning-messages/): warnings should appear before a potentially harmful action and explain the possible consequence.
- [Atlassian forms guidance](https://design-system-docs-proxy.services.atlassian.com/patterns/forms): long forms should be grouped logically or split into multi-step/progressive disclosure flows.
- [FullCalendar eventDrop docs](https://fullcalendar.io/docs/eventDrop): dropped events can be reverted after failed/cancelled saves.
- [FullCalendar eventAllow docs](https://fullcalendar.io/docs/eventAllow): event movement can be programmatically restricted before drop.
- [FullCalendar selectAllow docs](https://fullcalendar.io/docs/selectAllow): selectable ranges can be programmatically restricted.
- [FullCalendar businessHours per resource docs](https://fullcalendar.io/docs/businessHours-per-resource): resource-specific availability can be represented visually.

Principle-to-plan mapping:
- Data integrity work maps to NN/g error prevention and Atlassian warning/error guidance.
- Actionable queues, legends, and setup states map to NN/g visibility of system status and recognition rather than recall.
- Task-based lesson details and guided creation map to Atlassian form guidance, progressive disclosure, and minimalist design.
- Drag/drop safety maps to W3C drag alternatives and FullCalendar `eventDrop`/`eventAllow` capabilities.
- Accessibility polish maps to WCAG 2.2 keyboard, focus, labels, color, target-size, and input-assistance criteria.

## Owner Decisions And Working Constraints

Captured from owner review:
- Conflict blocking is `Later`. Current warning-before-action is acceptable for shipping speed. Do not introduce required conflict-reasoning or server-side overlap blocking in the first UX/UI milestone unless explicitly re-approved.
- Capacity exceeded is blocking when implemented.
- Role-permission redesign is postponed. Preserve existing admin/owner/instructor behavior unless a specific task says otherwise.
- Mobile view is postponed until after desktop is strong, but avoid desktop implementation choices that make a future mobile list/agenda mode expensive.
- FullCalendar customization must be conservative and documentation-backed. Avoid brittle custom behavior that fights FullCalendar internals.
- Exception handling should be useful but not always loud. Prefer progressive disclosure, compact indicators, hover/focus help, and detail panels over persistent large warnings.
- "Next action" should be modeled as "Open actions": a list of remaining actions in a clear workflow order.
- Open actions should be derived from actual underlying facts/steps where possible, not from a single status field that could become stale or corrupted.
- Icon-only controls can remain compact, but they need hover/focus explanations and accessible labels.
- Visual consistency work should be split into smaller subtasks instead of one broad redesign pass.

## Phase 1: Data Integrity UX Hardening

### 1.1 Make lesson conflicts blocking by default

Problem:
`AddLessonDialog.jsx` currently displays conflict warnings and says users can continue anyway. The create endpoint validates availability and leave conflicts, but overlap conflicts are currently exposed mainly through `api/calendar-conflicts/index.js` as a separate advisory check.

Goal:
Prevent accidental double-booking of instructors, students, and client profiles unless the business explicitly approves an exception model.

Proposed work:
- Add a server-side conflict check inside `POST /api/calendar/instances`.
- Add equivalent server-side conflict protection to relevant edit/reschedule flows if missing.
- In creation UI, disable submit while blocking conflicts exist.
- If exceptions are allowed, add an explicit "conflict override" reason model, similar to scheduling overrides.
- Persist override reason in metadata and audit details.

Best-practice basis:
- NN/g error prevention: prevent high-risk mistakes before they happen.
- Atlassian warning guidance: warn before actions that may cause errors or data loss.
- Atlassian error guidance: blocked saves should explain the conflict and the next step.

Acceptance criteria:
- A user cannot create an overlapping instructor/student/client lesson by ignoring the warning.
- If conflict exceptions are approved, every exception has a required reason and is visible in the lesson details and attention queue.
- Drag/drop reschedule and form-based edit behave consistently.

Decision: `Later`

Owner notes: Currently we've got a warning that stops the user before action, we'll allow them to execute this without reasoning to push to shipping faster, we'll take care of this later on.

---

### 1.2 Add server-backed impact preview for lesson reschedule/edit

Problem:
Cancellation and attendance already use server-backed previews. General lesson edits and drag/drop reschedule do not present the same level of impact clarity.

Goal:
Before saving risky edits, show what will change and which downstream systems are affected.

Proposed work:
- Add preview action for lesson edit/reschedule.
- Include before/after date, time, instructor, service, duration, participants.
- Include risk flags: conflict, outside availability, service duration change, billing impact, payroll impact, HMO impact, lock/correction constraints.
- Use the same preview language style used by attendance/cancellation.
- For drag/drop, show the same preview in the confirmation dialog.

Best-practice basis:
- NN/g visibility of system status: users should know what is happening and what will change.
- Atlassian warning guidance: significant consequences should be shown before commit.
- Material dialog guidance: confirmation actions should use descriptive verbs rather than vague "OK" labels.

Acceptance criteria:
- Users see exactly what will change before confirming a risky edit.
- Preview is generated from current server state.
- Version conflicts are still handled through existing expected-version flows.

Decision: `Do`

Owner notes: While you're at it, improve the way it's designed. I want it to be comfortable to scan.

---

### 1.3 Standardize exception handling

Problem:
Availability exceptions exist, but conflict exceptions, capacity exceptions, and operational exceptions are not presented as one coherent model.

Goal:
Create one user-understandable exception language.

Proposed work:
- Define exception categories:
  - Outside instructor/service availability
  - Instructor conflict
  - Participant conflict
  - Capacity exceeded
  - Finance/correction/lock exception
- Add consistent UI labels and badges.
- Add a single "why this is exceptional" panel in lesson details.
- Ensure exception reason is searchable/auditable where relevant.

Best-practice basis:
- NN/g consistency and standards: the same concept should not appear under different labels or interaction models.
- NN/g match with real world: use domain terms that match clinic operations rather than internal metadata names.

Acceptance criteria:
- Any lesson with an exception is visibly marked on the calendar card, workspace dock, and lesson details.
- Users can understand why the lesson is exceptional without reading raw metadata.

Decision: `Do`

Owner notes: Make sure you don't make it overwhelming, it doesn't necessarily needs to always be visible, we need to think it through.

---

### 1.4 Improve lock and correction visibility

Problem:
Locked/corrected lessons are protected, but the user experience can still feel like controls simply disappear or fail.

Goal:
Make locked state understandable before users attempt edits.

Proposed work:
- Add a clear "Why this lesson is locked" panel.
- Show lock source: payroll run, claim batch, paid claim, correction.
- Explain allowed next action: direct edit, correction flow, or no action.
- Make disabled buttons include visible reason text, not only `disabled`.

Best-practice basis:
- NN/g help users recognize, diagnose, and recover from errors.
- Atlassian error guidance: explain the problem, consequence, and next step without technical noise.

Acceptance criteria:
- A user can tell why a lesson cannot be edited.
- The UI points to the correct next flow when one exists.

Decision: `Do`

Owner notes:

---

## Phase 2: Actionable Calendar Workspace

### 2.1 Replace generic attention count with actionable queues

Problem:
The current dock shows "requires attention" as a count, but does not fully explain what to do next.

Goal:
Turn the dock into an operations checklist.

Proposed work:
- Break attention into categories:
  - Attendance missing
  - Documentation missing
  - Outside availability exceptions
  - Reminder confirmations pending
  - HMO/coverage issues
  - Billing/payroll closure blockers
  - Instructor availability setup issues
- Each category should show count, short explanation, and primary action.
- Clicking a queue item should select/open the related lesson or repair flow.

Best-practice basis:
- NN/g visibility of system status: expose operational state clearly.
- NN/g recognition rather than recall: users should not need to remember which symbols mean which pending work.

Acceptance criteria:
- Users can start their day from the dock without scanning the whole grid.
- Each attention item has a clear next action.

Decision: `Do`

Owner notes:

---

### 2.2 Add calendar legend and status education

Problem:
Calendar cards use colors, icons, badges, reminder counts, and workflow strips. Users need a legend.

Goal:
Make status meanings learnable without training.

Proposed work:
- Add a compact legend in the dock or header.
- Explain:
  - Scheduled
  - In progress
  - Needs attention
  - Completed/closed
  - Exception
  - Reminder sent/confirmed/declined
  - Locked/corrected
- Keep it collapsible after first use.

Best-practice basis:
- NN/g recognition rather than recall.
- WCAG use of color: status cannot rely only on color.

Acceptance criteria:
- A new user can understand the event card visual language from the page itself.
- Legend does not consume excessive space in daily operation.

Decision: `Do`

Owner notes: I tried to do that in the past, but it became annoying when it's always there, I don't know if a full legend is required or a "hover to understand" is required, we need to discuss this.

---

### 2.3 Improve empty and setup states

Problem:
"No instructors available or lessons in selected range" does not tell the user whether the problem is missing availability, missing service capabilities, filters, or truly empty schedule.

Goal:
Help users fix setup issues from the calendar.

Proposed work:
- Detect and distinguish:
  - No instructors exist
  - Instructors exist but no active service capability
  - Capabilities exist but no availability windows for selected day/week
  - Availability exists but no lessons
  - User lacks permission or is self-scoped
- Offer direct actions:
  - Add/edit instructor availability
  - Edit service capabilities
  - Create lesson
  - Go to templates

Best-practice basis:
- Atlassian empty-state guidance: explain why nothing is shown and offer a clear next action.
- NN/g help and documentation: contextual help should support task completion at the moment of need.

Acceptance criteria:
- Empty calendar state explains the cause and offers a next action.

Decision: `Do`

Owner notes: Very important.

---

### 2.4 Add focused filters without hiding integrity issues

Problem:
The week view can become dense. Users may need focus modes, but filters can hide important problems.

Goal:
Allow focus while preserving operational safety.

Proposed work:
- Add filters for instructor, service, status, attention-only, and unresolved-only.
- Always show a visible indicator when filters are active.
- Keep global attention counts visible even when filtered.
- Add "clear filters" action.

Best-practice basis:
- NN/g flexibility and efficiency of use: support expert focus workflows.
- NN/g visibility of system status: active filters must be visible so users do not misread hidden data as absent.

Acceptance criteria:
- Users can reduce visual noise.
- Hidden critical issues remain discoverable.

Decision: `Do`

Owner notes: Very important, needs to be engineered carefully.

---

## Phase 3: Lesson Details Redesign

### 3.1 Split lesson details into task-based sections

Problem:
`LessonInstanceDialog.jsx` is dense and mixes viewing, editing, attendance, reminders, billing, payroll, closure, cancellation, correction, and participant management.

Goal:
Make the dialog easy to scan and safe to use.

Proposed structure:
- Overview: service, date/time, instructor, status, participants summary.
- Next action: the one most important action for this lesson.
- Participants & attendance.
- Communication/reminders.
- Financial/workflow impact.
- Exceptions, locks, corrections.
- Advanced/audit metadata.

Best-practice basis:
- Atlassian forms guidance: long forms and dense tasks should be logically grouped or split.
- NN/g aesthetic and minimalist design: every extra visible detail competes with the task at hand.

Acceptance criteria:
- Common tasks are visible without scrolling through unrelated details.
- High-risk controls are grouped and explained.
- Admin-only and instructor-only experiences remain clear.

Decision: `Do`

Owner notes: Instead of "Next action" we should have "Open actions" - listing all the actions the user has left to do, but to keep a specific workflow.

---

### 3.2 Make "next action" explicit in lesson details

Problem:
Users must infer whether they should mark attendance, send reminders, close a blocker, resolve billing, or do nothing.

Goal:
Each lesson details view should recommend the next operational action.

Proposed work:
- Derive next action from status/workflow:
  - Send reminder
  - Wait for confirmation
  - Mark attendance
  - Complete lesson
  - Resolve billing/HMO/payroll blocker
  - Use correction flow
  - No action needed
- Show one primary action and secondary actions.

Best-practice basis:
- NN/g visibility of system status and recognition rather than recall.
- Atlassian message guidance: communicate conditions and responses to user actions clearly.

Acceptance criteria:
- Users do not need to understand the full workflow model to proceed.

Decision: `Do`

Owner notes: I prefer it to derive the next action from actually making sure the steps occured rather than rely on a "status" that might've been corrupted.

---

### 3.3 Redesign participant rows for clarity

Problem:
Participant rows currently contain attendance state, workflow badges, reminder controls, absence form, preview impacts, and restore controls in one dense card.

Goal:
Make participant status and available actions clearer.

Proposed work:
- Use a consistent participant row layout:
  - Name
  - Attendance status
  - Reminder status
  - Billing/payroll/HMO status summary
  - Primary action
  - Expand for details
- Move preview impacts into a clear confirmation panel.
- Replace icon-only controls with text labels where risk is high.

Best-practice basis:
- WCAG headings/labels and label-in-name principles.
- NN/g consistency and standards.
- Atlassian error/warning guidance for high-impact confirmations.

Acceptance criteria:
- Attendance marking is fast for simple cases.
- Financial consequences are visible before risky changes.

Decision: `Do`

Owner notes: Instead of replacing icon-only controls with text labels, put a hover explanation to keep it compact but explanatory.

---

### 3.4 Improve workflow closure explanation

Problem:
The closure panel is accurate but can feel abstract.

Goal:
Explain closure in operational terms.

Proposed work:
- Rename or supplement "closure" with user-facing text like "What still needs to be finished".
- Show blockers with action buttons where possible.
- Separate "not relevant" from "waiting for earlier step".

Best-practice basis:
- NN/g match with the real world: user-facing language should reflect operational work, not internal workflow terminology.
- NN/g help users diagnose and recover.

Acceptance criteria:
- Users understand why a lesson is still open.
- Users know which team/process owns the blocker.

Decision: `Do`

Owner notes:

---

## Phase 4: Lesson Creation Flow

### 4.1 Convert create lesson form into guided flow

Problem:
The create dialog has the correct fields and validations, but the form is cognitively heavy.

Goal:
Make lesson creation feel guided and predictable.

Proposed flow:
1. Who: select student/client and group participants.
2. What: service.
3. When/with whom: date, instructor, time from availability.
4. Review: conflicts, availability, price, exception reason, final submit.

Best-practice basis:
- Atlassian forms guidance: multi-step forms and progressive disclosure reduce long-form burden.
- Material dialog guidance: confirmation should be disabled/guarded until mandatory inputs are complete.
- NN/g recognition rather than recall: review step prevents users from remembering earlier choices.

Acceptance criteria:
- Users understand why later choices are disabled or auto-filled.
- Users can review all consequences before creating.

Decision: `Do`

Owner notes:

---

### 4.2 Improve direct client pricing UX

Problem:
Direct client charge amount is required only when the service has no default customer charge amount. This is correct but needs clearer language.

Goal:
Prevent accidental missing or wrong pricing.

Proposed work:
- Show pricing source:
  - Service default price
  - One-time lesson price
  - HMO/copay implications if relevant
- Require explicit review for one-time price.
- Display amount in shekels with formatting.

Best-practice basis:
- NN/g visibility of system status.
- Atlassian warning guidance: financial consequences should be visible before commit.

Acceptance criteria:
- User knows what will be charged before creating.

Decision: `Do`

Owner notes:

---

### 4.3 Make availability selection more transparent

Problem:
Users see available slots, but not always why a slot/instructor is missing.

Goal:
Make availability rules visible when needed.

Proposed work:
- For selected service/date, show why instructors are available or unavailable.
- Show configured availability windows for the selected instructor/service.
- Add direct repair action for missing availability.
- Keep exception flow explicit and auditable.

Best-practice basis:
- FullCalendar resource `businessHours` supports visible resource-specific availability.
- NN/g help and documentation: explain constraints in context.

Acceptance criteria:
- Users can diagnose missing instructor/time options without leaving the flow.

Decision: `Do`

Owner notes: I find FullCalendar easily breakable with custom solutions, stick to the docs and make sure what you make is up to code.

---

## Phase 5: Calendar Grid and Interaction Polish

### 5.1 Refine event card information hierarchy

Problem:
Short lessons and narrow columns hide details. The current card is functional but can be hard to scan.

Goal:
Make event cards readable at realistic density.

Proposed work:
- Define card variants for:
  - 15-20 minute lessons
  - 30-45 minute lessons
  - 60+ minute lessons
  - narrow week columns
- Always preserve the most important field: participant/client.
- Use hover/focus/click side summary for hidden details.
- Avoid relying only on color.

Best-practice basis:
- NN/g aesthetic and minimalist design: prioritize the most relevant information.
- WCAG use of color and text alternatives: status cannot depend only on color.

Acceptance criteria:
- Users can scan a dense day/week without opening every lesson.

Decision: `Do`

Owner notes:

---

### 5.2 Improve drag/drop safety and affordance

Problem:
Drag/drop is powerful but risky.

Goal:
Make drag/drop feel safe, reversible, and intentional.

Proposed work:
- Add visual affordance for draggable lessons.
- During drag, indicate valid/invalid zones using availability and constraints.
- Confirm before saving with before/after details.
- Keep `revert()` behavior for failed/cancelled operations.
- Consider disabling drag/drop for locked/closed lessons at the interaction level.

Best-practice basis:
- FullCalendar `eventDrop` provides `revert()` for failed/cancelled saves.
- FullCalendar `eventAllow` can restrict invalid drops before they happen.
- WCAG Dragging Movements: provide an alternative to drag-only interactions.
- NN/g user control and freedom: users need a clear exit/revert path.

Acceptance criteria:
- Users understand when drag/drop is allowed and what will happen.
- Failed operations revert cleanly.

Decision: `Do`

Owner notes: We need to be careful doing that. Revertability is great and I support it, valid/invalid zones are sensitive as we don't want to restrict the user too much, needs discussion.

---

### 5.3 Add quick inspector panel

Problem:
Opening the full lesson dialog for every click is heavy.

Goal:
Support fast scanning without losing access to full details.

Proposed work:
- Use the existing workspace dock or a side panel as a quick inspector.
- Show lesson summary, attention flags, primary next action.
- Provide "Open full details" for deep operations.

Best-practice basis:
- NN/g progressive efficiency/flexibility: quick paths help frequent users without removing full-detail paths.
- NN/g minimalist design: avoid opening a dense modal when a small summary is enough.

Acceptance criteria:
- Clicking a lesson gives useful information immediately without modal overload.

Decision: `Do`

Owner notes: Lets go with option C.

Implementation options:

Option A: Quick inspector supplements the modal.
- Behavior: clicking a lesson selects it in the dock/side inspector; deeper actions still open the full lesson dialog.
- Pros: lowest risk, keeps current modal workflows intact, improves scan speed immediately, aligns with progressive disclosure.
- Cons: some users may still need to open the modal for frequent actions until later refinements.

Option B: Quick inspector replaces the modal for common actions.
- Behavior: attendance, reminders, open actions, and basic edits happen directly in the side inspector; modal is reserved for advanced/correction/financial detail.
- Pros: fastest daily operation once polished, fewer modal interruptions.
- Cons: higher implementation risk, more duplicated state/action complexity, harder to preserve safety for financial/workflow side effects.

Option C: Hybrid staged migration.
- Behavior: start with Option A. After the inspector is stable, move only low-risk common actions into it one by one.
- Pros: balances safety and speed, avoids a large risky rewrite, lets us validate which actions truly belong outside the modal.
- Cons: takes longer to reach the final streamlined experience.

Recommendation:
Use Option C. Start with a supplemental quick inspector, then gradually promote low-risk actions after the open-actions model and impact previews are stable.

Reasoning:
- NN/g progressive disclosure supports showing simple information first and deeper controls only when needed.
- NN/g error prevention favors avoiding high-risk edits in a newly introduced compact panel until safety patterns are proven.
- Atlassian form/message guidance supports keeping complex or consequential flows grouped with enough explanatory context.
- This matches the project priority order: data integrity first, then ease of use, then polish.

---

### 5.4 Improve mobile and small-screen behavior

Problem:
Resource time-grid calendars are difficult on small screens.

Goal:
Provide usable calendar operation on smaller devices.

Proposed work:
- Add mobile-friendly list/agenda mode.
- Keep day summary and attention queues visible.
- Allow common actions from list cards.
- Keep full grid for desktop/tablet where appropriate.

Best-practice basis:
- WCAG reflow, target size, focus visibility, and dragging alternatives.
- NN/g flexibility and efficiency: choose the interaction pattern that fits the device.

Acceptance criteria:
- Mobile users can review schedule and handle basic actions without horizontal grid frustration.

Decision: `Later`

Owner notes: It's a very important task, but we'll wait with it for after the desktop experience will be done, but do make sure we don't build too much technical debt as we can.

---

## Phase 6: Manual Template Generation UX

### 6.1 Make generation preview easier to understand

Problem:
Manual generation has the right safety model, but the preview can still feel technical.

Goal:
Make template generation safe and understandable.

Proposed work:
- Group preview results by outcome:
  - Will create
  - Already exists
  - Blocked by conflict
  - Missing student/client data
  - HMO/coverage warning
  - Apply failure
- Add plain-language summary before apply.
- Keep "fresh preview required" guard.

Best-practice basis:
- NN/g visibility of system status.
- NN/g error prevention.
- Atlassian warning guidance: preview significant changes before applying.

Acceptance criteria:
- Users know exactly what applying generation will do.

Decision: `Do`

Owner notes:

---

### 6.2 Improve saved repair review workflow

Problem:
Saved review is useful, but can become another hidden state users do not understand.

Goal:
Make repair/retry feel like a work queue.

Proposed work:
- Show saved review in the dock as an actionable queue.
- Add "retry failed only" CTA from the calendar page.
- Make "clear review" explain that it only clears local review state, not lessons/templates.

Best-practice basis:
- NN/g recognition rather than recall: users should not have to remember unfinished repair lists.
- Atlassian empty-state/message guidance: explain state and next action.

Acceptance criteria:
- Users can leave, repair, return, and retry without confusion.

Decision: `Do`

Owner notes:

---

## Phase 7: Language, Accessibility, and Professional Polish

### 7.1 Standardize Hebrew domain language

Problem:
Some labels are technical or mixed-language, for example "Grace".

Goal:
Use professional, consistent Hebrew terminology.

Proposed work:
- Create a calendar terminology list.
- Standardize labels for:
  - Lesson/session
  - Client/student/participant
  - Attendance/no-show/cancellation
  - Billing charge/waiver
  - Instructor compensation
  - HMO/provider claim
  - Operationally open/closed
  - Exception/override
- Replace mixed-language UI terms.

Best-practice basis:
- NN/g match between system and real world: use words and concepts familiar to users.
- NN/g consistency and standards.

Acceptance criteria:
- Calendar language feels coherent and professional.

Decision: `Do`

Owner notes: Super important.

---

### 7.2 Accessibility pass

Problem:
Calendar interactions include dense visual status, icon buttons, drag/drop, tooltips, dialogs, and RTL text.

Goal:
Make core calendar tasks usable without relying only on mouse, color, or visual memory.

Proposed work:
- Add accessible labels to icon-only buttons.
- Ensure keyboard flow through calendar actions and dialogs.
- Ensure badges/icons are not color-only.
- Verify focus states and dialog focus return.
- Add text alternatives for event status icons.

Best-practice basis:
- WCAG 2.2 keyboard access, no keyboard trap, focus visible, focus not obscured, use of color, headings/labels, error identification, target size, and dragging alternatives.

Acceptance criteria:
- Key tasks are usable with keyboard and screen-reader-friendly labels.

Decision: `Do`

Owner notes:

---

### 7.3 Visual consistency and hierarchy pass

Problem:
The calendar has many cards, alerts, badges, and dialogs built over time.

Goal:
Make the page feel like one designed system.

Proposed work:
- Split into smaller subtasks before implementation:
  - Message tone audit: alerts, warnings, destructive states, empty states.
  - Calendar event visual audit: cards, badges, icons, workflow strips, reminder indicators.
  - Dialog layout audit: headers, descriptions, footers, primary/secondary/destructive action placement.
  - Financial/HMO/payroll impact visual audit.
  - Spacing/radius/typography pass after structural UX work settles.
- Define consistent tones:
  - Neutral information
  - Success/completed
  - Warning/attention
  - Destructive/blocking
  - Finance impact
  - HMO impact
  - Payroll impact
- Normalize spacing, card radius, titles, subtitles, and footer actions.
- Make primary actions visually consistent.

Best-practice basis:
- NN/g consistency and standards.
- Atlassian message patterns: message type should determine tone, color, and icon.

Acceptance criteria:
- Calendar UI feels intentional, not assembled from unrelated flows.
- Each polish subtask can be implemented and reviewed independently.

Decision: `Do`

Owner notes: Be careful with that, as it includes a lot at once, probably would be smart to cut it to sub-tasks.

---

## Verification Plan

For every implemented item:
- Run relevant unit tests where available.
- Run `npm run build`.
- Manually test admin/owner role.
- Manually test instructor self-scoped role where relevant.
- Test at least:
  - normal lesson create
  - group lesson create
  - direct client create
  - conflict create attempt
  - outside availability create attempt
  - drag/drop reschedule
  - attendance mark attended
  - no-show/cancellation with preview
  - locked lesson behavior
  - manual generation preview/apply if touched

Regression risks to explicitly check:
- Org isolation headers still flow through `authenticatedFetch`.
- No direct use of deprecated tenant clients.
- Calendar mutations still sync billing, payroll, and workflow closure.
- Locked finance states cannot be bypassed.
- Expected-version conflict handling still works.
- Instructor self-scope is preserved.

## Open Product Questions

Resolved or deferred:
- Should instructor/student/client conflicts ever be overridable? Deferred. Current warning-only behavior remains for shipping speed; revisit later.
- If conflicts are overridable, which roles can override them? Deferred with conflict policy.
- Should capacity exceeded be blocking or overridable? Blocking.
- Which calendar tasks must be available to instructors versus admin/owner only? Deferred. Preserve current role behavior for now.
- Should mobile support be full editing or mainly read/review plus basic actions? Deferred. Mobile view comes after desktop.
- Should the quick inspector replace the modal for common actions, or only supplement it? Recommendation documented in section 5.3: use staged hybrid migration.

## Suggested First Milestone

Recommended first milestone based on owner decisions:
1. Improve empty/setup states for missing availability and missing instructor/service setup.
2. Add actionable dock queues for attention categories.
3. Add the supplemental quick inspector foundation in the workspace dock.
4. Add server-backed edit/reschedule impact preview with a scan-friendly design.
5. Add compact status education using hover/focus explanations first, not a permanently visible full legend.
6. Start the Hebrew terminology cleanup for labels touched by the above work.

Rationale:
This sequence respects the decision to postpone conflict enforcement while still improving safety, clarity, and learnability. It avoids a broad visual redesign before the operational workflow is easier to understand.

## Implementation Progress

### 2026-04-29 First Milestone Start

Implemented:
- Added centralized calendar workspace derivations in `src/features/calendar/utils/calendarWorkspace.js`:
  - actionable attention queues
  - setup-aware empty-state metadata
  - fact-derived lesson open actions
- Updated `CalendarWorkspaceDock.jsx`:
  - compact status education chips with hover explanations
  - action-oriented attention queues
  - supplemental quick inspector foundation for selected lessons
  - open-actions list instead of a single "next action"
- Updated `CalendarPage.jsx`:
  - attention queue item selection
  - setup empty-state action routing
  - availability repair routing from calendar empty state
- Updated `ReinexFullCalendar.jsx` and `reinex-fullcalendar.css`:
  - contextual empty states
  - empty-state actions for employees/services/create/template/availability repair flows

Verified:
- `npm run build` passes.
- Targeted ESLint passes for touched calendar files:
  - `src/features/calendar/utils/calendarWorkspace.js`
  - `src/features/calendar/components/CalendarWorkspaceDock.jsx`
  - `src/features/calendar/components/ReinexFullCalendar.jsx`
  - `src/features/calendar/pages/CalendarPage.jsx`

Not implemented yet:
- Server-backed edit/reschedule impact preview.
- Full lesson-details redesign.
- Full filter system.
- Conflict blocking remains postponed by owner decision.
- Mobile/agenda mode remains postponed by owner decision.

### 2026-04-30 Reschedule Preview Start

Implemented:
- Added `preview-update-instance` support to `PUT /api/calendar/instances`.
- Extended `fetchLessonMutationState()` to include `datetime_start` and `duration_minutes`, so update/preview paths can compare against complete scheduling state.
- The preview action reuses the same target resolution path as real updates:
  - expected version check
  - finance lock check
  - instructor self-scope restriction
  - service-duration derivation when service changes
  - instructor leave validation
  - instructor service availability validation
- Added a non-mutating preview payload with:
  - `can_apply`
  - changed fields
  - impacts
  - availability/leave validation status
- Updated drag/drop reschedule confirmation in `ReinexFullCalendar.jsx`:
  - fetches server preview before confirmation
  - disables confirmation while preview loads, errors, or blocks
  - shows a scan-friendly before/after and impact panel
  - keeps existing revert behavior

Verified:
- Targeted ESLint passes for:
  - `api/_shared/calendar-editing.js`
  - `api/calendar/index.js`
  - `src/features/calendar/components/ReinexFullCalendar.jsx`
- `npm run build` passes.

Still needed:
- Improve preview field labels for service names if service changes from the edit dialog.
- Add dedicated backend tests for preview contracts if/when the project has endpoint test coverage for calendar updates.

### 2026-04-30 Lesson Edit Preview Integration

Implemented:
- Reused `preview-update-instance` inside `LessonInstanceDialog.jsx`.
- Edit mode now uses a preview-before-save flow:
  - first click builds the server preview
  - preview shows changed fields and downstream impacts
  - second click confirms and performs the existing save mutation
- Preserved the existing actual save path, billing warning handling, and version-conflict resolver.
- Cleared stale edit previews when the form changes.
- Removed dead unused helper code exposed by targeted lint.

Verified:
- Targeted ESLint passes for:
  - `api/_shared/calendar-editing.js`
  - `api/calendar/index.js`
  - `src/features/calendar/components/ReinexFullCalendar.jsx`
  - `src/features/calendar/components/LessonInstanceDialog.jsx`
- `npm run build` passes.

Still needed:
- Add dedicated backend tests for preview contracts if/when the project has endpoint test coverage for calendar updates.
- Consider extracting the preview cards into a shared component once the design stabilizes across drag/drop and edit dialog.
