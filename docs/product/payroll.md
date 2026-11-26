# Pay and leave

The product rules for what an employee is paid and how much leave they have. Format: [README](README.md). How the code does it: [`../project-rules/80-finance-billing-payroll.md`](../project-rules/80-finance-billing-payroll.md) and [`../project-rules/50-employees-and-instructors.md`](../project-rules/50-employees-and-instructors.md). The legal research behind it: [`../research/israel-payroll-components.md`](../research/israel-payroll-components.md).

**Scope** (PD8, follow-up 3): Reinex computes each employee's **gross pay components** (lessons, hours, salary, leave, and later holidays, sick days, recuperation, travel and adjustments) and hands them to the accountant. Tax, pension, severance and net pay stay in the accountant's payroll software.

**Tests:** the pay rules are executable in [`tests/payroll-rules.test.js`](../../tests/payroll-rules.test.js) (one `PAY-*` ID per scenario; an unbuilt rule is an `it.todo`), with the monthly calculation in [`tests/pay-calculation.test.js`](../../tests/pay-calculation.test.js). The leave rules are in [`tests/leave-entitlement.test.js`](../../tests/leave-entitlement.test.js), [`tests/leave-pay-policy.test.js`](../../tests/leave-pay-policy.test.js), [`tests/leave-balance-reason.test.js`](../../tests/leave-balance-reason.test.js) and [`tests/dated-settings.test.js`](../../tests/dated-settings.test.js). Below, `payroll-rules` and `pay-calculation` mean those two files.

---

## Pay rules

### A — Rates

