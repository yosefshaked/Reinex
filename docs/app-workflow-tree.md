# Reinex — User-Facing Workflow Tree

Full navigation and interaction map from a user's perspective.
Verified against the live pre-production environment (May 2026).
Intended as the skeleton for the user guide page post-shadow deployment.

> **Layout note:** The app is RTL (Hebrew). The sidebar is on the **right** side of the screen.

---

## Public Pages

```
/  (Landing Page)
├── Header
│   └── [כניסה] → /login
├── Hero
│   ├── [התחילו עכשיו] → /login
│   └── [למידע נוסף] → scrolls to features section
├── Feature cards (marketing content)
├── CTA section → /login
└── Footer
    ├── תנאי שימוש (Terms of Service) → /legal/terms
    ├── מדיניות פרטיות (Privacy Policy) → /legal/privacy
    └── הצהרת נגישות (Accessibility Policy) → /legal/accessibility

/legal/:slug
└── Legal article page (terms / privacy / accessibility)

/submit  (Public Form)
└── Publicly shareable intake form (no login required)
```

---

## Auth Flow

```
/login
├── Email + password login
├── [שכחתי סיסמה] → forgot password flow
│   └── Email sent → reset link → set new password
├── Google SSO (if configured)
└── On success →
    ├── First-time user → /account-setup → org selection
    └── Returning user → /dashboard

/accept-invite
└── Accept org invitation → complete registration → /dashboard

/complete-registration
└── Set name + password after invite

/verify
└── Email verification step (post-signup)
```

---

## Top Bar (always visible)

```
Top Bar
├── Org switcher (dropdown — switches active org)
├── Notification bell
├── User avatar menu
│   ├── [החשבון שלי] → /account
│   └── [יציאה] → logout → /login
└── [?] Help / guided tour trigger
```

---

## Sidebar Navigation (right side, expands on hover)

```
Sidebar
├── לוח בקרה (Dashboard) → /dashboard
├── לוח שנה (Calendar) → /calendar
├── תלמידים (Students) → /students-list
├── רשימת המתנה (Waiting List) → /waiting-list
├── לקוחות חד פעמיים (One-Time Customers) → /one-time-customers
├── עובדים (Employees) → /employees
├── שירותים (Services) → /services
├── כספים (Financials) → /financials
├── טפסים (Forms) → /forms
├── הגדרות (Settings) → /Settings
└── [admin/owner only] System Admin → /system-admin
```

---

## 1. Dashboard `/dashboard`

```
Dashboard
├── Welcome greeting (user name + time of day)
├── Action Tasks panel [admin/office only]
│   ├── Grouped by task type and priority
│   └── Click task → navigates to relevant page/action
├── Waiting List Matches panel [admin/office only]
│   ├── Capacity matches (join existing group)
│   └── Clear-space matches (new slot needed)
└── Billing Overview panel [admin/office only]
```

---

## 2. Calendar `/calendar`

```
Calendar
├── View switcher: Day | Week
├── Instructor column headers
│   └── [WhatsApp icon] → open WhatsApp conversation with instructor
├── Lesson slot (click) → Lesson Instance Dialog
│   ├── Tab: סקירה (Overview)
│   │   ├── Mark lesson as complete
│   │   ├── Cancel lesson
│   │   └── Lesson summary info
│   ├── Tab: משתתפים (Participants)
│   │   ├── Per-student attendance toggle
│   │   └── [WhatsApp icon] per student → message student/guardian
│   ├── Tab: מצב שיעור (Lesson Status)
│   │   └── Closure progress chain:
│   │       attendance ✓ → billing ✓ → earnings ✓ → HMO claim ✓
│   └── Tab: ניהול (Management)
│       ├── Source template info
│       └── Audit trail
├── [+ הוסף שיעור] → Add Lesson Dialog
│   ├── Select instructor, service, time, students
│   └── Save → lesson appears on calendar
├── [יצירה ידנית] → Manual Generation Dialog
│   └── Bulk-generate lessons from template for a date range
└── Workspace dock (bottom)
    └── Queued / in-progress lesson actions

Template Manager `/calendar/templates`
├── Weekly grid (days × instructor)
├── Template slot (click) → Edit Template Dialog
│   ├── Service, time, capacity, instructor
│   ├── Participants list (multi-student)
│   └── Waiting list candidates toggle (capacity / clear-space)
├── [+ הוסף תבנית] → Add Template Dialog
├── [הסתר/הצג ממתינים] toggle (visible when candidates exist)
├── Display options panel (show/hide columns, density)
└── Drag palette (drag service chip onto grid to create template)
```

