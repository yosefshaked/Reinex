# StudentDetailPage Refactor Plan - Phase 5 Step 2b

## Scope: Tabbed Component Architecture

### New Tab Structure (URL-based routing)
- **URL Pattern:** `/students/:id/:tab?` (router already updated)
- **Tab Parameter:** Extracted from `useParams()` as `tab` or defaults to `overview`
- **Tab Components:**
  - `overview` → `StudentOverviewTab`
  - `schedule` → `StudentScheduleTab`
  - `history` → `StudentHistoryTab`
  - `documents` → `StudentDocumentsSection` (existing)

### New Component Files Created
1. **StudentHeader.jsx** (200 lines)
   - Identity block, medical flags badges
   - Back button, action dropdown (edit, suspend, delete)
   - RTL: logical CSS properties, Arabic text direction
   - Props: `student`, `canEdit`, `isUpdating`, callbacks

2. **StudentOverviewTab.jsx** (180 lines)
   - Dashboard grid with next lesson, templates, financials placeholder, internal notes
   - Green accent for action-ready items
   - Props: `student`, `nextLesson`, `lessonTemplates`, `isLoading`

3. **StudentScheduleTab.jsx** (250 lines)
   - Lesson templates list + 14-day instances table
   - Pagination support
   - Data fetching hooks
   - Props: `studentId`, `lessonTemplates`, `isLoadingTemplates`

4. **StudentHistoryTab.jsx** (350 lines)
   - Audit log timeline with expandable details
   - Before/after value display
   - Cursor-based pagination (uses extended audit-log API)
   - Props: `studentId`

### Modified Files

#### **api/audit-log/index.js** ✅ DONE
- Added `resourceId` query parameter extraction
- Filters `audit_log` table by `resource_id` when `student_id` param provided
- Maintains all existing filters (action_category, limit, before)

#### **src/main.jsx** ✅ DONE
- Router updated: `/students/:id` → `/students/:id/:tab?`
- Enables tab parameter navigation

#### **src/features/students/pages/StudentDetailPage.jsx** ⏳ PENDING
- Refactoring approach:
  1. Keep ALL state management (loaders, error handlers, async functions)
  2. Extract `tab` param from `useParams()`
  3. Replace massive JSX return with simplified structure:
     - StudentHeader (delegated)
     - Tabs component with TabsList and TabsContent
     - Override tab switching with URL navigation
  4. Delegate tab content to new components
  5. Keep legacy modals/dialogs  (EditStudentModal,  StudentScheduleDialog, LegacyImportModal)
  6. Simplified render for error/loading states

### API Extension Pending (Step 3)

#### **api/lesson-instances/index.js** ⏳ NEEDS EXTENSION
- Current: Filters by `date` parameter
- Required: Add optional `student_id` query parameter
- Enables: `StudentScheduleTab` to fetch lessons for specific student
- Logic: When `student_id` provided, filter `lesson_instances` WHERE `student_id = value`

### Validation Plan

**After Refactor:**
1. Run lint on new components: `eslint src/features/students/components/*.jsx`
2. Validate StudentDetailPage render: `eslint src/features/students/pages/StudentDetailPage.jsx`
3. Test URL navigation: 
   - `/students/:id` (defaults to overview tab)
   - `/students/:id/overview`
   - `/students/:id/schedule`
   - `/students/:id/history`
4. Verify component delegation:
   - StudentHeader renders with actions
   - StudentOverviewTab shows dashboard
   - StudentScheduleTab loads lesson data
   - StudentHistoryTab fetches audit log

### Code Example: Tab Switching

```jsx
// Navigate to different tabs programmatically
const handleTabChange = (newTab) => {
  navigate(`/students/${studentId}/${newTab}`);
};

// TabsList with RTL support
<TabsList className="grid w-full grid-cols-3 dir-rtl" dir="rtl">
  <TabsTrigger value="overview">סקירה כללית</TabsTrigger>
  <TabsTrigger value="schedule">לוח זמנים</TabsTrigger>
  <TabsTrigger value="history">היסטוריה</TabsTrigger>
</TabsList>
```

### Alignment with Architectural Rules

✅ **API Reusability:** No new endpoints created
- Reused: audit-log (with `resource_id` filter)
- Reused: lesson-templates
- Reused: session-records
- Extending: lesson-instances (optional `student_id` filter)

✅ **Component Breakdown:** Clear separation of concerns
- StudentHeader: Identity & navigation
- StudentOverviewTab: Dashboard summary
- StudentScheduleTab: Templates + instances
- StudentHistoryTab: Audit timeline

✅ **RTL Support:** All new components use logical CSS
- Classes: `ms-`, `me-`, `text-right` via Tailwind logical properties
- Dir attributes applied
- Font-direction inherited from app context

✅ **URL-Based Routing:** Tab switching via URL
- Pattern: `/students/:id/:tab?`
- Default: `overview` when tab param missing
- Navigation: `navigate(`/students/${studentId}/${tab}`)`

---

## Status: ⏳ READY FOR STEP 2b COMPLETION

Next Action: Replace StudentDetailPage.jsx render method with tabbed structure
