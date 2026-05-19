# Calendar Feature - Full Implementation Plan

**Date:** 2026-02-12  
**Scope:** Daily/Weekly Calendar + Template Manager + Interactive Editing + WhatsApp MVP  
**Status:** Planning Phase

---

## 1. Overview

The calendar feature is the operational heart of Reinex, displaying actual lesson instances with status tracking, conflict detection, and interactive editing capabilities.

### 1.1 Core Components

1. **Daily Calendar View** (primary)
   - 15-minute row intervals
   - One column per instructor
   - Color-coded by service
   - Status icons (undocumented/completed/no-show/attention)

2. **Weekly Calendar View** (manager overview)
   - 7-day horizontal scroll
   - Same grid structure as daily
   - Used for capacity planning

3. **Template Manager** (new requirement)
   - Grid: columns = instructors, rows = days of week
   - Sub-rows = students assigned to that instructor/day
   - Visual template editing with drag-and-drop or click-to-edit
   - Accessed via button in calendar page

4. **WhatsApp Integration (MVP)**
   - Pre-generated message text
   - Copy-to-clipboard button
   - `wa.me` deep link (opens WhatsApp with prefilled message)

5. **Interactive Editing**
   - Add new instance (one-time or from template)
   - Edit existing instance (time, instructor, service, students)
   - Cancel instance (with reason: student/clinic/no-show)
   - Reschedule (creates new + marks old as cancelled)
   - Mark attendance/completion

---

## 2. Data Architecture

### 2.1 Tables Involved

**Core scheduling:**
- `public.lesson_templates` - Weekly recurring schedules
- `public.lesson_template_overrides` - Date-specific cancellations/modifications
- `public.lesson_instances` - Actual scheduled occurrences
- `public.lesson_participants` - Student participation in instances

**Related:**
- `public.students` - Student roster
- `public.Employees` - Instructors
- `public.Services` - Service types
- `public.instructor_service_capabilities` - Instructor capacity per service

### 2.2 Key Fields

**lesson_instances:**
```sql
id, template_id, datetime_start, duration_minutes,
instructor_employee_id, service_id, status, documentation_status,
created_source, metadata, created_at, updated_at
```

**lesson_participants:**
```sql
id, lesson_instance_id, student_id, participant_status,
price_charged, pricing_breakdown, commitment_id,
documentation_ref, metadata
```

**lesson_templates:**
```sql
id, student_id, instructor_employee_id, service_id,
day_of_week, time_of_day, duration_minutes,
valid_from, valid_until, is_active, version
```

---

## 3. API Endpoints

### 3.1 Calendar Data (Instances)

**GET `/api/calendar/instances`**
- Query params: `org_id`, `date` (or `start_date`/`end_date`), `instructor_id` (optional)
- Returns: Array of instances with embedded participants + student/service/instructor info
- Used by: Daily and Weekly calendar views

**POST `/api/calendar/instances`**
- Body: `org_id`, `datetime_start`, `duration_minutes`, `instructor_employee_id`, `service_id`, `student_ids[]`, `created_source`, `template_id` (optional)
- Creates: New instance + participants
- Used by: "Add Lesson" action

**PUT `/api/calendar/instances/{instanceId}`**
- Body: Updates to instance fields (datetime, instructor, service, status, etc.)
- Used by: Reschedule, status updates, edits

**DELETE `/api/calendar/instances/{instanceId}`**
- Soft-delete or mark as cancelled
- Used by: Cancel lesson action

**POST `/api/calendar/instances/{instanceId}/attendance`**
- Body: `participant_id`, `attended` (boolean), `status` (attended/no_show/cancelled)
- Used by: Mark attendance action

### 3.2 Template Management

**GET `/api/calendar/templates`**
- Query params: `org_id`, `status` (active/all)
- Returns: Array of templates with embedded student/instructor/service info
- Used by: Template Manager view

**POST `/api/calendar/templates`**
- Body: `org_id`, `student_id`, `instructor_employee_id`, `service_id`, `day_of_week`, `time_of_day`, `duration_minutes`, `valid_from`, `valid_until`
- Creates: New template
- Used by: Template Manager "Add Template" action

**PUT `/api/calendar/templates/{templateId}`**
- Body: Updates to template fields
- Creates versioned template if needed (supersedes pattern)
- Used by: Template Manager edit actions

