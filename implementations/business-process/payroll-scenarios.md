# Instructor pay — rules as scenarios (P1)

These are the pay rules the monthly cycle will enforce, written as acceptance scenarios. They follow the same format as [business-process-map.md](business-process-map.md). Each one becomes a test (IDs such as `PAY-B2`) *before* the code is built. See [payroll-prerequisites.md](payroll-prerequisites.md) for the technical plan.

**Status:**
- The owner answered PD1–PD10 on 2026-09-17 and confirmed the follow-ups.
- Section K and the legal notes come from research done on 2026-09-17. They must be checked by the farm's accountant or payroll advisor; see the disclaimer.

**How to read the tables:**
- The **Scenario** column is the rule we want.
- The **Today** column is what the code does now, verified 2026-09-15.

**Scope** (confirmed): Reinex calculates each employee's **gross pay components**: lessons, hours, salary, leave, holidays, sick days, recuperation, travel, pay differences and adjustments. It follows the legal rules as farm-editable settings and hands the result to the accountant. Tax, pension, severance and net pay stay in the accountant's payroll software.

---

## A — Rates (dated, in `RateHistory`)

| ID | Scenario | Today |
|---|---|---|
| PAY-A1 | A rate set "from 1.10" pays every lesson from 1.10 on, until the next rate change. Lessons before 1.10 keep the previous rate. | ✅ Pay reads the `RateHistory` rate in effect on the lesson's date (phase 1) |
| PAY-A2 | A rate with a future effective date is scheduled. It shows as "current X, from 1.10: Y" and takes effect on its own. | ✅ The rates screen schedules a future rate and shows it as "from 1.10: X" while the current rate stays (phase 1b) |
| PAY-A3 | A back-dated rate change warns first. If confirmed, it recalculates lessons in open months. For closed months it adds a linked pay difference to the next open month (see H5 / I1). | ❌ |
| PAY-A4 | A lesson whose instructor has no rate for that service on that date is flagged as "missing rate". Nothing is guessed, nothing is paid until a rate exists, and the flag blocks closing the month (H4). | 🟡 No rate on the lesson date means no pay (the earning is skipped and marked `missing_rate`), and attendance and completion are blocked. The review flag and close blocker come with the monthly cycle |
| PAY-A5 | An instructor paid per hour (`lesson_hourly`) earns rate × lesson length. An instructor paid per lesson (`lesson_flat`) earns the same amount whatever the length. | ✅ Each service rate is saved as hourly or flat from the rates screen |
| PAY-A6 | An employee who also works office hours has an hourly rate for those hours as well as their lesson rates. Each part of the month is paid from its own rate. | 🟡 Separate kinds exist and each has its own dated rate; the screen shows an employee-level kind only when their pay model or an existing rate calls for it, so an instructor who also works office hours still needs their pay model changed first |

## B — One lesson, one participant: what does the instructor earn?

**Source of truth: the lesson itself.** Whatever is recorded on the participant in the lesson (status, and the "paid / not paid" decision for the instructor) is final. The farm's settings below only pre-fill that decision; the office can always change it for a specific lesson.

A key moment is **the day's list being sent** (S3.6): the point when the instructor learns who's coming.

| ID | Scenario | Today |
|---|---|---|
| PAY-B1 | **Attended:** the instructor is paid. | ✅ |
| PAY-B2 | **No-show:** paid by default, because the instructor expected the student. | ✅ |
| PAY-B3 | **Cancelled by the customer before the day's list was sent:** not paid by default; the instructor never expected the student. | 🟡 Always unpaid; the "list sent" moment isn't recorded |
| PAY-B4 | **Cancelled by the customer after the day's list was sent** (a late cancellation): paid by default, as for a no-show. | ❌ Unpaid today |
| PAY-B5 | **Cancelled by the farm:** not paid by default. | ✅ |
| PAY-B6 | **Excused absence:** not paid by default. The instructor wasn't supposed to expect the lesson. | ✅ |
| PAY-B7 | For any participant, the office can set "paid" / "not paid" in the lesson, pre-filled from B2–B6. That choice is final and wins over every default. | ✅ The choice exists; the pre-fill doesn't know B3/B4 yet |

Customer billing for the same cases is S4.4–S4.5 in the map. A cancellation before the list was sent, by a student with an excused absence still available, isn't billed.

## C — Group lessons