| ID | Rule | Why | Status | Tests |
|---|---|---|---|---|
| PAY-A1 | A rate set "from 1.10" pays every lesson from 1.10 until the next change of that kind; earlier lessons keep the earlier rate. | A rate change must not rewrite pay already earned (PD11). | built | `payroll-rules` PAY-A1 |
| PAY-A2 | A rate with a future date is scheduled: it shows as "current X, from 1.10: Y" and takes effect on its own. | The office enters a raise when it is agreed, not on the day. | built | `payroll-rules` PAY-A2 |
| PAY-A3 | A back-dated rate change warns first, then changes the pay of every month it reaches (PD21). | A past date changes pay that may already have been shown or paid. | not built | `payroll-rules` PAY-A3 (todo); the live recalculation: `pay-calculation` "a rate added for a past date changes the pay of that month straight away" |
| PAY-A4 | A lesson whose instructor has no rate for its service on its date is "missing rate": nothing is guessed, nothing is paid until a rate exists, and the monthly summary lists it. (The scenario's "blocks closing the month" is retired with month closing, PD21.) | A guessed rate is a wrong payment nobody notices. | partly built | `payroll-rules` PAY-A4 (real and todo) |
| PAY-A5 | Paid per hour (`lesson_hourly`): rate × lesson length. Paid per lesson (`lesson_flat`): the same amount whatever the length. | Both exist at farms (owner, 2026-09-15). | built | `payroll-rules` PAY-A5 |
| PAY-A6 | An employee with several kinds of rates (lessons, office hours, salary) is paid each part of the month from its own rate. | One person can teach and do office work (PD12). | built | `payroll-rules` PAY-A6 |

### B — One lesson, one participant

The lesson is the source of truth: whatever is recorded on the participant (status, and a "paid / not paid" choice for the instructor) is final. The farm's settings only pre-fill that choice. A key moment is when **the day's list is sent** to the instructor.

| ID | Rule | Why | Status | Tests |
|---|---|---|---|---|
| PAY-B1 | Attended: the instructor is paid. | — | built | `payroll-rules` PAY-B1 |
| PAY-B2 | No-show: paid by default. | The instructor expected the student (PD1). | built | `payroll-rules` PAY-B2 |
| PAY-B3 | Cancelled by the customer before the day's list was sent: not paid by default. | The instructor never expected the student (PD2). | partly built: always unpaid; the "list sent" moment is not recorded | `payroll-rules` PAY-B3 (real and todo) |
| PAY-B4 | Cancelled by the customer after the list was sent (a late cancellation): paid by default, as a no-show. | Follow-up 1 to PD2. | not built | `payroll-rules` PAY-B4 (todo) |
| PAY-B5 | Cancelled by the farm: not paid by default. | PD3. | built | `payroll-rules` PAY-B5 |
| PAY-B6 | Excused absence: not paid by default. | The instructor was not supposed to expect the lesson (PD4). | built | `payroll-rules` PAY-B6 |
| PAY-B7 | For any participant the office can set "paid" / "not paid" in the lesson, pre-filled from B2–B6. That choice is final. | Follow-up 1: the lesson is the source of truth. | partly built: the pre-fill does not know B3/B4 | `payroll-rules` PAY-B7 (real and todo) |
| PAY-B8 | Whether a participant pays the instructor follows the earnings policy in force on the lesson's date; only a choice made in the absence form is stored, and it overrides the policy. | A policy change from a date must reach exactly the lessons from that date (PD16). | built | `payroll-rules` PAY-B8; `pay-calculation` "a choice made in the absence form overrides the policy" |

### C — Group lessons

| ID | Rule | Why | Status | Tests |
|---|---|---|---|---|
| PAY-C1 | A service paid **once per lesson** pays the instructor once if at least one participant triggers pay. | The service decides the model, not the instructor (owner, 2026-09-15). | built | `payroll-rules` PAY-C1 |
| PAY-C2 | A service paid **per student** pays once for each participant who triggers pay. | Same. | built | `payroll-rules` PAY-C2 |
| PAY-C3 | Mixed outcomes: each participant counts by B1–B8. | — | built | `payroll-rules` PAY-C3 |
| PAY-C4 | A lesson where no participant triggers pay earns nothing and shows as "no pay", not as missing. | "No pay" and "missing" need different action. | partly built | `payroll-rules` PAY-C4 (real and todo) |

### D — Changes to a lesson

| ID | Rule | Why | Status | Tests |
|---|---|---|---|---|
| PAY-D1 | A substitute: the pay goes to whoever gave the lesson, at their rate on that date. | — | built | `payroll-rules` PAY-D1; `pay-calculation` "reassigning one lesson to another instructor moves its pay…" |
| PAY-D2 | A length change recalculates hourly pay, in any month (PD21). | — | not built | `payroll-rules` PAY-D2 (todo) |
| PAY-D3 | An attendance fix after the lesson recalculates pay, in any month (PD21). | — | not built | `payroll-rules` PAY-D3 (todo) |
| PAY-D4 | A lesson moved to another date belongs to the month of the new date, at that date's rate. | — | built | `payroll-rules` PAY-D4 |

### E — Hours

| ID | Rule | Why | Status | Tests |
|---|---|---|---|---|
| PAY-E1 | Hours are paid as hours worked × the hourly rate valid on each day. | — | built | `payroll-rules` PAY-E1 |
| PAY-E2 | An instructor's lesson hours come from the lessons they gave and are kept apart from other work that day, so lesson time is never also paid by the hour. | No double pay. | built | `payroll-rules` PAY-E2; `pay-calculation` "adds up lesson minutes per day" |
| PAY-E3 | An hourly employee who is not an instructor enters their own hours (the office can too); the office approves them. | PD5 and follow-up 2; the record of hours is the employer's legal record (PAY-K6). | not built: the office enters hours; no self-entry or approval | `payroll-rules` PAY-E3 (todo) |

### F — Monthly salary

| ID | Rule | Why | Status | Tests |
|---|---|---|---|---|
| PAY-F1 | A full month pays the full salary; joining or leaving mid-month pays the share of working days employed. | — | not built for joining or leaving (a full month is built: `pay-calculation` "a full salaried month adds up to exactly the salary") | `payroll-rules` PAY-F1 (todo) |
| PAY-F2 | Unpaid leave reduces the month by the day's share; paid leave does not. | — | built | `payroll-rules` PAY-F2; `pay-calculation` "an unpaid full day on salary takes one daily rate off the salary" |

### G — Annual leave pay

| ID | Rule | Why | Status | Tests |
|---|---|---|---|---|
| PAY-G1 | Salaried employees keep their salary during leave. Hourly and per-lesson employees are paid by the "ממוצע מומלץ" method: the wage base of the fullest 3 consecutive calendar months of the last 12 ÷ 90 × 7 ÷ W (W = 6 for a six-day week, else 5) per net leave day; the base includes paid leave. | The Annual Leave Law, section 10 (PD19; research: [leave pay](../research/israel-payroll-components.md#how-is-a-leave-day-valued)). | built | `payroll-rules` PAY-G1; `pay-calculation` "PAY-G1 the "ממוצע מומלץ" leave value through the monthly pay" |
| PAY-G2 | A half day pays half the day's value; unpaid leave pays nothing. (A salaried half day: LV-8.) | — | built | `payroll-rules` PAY-G2 |
| PAY-G3 | Paid leave days are their own line in the monthly summary: "חופשה: N ימים × ₪X". | — | built | `payroll-rules` PAY-G3; `pay-calculation` "the leave line counts paid days…" |

### J — Outputs and access

| ID | Rule | Why | Status | Tests |
|---|---|---|---|---|
| PAY-J1 | A monthly summary per employee and in total, with the lines that make up each total. | What the office uses at month end. | not built per the tests (the summary exists, `EmployeePaySummary` and the "שכר" tab; the todo is stale) | `payroll-rules` PAY-J1 (todo); `tests/pay-summary.test.js` |
| PAY-J2 | An export of a month for the accountant (Excel / CSV), with farm-chosen columns and the legal disclaimer. | PD8: the accountant's software is unknown. | not built | `payroll-rules` PAY-J2 (todo) |
| PAY-J3 | An employee sees their own month, read-only. | PD9. | not built | `payroll-rules` PAY-J3 (todo) |

### K — Legal pay components (Israel)

Every legal amount is a **dated farm setting** with its source, a legal default the farm can edit, and the date it was last checked; the monthly summary and every export carry the disclaimer below. Values and sources: [research](../research/israel-payroll-components.md).

| ID | Rule | Status | Tests |
|---|---|---|---|
| PAY-K1 | Holiday pay for hourly and per-lesson employees: up to 9 days a year after 3 months, for a holiday on a scheduled work day, × their average daily hours × hourly rate. | not built | `payroll-rules` PAY-K1 (todo) |
| PAY-K2 | Sick pay: 1.5 days a month up to 90; day 1 unpaid, days 2–3 at 50%, from day 4 in full; needs a medical certificate. | not built (no sick-leave type) | `payroll-rules` PAY-K2 (todo) |
| PAY-K3 | Recuperation pay after 1 year: days by seniority × the dated day rate, proportional to job scope, paid in the month the farm chooses. | not built | `payroll-rules` PAY-K3 (todo) |
| PAY-K4 | Minimum wage: pay for hours worked (lessons included) is topped up to the dated hourly minimum; reimbursements and bonuses do not count. | not built | `payroll-rules` PAY-K4 (todo) |
| PAY-K5 | Travel: actual cost per working day up to the dated daily cap; half for one direction. | not built | `payroll-rules` PAY-K5 (todo) |
| PAY-K6 | Every employee's actual hours are kept per day (derived from lessons, or entered and approved). | partly: attendance records exist; approval does not | `payroll-rules` PAY-K6 (todo) |
| PAY-K7 | A month's pay is due by the 9th of the following month. | not built | `payroll-rules` PAY-K7 (todo) |

**Disclaimer** (shown on the monthly summary and every export):

> החישובים מבוססים על כללי דיני העבודה כפי שהיו ידועים במועד העדכון האחרון של Reinex, ועל ההגדרות שקבע הארגון. הכללים והתעריפים משתנים מעת לעת, ו-Reinex אינה יועצת שכר או גורם מוסמך בתחום. יש לאמת את החישובים מול רואה החשבון או יועץ השכר של הארגון לפני סגירת החודש ותשלום השכר.

---

## Leave rules

| ID | Rule | Why | Status | Tests |
|---|---|---|---|---|
| LV-1 | The leave days a calendar year gives come from, in order: a manual yearly number on the employee; else the organisation default, either a fixed table by seniority year (the default) or the law. | Farms set leave by contract with their accountant; the law is offered, not imposed (PD17). | built | `leave-entitlement` "a manual number wins over the organisation default…", "the fixed table gives the row of the seniority year…" |
| LV-2 | By the law: seniority = calendar years touched; the gross table 16 × 5, 18, 21, then +1 a year up to 28, converted to working days; a whole year is full from 200 days worked, a year started part-way from 240, below that pro rata, kept to 2 decimals; no leave before 75 days of employment. | Annual Leave Law, as summarised by Kol Zchut (PD17, PD18). | built | `leave-entitlement` "the law: Kol Zchut worked examples", "when the system does not compute" |
| LV-3 | A day worked is a date with a counted lesson or recorded office minutes, once per date; a paid leave day counts as a day worked, unpaid leave does not. | PD18. | built | `leave-entitlement` "a day with a counted lesson or with office minutes counts once" |
| LV-4 | Exactly 6 defined working days use the 6-day table; anything else, none included, the 5-day table. | PD17. | built | `leave-entitlement` "exactly six defined days is a 6-day week…" |
| LV-5 | Nothing caps a carry-over; carrying days from last year is a manual change. | PD18. | built | `leave-entitlement` "nothing caps a carry-over…" |
| LV-6 | Every manual balance change has a reason: carry-over, or add or remove, with "other" needing text; the history shows who and when. | An auditable balance. | built | `leave-balance-reason` |
| LV-7 | A leave day is valued by the employee's leave-pay method in force on that day ("ממוצע מומלץ", a historical average, or a fixed day value), else the organisation default on that day. | Dated settings (PD16). | built | `dated-settings` "each leave day is valued by the version in force on that day, per employee"; `pay-calculation` "a leave day is valued by the leave-pay policy in force on that day" |
| LV-8 | On a salaried day, leave is part of the salary. A paid half day pays the full day when work was recorded that day (a counted lesson or office minutes), otherwise half a day, and the summary marks it "חצי יום חופשה בלי שעות". | The salary covers the day only if the other half was worked. | built | `pay-calculation` "a paid half day with work recorded that day pays the full day", "…with no work pays half a day and is listed with its date" |
| LV-9 | A full day of leave cannot be recorded on a day with hours or lessons, nor hours or a lesson on a full leave day; a half day can share the day with work. | A day is either leave or work. | built | `tests/org-scope-reads.test.js` (`assertNoLeaveForAttendance`, `assertNoLeaveForLesson`); `tests/attendance-month-grid.test.js` (the messages) |

---

## Decisions

| ID | Decision | Date | Source | Verified by |
|---|---|---|---|---|
| PD1 | A no-show pays the instructor by default, changeable by configuration or per lesson. | 2026-09-17 | owner answers, [`payroll-scenarios.md`](../plans/payroll/payroll-scenarios.md) | PAY-B2 |
| PD2 | A customer cancellation before the day's list was sent, by a student with an excused absence available, is not paid; after it (late), it is paid. | 2026-09-17 | same, and follow-up 1 | PAY-B3, PAY-B4 |
| PD3 | A farm cancellation is not paid by default. | 2026-09-17 | same | PAY-B5 |
| PD4 | An excused absence is not paid. | 2026-09-17 | same | PAY-B6 |
| PD5 | A non-instructor hourly employee enters their own hours; the office approves them. | 2026-09-17 | same, follow-up 2 | PAY-E3 (not built) |
| PD6 | Closing a month is blocked while anything is unmarked or missing, with a list that opens each blocker in a new tab. | 2026-09-17 | same | superseded by PD21 |
| PD7 | A closed month is never reopened; fixes become pay differences in the next month. | 2026-09-17 | same, the PD7 recommendation | superseded by PD21 |
| PD8 | Reinex computes gross components only, follows the law as editable settings, and exports for the accountant. | 2026-09-17 | same, follow-up 3 | Scope above; PAY-J2 (not built) |
| PD9 | An employee may see their own month. | 2026-09-17 | same | PAY-J3 (not built) |
| PD10 | The office can close a month, as well as owners and admins. | 2026-09-17 | same | superseded by PD21 |
| PD11 | Every rate is a dated `RateHistory` row of one kind (`pay_basis`: per-service lesson hourly or flat, office hourly, monthly salary, leave day); a lesson reads the rate of its kind in force on its date; there is no fallback between kinds; "once per lesson / per student" stays a service setting. | 2026-09-15 | owner, [`payroll-prerequisites.md`](../plans/payroll/payroll-prerequisites.md) P2 | `api/_shared/rate-history.js`; `tests/dated-settings.test.js` "migration 0002 copies the legacy rates…" |
| PD12 | Pay is additive across kinds: an employee is paid every part they have rates for; there is no pay model. | 2026-09-23 | owner, recorded in `project-rules/80` | PAY-A6 |
| PD13 | Pay is computed live from facts; nothing derived (lesson earnings, pay runs, lesson minutes) is stored. A changed rate, mark or lesson shows on the next read. | 2026-11-10 | the owner-approved implementation plan of pay computed live (outside the repository), built in [#55](https://github.com/yosefshaked/Reinex/pull/55) (`migrations/0001_live_pay_remove_stored_copies.sql`) | `pay-calculation` "a rate added for a past date changes the pay of that month straight away" |
| PD14 | A past lesson nobody marked is paid as attended and flagged "לא סומן"; a cancelled lesson never is. | 2026-11-10 | same plan, decision 1 | `pay-calculation` "a lesson that ended and nobody marked is paid as attended and flagged as unmarked" |
| PD15 | A missing rate blocks adding a lesson or moving it to another instructor, service or date; it never blocks marking attendance, completing a lesson, template generation or imports. | 2026-11-10 | same plan, decision 2 | `pay-calculation` "a lesson cannot be given to an instructor without a rate…", "marking attendance is never blocked by a missing rate" |
| PD16 | A setting that changes pay is dated, like a rate: each lesson or leave day reads the version in force on its date. | 2026-11-16 | owner, recorded in `project-rules/80` | `tests/dated-settings.test.js` |
| PD17 | Leave entitlement: a manual number, else the organisation's fixed table (the default from 2026-11-22) or the law; the law's choices where it leaves room are listed in `api/_shared/leave-entitlement.js`. | 2026-11-16, 2026-11-22 | owner, recorded in `project-rules/50` | LV-1 to LV-4 |
| PD18 | A paid leave day counts as a day worked; leave days are kept to 2 decimals, not rounded down; there is no carry-over cap. | 2026-11-17 | owner, [#56](https://github.com/yosefshaked/Reinex/issues/56) comment | LV-2, LV-3, LV-5 |
| PD19 | "ממוצע מומלץ" values a leave day by the formula in PAY-G1; the window and new-employee assumptions are in the research. The accountant's check is pending. | 2026-11-18 | [#56](https://github.com/yosefshaked/Reinex/issues/56) comment | PAY-G1 |
| PD20 | "ביטול גבייה" (fee waived) on a participant: the student is not charged and the instructor is not paid. An interim choice; separating the two when the instructor was already there is open in [#60](https://github.com/yosefshaked/Reinex/issues/60). | 2026-11-17 | owner, [#57](https://github.com/yosefshaked/Reinex/issues/57) comment | instructor side: `pay-calculation` "an excused absence pays nothing even when the status alone would"; student side not built ([#57](https://github.com/yosefshaked/Reinex/issues/57) open) |
| PD21 | Pay is computed live for every month, also after a correction back in time. Locking a month's pay is not an active requirement; it is reconsidered only if a need comes up. This retires month closing (PAY-H1–H6, PAY-I1–I2, PAY-J4) and supersedes PD6, PD7 and PD10. | 2026-11-26 | owner, restructure review 4.7 ([plan](../plans/repository/directory-restructure.md)) | PD13; `pay-calculation` "a rate added for a past date changes the pay of that month straight away" |

---

## Retired rules

Kept so that their IDs stay unique and the reason is findable. Do not build them; a request to lock a month's pay is answered with PD21.

**Month closing**, approved on 2026-09-17 and retired by PD21 on 2026-11-26: pay is live for every month, so there is no period to close and no pay difference to carry.

| ID | Scenario (2026-09-17) |
|---|---|
| PAY-H1 | One pay period per farm per month, opened on its own. |
| PAY-H2 | The office reviews the month for every employee. (The monthly summary, PAY-J1, covers the review without closing.) |
| PAY-H3 | Closing confirms a summary with the disclaimer, freezes the month, locks its lessons and re-syncs lesson closure. |
| PAY-H4 | Closing is blocked by unmarked attendance, missing rates, lessons without an instructor or unapproved hours, each listed with a link. |
| PAY-H5 | A closed month is never reopened; later changes become linked pay differences in the next open month. |
| PAY-H6 | A reminder to close before pay is due on the 9th. (The pay date itself is PAY-K7.) |
| PAY-I1 | A correction in a closed month creates its pay difference automatically. |
| PAY-I2 | A bonus or deduction lands in the month of its date, or the next open month if that one is closed. (Bonuses and deductions dated in their month exist; only the closed-month part is retired.) |
| PAY-J4 | Owners, admins and the office can review and close a month; nobody can reopen one. |

## Needs confirmation

Not binding until the owner decides. Ask before changing behaviour that depends on them.

- **The 150-employee limit (L1).** Named only in the wiki, which this work did not read. Not added as a rule.