**DELETE `/api/calendar/templates/{templateId}`**
- Soft-delete: sets `is_active = false` and `valid_until = today`
- Used by: Template Manager delete action

**POST `/api/calendar/templates/{templateId}/override`**
- Body: `target_date`, `override_type` (cancel/modify), optional overrides
- Creates: Override entry for specific date
- Used by: One-off cancellations without deleting template

### 3.3 WhatsApp Messaging (MVP)

**POST `/api/calendar/instances/{instanceId}/whatsapp-message`**
- Body: `org_id`, `recipient_type` (student/guardian), `template_type` (reminder/confirmation/cancellation)
- Returns: `{ message: "...", phone: "05xxxxxxxx", wa_link: "https://wa.me/..." }`
- Used by: "Send WhatsApp" action in calendar

**GET `/api/calendar/whatsapp-templates`**
- Query params: `org_id`
- Returns: Array of message templates stored in `public.Settings`
- Used by: Template selector in WhatsApp dialog

### 3.4 Conflict Detection

**POST `/api/calendar/conflicts/check`**
- Body: `org_id`, `datetime_start`, `duration_minutes`, `instructor_employee_id`, `student_ids[]`, `exclude_instance_id` (optional, for edits)
- Returns: Array of conflicts: `[{ type: 'student_overlap'|'instructor_overlap'|'capacity_exceeded', details: {...} }]`
- Used by: Real-time validation when adding/editing instances

### 3.5 Generation (Future, but plan for it)

**POST `/api/calendar/generate`**
- Body: `org_id`, `start_date`, `end_date`, `dry_run` (boolean)
- Returns: Diff preview if dry_run=true, otherwise applies generation
- Used by: "Generate Week" action

---

## 4. Frontend Architecture

### 4.1 Route Structure

```
/calendar              → Daily calendar (default: today)
/calendar/day/:date    → Specific day
/calendar/week/:date   → Week view starting on date
/calendar/templates    → Template Manager
```

### 4.2 Component Hierarchy

```
CalendarPage/
├── CalendarHeader
│   ├── DateNavigator (prev/next day, date picker)
│   ├── ViewSwitcher (day/week toggle)
│   └── ActionButtons (Add Lesson, Templates, Generate)
├── CalendarGrid
│   ├── TimeColumn (15-min intervals, 06:00-22:00)
│   ├── InstructorColumn (per instructor)
│   │   └── LessonInstance (clickable card)
│   └── ConflictOverlay (visual warnings)
└── CalendarSidebar (optional, for filters/legend)

TemplateManagerPage/
├── TemplateManagerHeader
│   ├── Filters (instructor, service, student)
│   └── ActionButtons (Add Template, Back to Calendar)
├── TemplateGrid
│   ├── InstructorColumn (per instructor)
│   │   └── DayRow (Sunday-Saturday)
│   │       └── StudentTemplateCard (draggable/editable)
│   └── ConflictIndicators
└── TemplateManagerSidebar (student list for adding)

LessonInstanceDialog/ (opens on click)
├── InstanceDetails (readonly view)
├── InstanceEditForm (edit mode)
├── AttendanceSection (mark attended/no-show)
├── WhatsAppSection (send message)
└── ActionButtons (Edit, Cancel, Reschedule, Close)

AddLessonDialog/
├── SelectStudent (ComboBox)
├── SelectInstructor (Select)
├── SelectService (Select)
├── DateTimePicker
├── DurationInput
├── ConflictWarning (live)
└── ActionButtons (Create, Cancel)

WhatsAppMessageDialog/
├── RecipientSelector (student/guardian)
├── TemplateSelector (reminder/confirmation/cancellation)
├── MessagePreview (editable textarea)
├── CopyButton
└── WhatsAppLinkButton (wa.me deep link)
```

### 4.3 State Management

**Calendar State (React Context or Zustand):**
```javascript
{
  // View state
  currentDate: Date,
  viewMode: 'day' | 'week',
  
  // Data
  instances: LessonInstance[],
  templates: LessonTemplate[],
  instructors: Instructor[],
  students: Student[],
  services: Service[],
  
  // Loading/error
  isLoading: boolean,
  error: string | null,
  
  // Filters
  selectedInstructorIds: string[],
  selectedServiceIds: string[],
  showCancelled: boolean,
  
  // Actions
  fetchInstances: (date: Date) => Promise<void>,
  addInstance: (data) => Promise<void>,
  updateInstance: (id, updates) => Promise<void>,
  cancelInstance: (id, reason) => Promise<void>,
  markAttendance: (instanceId, participantId, attended) => Promise<void>,
}
```

