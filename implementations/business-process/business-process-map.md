# Business Process Map — the riding-farm cycle

**Source:** the owner's description of the business cycle (2026-09-15), mapped to what Reinex does today. The owner answered D1–D9 on 2026-09-15; the scenarios below reflect those answers.

**How to use it:**
1. Every scenario is a plain-language acceptance test. The owner approves or edits it.
2. Each approved scenario becomes an automatic-tester script (end to end). Scenarios that encode a rule also get node tests. Tests carry the scenario ID (for example `S2.3`) so coverage is traceable.
3. New work writes its scenarios **before** the code.
4. Features whose scenarios aren't approved and passing stay hidden from businesses behind a feature switch.

**Status legend**

| Mark | Meaning |
|---|---|
| ✅ | Exists and has an automated test |
| 🟡 | Exists but is untested, or is only partial |
| ❌ | Missing |
| 🔍 | Not yet verified in the code |
| ⏸ | Deferred by the owner |

## Scope for the first real farm

| | Stages |
|---|---|
| **Must** | Stage 0, Stage 1 (the instructor as an entity), Stage 2, Stage 3, Stage 4, Stage 5 (for HMO customers), and monthly instructor pay (see [payroll-prerequisites.md](payroll-prerequisites.md)) |
| **Later** | Hiring pipeline (CV, interview); collecting payments inside Reinex (card clearing, business Bit/PayBox); Reinex issuing its own invoices; farm-wide activity hours (only with self sign-up) |
| **Deferred** | Horses: vet approvals and treatments for yearly reviews (#52) |

---

## Stage 0 — Farm rules (setup)

| ID | Scenario | Status |
|---|---|---|
| S0.1 | The admin defines a service with a duration and a price. Lessons of that service take its duration and charge. | 🟡 Used as setup by other tests; no scenario of its own |
| S0.2 | The admin sets the billing policy per attendance status (attended / no-show / cancelled by the customer / cancelled by the farm). Charges follow it. | ✅ Node tests (finance-calendar) |
| S0.3 | The admin defines funding bodies: HMO providers and tracks (כללית / מאוחדת / לאומית), each with a price and co-pay. An HMO lesson splits between the customer and the HMO. | ✅ `hmo-claiming` |
| S0.4 | The admin builds forms (health declaration, participation, publicity consent) and marks them as required. Students missing a required form are flagged. | ✅ `required-forms-workflow` |
| S0.5 | Each instructor's availability is what limits bookings. There are no farm-wide activity hours. | ⏸ Farm-wide hours only if self sign-up is ever added (**D1**) |
| S0.6 | The admin connects the organization to Green Invoice (Morning) and chooses the document type (receipt or tax invoice-receipt). | ❌ See S3.4 (**D6**) |
| S0.7 | The admin sets the farm's absence rules: how many excused absences a student gets, the proof required (for example a doctor's note), the deadline for bringing it, and what happens if it doesn't arrive (bill later, or bill now and credit back). | ❌ See S4.5 (**D4**) |
| S0.8 | The admin sets the package rules: the low-balance warning point (default 2–3 lessons before the end), and what happens when credit runs out (block new lessons, or allow N more first). | ❌ See S3.2 (**D3**) |

## Stage 1 — Instructor

| ID | Scenario | Status |
|---|---|---|
| S1.1 | The admin adds an instructor with contact details. The instructor appears in Employees and in the calendar. | ✅ `instructor-lifecycle` |
| S1.2 | Certificates and documents are uploaded to the instructor. Missing mandatory documents are flagged. | 🟡 Exists; scenario coverage 🔍 |
| S1.3 | The instructor's agreed days, hours and services are recorded. The calendar books them only inside that availability, or asks for an override reason. | 🟡 Exists; only breaks are tested |
| S1.4 | The instructor is invited to a user account and sees only their own lessons and the fields they're allowed to see. | 🟡 Exists; scenario 🔍 |

The hiring pipeline (CV, interview) is out of scope.

## Stage 2 — Customer intake