| ID | Scenario | Today |
|---|---|---|
| PAY-C1 | Service set to **paid once per lesson**: the instructor is paid once if at least one participant triggers pay, however many attended. | ✅ |
| PAY-C2 | Service set to **paid per student**: the instructor is paid once for each participant who triggers pay. | ✅ |
| PAY-C3 | Mixed outcomes, for example 2 attended, 1 no-show and 1 cancelled: each participant counts according to B1–B7, and per-student pay counts only the ones that trigger pay. | ✅ |
| PAY-C4 | A lesson where no participant triggers pay earns nothing, and shows as "no pay" in the monthly review, not as missing. | 🟡 It earns nothing; the review doesn't exist yet |

## D — Changes to a lesson

| ID | Scenario | Today |
|---|---|---|
| PAY-D1 | **Substitute instructor:** the pay goes to whoever gave the lesson, at the substitute's rate for that date. | ✅ Pay goes to the lesson's instructor at their rate on the lesson date |
| PAY-D2 | **Length changed:** hourly pay is recalculated if the month is open, and becomes a linked pay difference if it's closed. | 🟡 Always recalculated, closed months included |
| PAY-D3 | **Attendance fixed after the lesson:** recalculated if the month is open, and becomes a linked pay difference if it's closed. | 🟡 Recalculated, unless a claim batch locks the lesson |
| PAY-D4 | **Lesson moved to another date:** the pay belongs to the month of the new date, at the rate valid on that date. | ✅ It follows the new date, at that date's rate |

## E — Hours

| ID | Scenario | Today |
|---|---|---|
| PAY-E1 | The pay is the hours worked × the hourly rate valid on each day. | ✅ Hours × the hourly rate in effect on each day |
| PAY-E2 | **An instructor's lesson hours** come from the lessons they gave. | ✅ Derived from lessons |
| PAY-E3 | **An hourly employee who isn't an instructor** enters their own hours (the office can enter them too). The office approves them. Unapproved hours block closing the month (H4). The record of actual hours is the employer's legal record (K6). | 🟡 The office enters hours by hand; there's no self-entry or approval |

## F — Monthly salary

| ID | Scenario | Today |
|---|---|---|
| PAY-F1 | The salary is paid in full for a full month. An employee who joins or leaves mid-month is paid the share of working days they were employed. | 🟡 Pro-rated over working days; joining or leaving mid-month 🔍 |
| PAY-F2 | Unpaid leave reduces the month by the day's share. Paid leave doesn't. | ✅ |

## G — Annual leave

| ID | Scenario | Today |
|---|---|---|
| PAY-G1 | **Monthly-salary employees** keep their regular salary during leave. **Hourly and per-lesson employees** are paid (gross wages of the last 3 months ÷ 90) × the number of leave days counted *including* weekends. If those 3 months weren't full, the fullest 3 consecutive months of the last 12 are used. The wage base includes paid absence days (leave, sick, holiday). | ❌ The code averages over *worked* days (3 or 12 months), which doesn't match the law |
| PAY-G2 | A half day is paid at half the day's value. Unpaid leave pays nothing. | ✅ |
| PAY-G3 | Paid leave days appear as their own line in the monthly review. | 🟡 They appear in the employee preview |

## H — The monthly cycle