**Template Manager State:**
```javascript
{
  templates: LessonTemplate[],
  groupedByInstructor: Map<instructorId, Template[]>,
  isLoading: boolean,
  error: string | null,
  
  fetchTemplates: () => Promise<void>,
  addTemplate: (data) => Promise<void>,
  updateTemplate: (id, updates) => Promise<void>,
  deleteTemplate: (id) => Promise<void>,
}
```

---

## 5. UI/UX Design Specifications

### 5.1 Daily Calendar Grid

**Layout:**
- Left column: Time labels (06:00, 06:15, 06:30, ...)
- Each instructor column: 200px min-width
- Each row: 24px height (15 minutes)
- Grid scrolls horizontally if too many instructors
- Grid scrolls vertically with sticky time column

**Lesson Instance Card:**
```
┌─────────────────────┐
│ 🟢 Hippotherapy      │ ← Service name + status icon
│ Sarah Cohen         │ ← Student name(s)
│ 09:00 - 10:00       │ ← Time range
│ [Undocumented]      │ ← Documentation status badge (if applicable)
└─────────────────────┘
```

**Colors (by service):**
- Each service has a `color` field in DB
- Use as card background with white text
- Default: neutral gray if no color set

**Status Icons:**
- ⚫ Undocumented (gray circle)
- 🟢 Completed (green checkmark)
- 🔴 No-show (red X)
- 🟡 Attention (amber warning)
- ⚠️ Conflict (red warning triangle, top-right corner)

**Interactions:**
- Click card → Open LessonInstanceDialog
- Hover → Show tooltip with full details
- Drag (future enhancement) → Reschedule

### 5.2 Template Manager Grid

**Layout:**
- Columns: One per instructor (200px min-width)
- Rows: 7 rows (Sunday-Saturday)
- Each cell shows templates for that instructor/day
- Multiple students can appear in same cell (stacked cards)

**Student Template Card:**
```
┌─────────────────────┐
│ David Levi          │ ← Student name
│ 🕐 14:00 (60min)    │ ← Time + duration
│ Hippotherapy        │ ← Service
│ [Active]            │ ← Status badge
└─────────────────────┘
```

**Interactions:**
- Click card → Open TemplateEditDialog
- Click cell background → Open AddTemplateDialog (pre-filled instructor/day)
- Drag card between cells (future) → Reassign instructor/day

**Filters (top bar):**
- Instructor multi-select
- Service multi-select
- Student search/filter
- "Show inactive" toggle

### 5.3 WhatsApp Message Dialog (MVP)

**Layout:**
```
┌─────────────────────────────────────┐
│ Send WhatsApp Message               │
│                                     │
│ Recipient: [Guardian: Sarah Cohen] │ ← Dropdown
│ Template:  [Lesson Reminder]       │ ← Dropdown
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ שלום Sarah,                     │ │ ← Editable preview
│ │ תזכורת לשיעור היפותרפיה        │ │
│ │ מחר (13/02) בשעה 14:00          │ │
│ │ עם המדריכה רונית.               │ │
│ │ מצפים לראותך! 🐴               │ │
│ └─────────────────────────────────┘ │
│                                     │
│ Phone: 050-1234567                  │
│                                     │
│ [Copy Text] [Open WhatsApp]         │
│                     [Close]         │
└─────────────────────────────────────┘
```

**Message Templates (stored in Settings):**
- `whatsapp_template_reminder` (day before lesson)
- `whatsapp_template_confirmation` (after booking)
- `whatsapp_template_cancellation` (clinic-initiated)
- `whatsapp_template_reschedule` (time change)

**Template Variables:**
```
{student_name}
{guardian_name}
{instructor_name}
{service_name}
{date}
{time}
{duration}
{clinic_name}
{clinic_phone}
```

**wa.me Link:**
```
https://wa.me/972501234567?text={encodeURIComponent(message)}
```

### 5.4 Conflict Indicators

**Types:**
1. **Student Overlap** (same student, overlapping times)
   - Red border on both conflicting instances
   - Warning icon in top-right
   - Tooltip: "Student has another lesson at this time"

2. **Instructor Overlap** (same instructor, overlapping times)
   - Amber border on both instances
   - Warning icon
   - Tooltip: "Instructor assigned to another lesson"

