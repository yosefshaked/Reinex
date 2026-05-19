Optimizing tool selection...I’m extracting the actual leave/payroll architecture from this codebase rather than proposing a fresh design first. I’ll inspect the leave, work-session, selectors, reports, and API paths to reconstruct the old model and then map that into a concrete Reinex target architecture.

Read memory

I’m gathering the highest-signal files in parallel: repo docs, leave helpers, API handlers, selectors, and tests that encode behavior. The outcome should be enough to infer the old domain model from implementation rather than assumptions.

Read [](file:///c%3A/dev/salary-app/Employee-Management/ProjectDoc/Eng.md#1-1), lines 1 to 260

Read [](file:///c%3A/dev/salary-app/Employee-Management/src/lib/leave.js#1-1), lines 1 to 260

Read [](file:///c%3A/dev/salary-app/Employee-Management/src/selectors.js#1-1), lines 1 to 260

Read [](file:///c%3A/dev/salary-app/Employee-Management/api/_shared/leave-ledger.js)

Read [](file:///c%3A/dev/salary-app/Employee-Management/api/leave-balances/index.js#1-1), lines 1 to 320

Read [](file:///c%3A/dev/salary-app/Employee-Management/api/work-sessions/index.js#1-1), lines 1 to 320

The first pass already shows the old design was payroll-first: `WorkSessions` is the canonical paid-event table, while `LeaveBalances` is a linked quota ledger. I’m now tracing the exact behaviors for creation, deletion, selectors, and reports so the reuse recommendation is grounded in real flows.

Searched for regex `LeaveBalances|leave_balance|work_session_id|leave_half_day|leave_employee_paid|leave_system_paid|leave_unpaid` (`**/api/work-sessions/index.js`), 5 results

Searched for regex `computeEmployeeLeaveSummary|selectHolidayForDate|selectLeaveRemaining|selectLeaveDayValue|leave_pay_policy` (`**/src/**`), 75 results

Searched for regex `leave_half_day|leave_employee_paid|leave_system_paid|leave_unpaid|total_payment|rate_used` (`**/test/**`), 91 results

Searched for regex `LeaveBalances|work_session_id|time_entry_leave|leave_policy|leave_pay_policy` (`**/src/**`), 120 results

I’ve confirmed the separation pattern: UI logic computes leave eligibility and day value, API logic synchronizes a quota ledger from leave-type work-session rows. Next I’m reading the exact code paths that enforce this so I can call out what is structural versus what is accidental coupling.

Read [](file:///c%3A/dev/salary-app/Employee-Management/api/work-sessions/index.js#330-330), lines 330 to 430

Read [](file:///c%3A/dev/salary-app/Employee-Management/api/work-sessions/index.js#430-430), lines 430 to 760

Read [](file:///c%3A/dev/salary-app/Employee-Management/src/lib/leave.js#640-640), lines 640 to 790

Read [](file:///c%3A/dev/salary-app/Employee-Management/src/selectors.js#260-260), lines 260 to 390

Read [](file:///c%3A/dev/salary-app/Employee-Management/src/components/time-entry/useTimeEntry.js#1080-1080), lines 1080 to 1605

Read [](file:///c%3A/dev/salary-app/Employee-Management/test/time-entry.global-leave.audit.test.js)

I’ve now got the core invariant: leave rows are stored as `WorkSessions` only when they are meant to affect pay or share the time-entry flow, and each such row spawns a `LeaveBalances` ledger entry with a signed quota delta. I’m filling in the manual-allocation and reporting side to separate true domain concepts from UI convenience.

Read [](file:///c%3A/dev/salary-app/Employee-Management/api/leave-balances/index.js#240-240), lines 240 to 410

Read [](file:///c%3A/dev/salary-app/Employee-Management/src/api/leave-balances.js)

Read [](file:///c%3A/dev/salary-app/Employee-Management/src/components/employees/LeaveOverview.jsx#150-150), lines 150 to 320

Read [](file:///c%3A/dev/salary-app/Employee-Management/test/leave.test.js)

Read [](file:///c%3A/dev/salary-app/Employee-Management/src/components/reports/PayrollSummary.jsx#1-1), lines 1 to 240

Read [](file:///c%3A/dev/salary-app/Employee-Management/test/time-entry.test.js#130-130), lines 130 to 280

The manual side is clear now: `LeaveBalances` is not just an index of time-off rows, it also accepts standalone positive or corrective entries and is what drives remaining balance calculations. I’m reading the payroll aggregator next so I can state exactly where operational leave ends and finance begins in the old model.

Searched for regex `computePeriodTotals|leavePay|adjustments|daysPaid|totalPay|payable` (`**/src/lib/**`), 49 results

Searched for regex `deleteLedgerForSession|insertLedgerForSession|failed_to_permanently_delete_session|failed_to_delete_session|soft delete|deleted_at` (`**/api/work-sessions/index.js`), 23 results

Searched for regex `TIME_ENTRY_LEAVE_BALANCE_EXCEEDED|TIME_ENTRY_LEAVE_CONFLICT|selectLeaveRemaining|createLeaveBalanceEntry|deleteLeaveBalanceEntries` (`**/src/components/time-entry/useTimeEntry.js`), 10 results

Read [](file:///c%3A/dev/salary-app/Employee-Management/src/lib/payroll.js)

I’ve got enough to state the model with confidence. I’m checking the final delete/restore behavior because it matters for whether `LeaveBalances` is intended as a true ledger or merely a derived mirror of leave rows.

Read [](file:///c%3A/dev/salary-app/Employee-Management/api/work-sessions/index.js#740-740), lines 740 to 809

I’ve confirmed a critical nuance: `LeaveBalances` is treated as the balance authority for remaining quota, but time-entry leave rows are still the source for paid leave in payroll. That means copying the old model directly would import a deliberate coupling between leave operations and finance, not just a table structure.

Searched for text ``Acts as the immutable ledger for employee leave allocations and usage|Every leave saved through the Time Entry flow now creates a matching `LeaveBalances` row|entry_type` | 'session', 'hours', 'adjustment', 'leave_employee_paid', 'leave_system_paid', 'leave_unpaid', or 'leave_half_day'`` (`**/ProjectDoc/Eng.md`), 7 results

Searched for text `` buildLedgerEntryFromSession|balance: delta|leave_type: `${TIME_ENTRY_LEAVE_PREFIX}_${baseKind}` `` (`**/api/_shared/leave-ledger.js`), 2 results

Searched for regex `computeEmployeeLeaveSummary|carryover_enabled|remaining: Number\(balance.toFixed\(3\)\)|used: Number\(usage.toFixed\(3\)\)` (`**/src/lib/leave.js`), 8 results

Searched for text `selectLeaveRemaining|computeEmployeeLeaveSummary|selectLeaveDayValue` (`**/src/selectors.js`), 6 results

Searched for text `isPaidLeave|bucket.leavePay|bucket.daysPaid|result.totalPay \+= payAmount` (`**/src/lib/payroll.js`), 5 results

Searched for text `TIME_ENTRY_LEAVE_BALANCE_EXCEEDED|summary = selectLeaveRemaining|createLeaveBalanceEntry|deleteLeaveBalanceEntries` (`**/src/components/time-entry/useTimeEntry.js`), 7 results

Searched for text ``Leave rows: quota deductions use `entry_type='leave_employee_paid'`|Monthly totals and reports sum `total_payment` from `WorkSessions` rows only|Half-day usage is now driven entirely by the `entry_type='leave_half_day'` flag`` (`**/ProjectDoc/Eng.md`), 3 results

Searched for regex `soft delete ledger cleanup failed|deleteLedgerForSession\(tenantClient, sessionId\)|insertLedgerForSession\(tenantClient, restoredSession\)` (`**/api/work-sessions/index.js`), 6 results

Searched for text `employeePaidDays|systemPaidCount|leaveSummary = selectLeaveRemaining` (`**/src/components/reports/PayrollSummary.jsx`), 7 results

Searched for text `global paid_leave persists and counts daily rate|saves unpaid mixed leave without payment|saves half-day leave with fraction metadata for globals` (`**/test/time-entry.test.js`), 3 results

--------------------------------------------------------------------------------------------------------------------------------------------

**Section 1: Observed old-model structure**

This old project was not built with a clean separation between leave operations and payroll. It was built as a payroll system first, and leave was layered into that payroll model.

The strongest evidence is in the documented schema and calc rules in Eng.md, the leave ledger builder in leave-ledger.js, the leave summary logic in leave.js, and the payroll aggregator in payroll.js.

1. Role of WorkSessions in the old project

WorkSessions was the canonical payable-event table.

It represented:
- worked hours
- instructor sessions
- manual payroll adjustments
- paid leave
- unpaid leave
- half-day leave

That is explicit in Eng.md and the calculation rules in Eng.md.

Its real job was:
- store one row per payroll-relevant day/event
- freeze payroll valuation at creation time via rate_used and total_payment
- drive reports and payroll totals directly

That last point matters most: monthly totals and reports summed total_payment from WorkSessions only, with no separate salary layer added afterward, as documented in Eng.md and implemented in payroll.js.

So in the old system, WorkSessions was not just “attendance” or “time tracking.” It was the payroll fact table.

2. Role of LeaveBalances in the old project

LeaveBalances was the leave quota ledger, not the payroll table.

Its job was:
- track allocations and deductions as signed quantities
- support carryover, adjustments, and annual quota summaries
- answer “how much leave remains”

That is documented in Eng.md and computed in leave.js, with selectors wired through selectors.js.

Important nuance:
- remaining balance came from LeaveBalances plus policy rules
- pay came from WorkSessions
- the two were kept in sync by application logic

So LeaveBalances was authoritative for balance, but not authoritative for pay.

3. How leave creation was probably modeled

The old flow was roughly this:

- Admin created leave from the Time Entry flow, not from a separate leave domain.
- The UI first calculated leave balance impact using selectLeaveRemaining in useTimeEntry.js.
- It blocked overdraft using TIME_ENTRY_LEAVE_BALANCE_EXCEEDED in useTimeEntry.js.
- It calculated leave day value using historical payroll/work-session data via selectLeaveDayValue in selectors.js.
- It inserted one or more WorkSessions leave rows.
- It then inserted matching LeaveBalances rows through createLeaveBalanceEntry in useTimeEntry.js.
- On delete/restore of a leave WorkSession, it deleted/recreated linked LeaveBalances rows in index.js.

That means leave was modeled as:
- an operational event inside payroll entry UI
- then mirrored into the ledger

4. How half-day leave was modeled

Half-day was treated as a special leave entry type, not just a flag.

Evidence:
- documented as leave_half_day in Eng.md
- ledger delta of -0.5 in leave-ledger.js
- tests confirm half-day payment and metadata in time-entry.test.js and time-entry.global-leave.audit.test.js

Behavior was probably:
- create a WorkSessions row with entry_type = leave_half_day
- total_payment = half of resolved daily leave value
- create a LeaveBalances row with balance = -0.5
- for more complex half-day cases, the UI could create a leave row plus a work row on the same date

So half-day was not only a calendar concept. It was a payroll-valued artifact.

5. How balance deductions were modeled

Balance deductions were not inferred later from payroll. They were explicitly written into LeaveBalances.

Rules inferred from code/docs:
- employee-paid leave: ledger delta -1
- half-day leave: ledger delta -0.5
- system-paid leave: ledger delta 0
- unpaid leave: ledger delta 0

That mapping is explicit in leave-ledger.js and described in Eng.md.

This is an important design choice:
- not every leave-like event deducted balance
- not every leave-like event changed pay
- those two decisions were related, but separate

6. How pay calculations were modeled

Pay was derived from WorkSessions rows, not from leave ledger rows.

The old project computed:
- hourly pay from hours × rate
- instructor pay from session/service logic
- global salary as daily prorated value by working days in month
- paid leave using a resolved daily leave value
- unpaid leave as total_payment = 0
- adjustments as direct payroll rows

Evidence:
- calc rules in Eng.md
- daily leave valuation in selectors.js
- payroll aggregation in payroll.js

For global employees specifically, the tests show:
- paid leave got the daily global rate
- unpaid leave got zero
- half-day got half daily value

See time-entry.global-leave.audit.test.js and time-entry.global-leave.audit.test.js.

7. Clear distinction between the three concepts in the old project

Operational time-off / unavailability:
- Not truly modeled as its own bounded domain.
- In practice, leave dates were often represented by leave-type WorkSessions rows.
- Conflict checks also looked at existing WorkSessions, which means calendar blocking was partly piggybacking on payroll rows.

Leave balance ledger:
- Properly modeled in LeaveBalances.
- Used for remaining/used/quota/carryover calculations.
- Included manual allocations and corrections, not just time-entry-created usage.

Payroll artifacts:
- Fully centered in WorkSessions.
- Reports used total_payment from these rows.
- Leave became a payroll artifact as soon as it was entered.

That means the old architecture had one clean concept and one overloaded concept:
- LeaveBalances was relatively clean.
- WorkSessions was overloaded.

**Section 2: Risks/problems in copying it directly**

1. It couples calendar operations to payroll too early

If Reinex needs admin-entered date-range leave and future calendar blocking before finance exists, then writing leave into WorkSessions is the wrong abstraction. In the old system, that worked because payroll was the primary product.

2. It forces one row per payroll day/event, not one leave business object

Your new requirement is date-range leave entered manually by admins. The old model is naturally row-per-day because payroll values are daily. That is awkward for:
- multi-day approval/change/cancel
- future blocking
- audit of one admin action
- changing a range without rewriting many rows

3. It creates sync burden between WorkSessions and LeaveBalances

The old project had to delete/reinsert ledger entries when WorkSessions changed or were restored, shown in index.js. That is a code smell for Reinex if leave is supposed to be its own domain.

4. It pollutes the ledger with zero-delta records

The old system intentionally created ledger rows even for system-paid and unpaid leave, sometimes with balance 0, per Eng.md. That makes sense for one integrated audit trail, but it weakens the ledger if your goal is a clean quota ledger.

5. Leave valuation depends on payroll history

selectLeaveDayValue uses prior WorkSessions earnings/hours to value leave in selectors.js. That is finance logic, not leave management logic. Reinex should not require payroll history just to record leave and block a calendar.

6. Half-day and mixed cases become too complex too early

The old time-entry hook had to manage:
- leave rows
- work rows
- second-half logic
- ledger insert/delete
- pay override/fallback logic

That complexity is justified only when leave entry is a payroll entry flow. It is not a good base model for an operational HR leave module.

**Section 3: Recommended Reinex architecture**

My recommendation is:

Do not use WorkSessions as the primary table for base leave management.

Keep WorkSessions only as a payroll/finance artifact table for later phases, or replace it with a clearer PayrollEntries table if you are willing to evolve the legacy model.

A concrete target architecture in public schema:

1. Employee weekly availability

Reuse:
- Employees.working_days if you only need weekday presence such as SUN/MON/TUE

Do not overbuild this yet if you only need weekly days.

If you later need per-day hours or multiple shifts, split it into a separate table:
- EmployeeWeeklyAvailability
- columns: id, tenant_id, employee_id, weekday, is_working, start_time, end_time, created_at, updated_at

For phase 1, Employees.working_days is reusable.

2. Date-based leave / unavailability exceptions

Create a new table as the operational source of truth.

Recommended table:
- EmployeeDateExceptions

Recommended columns:
- id
- tenant_id
- employee_id
- start_date
- end_date
- duration_mode: full_day, half_day, custom
- half_day_part: first_half, second_half, null
- exception_kind: unavailability, leave
- leave_pay_kind: employee_paid, system_paid, unpaid, null
- status: planned, approved, cancelled
- blocks_calendar: true
- deducts_balance: true/false
- source: admin_manual
- notes
- created_by
- created_at
- updated_at
- cancelled_at

This table should drive:
- future calendar blocking
- employee availability calculations
- admin edits/cancellations
- audit of one human leave action

This is the domain object missing in the old project.

3. Leave ledger

Reuse the LeaveBalances concept, but narrow its purpose.

Recommended table:
- LeaveLedger
- or keep LeaveBalances name if that helps migration

Recommended columns:
- id
- tenant_id
- employee_id
- source_exception_id nullable
- source_type: allocation, carryover, manual_adjustment, leave_consumption, reversal, payout
- effective_date
- period_start nullable
- period_end nullable
- quantity_days numeric
- notes
- created_by
- created_at

Rules:
- positive rows add entitlement
- negative rows consume entitlement
- only balance-affecting events go here
- do not create zero-delta rows just to mirror operational events
- summary function should remain very close to the old computeEmployeeLeaveSummary contract:
  - remaining
  - used
  - quota
  - carryIn
  - allocations
  - adjustments

This is the strongest piece to reuse conceptually from the old project.

4. Payroll / finance rows

If you keep WorkSessions, redefine its boundary:

WorkSessions should contain only payroll-relevant rows, not general leave state.

It should be created only when one of these is true:
- actual work was performed
- a payroll adjustment is posted
- a leave exception has been payrollized for a pay period
- finance needs a frozen valuation snapshot

If you can extend the schema, add:
- source_exception_id
- payroll_run_id
- valuation_method
- valuation_snapshot
- payable
- quantity_days or quantity_hours

If you do not want to overload WorkSessions again, create:
- PayrollEntries

That would be cleaner than inheriting the old semantics.

5. Explicit domain boundaries

Employee weekly availability:
- recurring weekly pattern
- no ledger effect
- no payroll effect by itself

Date exceptions:
- actual absences or planned unavailability on dates/ranges
- calendar blocking source
- may or may not imply leave deduction
- may or may not imply future payroll

Leave ledger:
- entitlement accounting only
- no payroll amount columns
- no work/time data
- no calendar blocking

Payroll rows:
- frozen financial artifacts only
- contain money/rate snapshots
- derived from work and approved exceptions
- safe for payroll reports and audit

6. What to reuse from the old project

Reuse:
- Employees.working_days idea
- signed leave ledger concept
- balance summary logic from leave.js
- carryover/proration policy behavior
- distinction between employee-paid leave, system-paid leave, unpaid leave, and half-day
- leave day valuation logic later, in finance phase only

Do not reuse:
- creating leave directly as WorkSessions
- using WorkSessions as the calendar-blocking source
- creating zero-delta ledger rows for every leave-like event
- delete/restore sync behavior between WorkSessions and ledger
- requiring payroll valuation before operational leave can be saved

7. If WorkSessions remains, exactly when to create it

My recommendation:
- do not create WorkSessions during base leave management

Create WorkSessions only in finance phase, from approved exceptions.

Recommended trigger points:
- payroll preview generation
- payroll run finalization
- manual finance posting of a leave item

What a finance-created leave WorkSession should contain:
- employee_id
- date
- entry_type: leave_employee_paid, leave_system_paid, leave_unpaid, leave_half_day
- source_exception_id
- payroll_run_id
- payable
- rate_used
- total_payment
- notes
- metadata or valuation_snapshot containing:
  - valuation method
  - lookback window
  - override if any
  - derived fraction such as 0.5

If an approved date-range exception spans multiple payable days, materialize one payroll row per payable day. That preserves the old payroll/reporting advantages without making the operational model depend on it.

8. If WorkSessions should not be created during base leave management, why

Because in Reinex phase 1 the primary business problem is:
- availability
- admin-entered leave ranges
- balance tracking
- future blocking

None of those requires a payroll fact row.

Creating WorkSessions too early would introduce:
- monetary snapshots before finance rules are settled
- row-per-day persistence for a range-based business object
- needless coupling to pay valuation
- sync logic between domain tables

The bridge to finance should be:
- EmployeeDateExceptions as operational source
- LeaveLedger as balance source
- a payroll materializer that converts approved exceptions into payroll rows later

That bridge can be either:
- on-demand payroll preview
- payroll-run posting
- event-driven posting when an exception becomes approved and payroll-applicable

I would favor payroll-run posting plus preview, because it is idempotent and easier to audit.

**Section 4: Migration/implementation sequence**

1. Freeze the target boundaries first
- Decide that EmployeeDateExceptions is operational truth.
- Decide that LeaveBalances or LeaveLedger is entitlement truth.
- Decide that WorkSessions is finance truth only.

2. Reuse Employees.working_days immediately
- Keep the existing field for weekly working days.
- Do not normalize yet unless you need hours/shifts.

3. Add the new operational exception table
- Implement range-based leave/unavailability entries.
- Make calendar blocking read only from this table plus weekly pattern.

4. Adapt the ledger model
- Keep existing LeaveBalances if needed, but add source_exception_id and source_type if possible.
- Stop writing zero-delta rows.
- Deduct only when an exception is balance-affecting and approved.

5. Backfill old leave WorkSessions into the new model
- Convert legacy leave-type WorkSessions into EmployeeDateExceptions.
- Convert linked LeaveBalances rows into ledger entries.
- Preserve old WorkSessions as historical finance artifacts.

6. Change all future leave writes
- New admin leave UI writes EmployeeDateExceptions.
- If balance-affecting, also writes LeaveLedger.
- It does not write WorkSessions.

7. Add finance bridge later
- Build a payroll materializer that reads approved exceptions and actual work rows.
- Create payroll rows idempotently with source_exception_id and payroll_run_id.
- Only then reuse or extend WorkSessions for leave pay.

8. Migrate reports in stages
- availability/calendar views read weekly availability + date exceptions
- leave balance views read ledger + policy
- payroll views read WorkSessions or PayrollEntries only

**Section 5: Open questions that must be answered before coding finance**

1. When is leave balance consumed?
- on admin creation
- on approval
- on start date
- on payroll close

2. For a date range, what counts as deductible days?
- all calendar days
- only employee working days
- working days excluding company holidays
- do half-days inside a range need explicit per-day breakdown

3. What is the finance treatment matrix?
- employee-paid leave
- system-paid leave
- unpaid leave
- half-day leave
- mixed ranges with both paid and unpaid segments

4. Is system-paid leave a leave object or a holiday object?
- should it live in the same exception table with different pay treatment
- or in a separate company calendar table referenced by exceptions/payroll

5. Do you need one finance row per day or aggregated finance rows per payroll period?
- old project used per-day rows
- that is simpler for audit and reruns

6. For monthly/global employees, is paid leave additional pay or included salary recognition?
- the old project treated it as explicit paid rows
- your finance model may prefer a different representation

7. What happens after payroll is closed?
- can operational leave be edited
- if yes, does that create reversal payroll rows
- or reopen the payroll period

8. If public schema is shared across tenants, what is the tenancy key?
- tenant_id or org_id must be present on every new table
- unique indexes and foreign keys should include it where needed
- this must be decided before any migration

9. Do you need approval workflow now or later?
- if later, still reserve status fields on exceptions and ledger source_type values now

10. Is LeaveBalances meant to remain a business-facing ledger name?
- if yes, keep the name and change semantics
- if no, rename to LeaveLedger early before Reinex code spreads the old meaning

The short version is:

- Reuse the old LeaveBalances idea.
- Reuse the old leave summary policy logic.
- Reuse Employees.working_days.
- Do not reuse the old habit of creating leave as WorkSessions during base HR flow.
- Keep WorkSessions only as a later finance artifact generated from approved operational exceptions.

If you want, the next useful step is for me to turn this into a concrete Reinex schema proposal with table definitions, keys, and lifecycle rules for:
1. EmployeeDateExceptions
2. LeaveLedger
3. payroll materialization from exceptions into WorkSessions or PayrollEntries