| ID | Scenario | Status |
|---|---|---|
| S2.1 | A customer calls or sends a WhatsApp. The office creates a waiting-list entry with the rider's age, the funding (HMO / other subsidy / private), the service, and preferred days and hours. | 🟡 Exists; untested |
| S2.2 | Alternatively, the office sends the intake-form link. The customer fills it in, and a waiting-list entry is created. | 🟡 Exists; untested |
| S2.3 | A slot fits. The entry becomes a student with a fixed weekly slot, and the weekly generation creates their lessons. | 🟡 Exists; untested (templates and generation) |
| S2.4 | No slot fits. The entry stays on the waiting list by priority. When a matching slot frees up, the office sees a suggestion. | 🟡 Exists; untested |
| S2.5 | A one-time customer is booked into an available one-time slot of the service they asked for. | ✅ `one-time-customer-lifecycle` |
| S2.6 | For an HMO customer, the approval (number of lessons, dates) is recorded before the first lesson. | ✅ `hmo-claiming` |
| S2.7 | For a minor, the parent is recorded as the contact and the payer. Separated parents can each be a payer. | 🟡 Guardians exist; untested. Split payers ❌ (see S3.7) |

## Stage 3 — Payment, forms, daily list

| ID | Scenario | Status |
|---|---|---|
| S3.1 | The customer pays in advance for 1, 5 or 10 lessons (cash / card read over the phone / Bit / PayBox). The office records the payment as a package, and the student sees "X of Y lessons left". | 🟡 Packages already store the lesson count and per-lesson price for each service at purchase. The "X of Y left" display is unverified 🔍, and payments are recorded manually. |
| S3.2 | Each attended lesson uses one lesson of the package. At the warning point (default 2–3 lessons before the end) the office gets a reminder; when the package runs out, a prominent notice. Scheduling then follows the farm's rule: block, or allow N more lessons first. | 🔍 Usage exists; the warning, the notice and the blocking rule are ❌ (**D3**, S0.8) |
| S3.3 | Other farms can charge after the lesson, or sell other package sizes. This is configurable per organization. | 🔍 |
| S3.4 | Every payment creates a document in Green Invoice (Morning), of the type the farm chose, sent to the customer as soon as the payment is recorded. | ❌ There's only a manual invoice number/link field (**D6**) |
| S3.5 | Before the first lesson (or in its first minutes), the customer gets the health / participation / publicity form by WhatsApp and fills it in. | ✅ `form-sending`, `required-forms-workflow` (the send is manual) |
| S3.6 | Once the office marks the day's schedule as organised and approved, each instructor automatically gets their list of students by WhatsApp (this farm: by 10:00). | 🟡 A manual button per instructor today. There's no "day approved" step and no WhatsApp API connection (**D7**) |
| S3.7 | Separated parents pay independently. Each payment and each Green Invoice document is for that parent's share. | ❌ (**D6**) |
| S3.8 | A price change mid-package doesn't affect packages already bought: they finish at their purchase price, and the next package uses the new price. | 🟡 Package lines store their price at purchase. Verify that consumption uses it 🔍 (**D2**) |
| S3.9 | A student leaving mid-package gets the unused lessons (× the package's per-lesson price) back as a refund, or as credit toward a later purchase. The office chooses per case. | ❌ (**D2**) |

## Stage 4 — After the lesson

| ID | Scenario | Status |
|---|---|---|
| S4.1 | The instructor or the office marks each participant as attended, no-show or cancelled. Billing and pay follow the policy. | ✅ `lesson-dialog-regressions` and node tests |
| S4.2 | For services that require a session report, the instructor fills it in after the lesson. Missing reports appear in "דוחות ממתינים". | 🟡 Exists; no tester scenario |
| S4.3 | After a lesson, one-time customers get a review request by their preferred channel (WhatsApp or email). Regular students get one occasionally. Anyone can opt out of review requests. | ❌ (**D5**) |
| S4.4 | By default, customer cancellations and no-shows are billed, unless an excused absence applies (S4.5). A cancellation made **before the day's list was sent to the instructor**, by a student with an excused absence still available, isn't billed (owner decision PD2 in [payroll-scenarios.md](payroll-scenarios.md)). The rules are configurable per farm. | 🟡 The billing policy per status exists (S0.2); the per-farm default rules are 🔍 (**D4**) |
| S4.5 | A student has an allowance of excused absences. An absence counts as excused once the required proof (for example a doctor's note) is uploaded. If it hasn't arrived by the deadline (default about a month), the lesson is billed. Alternatively, it's billed immediately and credited back when the proof arrives. | 🟡 Only a manual "excused" flag per participant exists. There's no allowance, proof upload, deadline or credit-back (**D4**) |

## Stage 5 — Month end

| ID | Scenario | Status |
|---|---|---|
| S5.1 | At month end, the office sees every HMO lesson of the month per provider and per student, checked against each student's approval. | ✅ `hmo-claiming` |
| S5.2 | The office creates and submits a claim batch per provider. Lessons in a submitted batch are locked. | ✅ `hmo-claiming` |
| S5.3 | Claims reach each HMO through its API. HMO sites don't accept uploaded files. Until API access is granted, the office enters claims on the HMO site by hand, using Reinex's per-provider list. | ❌ The API integration waits for access (**D8**). The per-provider list ✅ (S5.1) |
| S5.4 | When an approval is about to run out (lessons used up or the date passing), the office is reminded to renew it. | 🟡 The expiry is tracked; no reminder |
| S5.5 | Monthly instructor pay: each instructor's lessons and pay for the month, reviewed, approved and closed. After closing, the month can't change silently. | ❌ See [payroll-prerequisites.md](payroll-prerequisites.md) and the pay rules in [payroll-scenarios.md](payroll-scenarios.md) (**D9**, #49) |

## Stage 6 — Student leaves

| ID | Scenario | Status |
|---|---|---|
| S6.1 | After a final summary session, the student is removed from their fixed slot, and their lessons from that date on are removed. | 🟡 Removing from the template exists; handling of already-generated future lessons 🔍 |
| S6.2 | The freed slot is offered to matching waiting-list entries and to students who want to switch. | ❌ Nothing links a student leaving to the waiting-list suggestions 🔍 |
| S6.3 | The student's record and history stay; the student becomes inactive. Any unused package balance is handled as in S3.9. | 🔍 |

## Across stages

| ID | Scenario | Status |
|---|---|---|
| SX.1 | Holidays, farm closures and instructor sick days: many lessons are moved or cancelled at once, with correct billing. | 🔍 |
| SX.2 | Instructors see only their own lessons and the fields they're allowed to see. | 🟡 Permissions exist; scenario 🔍 |

---

## Decisions for the owner

| # | Decision | Owner answer (2026-09-15) |
|---|---|---|
| D1 | Are farm-wide activity hours needed, or is each instructor's availability enough? | I think each instructor's availability is enough, do you see a scenerio where it would be useful to have a farm-wide activity hours? Maybe in the future if we want to allow self-signups, but it's not planned for now. |
| D2 | Should private packages show a **lesson count** ("7 of 10 left") on top of the money balance? | If they were bought as packages, I'm pretty sure they should for convenience, however, we need to decide what happens if a price is changed mid-package and what is the process to leaving mid-package. Regarding price change mid-package is to either allow to finish the rest of the package while the next package gets the new price, create a new service for the new price, that way the old package havers will keep their price and gradual change will be possible or just update to the new price and have the calculation show that there's enough credit for part a lesson, either offer to retrieve the rest to the customer or take in mind in the next package purchase. |
| D3 | Should the office be alerted when a package runs out? Before which lesson? | It needs to be alerted a bit before it runs out and get a big notice if the package has run out. I think the defult reminder should be 2 or 3 lessons before it ends. The business will need to decide if it wants to stop allowing to the student to be put to sessions if the credit is out or if they allow a set amount of sessions before blocking. |
| D4 | What are the rules for customer cancellations, no-shows and farm cancellations? Who is charged, and is a make-up lesson owed? | Business configured, defult should be that customer cancellation and no-shows are billed, unless there's an explicit reason for it to not be billed, in which each student should have an amount of graces they are allowed to not arrive, in our business it is tied to bringing doctor's approval, if a doctor's approval isn't brought after lets say a month, that lesson is billed (or billed until a doctor's notice arrives and the lesson adds back once the notice is uploaded). |
| D5 | Review request: which channel (WhatsApp / SMS / email), and when after the lesson? | Either Whatsapp or Email (based on their reminder preference), usually for one time customers, but it would be a good idea to have it to students as well every so often (maybe with the option to decide not get reminders about reviewing?). |
| D6 | Green Invoice integration: a document per payment (receipt / tax invoice-receipt)? Who triggers it? Monthly reports? | A document per payment, could be splitted if the parents are seperated and want to pay independently. I don't know if receipt or tax invoice-receipt, maybe business configed? It needs to be sent once the payment is done to the business. |
| D7 | Daily instructor list: keep the manual button, or send automatically on a schedule set per organization? | The plan is to have it automatically send once the day is considered organised and approved. We need to connect Whatsapp Business to it, I'm trying to think what would be better, to have a system whatsapp account connected (Reinex owned) or each business connects their whatsapp account. It would be easier to implement if it is Reinex-owned, but the cost will need to be calculated or at least taken in mind in the subscription.... How complicated would it be to implement either solution? or both? |
| D8 | HMO claim formats: sample files from Clalit and Meuhedet are needed to verify the export. | There is no way to just put a CSV or a file into the HMO sites, they are supposed to have an API, but I have yet to get access to it. |
| D9 | Instructor-pay redesign: when does it start? It's a must for the first farm. | I need you to investigate and decide what are the prerequirements for it technically. |

## Replies to the owner's questions

**D1: when would farm-wide activity hours help?**
- Self sign-up or online booking, so customers only see times when the farm is open.
- A public intake form offering real available times.
- Closures and holidays. That's better handled as a list of closed *days* (SX.1) than as opening hours.

None of these is needed now, so instructor availability is enough.

**D2: a price change mid-package.**
- The data already follows your first option. Each package line stores its lesson count and per-lesson price at purchase, so existing packages finish at their price and new packages use the new one.
- Your second option (a new service per price) isn't needed, and it would fragment reports.
- Your third option (fractional credit) is the one to avoid.
- Leaving mid-package uses the same stored price. The refund or credit is the unused lessons × the package's per-lesson price (S3.9).

**D7: which WhatsApp setup?** Both run on WhatsApp's official Business API; they differ in whose number sends.

| | A: a Reinex-owned number | B: each farm connects its own number |
|---|---|---|
| Setup | One business account and number for Reinex. Message templates are approved once for everyone. | Reinex registers with Meta as a technology provider (business verification and an app review) and adds Meta's sign-up flow, so each farm links its number from Reinex. Tokens, numbers and templates are stored per farm, and incoming messages are routed per number. |
| What customers see | Messages come from "Reinex", and replies go to Reinex, not the farm. | Messages come from the farm's own number, and replies reach the farm. |
| Who pays Meta | Reinex pays per message, so it has to go into the subscription price. | Each farm is billed by Meta directly. |
| Effort | Smaller: one connection, a send queue, templates. | About two to three times the work, plus Meta's review wait and onboarding help for each farm. |

- **Recommendation: both, in stages, behind one internal "send a message" layer.**
  1. Start with **A for messages to staff**: the daily instructor list and internal alerts. Who the sender is matters little there.
  2. Add **B later for messages to customers**: reminders, forms, review requests. Those should come from the farm.
- An intermediary provider (for example Twilio or 360dialog) can shorten B's onboarding, at a higher cost per message.
- Check Meta's current rules and prices before building. They change often, and a farm's existing WhatsApp Business app number may or may not be usable alongside the API.

**D9:** see [payroll-prerequisites.md](payroll-prerequisites.md). Summary:
- The calculation pieces exist, but there's no monthly cycle (period, approval, freeze).
- Rates aren't tied to dates, so paid months can change silently.
- Prerequisites, in order: P1 pay rules as approved scenarios → P2 dated rates in `RateHistory` ("from this date on, the rate is X"; owner decision) → P3 frozen earnings after close → P4 a pay-period cycle with locks (fixes #49) → P7 monthly screen and export. P6 tests go alongside each step.

## Suggested order

1. **Approve the updated scenarios**, including the new S0.7, S0.8 and S3.7–S3.9, and the rewritten S3.2, S3.6, S4.3–S4.5 and S5.3.
2. **Money first.** Write tests for the money stages (S0.2–S0.3, S3.x, S4.1, S4.4–S4.5, S5.x), because mistakes there are the costliest.
3. **Operations in cycle order.** Then write tests for Stages 0 → 1 → 2 → 6.
4. **Close the gaps in priority order:**
   - instructor pay (P1 first)
   - Green Invoice (S3.4, S3.7)
   - package count, warnings and exit (S3.1–S3.2, S3.8–S3.9)
   - excused absences (S4.5)
   - WhatsApp stage A (S3.6)
   - the stage-6 slot hand-off (S6.2)
   - review requests (S4.3), which need WhatsApp stage B or email