---

## 3. Students `/students-list`

```
Students List
├── Search bar (name, phone, ID)
├── Filter panel (status, service, instructor, etc.)
├── Sort controls
├── Pagination
├── [+ הוסף תלמיד] → Add Student Dialog
│   └── Name, contact, guardians, service assignment
├── [תחזוקת נתונים] (Data Maintenance menu) [admin only]
│   └── Bulk data operations (merge duplicates, fix data issues)
└── Student row (click) → Student Detail Page `/students/:id`

Student Detail `/students/:id/:tab?`
├── Tab: סקירה (Overview)
│   ├── Personal info, contact, guardians
│   └── Quick-edit fields
├── Tab: לוח שנה (Schedule)
│   └── Student's lesson schedule (calendar view)
├── Tab: היסטוריה (History)
│   └── Past lesson attendance log
├── Tab: מסמכים (Documents)
│   └── Uploaded files per student
├── Tab: כספים (Financial)
│   └── Charges, payments, balance
└── Tab: טפסים (Forms)
    └── Submitted intake forms for this student
```

---

## 4. Waiting List `/waiting-list`

```
Waiting List  (3-column workspace)
├── Left column — Placement Suggestions
│   ├── Capacity matches: student can join an existing group
│   └── Clear-space matches: a new slot must be opened
├── Middle column — Entry Detail
│   ├── Student info
│   ├── Requested service / time preferences
│   └── Action buttons (resolve, dismiss, contact)
├── Right column — Queue
│   └── All open waiting-list entries (sorted by wait time)
├── [+ רשומה חדשה] → New Entry Dialog
│   └── Select student, service, preferences
└── [שלח טופס] → Send intake form to prospective student
```

---

## 5. One-Time Customers `/one-time-customers`

```
One-Time Customers
├── Card grid (one card per customer)
└── Customer card (click) → Customer Detail `/one-time-customers/:id`
    ├── Tab: סקירה (Overview)
    │   └── Contact info, notes
    ├── Tab: היסטוריה (History)
    │   └── Past sessions / interactions
    └── Tab: כספים (Financial)
        └── Charges and payment history
```

---

## 6. Employees `/employees`

```
Employees  (master-detail layout)
├── Left panel: instructor list with search
└── Right panel: selected instructor detail
    ├── Tab: פרטים (Details) — personal info, contact
    ├── Tab: לוח שנה (Schedule) — weekly availability
    ├── Tab: שירותים (Services) — assigned services
    ├── Tab: היסטוריה (History) — lesson history
    ├── Tab: כספים (Financial) — payroll / earnings
    ├── Tab: מסמכים (Documents) — uploaded files
    └── Tab: הגדרות (Settings) — permissions, role
```

---

## 7. Services `/services`

```
Services
├── Services table (name, type, price, status)
├── [+ הוסף שירות] → Add Service Dialog
└── Service row actions
    ├── Edit → Edit Service Dialog
    │   └── Name, duration, price, HMO eligibility, capacity
    ├── Activate / Deactivate (toggle `is_active`)
    └── Service detail → `/services/:id`
        └── Linked templates, billing rules
```

---

## 8. Financials `/financials`

```
Financials
├── Tab: שכר (Salary)  ← first tab
│   ├── Per-instructor payroll summary
│   ├── Month selector
│   └── Export payroll report
├── Tab: חיובי תלמידים (Student Billing)
│   ├── Per-student charges table
│   ├── Manual charge / credit entry
│   └── Payment status tracking
└── Tab: תביעות גורם ממן (HMO Claims)
    ├── HMO-eligible sessions awaiting claim
    ├── Claim submission status
    └── Approved / rejected breakdown
```

