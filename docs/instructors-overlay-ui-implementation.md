# Instructors Overlay UI Implementation

## Summary
Complete UI implementation for managing instructor profiles (working days, break time) and service capabilities using Reinex overlay table pattern.

## Components Created

### 1. EditInstructorProfileDialog.jsx
**Location**: `src/components/settings/employee-management/EditInstructorProfileDialog.jsx`

**Purpose**: Edit working days and break time for instructors

**Features**:
- Visual 7-day selector (Sunday-Saturday) with Hebrew labels
- Toggle functionality for selecting/deselecting days
- Break time input (0-240 minutes, step 5)
- Selected days summary with count
- Form validation and error handling
- Toast notifications for success/error
- Loading state during save operation

**API Integration**:
```javascript
PUT /api/instructors
{
  org_id: "uuid",
  instructor_id: "uuid",
  working_days: [0, 1, 2, 3, 4],  // Sunday-Thursday
  break_time_minutes: 30
}
```

**State Management**:
- `workingDays`: Array of integers (0-6)
- `breakTimeMinutes`: Number (0-240)
- `isSaving`: Boolean for disabled state

### 2. EditServiceCapabilitiesDialog.jsx
**Location**: `src/components/settings/employee-management/EditServiceCapabilitiesDialog.jsx`

**Purpose**: Manage which services an instructor can provide, with capacity and rate per service

**Features**:
- Loads available services from `/settings/services` API
- Dynamic capabilities list (add/remove)
- Each capability includes:
  - Service selection (dropdown)
  - Max students (1-50)
  - Base hourly rate (decimal)
- Add button auto-selects first available service
- Remove button deletes capability
- Shows "all services configured" when no more services available
- Validation: service_id required, max_students >= 1
- Prevents duplicate service assignments
- Service name resolution from loaded services array

**API Integration**:
```javascript
PUT /api/instructors
{
  org_id: "uuid",
  instructor_id: "uuid",
  service_capabilities: [
    {
      service_id: "uuid",
      max_students: 5,
      base_rate: 150.00
    }
  ]
}
```

**State Management**:
- `services`: Array of available services
- `capabilities`: Array of capability objects
- `loadingServices`: Boolean for loading state
- `isSaving`: Boolean for save state

## DirectoryView Integration

### Changes Made
**File**: `src/components/settings/employee-management/DirectoryView.jsx`

**Additions**:
1. **Imports**:
   - `EditInstructorProfileDialog`
   - `EditServiceCapabilitiesDialog`
   - `Settings` and `Briefcase` icons from lucide-react

2. **State**:
   - `showProfileDialog`: Boolean
   - `showCapabilitiesDialog`: Boolean
   - `editingInstructor`: Object | null

3. **Handlers**:
   ```javascript
   const handleEditProfile = (instructor) => {
     setEditingInstructor(instructor);
     setShowProfileDialog(true);
   };
   
   const handleEditCapabilities = (instructor) => {
     setEditingInstructor(instructor);
     setShowCapabilitiesDialog(true);
   };
   ```

4. **UI Buttons** (Active Instructors Tab):
   - "פרופיל" button with Settings icon
   - "שירותים" button with Briefcase icon
   - Positioned before "השבת" (deactivate) button
   - Responsive layout (flex-col on mobile, flex-row on desktop)

5. **Dialog Components** (at end of render):
   ```jsx
   <EditInstructorProfileDialog
     open={showProfileDialog}
     onOpenChange={setShowProfileDialog}
     instructor={editingInstructor}
     orgId={orgId}
     session={session}
     onSaved={() => void refetchInstructors()}
   />
   
   <EditServiceCapabilitiesDialog
     open={showCapabilitiesDialog}
     onOpenChange={setShowCapabilitiesDialog}
     instructor={editingInstructor}
     orgId={orgId}
     session={session}
     onSaved={() => void refetchInstructors()}
   />
   ```

## API Enhancement

### PUT Handler Update
**File**: `api/instructors/index.js`

**Added Logic** (after main Employee update, before audit log):

1. **Instructor Profile Updates**:
   ```javascript
   if (body.working_days !== undefined || body.break_time_minutes !== undefined) {
     const profilePayload = { employee_id: instructorId };
     if (body.working_days !== undefined) profilePayload.working_days = body.working_days;
     if (body.break_time_minutes !== undefined) profilePayload.break_time_minutes = body.break_time_minutes;
     
     await tenantClient
       .from('instructor_profiles')
       .upsert(profilePayload, { onConflict: 'employee_id' });
   }
   ```

2. **Service Capabilities Updates**:
   ```javascript
   if (body.service_capabilities !== undefined) {
     // Delete existing capabilities
     await tenantClient
       .from('instructor_service_capabilities')
       .delete()
       .eq('employee_id', instructorId);
     
     // Insert new capabilities
     if (body.service_capabilities.length > 0) {
       const capabilitiesWithEmployeeId = body.service_capabilities.map(cap => ({
         employee_id: instructorId,
         service_id: cap.service_id,
         max_students: cap.max_students || 1,
         base_rate: cap.base_rate || 0,
         metadata: cap.metadata || {},
       }));
       
       await tenantClient
         .from('instructor_service_capabilities')
         .insert(capabilitiesWithEmployeeId);
     }
   }
   ```