| ID | Scenario | Today |
|---|---|---|
| PAY-H1 | Each month has one pay period per farm. It opens on its own. | ❌ |
| PAY-H2 | The office reviews the month: each employee's lessons, hours, leave, legal components (K), pay differences, adjustments and total. | 🟡 A per-employee preview exists; no org-wide review |
| PAY-H3 | Closing shows a final summary to confirm, including the legal disclaimer. Once closed, the month is frozen: the pay is final, its lessons are locked against direct edits, and lesson closure is re-synced, which clears "נותר לסגירה: שכר מדריך/ה". | ❌ (#49) |
| PAY-H4 | **Closing is blocked** while the month has any of: lessons with unmarked attendance, missing rates, lessons without an instructor, or unapproved hours. The screen lists every blocker: what it is, where, and a link that opens it (the lesson in the calendar, the employee's profile) in a **new tab**. The list refreshes when the office returns. | ❌ |
| PAY-H5 | **A closed month is never reopened.** Every later change becomes a **pay difference** ("הפרש שכר") in the next open month, linked to the lesson or rate that caused it and to the month it corrects, with a reason. | ❌ |
| PAY-H6 | The office is reminded to close the month in good time: pay is due by the 9th of the following month (K7). | ❌ |

## I — After the month is closed

| ID | Scenario | Today |
|---|---|---|
| PAY-I1 | A correction to a lesson or a rate in a closed month creates the pay difference from H5 automatically. The next month's review shows it as its own line: "הפרש עבור 09/2026". | ❌ Lessons change silently |
| PAY-I2 | A manual bonus or deduction has an amount, a date and a note, and lands in the month of its date (or the next open month, if that month is closed). | 🟡 Exists (bonus / deduction / adjustment / correction); the closed-month rule is ❌ |

## J — Outputs and access

| ID | Scenario | Today |
|---|---|---|
| PAY-J1 | A monthly summary per employee and in total, with the lines that make up each total. | 🟡 A per-employee preview in Settings |
| PAY-J2 | An export of the closed month for the accountant: a detailed spreadsheet (Excel / CSV) per employee with every component. The farm can choose and order the columns. The export carries the legal disclaimer. | ❌ |
| PAY-J3 | An employee sees their own month, read-only: lessons or hours, lines and total. | 🟡 The preview allows their own record |
| PAY-J4 | The owner, admins **and the office** can review and close a month. Nobody can reopen one (H5). | ❌ |

## K — Legal pay components (Israel)

The amounts below are as researched on 2026-09-17. Every legal amount and rule is stored as a **dated farm setting** with its source, with legal defaults the farm can edit, because the values change (see the legal notes).

| ID | Scenario | Today |
|---|---|---|
| PAY-K1 | **Holiday pay (דמי חגים)** for hourly and per-lesson employees: up to 9 holiday days a year, after 3 months of work, for a holiday that fell on a day they were scheduled to work (not Friday / Saturday), provided they worked or were excused the day before and after. The amount is their average daily hours over the preceding 3 months × their hourly rate. Monthly employees already get it inside their salary. | ❌ |
| PAY-K2 | **Sick pay (דמי מחלה):** 1.5 days are accrued per month, up to 90. For a sick period: day 1 is unpaid, days 2–3 are paid at 50%, and day 4 onward in full. Days are counted per illness period from the employee's side. It requires a medical certificate. | ❌ No sick-leave type |
| PAY-K3 | **Recuperation pay (דמי הבראה):** after 1 year of work, the number of days by seniority × the day rate (451.50 ₪ for 2026 in the private sector), proportional to the job scope. It's paid in the month the farm chooses. | ❌ |
| PAY-K4 | **Minimum wage check:** each month, an employee's pay for their hours worked (lessons included) is compared with the hourly minimum (35.40 ₪ from 1.4.2026; lower youth rates under 18). If it falls short, a top-up line is added. Reimbursements and bonuses don't count toward the minimum. | ❌ |
| PAY-K5 | **Travel reimbursement:** per working day, the actual cost up to the daily cap (22.60 ₪ in 2026); half for one direction. | ❌ |
| PAY-K6 | **Record of hours:** every employee's actual hours are kept per day (derived from lessons, or entered and approved). Rest-time rules are outside this scope. | 🟡 Attendance records exist; approval ❌ |
| PAY-K7 | **Pay date:** the month's pay is due by the 9th of the following month; this drives H6. | ❌ |

---

## Legal notes and disclaimer

**Disclaimer.** Shown in the close-month confirmation (H3), on the monthly review, and in every export (J2):

> החישובים מבוססים על כללי דיני העבודה כפי שהיו ידועים במועד העדכון האחרון של Reinex, ועל ההגדרות שקבע הארגון. הכללים והתעריפים משתנים מעת לעת, ו-Reinex אינה יועצת שכר או גורם מוסמך בתחום. יש לאמת את החישובים מול רואה החשבון או יועץ השכר של הארגון לפני סגירת החודש ותשלום השכר.

**Rules to keep current** (each a dated setting, with the date it was last checked):

| Rule | Value as of 2026-09-17 | Source |
|---|---|---|
| Hourly minimum wage | 35.40 ₪ (monthly 6,443.85 ₪), from 1.4.2026 | [כל-זכות: שכר מינימום](https://www.kolzchut.org.il/he/%D7%A9%D7%9B%D7%A8_%D7%9E%D7%99%D7%A0%D7%99%D7%9E%D7%95%D7%9D) |
| Recuperation day rate (private sector) | 451.50 ₪ (extension order published 18.8.2026, effective from 1.7.2025) | [מלם שכר](https://www.malam-payroll.com/%D7%A2%D7%93%D7%9B%D7%95%D7%9F-%D7%AA%D7%A2%D7%A8%D7%99%D7%A3-%D7%99%D7%95%D7%9D-%D7%94%D7%91%D7%A8%D7%90%D7%94-%D7%9C%D7%A9%D7%A0%D7%AA-2026-%D7%91%D7%9E%D7%92%D7%96%D7%A8-%D7%94%D7%A4%D7%A8%D7%98/), [כל-זכות: דמי הבראה](https://www.kolzchut.org.il/he/%D7%93%D7%9E%D7%99_%D7%94%D7%91%D7%A8%D7%90%D7%94) |
| Travel reimbursement daily cap | 22.60 ₪ | [bizportal](https://www.bizportal.co.il/career/news/article/20035635) |
| Leave-day value | Monthly: regular salary. Hourly: 3 months' gross ÷ 90 (fullest 3 months of the last 12 if needed); Annual Leave Law, section 10 | [כל-זכות: תשלום דמי חופשה](https://www.kolzchut.org.il/he/%D7%AA%D7%A9%D7%9C%D7%95%D7%9D_%D7%93%D7%9E%D7%99_%D7%97%D7%95%D7%A4%D7%A9%D7%94) |
| Holiday pay | 9 days a year for hourly workers after 3 months; average daily hours over 3 months × hourly rate | [כל-זכות: דמי חגים](https://www.kolzchut.org.il/he/%D7%93%D7%9E%D7%99_%D7%97%D7%92%D7%99%D7%9D) |
| Sick pay | 1.5 days a month (maximum 90); day 1: 0%, days 2–3: 50%, day 4 on: 100% | [כל-זכות: ימי מחלה](https://www.kolzchut.org.il/he/%D7%99%D7%9E%D7%99_%D7%9E%D7%97%D7%9C%D7%94) |
| Record of hours | The employer keeps a record of actual hours (Work Hours and Rest Law, section 25) | [gov.il: רישום שעות עבודה](https://www.gov.il/he/pages/work-hours-documentation) |
| Pay date | By the 9th of the following month | [כל-זכות: מועד תשלום השכר](https://www.kolzchut.org.il/he/%D7%9E%D7%95%D7%A2%D7%93_%D7%AA%D7%A9%D7%9C%D7%95%D7%9D_%D7%94%D7%A9%D7%9B%D7%A8) |

**Not researched, and left to the accountant:**
- the recuperation seniority table;
- collective agreements that might apply to a specific farm;
- pension, severance, tax and national insurance.

---

## Decisions for the owner

| # | Decision | Today's default | Owner answer |
|---|---|---|---|
| PD1 | No-show: is the instructor paid by default? | Paid | By default the instructor is paid because it expected a student to arrive, changeable through configuration or specific session |
| PD2 | Customer cancellation: is a late cancellation paid? If so, inside how many hours? | Never paid | Depends how late, in our business, if it was cancelled before the list of sessions was sent to the instructors and the student has available excused absence, they don't pay |
| PD3 | Farm cancellation on the same day, after the instructor arrived: paid? | Never paid | I don't see such a scenerio happens but not paid by default |
| PD4 | Excused absence: is the instructor paid? Is it the same rule as a no-show? | Never paid | Not paid if excused, the instructor isn't supposed to know it was supposed to happen in the first place if it's excused |
| PD5 | Hours for hourly employees: entered by the office, clocked in, or derived from lessons? | Derived from lessons unless entered by hand | If the hourly employee is not an instructor, it is entered by hand, preferably by the employee themselves |
| PD6 | Closing a month with unmarked attendance or missing rates: block it, or allow it after a confirmation? | — | Block with letting the user know what and where blocks it, if possible to allow them to open in a new tab the list it would help with them going back and forth between the list and the calendar/profiles |
| PD7 | Can a closed month be reopened? By whom? | — | I need your suggestion here, what is the correct handling in such a situation? In my opinion a closed month shouldn't be reopened, only fixed, but I want to go with the best practices of the profession |
| PD8 | Which payroll software or format does the accountant use? Confirm the leave-day method with them. | Legal average | I don't know what software the accountant use, the software we have access to is only regarding invoices and income, needs to fit the legal rules but customizable by the user |
| PD9 | Do instructors see their own monthly pay in the system? | Their own preview is possible | I don't see a reason not to |
| PD10 | Who closes a month: owner / admin only, or the office too? | — | office too |

**Follow-ups, confirmed by the owner on 2026-09-17:**
1. A late cancellation (after the day's list was sent) pays the instructor by default. Whatever is set on the participant in the lesson is the source of truth (B7).
2. Self-entered hours need office approval before the month can close (E3).
3. Reinex calculates gross pay components only. The legal rules were researched and come with a disclaimer to verify with the accountant or a payroll professional before closing.

**PD7 recommendation (adopted):** a closed month is never reopened; fixes become pay differences (H5). Payslips for a closed, paid month are legal records, and later corrections appear in the next period as explicitly labelled retroactive differences ("הפרשי שכר").