3. **Capacity Exceeded** (students > max_students for service)
   - Red badge on instance card: "3/2 students"
   - Warning icon
   - Tooltip: "Exceeds capacity (max 2 for this service)"

**Real-time Validation:**
- Run conflict check API when:
  - Adding new instance (before save)
  - Editing instance time/instructor/service
  - Moving instance in calendar
- Display warnings but **do not block** (allow override with confirmation)

---

## 6. User Flows

### 6.1 View Today's Schedule

1. User navigates to `/calendar`
2. System loads today's date as default
3. Fetches instances for today via `GET /api/calendar/instances?date={today}`
4. Renders daily grid with instructor columns
5. User sees lesson instances as cards with status icons

### 6.2 Add One-Time Lesson

1. User clicks "Add Lesson" button in calendar header
2. System opens AddLessonDialog
3. User selects:
   - Student (ComboBox with search)
   - Instructor (Select)
   - Service (Select)
   - Date & Time (DateTimePicker)
   - Duration (Input, default from service)
4. System runs conflict check API (real-time)
5. If conflicts: Show warning banner (allow proceed)
6. User clicks "Create"
7. System POSTs to `/api/calendar/instances`
8. System refreshes calendar grid
9. New instance appears in calendar

### 6.3 Edit Instance Details

1. User clicks lesson instance card in calendar
2. System opens LessonInstanceDialog (readonly mode)
3. User clicks "Edit" button
4. System switches to edit mode (form fields editable)
5. User changes fields (time, instructor, service, etc.)
6. System runs conflict check (real-time)
7. User clicks "Save"
8. System PUTs to `/api/calendar/instances/{id}`
9. System refreshes calendar
10. Updated instance reflects changes

### 6.4 Cancel Lesson

1. User clicks lesson instance card
2. System opens LessonInstanceDialog
3. User clicks "Cancel" button
4. System shows cancellation reason dialog:
   - Student cancelled
   - Clinic cancelled
   - No-show (mark as no-show)
5. User selects reason
6. System calculates charge based on cancellation rules (if student cancel)
7. User confirms
8. System PUTs instance status to `cancelled_*`
9. System creates audit log entry
10. Calendar updates card to show cancellation

### 6.5 Mark Attendance (Quick Action)

1. User clicks lesson instance card
2. System opens LessonInstanceDialog
3. User sees AttendanceSection with participant list
4. For each student:
   - [Attended] [No-Show] [Cancelled] buttons
5. User clicks "Attended"
6. System POSTs to `/api/calendar/instances/{id}/attendance`
7. System updates participant_status to `attended`
8. System triggers:
   - Consumption entry creation
   - Earnings calculation
   - Documentation status check (remains undocumented until documented)
9. Calendar card updates to show green checkmark icon

### 6.6 Send WhatsApp Reminder (MVP)

1. User clicks lesson instance card
2. System opens LessonInstanceDialog
3. User clicks "Send WhatsApp" button in WhatsAppSection
4. System opens WhatsAppMessageDialog
5. System pre-fills:
   - Recipient: Guardian of student (from student_guardians lookup)
   - Template: "Lesson Reminder"
   - Message: Template with variables replaced
6. User reviews/edits message
7. User clicks "Copy Text" → Message copied to clipboard
   - OR clicks "Open WhatsApp" → Opens wa.me link in new tab
8. User pastes in WhatsApp conversation or reviews prefilled message and clicks Send
9. (Future: Track sent status in metadata)

### 6.7 Manage Templates

1. User clicks "Templates" button in calendar header
2. System navigates to `/calendar/templates`
3. System fetches templates via `GET /api/calendar/templates`
4. System renders TemplateGrid:
   - Columns: Instructors
   - Rows: Days of week
   - Cards: Student templates
5. User clicks "Add Template" in empty cell
6. System opens AddTemplateDialog (instructor/day pre-filled)
7. User selects student, service, time, duration, validity
8. User clicks "Create"
9. System POSTs to `/api/calendar/templates`
10. Grid refreshes with new template card

### 6.8 Edit Template

1. User is in Template Manager view
2. User clicks student template card
3. System opens TemplateEditDialog
4. User changes fields (time, instructor, service, validity)
5. User clicks "Save"
6. System determines if versioning is needed:
   - If changes apply "from next week onward" → Create new version
   - If immediate → Update existing