**Strategy**: Delete-then-insert approach for capabilities ensures UNIQUE constraint (employee_id, service_id) is respected and simplifies client-side logic.

## Database Schema

### instructor_profiles
```sql
CREATE TABLE IF NOT EXISTS tuttiud.instructor_profiles (
  employee_id uuid PRIMARY KEY REFERENCES tuttiud."Employees"(id) ON DELETE CASCADE,
  working_days integer[] DEFAULT ARRAY[]::integer[],
  break_time_minutes integer DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);
```

**Notes**:
- One-to-one relationship with Employees
- `working_days`: Array of integers 0-6 (0=Sunday, 6=Saturday)
- `break_time_minutes`: Integer (0-240)
- Cascade delete when employee deleted

### instructor_service_capabilities
```sql
CREATE TABLE IF NOT EXISTS tuttiud.instructor_service_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES tuttiud."Employees"(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES tuttiud."Services"(id) ON DELETE CASCADE,
  max_students integer DEFAULT 1 CHECK (max_students >= 1),
  base_rate numeric(10,2) DEFAULT 0 CHECK (base_rate >= 0),
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW(),
  UNIQUE(employee_id, service_id)
);
```

**Notes**:
- One-to-many relationship with Employees
- UNIQUE constraint prevents duplicate service assignments
- Cascade delete when employee or service deleted
- CHECK constraints for validation

## User Flow

### Edit Profile Flow
1. Admin navigates to Settings → Employees & Instructors
2. In "Active Instructors" tab, clicks "פרופיל" button
3. Dialog opens showing:
   - 7 visual day buttons (current selection highlighted)
   - Break time input (pre-filled if exists)
   - Selected days count and abbreviations
4. Admin selects/deselects days by clicking buttons
5. Admin enters break time (e.g., 30 minutes)
6. Clicks "שמור שינויים"
7. Toast notification: "הפרופיל עודכן בהצלחה"
8. Dialog closes, instructor list refreshes
9. Re-opening dialog shows persisted values

### Edit Capabilities Flow
1. Admin clicks "שירותים" button on instructor
2. Dialog opens showing:
   - List of current capabilities (if any)
   - "הוסף שירות" button
   - Empty state message if no capabilities
3. Admin clicks "הוסף שירות"
   - New capability row appears
   - Service dropdown auto-selects first available
   - Max students defaults to 1
   - Base rate defaults to 0
4. Admin configures:
   - Selects service from dropdown
   - Sets max students (e.g., 5)
   - Sets base rate (e.g., 150.00)
5. Admin can add more services or remove existing ones
6. Clicks "שמור שינויים"
7. Toast notification: "היכולות עודכנו בהצלחה"
8. Dialog closes, instructor list refreshes
9. Re-opening shows persisted capabilities

## Validation Rules

### Profile
- **Working Days**: 
  - Optional (empty array allowed)
  - Values must be 0-6 (enforced by UI)
  - Duplicates prevented by Set logic

- **Break Time**:
  - Optional (defaults to 0)
  - Range: 0-240 minutes
  - Step: 5 minutes (enforced by input)

### Capabilities
- **Service ID**: Required (enforced by UI)
- **Max Students**: 
  - Required
  - Minimum: 1 (enforced by UI and DB CHECK)
  - Maximum: 50 (UI only, can be increased if needed)
- **Base Rate**:
  - Required (defaults to 0)
  - Minimum: 0 (enforced by DB CHECK)
  - Format: Decimal with 2 precision
- **Duplicate Prevention**: UNIQUE(employee_id, service_id) enforced by DB

## Hebrew Day Mapping
```javascript
const HEBREW_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const HEBREW_DAY_ABBR = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

// Example: Sunday = 0 → 'ראשון' → 'א׳'
```

## Error Handling

### Frontend
- Missing required fields: Toast error with Hebrew message
- API failures: Toast error with server message
- Network errors: Toast error "שגיאה בשמירת השינויים"
- Loading states: Buttons disabled, spinner shown

### Backend
- Missing instructor_id: 400 "missing instructor id"
- Instructor not found: 404 "instructor_not_found"
- Profile upsert failure: 500 "failed_to_update_instructor_profile"
- Capabilities delete failure: 500 "failed_to_delete_service_capabilities"
- Capabilities insert failure: 500 "failed_to_insert_service_capabilities"
- Validation errors: 400 with specific error code

## Testing Checklist

### Profile Editing
- [x] Build successful
- [ ] Dialog opens when clicking "פרופיל"
- [ ] Current working days displayed correctly
- [ ] Current break time displayed correctly
- [ ] Day selection toggles work
- [ ] Break time input validates range
- [ ] Save button disabled during save
- [ ] Toast success message appears
- [ ] Dialog closes after save
- [ ] Instructor list refreshes
- [ ] Values persist after re-opening
- [ ] Error messages appear on failure

