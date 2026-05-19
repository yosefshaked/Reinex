# Reinex Student API Migration

## Overview
The student creation form has been updated to match the Reinex data model, which uses `public.students` as the source of truth across all products (Reinex, TutTiud, TutRate).

## Frontend Changes Completed ✅

### Form State (`src/features/students/utils/form-state.js`)
**Removed fields:**
- `contactName` / `contactPhone` (moved to guardians table)
- `assignedInstructorId` (moved to lesson templates)
- `defaultService` / `defaultDayOfWeek` / `defaultSessionTime` (moved to lesson templates)
- `notes` (renamed to `notesInternal`)

**Added fields:**
- `dateOfBirth` (date, optional) - For service planning
- `notificationMethod` (string, default 'whatsapp') - WhatsApp or email
- `specialRate` (numeric, optional) - Special pricing for this student
- `medicalFlags` (jsonb, optional) - Structured medical/safety flags
- `onboardingStatus` (string, default 'not_started') - Form completion status
- `notesInternal` (text, optional) - Internal staff notes (renamed from `notes`)

### Form UI (`src/features/admin/components/AddStudentForm.jsx`)
**Updated:**
- Removed instructor selector (scheduling is separate)
- Removed service/day/time fields (lesson templates handle scheduling)
- Removed contact/guardian fields (separate guardians table)
- Added date of birth field
- Added notification method selector (WhatsApp/Email)
- Added special rate field
- Renamed notes to "הערות פנימיות" (Internal Notes)
- Added blue info banner explaining that lesson scheduling happens after student creation

## Backend Changes Required ⚠️

### API Endpoint: `/api/students-list` (POST handler)

The current endpoint expects TutTiud schema fields. It needs to be updated to handle Reinex schema.

#### Current Expected Fields (TutTiud):
```javascript
{
  firstName, middleName, lastName,
  identityNumber,
  phone, email,
  contactName, contactPhone,  // ❌ Remove
  assignedInstructorId,        // ❌ Remove
  defaultService,              // ❌ Remove
  defaultDayOfWeek,            // ❌ Remove
  defaultSessionTime,          // ❌ Remove
  notes,                       // ❌ Rename to notesInternal
  tags,
  isActive
}
```

#### New Expected Fields (Reinex):
```javascript
{
  firstName, middleName, lastName,
  identityNumber,
  dateOfBirth,                 // ✅ Add
  phone, email,
  notificationMethod,          // ✅ Add
  specialRate,                 // ✅ Add
  medicalFlags,                // ✅ Add
  onboardingStatus,            // ✅ Add
  notesInternal,               // ✅ Renamed from notes
  tags,
  isActive
}
```

#### Required Backend Changes:

1. **Update `buildStudentPayload` function** in `api/students-list/index.js`:
   ```javascript
   function buildStudentPayload(body) {
     // ... existing name/identity validation ...
     
     // Add new field validations:
     const dateOfBirthResult = coerceOptionalDate(body?.date_of_birth ?? body?.dateOfBirth);
     if (!dateOfBirthResult.valid) {
       return { error: 'invalid_date_of_birth' };
     }
     
     const notificationMethodResult = coerceNotificationMethod(
       body?.default_notification_method ?? body?.notificationMethod
     );
     if (!notificationMethodResult.valid) {
       return { error: 'invalid_notification_method' };
     }
     
     const specialRateResult = coerceOptionalNumeric(body?.special_rate ?? body?.specialRate);
     if (!specialRateResult.valid) {
       return { error: 'invalid_special_rate' };
     }
     
     const medicalFlagsResult = coerceOptionalJsonb(body?.medical_flags ?? body?.medicalFlags);
     if (!medicalFlagsResult.valid) {
       return { error: 'invalid_medical_flags' };
     }
     
     const onboardingStatusResult = coerceOnboardingStatus(
       body?.onboarding_status ?? body?.onboardingStatus
     );
     if (!onboardingStatusResult.valid) {
       return { error: 'invalid_onboarding_status' };
     }
     
     const notesInternalResult = coerceOptionalText(body?.notes_internal ?? body?.notesInternal);
     if (!notesInternalResult.valid) {
       return { error: 'invalid_notes_internal' };
     }
     
     // Remove validations for: contactName, contactPhone, assignedInstructorId,
     // defaultService, defaultDayOfWeek, defaultSessionTime
     
     return {
       payload: {
         first_name: firstName,
         middle_name: middleName || null,
         last_name: lastName,
         identity_number: identityNumberResult.value,
         date_of_birth: dateOfBirthResult.value,
         phone: phoneResult.value,
         email: emailResult.value,
         default_notification_method: notificationMethodResult.value,
         special_rate: specialRateResult.value,
         medical_flags: medicalFlagsResult.value,
         onboarding_status: onboardingStatusResult.value,
         notes_internal: notesInternalResult.value,
         tags: tagsResult.value,
         is_active: isActiveValue,
       },
     };
   }
   ```