7. System PUTs to `/api/calendar/templates/{id}`
8. Grid refreshes

### 6.9 Delete/Deactivate Template

1. User is in Template Manager view
2. User clicks student template card
3. User clicks "Delete" button in dialog
4. System shows confirmation: "This will end the recurring schedule. Future instances will not be generated."
5. User confirms
6. System sets `is_active = false` and `valid_until = today`
7. Grid refreshes (card removed or grayed out)

---

## 7. Technical Implementation Details

### 7.1 Time Handling

**Critical: Timezone correctness**
- Store all datetimes in `timestamptz` (UTC in DB)
- Display in org's local timezone (stored in org settings)
- Use `date-fns-tz` for timezone conversions
- Default timezone: `Asia/Jerusalem`

**Time Grid:**
- Start: 06:00 local time
- End: 22:00 local time
- Interval: 15 minutes
- Total rows: 64 rows (16 hours * 4 intervals/hour)

### 7.2 Conflict Detection Algorithm

**Student Overlap:**
```javascript
function checkStudentOverlap(newInstance, existingInstances) {
  const studentIds = newInstance.participants.map(p => p.student_id);
  const start = new Date(newInstance.datetime_start);
  const end = addMinutes(start, newInstance.duration_minutes);
  
  return existingInstances.filter(instance => {
    if (instance.id === newInstance.id) return false; // Exclude self
    if (instance.status.startsWith('cancelled')) return false; // Ignore cancelled
    
    const instanceStart = new Date(instance.datetime_start);
    const instanceEnd = addMinutes(instanceStart, instance.duration_minutes);
    
    // Check time overlap
    const timeOverlap = start < instanceEnd && end > instanceStart;
    if (!timeOverlap) return false;
    
    // Check student overlap
    const instanceStudentIds = instance.participants.map(p => p.student_id);
    return studentIds.some(id => instanceStudentIds.includes(id));
  });
}
```

**Instructor Overlap:**
```javascript
function checkInstructorOverlap(newInstance, existingInstances) {
  // Similar logic but check instructor_employee_id instead of student_id
}
```

**Capacity Check:**
```javascript
function checkCapacity(newInstance, instructorCapabilities) {
  const capability = instructorCapabilities.find(
    cap => cap.employee_id === newInstance.instructor_employee_id &&
           cap.service_id === newInstance.service_id
  );
  
  if (!capability) return { exceeded: false };
  
  const studentCount = newInstance.participants.length;
  const maxStudents = capability.max_students || 1;
  
  return {
    exceeded: studentCount > maxStudents,
    current: studentCount,
    max: maxStudents,
  };
}
```

### 7.3 Calendar Grid Rendering

**Use HTML Table or CSS Grid?**
- **Recommendation**: CSS Grid for flexibility
- Sticky time column: `position: sticky; left: 0;`
- Sticky header row: `position: sticky; top: 0;`
- Each cell: 15-min time slot for an instructor

**Instance Card Positioning:**
```css
.lesson-instance-card {
  position: absolute;
  top: calc((startMinutes - 360) / 15 * 24px); /* 360 = 06:00 in minutes */
  height: calc(durationMinutes / 15 * 24px);
  width: 100%;
  z-index: 10;
}
```

**Overlapping Instances (same instructor, overlapping times):**
- Offset horizontally: `left: 0`, `left: 50%`, etc.
- Reduce width: `width: 50%`
- Add border to indicate conflict

### 7.4 WhatsApp Message Templates (Settings)

**Storage in `public.Settings`:**
```javascript
{
  key: 'whatsapp_template_reminder',
  settings_value: {
    name_he: 'תזכורת לשיעור',
    name_en: 'Lesson Reminder',
    template: `שלום {guardian_name},
תזכורת לשיעור {service_name} של {student_name}
מחר ({date}) בשעה {time}
עם {instructor_name}.
מצפים לראותך! 🐴`,
    variables: ['guardian_name', 'student_name', 'service_name', 'date', 'time', 'instructor_name'],
  }
}
```

