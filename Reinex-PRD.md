Product Requirements Document (PRD)
Therapeutic Riding & Clinic Management System
Version: 1.0 (Extended MVP)
Scope: Scheduling, Students, Payments, Commitments, Staff Payroll, Forms, WhatsApp Automation, Multi-Tenant

0. Product Purpose
Build a unified, modern, scalable system that replaces Excel, paper workflows, and legacy software.
The system will support:

Operational Management
Weekly fixed schedules

Actual lesson instances

Rescheduling & one-time lessons

Cancellations and attendance tracking

WhatsApp reminders & confirmations

Staff views with minimal UI complexity

Business & Financial Management
Commitments (prepaid packages, HMOs, private)

Consumption per lesson

Automated instructor payroll

Manual/automated invoicing (GreenInvoice)

Smart waiting list with prioritization

Client & Clinical Data Management
Student onboarding forms (with OTP)

Risk/alert flags (e.g., medical, emotional, safety)

Exposure rules (what instructors see)

Guardians/parents relations

Organizational Framework
Multi-tenant architecture

Permissions per role

Settings per business

Forms builder

High security and auditable actions

1. System Architecture
1.1 Control DB (Global)
Contains:

Organizations

Users

Roles & permissions

Audit log

Invitation system

Billing (future)

All tenants authenticate here.

1.2 Tenant DB (Per Organization)
Future direction: All business logic + data under public schema.
Legacy schema tuttiud remains accessible but will be merged into public in later refactors.

2. Core Domain: Lessons & Scheduling
2.1 Weekly Lesson Templates
Each student may have:

One or more weekly recurring lessons

Assigned instructor

Assigned service type

Duration

Default price (or special price per student)

Validity window (valid_from / valid_until)

Notes for internal communication

Flags (high-risk student, requires senior instructor, etc.)

Supports:
Multiple services per week for same student

Ad-hoc slot overrides

Instructor replacement

Long-term template changes (“from next week onward”)

Undo safety mechanism

2.2 Lesson Instances (Actual Scheduled Occurrences)
Every instance is created from either:

Weekly template

One-time booking

Manual reschedule

Migration script (edge cases)

Fields:
template_id (nullable)

student_id

instructor_id

service_id

datetime_start

duration_minutes

status (scheduled / completed / cancelled_student / cancelled_clinic / no_show)

attended (boolean)

documentation_status (undocumented / documented)

price_charged (calculated per rules)

metadata

Hard Requirements:
Must NOT be overwritten automatically by weekly generation

Must support “one-time lesson at a slot normally occupied by cancelled regular student”

Must allow manual edits with audit trail

Must surface conflicts (“student has two lessons at the same time”)

3. Weekly Generation Engine
3.1 Default behavior (Automated)
Runs weekly (recommended Sunday 03:00)

Creates 14 days ahead

Does NOT overwrite existing instances

Skips dates marked as “cancelled for this student”

Applies template changes only into the future

Includes safety “dry-run” mode for debugging

Performs conflict detection

3.2 Manual Generation
“Generate week” button

Compares before/after

Shows diff to admin before applying

3.3 Undo
Full rollback available for X minutes

Logged in audit trail

4. Cancellations, No-shows & Reminders
4.1 WhatsApp Bot
Sends reminder at customizable time

Supports bi-directional reply:

“I’m coming”

“I’m not coming”

Updates status on Lesson Instance

Calculates whether cancellation should be charged

4.2 Charging Logic (Set per organization)
Cancellation fee rules

HMO rules:

Clalit: Parent pays 45 ₪, rest from HMO

Meuhedet: Form 17, HMO payment

Leumit: Full pay + reimbursement

Emergency medical note (up to 3 per year)

Clinic-initiated cancellation → zero charge

Price overrides possible per instance

5. Students & Guardians
5.1 Student Table
Fields:

Basic profile

Date of birth (optional)

guardian_id or self

notes_internal

default_notification_method (WhatsApp / email)

special_rate (optional)

medical_flags

onboarding_status (not_started / pending_forms / approved)

5.2 Guardians
Fields:

Name

Phone

Email

Relationship (father, mother, self, caretaker)

Support for:

One guardian

Multiple guardians

Student without guardian (adult clients)

6. Onboarding Forms (Forms + FormSubmissions)
6.1 Forms
Fields:

name

description

form_schema (JSON)

alert_rules (JSON)

visibility_rules (for instructor exposure)

created_by

updated_at

6.2 Submissions
Fields:

form_id

student_id

answers (jsonb)

alert_flags (jsonb)

otp_metadata (ip, phone_verified, timestamp)

submitted_at

reviewed_by (optional)

OTP Security:
Required for all submissions

Supports WhatsApp + email

Prevents impersonation

Mandatory logging for legal defense

7. Commitments & Consumption
7.1 Commitments (Pre-paid packages, HMO quotas)
Fields:

student_id

service_id

total_amount (₪)

created_at

expires_at (optional)

metadata

7.2 Consumption
For each completed lesson:

lesson_instance_id

amount_charged

remaining_balance (calculated view)

8. Waiting List
8.1 Fields:
student_id

desired_service_id

preferred_days

preferred_times

instructor_preferences (optional)

willing_to_pay_premium (optional)

priority_flag (boolean)

priority_reason (dropdown or text)

notes

8.2 Matching Logic:
Scans open slots

Displays matches to admin

Admin decides whether to create template or one-time lesson

Prevents duplicates

Highlights conflicts (“student has an active template for this service”)

9. Instructor & Payroll System
9.1 Instructor Data
employee_id

services they can provide

working_days

max_students (per service)

break_time (optional)

9.2 Earnings (Automated)
Each completed lesson generates:

employee_id

lesson_instance_id

rate_used

payout_amount

created_at

Supports:

Base rate per service

Special per-student rate

Overrides per instance

Hourly/global workers via WorkSessions (legacy kept)

10. User Roles & Permissions
At minimum:

Role	Capabilities
Owner	Full control, settings, payroll
Admin	Scheduling, financials, forms
Office	Daily scheduling, confirmations
Instructor	See own lessons, mark attendance, basic student info
Read-only	Reports only
Permissions stored in Control DB; enforcement per tenant DB.

11. Interfaces
11.1 Calendar UI
Daily view (primary)

Weekly view (for managers)

Row = 15 minutes

Column = instructor

Color = service

Icons:

⚫ undocumented

🟢 completed

🔴 no-show

🟡 admin-attention

11.2 Student Page
Upcoming lessons

Past lessons + documentation

Flags

Commitments

Forms

Contact buttons

11.3 Instructor Page
Today’s lessons

Weekly overview

Undocumented lessons

Payroll summary

12. WhatsApp & Email Integrations
MVP:

Copy-paste messages

Manual sending

Phase 2:

API calls / bot automation

Templates stored in Settings

Opt-in per guardian/student

13. System Settings
Stored in public.Settings:

Examples:

business_hours

lesson_duration_options

notification_preferences

cancellation_rules

priority_reason_options

green_invoice_api_key (optional)

employee_default_rates

form builder policies

14. Data Safety & Reliability
Includes:

Soft delete everywhere

Audit trail in Control DB

OTP verification on all external forms

IP logging

Versioning for templates

Undo mechanisms

Weekly backups (tenant DB)

15. What We Still Needed (Final Review)
After re-scanning everything we discussed + typical real-world clinic SaaS, here are possible gaps:

✔ 1. Multi-service per student per week
Covered, but added: Service mix support

✔ 2. Partial attendance
Important in group lessons:

student_attended (boolean)

students_count per instance

✔ 3. Session capacity
We added “max_students per service”. Correct.

✔ 4. Instructor replacements
Covered but now explicitly required in UI.

✔ 5. Holidays & closed days
Added as system setting.

✔ 6. Documentation guidelines per service
Future: Templates for documentation.

✔ 7. Risk flags lifecycle
Added: “reviewed_by” field for clinician.

✔ 8. Multi-guardian communications
Supported now.

✔ 9. Staff permissions per service
Instructors should ONLY see students assigned to them.
Already covered under permissions but made explicit.

✔ 10. Object versioning
Lesson Template version history — added.

✔ 11. Business analytics (future)
Not MVP.

✔ 12. Sync between payroll & lessons
Covered fully.

✔ 13. Exceptions & overrides
Yes: per instance and per student.

✔ 14. Export API for future mobile app
Not MVP, but DB designed to support it.

✔ 15. Support for adult students (self-guardian)
Added.