---

## 9. Forms `/forms`

```
Forms
├── Forms table (name, status, submissions count)
├── [+ צור טופס] → Create Form
│   └── Form builder → save → published URL
├── [בלוקים משותפים] → Shared Blocks `/forms/shared-blocks`
│   └── Reusable question blocks shared across forms
└── Form row (click) → Form Detail `/forms/:formId`
    ├── Edit form fields and logic
    ├── [תצוגה מקדימה] → Form Preview `/forms/:formId/preview`
    └── Submissions list (linked students / customers)
```

---

## 10. Settings `/Settings`

```
Settings  (card-based hub)
├── [מידע Debug] — debug info panel
├── [סיור מודרך] — restart guided tour
└── Setting modules (11 cards):
    ├── פרופיל הארגון (Org Profile)
    ├── חברי צוות (Team Members) — invite / manage roles
    ├── שירותים (Services) — shortcut to /services
    ├── תבניות לוח שנה (Calendar Templates) — shortcut to /calendar/templates
    ├── טפסים (Forms) — shortcut to /forms
    ├── ספקי אחסון (Storage) — document storage config
    ├── הגדרות חיוב (Billing Settings) — billing rules
    ├── הגדרות שכר (Payroll Settings) — payroll rules
    ├── הגדרות HMO (HMO Settings)
    ├── הודעות (Notifications) — notification preferences
    └── מדיניות פרטיות ותנאים (Legal) — org-level legal docs
```

---

## Account Page `/account`

```
Account
├── Personal profile (name, email, avatar)
├── Change password
├── MFA setup / management
└── Active sessions list
```

---

## System Admin Console `/system-admin/*`

> Accessible only to users flagged as system administrators.

```
System Admin
├── Overview
│   ├── Dashboard → /system-admin/dashboard
│   ├── System Health → /system-admin/system-health
│   └── Supabase Connection → /system-admin/supabase-connection
├── Platform
│   ├── Global Settings → /system-admin/global-settings
│   ├── Feature Flags → /system-admin/feature-flags
│   ├── Release Migrations → /system-admin/release-migrations  [coming soon]
│   └── Encryption Keys → /system-admin/encryption-keys  [coming soon]
├── Customers
│   ├── Organizations → /system-admin/organizations
│   ├── Users → /system-admin/users
│   └── Impersonation Queue → /system-admin/impersonation-queue
├── Operations
│   ├── Onboarding Pipeline → /system-admin/onboarding-pipeline
│   ├── Email Log → /system-admin/email-log
│   ├── Error Events → /system-admin/error-events
│   ├── Org Purge → /system-admin/org-purge
│   └── Backups → /system-admin/backups
├── Content
│   ├── Announcements → /system-admin/announcements
│   ├── Knowledge Base → /system-admin/knowledge-base
│   └── Incidents → /system-admin/incidents
├── Insights
│   ├── Product Analytics → /system-admin/product-analytics
│   ├── Audit Log → /system-admin/audit-log
│   ├── Integration Health → /system-admin/integration-health
│   └── Data Quality → /system-admin/data-quality
└── Settings
    ├── Admin Tools → /system-admin/admin-tools
    ├── Compliance → /system-admin/compliance
    ├── Future Ideas → /system-admin/future-ideas
    └── Billing → /system-admin/billing  [coming soon]
```

---

## Key End-to-End Flows

```
Prospect → Student
  Waiting List (new entry)
  → send intake form (/submit)
  → form submission captured
  → resolve waiting list entry
  → Add Student → Student Detail

Lesson Cycle (per session)
  Calendar → lesson slot
  → mark attendance (משתתפים tab)
  → mark complete (סקירה tab)
  → billing triggered automatically
  → HMO claim queued if eligible (Financials → תביעות)

Monthly Payroll
  Financials → שכר tab
  → select month
  → review per-instructor earnings
  → export / approve payroll
```

---

*Last verified: May 2026 — pre-prod environment*