**Variable Replacement:**
```javascript
function fillWhatsAppTemplate(template, data) {
  let message = template;
  
  // Date formatting
  const date = format(new Date(data.datetime_start), 'dd/MM/yyyy', { locale: he });
  const time = format(new Date(data.datetime_start), 'HH:mm', { locale: he });
  
  message = message.replace('{guardian_name}', data.guardian_name || data.student_name);
  message = message.replace('{student_name}', data.student_name);
  message = message.replace('{service_name}', data.service_name);
  message = message.replace('{date}', date);
  message = message.replace('{time}', time);
  message = message.replace('{instructor_name}', data.instructor_name);
  message = message.replace('{clinic_name}', data.org_name || 'המרכז');
  message = message.replace('{clinic_phone}', data.org_phone || '');
  
  return message;
}
```

### 7.5 Performance Optimizations

**Calendar Data Loading:**
- Fetch only visible date range (day or week)
- Use React Query or SWR for caching
- Debounce date navigation (prevent rapid API calls)

**Template Manager:**
- Load all templates once (typically <500 rows)
- Filter/group client-side
- Use virtual scrolling if >1000 templates

**Real-time Conflict Check:**
- Debounce input changes (500ms)
- Cancel previous request on new input
- Show loading indicator during check

---

## 8. Implementation Phases

### Phase 1: Daily Calendar View (Week 1-2)
**Goal:** Basic calendar grid with instances display

**Tasks:**
1. Create API endpoints:
   - `GET /api/calendar/instances` (read instances for date range)
   - `GET /api/calendar/instructors` (list instructors for columns)
2. Create Calendar page route (`/calendar`)
3. Build CalendarGrid component:
   - Time column (06:00-22:00, 15-min intervals)
   - Instructor columns (dynamic based on roster)
   - LessonInstanceCard (readonly, click to view)
4. Build CalendarHeader:
   - Date navigator (prev/next day, date picker)
5. Build LessonInstanceDialog (readonly mode):
   - Display instance details
   - Display participants
   - Display status
6. Style with service colors and status icons
7. Test with sample data

**Deliverable:** User can view today's schedule, navigate between days, click instances to see details.

### Phase 2: Interactive Editing (Week 3)
**Goal:** Add/edit/cancel instances

**Tasks:**
1. Create API endpoints:
   - `POST /api/calendar/instances` (create instance)
   - `PUT /api/calendar/instances/{id}` (update instance)
   - `POST /api/calendar/conflicts/check` (conflict detection)
2. Build AddLessonDialog:
   - Student selector (ComboBox)
   - Instructor selector
   - Service selector
   - DateTime picker
   - Duration input
   - Real-time conflict warnings
3. Build LessonInstanceDialog edit mode:
   - Editable fields
   - Conflict warnings
4. Implement cancellation flow:
   - Cancellation reason selector
   - Charging calculation (basic)
5. Implement attendance marking:
   - Attended/No-show buttons
   - Status update API call
6. Test editing flows

**Deliverable:** User can add, edit, cancel lessons, mark attendance.

### Phase 3: Template Manager (Week 4)
**Goal:** Visual template management

**Tasks:**
1. Create API endpoints:
   - `GET /api/calendar/templates` (read templates)
   - `POST /api/calendar/templates` (create template)
   - `PUT /api/calendar/templates/{id}` (update/version template)
2. Create Template Manager route (`/calendar/templates`)
3. Build TemplateGrid component:
   - Instructor columns
   - Day rows (Sunday-Saturday)
   - Student template cards
4. Build AddTemplateDialog:
   - Student selector
   - Time picker
   - Duration input
   - Validity date range
5. Build TemplateEditDialog:
   - Editable fields
   - Versioning logic
   - Delete/deactivate action
6. Add "Templates" button in calendar header
7. Test template CRUD

**Deliverable:** User can view, add, edit, delete templates in visual grid.

### Phase 4: WhatsApp Integration (MVP) (Week 5)
**Goal:** Message generation and deep links

**Tasks:**
1. Create API endpoint:
   - `POST /api/calendar/instances/{id}/whatsapp-message` (generate message)
2. Create default message templates in Settings:
   - Reminder
   - Confirmation
   - Cancellation
3. Build WhatsAppMessageDialog:
   - Recipient selector
   - Template selector
   - Message preview (editable)
   - Copy button (clipboard API)
   - WhatsApp link button (wa.me deep link)
4. Add "Send WhatsApp" action in LessonInstanceDialog
5. Test message generation and links

**Deliverable:** User can generate WhatsApp messages with copy/paste or direct link.

### Phase 5: Weekly View & Polish (Week 6)
**Goal:** Weekly calendar and final touches