### Capabilities Editing
- [x] Build successful
- [ ] Dialog opens when clicking "שירותים"
- [ ] Services load correctly
- [ ] Current capabilities displayed
- [ ] Add service creates new row
- [ ] Remove service deletes row
- [ ] Service dropdown shows available services
- [ ] Max students validates >= 1
- [ ] Base rate accepts decimals
- [ ] Duplicate service prevented
- [ ] "All services configured" message shows
- [ ] Save button disabled during save
- [ ] Toast success message appears
- [ ] Dialog closes after save
- [ ] Instructor list refreshes
- [ ] Values persist after re-opening

### Integration
- [x] Build successful
- [ ] Buttons appear on instructor cards
- [ ] Buttons don't overlap on mobile
- [ ] Buttons don't overflow on desktop
- [ ] Multiple dialogs can be opened sequentially
- [ ] Refresh callbacks work correctly
- [ ] No console errors
- [ ] Hebrew text displays correctly (RTL)
- [ ] Icons render properly

## Future Enhancements

### Display Enhancements
- [ ] Show working days count badge on instructor card
- [ ] Show capabilities count badge on instructor card
- [ ] Tooltip showing full working days list
- [ ] Color-code instructors based on profile completeness
- [ ] Visual indicator for instructors without capabilities

### Validation Enhancements
- [ ] Warn if working days overlap with organization holidays
- [ ] Suggest base rate based on similar instructors
- [ ] Validate max_students against historical session counts

### UX Enhancements
- [ ] Quick edit mode (inline editing without dialog)
- [ ] Bulk edit capabilities for multiple instructors
- [ ] Copy profile from another instructor
- [ ] Template-based capability sets

### Reporting
- [ ] Report showing instructor availability by day
- [ ] Report showing service coverage (which instructors can provide which services)
- [ ] Capacity planning report (max_students vs actual utilization)

## Dependencies

### NPM Packages
- `lucide-react`: Icons (Settings, Briefcase, Calendar, Clock, Users, DollarSign)
- `sonner`: Toast notifications
- `@radix-ui/react-dialog`: Dialog primitive
- `@radix-ui/react-select`: Select dropdown primitive

### Internal
- `@/lib/api-client`: `authenticatedFetch` helper
- `@/components/ui/*`: Reusable UI components
- `@/lib/utils`: `cn` utility for classNames

## Security

### Authorization
- Only admin/owner can edit instructor profiles
- Only admin/owner can edit service capabilities
- Non-admin instructors can view but not edit
- Backend enforces role checks before accepting updates

### Data Validation
- All inputs validated on frontend before submission
- Backend validates all fields before database writes
- Database CHECK constraints prevent invalid data
- UNIQUE constraints prevent duplicate capabilities

## Performance

### Optimization Strategies
- Services loaded once per dialog open (cached in state)
- Instructor list refetch only after successful save
- No polling or real-time updates
- Minimal re-renders using controlled components

### Potential Bottlenecks
- Large service catalogs (50+ services) may impact dropdown performance
- Consider virtualization if > 100 services
- Capabilities list render time grows with number of services
- Consider pagination if > 20 capabilities per instructor

## Backward Compatibility

### Schema
- No backward compatibility maintained (per user requirement)
- Fresh deployments only support overlay table pattern
- Old schema (if any) should be migrated before deploying

### API
- GET handler always returns overlay data
- POST handler creates overlay records when provided
- PUT handler upserts overlay records
- Null/empty overlay data handled gracefully

## Documentation Updates

### Files Updated
- `AGENTS.md`: Reinex Instructors Pattern section updated
- `docs/instructors-api-refactor-summary.md`: Referenced for API patterns
- `docs/instructors-api-response-structure.md`: Referenced for response contract
- This file: Complete UI implementation documentation

## Deployment Checklist

- [x] Database schema created (instructor_profiles, instructor_service_capabilities)
- [x] API endpoints updated (GET, POST, PUT)
- [x] Frontend components created (EditInstructorProfileDialog, EditServiceCapabilitiesDialog)
- [x] DirectoryView integration complete
- [x] Build successful
- [ ] End-to-end testing complete
- [ ] User acceptance testing complete
- [ ] Documentation reviewed
- [ ] Deployed to production

## Summary

Complete UI implementation for Reinex instructor overlay pattern. Admins can now manage:
- Instructor working days (Sunday-Saturday selection)
- Break time (0-240 minutes)
- Service capabilities (which services, max students per service, hourly rate)

All features integrated into existing DirectoryView with consistent patterns (dialog-based, Hebrew RTL, toast notifications, loading states). Backend API enhanced to process overlay table updates via PUT handler with delete-then-insert strategy for capabilities.

Build successful, ready for testing and deployment.