2. **Add validation helpers** in `api/_shared/student-validation.js`:
   ```javascript
   export function coerceOptionalDate(raw) {
     if (raw === null || raw === undefined) {
       return { value: null, valid: true };
     }
     if (typeof raw === 'string') {
       const trimmed = raw.trim();
       if (!trimmed) return { value: null, valid: true };
       // Validate YYYY-MM-DD format
       if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
         return { value: trimmed, valid: true };
       }
     }
     return { value: null, valid: false };
   }
   
   export function coerceNotificationMethod(raw) {
     const normalized = String(raw || 'whatsapp').trim().toLowerCase();
     if (normalized === 'whatsapp' || normalized === 'email') {
       return { value: normalized, valid: true };
     }
     return { value: null, valid: false };
   }
   
   export function coerceOptionalNumeric(raw) {
     if (raw === null || raw === undefined || raw === '') {
       return { value: null, valid: true };
     }
     const num = parseFloat(raw);
     if (isNaN(num)) {
       return { value: null, valid: false };
     }
     return { value: num, valid: true };
   }
   
   export function coerceOptionalJsonb(raw) {
     if (raw === null || raw === undefined) {
       return { value: null, valid: true };
     }
     if (typeof raw === 'object') {
       return { value: raw, valid: true };
     }
     if (typeof raw === 'string') {
       try {
         const parsed = JSON.parse(raw);
         return { value: parsed, valid: true };
       } catch {
         return { value: null, valid: false };
       }
     }
     return { value: null, valid: false };
   }
   
   export function coerceOnboardingStatus(raw) {
     const normalized = String(raw || 'not_started').trim().toLowerCase();
     const validStatuses = ['not_started', 'pending_forms', 'approved'];
     if (validStatuses.includes(normalized)) {
       return { value: normalized, valid: true };
     }
     return { value: null, valid: false };
   }
   ```

3. **Update error messages** in POST handler:
   ```javascript
   const message =
     // ... existing error codes ...
     : normalized.error === 'invalid_date_of_birth'
       ? 'invalid date of birth'
       : normalized.error === 'invalid_notification_method'
         ? 'invalid notification method'
         : normalized.error === 'invalid_special_rate'
           ? 'invalid special rate'
           : normalized.error === 'invalid_medical_flags'
             ? 'invalid medical flags'
             : normalized.error === 'invalid_onboarding_status'
               ? 'invalid onboarding status'
               : normalized.error === 'invalid_notes_internal'
                 ? 'invalid internal notes'
                 : 'invalid payload';
   ```

4. **Update database insert** to target `public.students` instead of `tuttiud."Students"`:
   ```javascript
   const { data, error } = await tenantClient
     .from('students')  // Changed from 'Students' (tuttiud schema)
     .insert([recordToInsert])
     .select()
     .single();
   ```

5. **Create Supabase tenant client with public schema**:
   ```javascript
   const tenantClient = createSupabaseClient(tenantUrl, tenantAnonKey, {
     db: { schema: 'public' },  // ✅ Required for Reinex
     // ... other config
   });
   ```

## Database Schema Changes Required

The backend must ensure the `public.students` table exists with the Reinex schema:

```sql
CREATE TABLE IF NOT EXISTS public.students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  middle_name text NULL,
  last_name text NULL,
  identity_number text NOT NULL UNIQUE,
  date_of_birth date NULL,
  phone text NULL,
  email text NULL,
  default_notification_method text NOT NULL DEFAULT 'whatsapp' CHECK (default_notification_method IN ('whatsapp','email')),
  special_rate numeric NULL,
  medical_flags jsonb NULL,
  onboarding_status text NOT NULL DEFAULT 'not_started' CHECK (onboarding_status IN ('not_started','pending_forms','approved')),
  notes_internal text NULL,
  tags uuid[] NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NULL
);

CREATE INDEX IF NOT EXISTS idx_students_identity_number ON public.students(identity_number);
CREATE INDEX IF NOT EXISTS idx_students_is_active ON public.students(is_active);
CREATE INDEX IF NOT EXISTS idx_students_name ON public.students(first_name, last_name);
```

## Guardian/Contact Management (Future)

The form no longer collects guardian/contact information during student creation. This will be handled separately through:

1. **Guardians table** (`public.guardians`):
   - Separate entity with own form
   - Can be linked to multiple students
   
2. **Student-Guardian relationships** (`public.student_guardians`):
   - Many-to-many relationship
   - Relationship type (father, mother, caretaker, etc.)
   - Primary guardian flag

3. **Guardian management UI**:
   - Add guardian button on student profile page
   - Search existing guardians or create new
   - Link/unlink guardians from students

## Lesson Template Management (Future)

Instructor assignment and scheduling are no longer part of student creation. This will be handled through:

1. **Lesson Templates table** (`public.lesson_templates`):
   - Weekly recurring schedule
   - Student → Instructor → Service → Day/Time
   - Valid from/until dates
   - Version tracking

2. **Lesson scheduling UI**:
   - Calendar view for creating templates
   - Drag-and-drop scheduling
   - Conflict detection
   - Bulk operations

## Migration Path

### Phase 1: Immediate (Student Creation) ✅
- Frontend form updated to Reinex model
- Backend API needs updates (see above)
- Database schema deployed

### Phase 2: Guardian Management (Next)
- Create guardians table and API
- Add guardian UI to student profile
- Migrate existing contact data from TutTiud

### Phase 3: Lesson Templates (Next)
- Create lesson templates table and API
- Add calendar/scheduling UI
- Migrate existing instructor assignments from TutTiud

### Phase 4: Data Migration (Later)
- Migrate existing `tuttiud."Students"` to `public.students`
- Preserve audit trail and metadata
- Update all references

## Testing Checklist

- [ ] Backend validation for all new fields
- [ ] Database schema deployed to tenant
- [ ] Student creation with minimal fields (name + identity)
- [ ] Student creation with all optional fields
- [ ] Duplicate identity number detection still works
- [ ] Phone validation (Israeli format)
- [ ] Email validation
- [ ] Special rate accepts decimal values
- [ ] Notification method dropdown works
- [ ] Date of birth picker works
- [ ] Internal notes field saves correctly
- [ ] Tags still work
- [ ] Build succeeds
- [ ] No console errors

## Notes

- The form now clearly states that lesson scheduling happens after student creation
- Phone and email are truly optional (for adult/independent students)
- Guardian management is separated from student creation
- The form is cleaner and more focused on core student identity
- All lesson scheduling logic has been removed from student entity
