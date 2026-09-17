# Instructor pay — technical prerequisites (D9)

This is the answer to D9 in [business-process-map.md](business-process-map.md), which asked for an investigation and a decision on what must be true technically before the monthly instructor-pay cycle (S5.5) is built.

## What exists today (verified in code, 2026-09-15)

| Area | Today | Problem |
|---|---|---|
| Per-lesson pay | `syncLessonInstructorEarnings` (`api/_shared/employee-finance.js`) writes one `lesson_earnings` row per lesson and instructor: rate × lesson hours, counted once or per student (`fixed_rate` / `per_student`). Excused ("grace") participants are skipped, and absences follow the compensation decision. | The rate is the instructor's **current** `instructor_service_capabilities.base_rate`. Any later re-sync of an old lesson (an edit, attendance fix or correction) recalculates it with today's rate. |
| Rate history | A `RateHistory` table exists: employee, optional service, rate, `effective_date`. It came over from TutRate, and `implementations/finance/PLAN.md` kept it as "the effective-dated rate history table". | **No logic uses it**; only backup, export and purge touch it. Pay reads `current_rate` and `base_rate` instead. |
| Hourly and monthly employees | `api/payroll` computes hourly pay from attendance minutes × `current_rate`, and monthly salary pro-rated over working days, plus leave pay and corrections. | Also uses the current rate, so past months change when a rate changes. |
| Pay period | A `payroll_runs` table (`draft → finalized → cancelled`) exists. | **Nothing creates a run.** There's no review, approval or close step. |
| Protection of paid months | Lesson locks exist for claim batches. | No payroll locks are ever written (#49). Past months stay editable, and lessons that owe pay never close ("נותר לסגירה: שכר מדריך/ה"). |
| Corrections | `finance_corrections` and `payroll-adjustments` exist. | There's no rule for corrections to an already-paid month. |
| Screens | A per-employee preview (Settings → employees → `EmployeeFinancePanel`). | No monthly, org-wide pay screen, no export for the accountant, no instructor self-view. |

So the confusion you felt is real. The calculation pieces exist, but there's no **cycle** around them: no period, no approval, no freeze. The inputs (rates) also aren't pinned to dates.

## Prerequisites, in order

| # | Prerequisite | Why |
|---|---|---|
| **P1** | **Pay rules as approved scenarios**, written by you with my drafts: which pay models the first farm needs (per lesson / hourly / monthly / per student); what an instructor earns for each outcome (attended, no-show, customer cancellation, farm cancellation, excused); group lessons; leave; how corrections after a paid month work. | Everything else encodes these rules. Without them the code keeps guessing, and that's where the confusion comes from. |
| **P2** | ✅ **Phase 1 built** (2026-09-17): pay reads only `RateHistory`, with backfill and transition triggers. Phase 1b is the rate screen with effective dates and warnings. **Dated rates in `RateHistory`** (owner decision, 2026-09-15). A rate is "from this date on, until the next rate change, the rate is X". Details below the table. | Otherwise a paid month can't be reproduced. |
| **P3** | **Frozen earnings after close.** Before a period closes, earnings follow lesson changes as they do now. After it closes, a lesson change never edits that period; it creates an explicit adjustment in the next open period. | Otherwise the numbers you already paid drift. |
| **P4** | **A pay-period cycle** using the existing `payroll_runs`: one per org per month, *open → reviewed → closed*. Closing links `lesson_earnings.payroll_run_id`, writes payroll locks on those lessons (this is the #49 fix), and re-syncs lesson closure. | This is the "finish the cycle of the month". |
| **P4b** | **Record when each day's list was sent** to each instructor (the manual send button today, the WhatsApp automation later; S3.6). This is the cutoff between an ordinary cancellation and a late one (PAY-B3 / B4). | Pay and billing for cancellations depend on it (owner decision PD2). |
| **P5** | **A trusted source of hours** for hourly and monthly staff: derived from lessons, clocked in, or entered manually. This is a decision to make. | Hourly pay is only as good as its hours. |
| **P5b** | **Legal amounts as dated settings:** minimum wage, the recuperation day rate, the travel cap, and the leave, holiday and sick rules (PAY-K). Each has a legal default, the date it was last checked, a source link, and the farm's override. The legal disclaimer appears on close and on export. | Legal values change every year or two; hard-coding them would silently go stale. |
| **P6** | **Tests first.** Node tests for P2–P4 (rate over time, close, adjustment after close) plus one tester scenario for the whole month. | Money logic; the costliest place to be wrong. |
| **P7** | **Outputs:** a monthly screen per instructor and in total, an export for the accountant (format decided with them), and later an instructor's view of their own month. | What the office actually uses at month end. |

### P2 in detail: `RateHistory` as the single source of truth for pay rates

This is the owner's decision (2026-09-15).

**Every rate is a dated row.** A row means "from `effective_date` until the next row of the same kind, this employee's `rate` is X". A change adds a row; nothing is edited in place.

**New column: `pay_basis`,** which says what the number means:

| `pay_basis` | Service | Meaning | Replaces |
|---|---|---|---|
| `lesson_hourly` | required | Instructor pay per lesson hour for that service (× duration, once or per student) | `instructor_service_capabilities.base_rate` |
| `lesson_flat` | required | Instructor pay per lesson for that service, whatever its length (once or per student). Not used by the owner's farm, but supported for other farms. | — (new) |
| `attendance_hourly` | none | Hourly pay for attended work hours (office staff) | `Employees.current_rate` |
| `monthly_salary` | none | Monthly salary, pro-rated over working days | `Employees.monthly_salary_amount` |
| `leave_day` (optional) | none | The value of a paid leave day, where the farm uses a fixed day rate | `Employees.leave_fixed_day_rate` |

**Rules:**
- **One lookup, no fallback.** Each calculation asks for one kind: a lesson asks for `lesson_hourly` of its service on its date, attendance hours ask for `attendance_hourly`, a month asks for `monthly_salary`. Exactly one row can answer. A lesson for a service with no rate row is flagged as "missing rate" and is never guessed.
- **Employees with more than one role** (for example an instructor who also works office hours) simply have rows of both kinds. Their pay model on any date is whatever kinds of rows are in effect then, so `Employees.payroll_model` becomes a display default rather than a source.
- **`instructor_service_capabilities`** keeps "can teach this service" (plus max students and availability), but not the rate.
- **Retired:** `current_rate`, `base_rate`, `monthly_salary_amount` (and `leave_fixed_day_rate` if `leave_day` is adopted). A rate edit on any screen creates a `RateHistory` row.
- **The earnings row keeps a copy** of the rate it used (`lesson_earnings.rate_used`) for the record only.
- **A back-dated change** (an effective date in the past) recalculates only periods that are still open. Closed periods keep their numbers, and the difference becomes an adjustment in the next open period (P3).

**Technical notes:**
- The unique key becomes (org, employee, `pay_basis`, service, `effective_date`). Rows with no service need `NULLS NOT DISTINCT`, or an expression index, so that two rows with no service on the same date conflict.
- **Existing data:** seed one row per current value (each capability's `base_rate`, each employee's `current_rate` / `monthly_salary_amount`), dated from the employee's start date or first lesson.

**Owner answers (2026-09-15):**
- **Flat pay per lesson** exists at other farms (the same pay even if the lesson runs longer or shorter), so `lesson_flat` is a supported kind. For one instructor and service, only one lesson kind can be in effect at a time.
- **"Paid once per lesson vs. per student"** stays a setting on the **service** (`Services` payment model). It isn't per instructor and isn't dated. Per-instructor overrides may be considered later if a farm needs them. Changing it affects only lessons in periods that are still open; closed periods are frozen (P3).

**Rate-change screen rules:**
- Every rate change asks for an **effective date** ("from this date on"). The default is today.
- **Warning when the date is in the past:** "This rate will apply to lessons that already took place. Lessons in open months will be recalculated; closed months won't change, and the difference will be added as an adjustment to the next open month." The office confirms to continue.
- **Stronger warning when the date is before the current rate's effective date:** the new rate is inserted between two existing rates and applies only until the next one. The screen shows the resulting timeline (from → until → rate) before saving.
- **Future dates are allowed:** the rate is scheduled and takes effect automatically on that date. The screen shows "current rate X, from 1.10: Y".
- **The screen shows the history** (the list of rows) for each employee, kind and service. Rows are never edited in place; a mistaken row is corrected by adding a new row, and removing a row requires a reason.

## Decision

- **P1 is drafted** in [payroll-scenarios.md](payroll-scenarios.md): 48 scenarios. PD1–PD10 and the follow-ups were answered and confirmed on 2026-09-17. Section K (Israeli legal pay components) was researched and waits for a check by the accountant. Nothing else blocks it.
- **Stage 4 attendance is already reliable enough** to build on (tested), so the payroll work doesn't depend on other gaps.
- **Build order after P1:** P2 → P3 → P4 → P7, with P6 tests written alongside each step. P5 only if the first farm has hourly or monthly staff.
- **Neither earlier #49 option is enough.** "Count pay as settled once recorded" (option B) is dropped. P4 is option A done properly, on top of P2 and P3.