**Tasks:**
1. Build weekly calendar view:
   - 7-day horizontal grid
   - Smaller card sizes
   - Same interactions as daily
2. Add view switcher (Day/Week toggle)
3. Performance optimization:
   - Caching
   - Virtual scrolling (if needed)
   - Debounced API calls
4. Accessibility audit:
   - Keyboard navigation
   - Screen reader labels
   - Focus management
5. Mobile responsiveness:
   - Touch-friendly card sizes
   - Horizontal scroll hints
6. Error handling and loading states
7. Comprehensive testing

**Deliverable:** Full calendar feature with daily/weekly views, polished UX, production-ready.

---

## 9. Testing Strategy

### 9.1 Unit Tests
- Conflict detection functions
- Template variable replacement
- Date/time calculations
- Timezone conversions

### 9.2 Integration Tests
- API endpoint flows (add/edit/delete)
- Database transactions (instance + participants creation)
- Conflict check API with multiple scenarios

### 9.3 E2E Tests (Critical Paths)
1. View calendar → Click instance → See details
2. Add new lesson → Confirm no conflicts → Create successfully
3. Edit instance time → See conflict warning → Save anyway
4. Cancel lesson → Select reason → Confirm cancellation
5. Mark attendance → Trigger earnings → Verify DB updates
6. Navigate to templates → Add template → See in grid
7. Edit template → Version created → Grid updates
8. Generate WhatsApp message → Copy text → Verify clipboard
9. Generate WhatsApp message → Click link → Opens WhatsApp

### 9.4 Manual Testing
- Timezone edge cases (midnight, DST transitions)
- Overlapping instances rendering
- Long student names / service names (truncation)
- Mobile touch interactions
- WhatsApp deep links on different devices

---

## 10. Open Questions & Decisions Needed

### 10.1 Design Decisions
1. **Instructor column ordering:** Alphabetical or configurable?
   - **Recommendation:** Alphabetical by default, allow manual reordering (save in user preferences)

2. **Empty time slots:** Show empty rows or collapse?
   - **Recommendation:** Show all time slots (06:00-22:00) even if empty, for consistent layout

3. **Multi-student instances:** Stack names or show count?
   - **Recommendation:** Show first name + count badge (e.g., "Sarah +2")

4. **Cancelled instances:** Show grayed out or hide?
   - **Recommendation:** Show grayed out with strikethrough, allow filter toggle

### 10.2 Business Logic
1. **Charging rules:** Where to define cancellation windows and fees?
   - **Recommendation:** Store in `public.Settings` as org-level config

2. **Earnings calculation:** Trigger on attendance or on completion?
   - **Recommendation:** On attendance=true (attended status), but allow manual override

3. **Template versioning:** Always create new version or allow in-place edits?
   - **Recommendation:** Ask user: "Apply to future lessons only (create version)" vs "Update this template (affects generation)"

### 10.3 Technical
1. **Real-time updates:** WebSockets or polling?
   - **Recommendation:** Polling every 30s when calendar is visible, refresh on focus

2. **Optimistic updates:** Update UI before API confirms?
   - **Recommendation:** Yes, with rollback on error

3. **Undo mechanism:** Support undo for edits?
   - **Recommendation:** Phase 2 feature, use command pattern + audit log

---

## 11. Success Metrics

### 11.1 User Adoption
- 80% of instructors check calendar daily
- 60% of lessons marked as attended within 2 hours of completion
- 40% reduction in scheduling conflicts vs. previous Excel workflow

### 11.2 Performance
- Calendar loads in <2 seconds
- Conflict check responds in <500ms
- Template Manager loads in <3 seconds

### 11.3 Accuracy
- 0% instance overwrites by generation (critical constraint met)
- <5% conflicts per week (with warnings but allowing overrides)
- 100% timezone correctness (no off-by-one-hour bugs)

---

## 12. Future Enhancements (Post-MVP)

### Phase 6+: Advanced Features
1. **Drag-and-drop rescheduling** (drag instance card to new time/instructor)
2. **Bulk actions** (select multiple instances, bulk cancel/reschedule)
3. **Instructor availability blocks** (mark instructor unavailable for date range)
4. **Recurring exception rules** (e.g., "no lessons on holidays")
5. **WhatsApp bot integration** (inbound reply parsing, auto-status updates)
6. **SMS fallback** (for guardians without WhatsApp)
7. **Email reminders** (parallel to WhatsApp)
8. **Mobile app** (native iOS/Android with offline support)
9. **Calendar sync** (export to Google Calendar, iCal)
10. **Analytics dashboard** (capacity utilization, attendance rates, revenue per instructor)

---

## 13. File Structure

```
src/features/calendar/
├── pages/
│   ├── CalendarPage.jsx (daily/weekly view)
│   └── TemplateManagerPage.jsx
├── components/
│   ├── CalendarGrid/
│   │   ├── CalendarGrid.jsx
│   │   ├── TimeColumn.jsx
│   │   ├── InstructorColumn.jsx
│   │   ├── LessonInstanceCard.jsx
│   │   └── ConflictOverlay.jsx
│   ├── CalendarHeader/
│   │   ├── CalendarHeader.jsx
│   │   ├── DateNavigator.jsx
│   │   ├── ViewSwitcher.jsx
│   │   └── ActionButtons.jsx
│   ├── TemplateGrid/
│   │   ├── TemplateGrid.jsx
│   │   ├── InstructorColumn.jsx
│   │   ├── DayRow.jsx
│   │   └── StudentTemplateCard.jsx
│   ├── Dialogs/
│   │   ├── LessonInstanceDialog.jsx
│   │   ├── AddLessonDialog.jsx
│   │   ├── TemplateEditDialog.jsx
│   │   └── WhatsAppMessageDialog.jsx
│   └── Sections/
│       ├── InstanceDetails.jsx
│       ├── AttendanceSection.jsx
│       └── WhatsAppSection.jsx
├── hooks/
│   ├── useCalendar.js (calendar state)
│   ├── useTemplates.js (template state)
│   ├── useConflictCheck.js (conflict detection)
│   └── useWhatsApp.js (message generation)
├── utils/
│   ├── conflicts.js (conflict detection algorithms)
│   ├── whatsapp.js (template filling, wa.me link generation)
│   ├── timeGrid.js (time slot calculations)
│   └── instanceStatus.js (status badge helpers)
└── context/
    └── CalendarContext.jsx (global calendar state)

api/calendar/
├── instances/
│   ├── index.js (GET/POST instances)
│   └── function.json
├── instances-update/
│   ├── index.js (PUT /instances/{id})
│   └── function.json
├── attendance/
│   ├── index.js (POST /instances/{id}/attendance)
│   └── function.json
├── templates/
│   ├── index.js (GET/POST/PUT templates)
│   └── function.json
├── conflicts/
│   ├── index.js (POST /conflicts/check)
│   └── function.json
└── whatsapp-message/
    ├── index.js (POST /instances/{id}/whatsapp-message)
    └── function.json
```

---

## 14. Dependencies

### Frontend
- `date-fns` + `date-fns-tz` (date/time handling with timezone support)
- `react-day-picker` (date picker component)
- `sonner` (toast notifications, already in use)
- `zustand` or React Context (state management)
- `react-query` or `swr` (data fetching/caching)

### Backend
- Existing: Supabase client, org-bff helpers, audit-log
- New: Conflict detection logic (can be pure JS utility)

---

## 15. Risks & Mitigations

### Risk 1: Timezone Bugs
**Impact:** High (incorrect times = missed lessons)  
**Mitigation:**
- Use `timestamptz` everywhere
- Test with multiple timezones
- Display timezone abbreviation in UI (e.g., "14:00 IST")

### Risk 2: Performance with Many Instructors
**Impact:** Medium (slow rendering, poor UX)  
**Mitigation:**
- Virtual scrolling for instructor columns
- Lazy load instances outside visible range
- Cache instructor list

### Risk 3: Conflict Detection False Positives
**Impact:** Medium (annoying warnings)  
**Mitigation:**
- Clear warning messages
- Allow override with confirmation
- Log overrides to audit trail

### Risk 4: WhatsApp Link Failures
**Impact:** Low (fallback: copy/paste works)  
**Mitigation:**
- Test wa.me links on iOS/Android/desktop
- Provide clear instructions
- Support multiple phone formats (with/without country code)

---

## 16. Next Steps

1. **Review & Approve Plan** (stakeholder sign-off)
2. **Set Up Project Board** (track tasks per phase)
3. **Implement Phase 1** (daily calendar view)
4. **Demo & Iterate** (user testing after each phase)
5. **Deploy to Production** (after Phase 5 complete)

---

**End of Implementation Plan**
