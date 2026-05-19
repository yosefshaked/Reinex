# Guardian Integration & Contact Phone Requirements

## Overview
This document describes the guardian integration in student management and the conditional phone requirement logic implemented for Reinex.

## Contact Method Requirements

### Core Rules
1. **Phone number is REQUIRED** unless a guardian is connected
2. **Email is OPTIONAL** always (including when guardian is connected)
3. **Guardian's contact info** is used as fallback when connected

### Logic Flow

```
if (student.guardian_id exists) {
  // Guardian connected
  - Student phone: OPTIONAL (can leave blank)
  - Student email: OPTIONAL
  - Display: Show guardian's phone as primary contact
  - Display: Show guardian's email in profile if exists
} else {
  // Independent student
  - Student phone: REQUIRED
  - Student email: OPTIONAL
  - Display: Use student's phone as primary contact
}
```

## Database Schema

### Guardians Table (`public.guardians`)

```sql
CREATE TABLE IF NOT EXISTS public.guardians (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  phone text NOT NULL, -- Required: primary contact method
  email text, -- Optional
  relationship text, -- Optional: e.g., "הורה", "סבא/סבתא", "אפוטרופוס חוקי"
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_guardians_is_active ON public.guardians(is_active);
CREATE INDEX idx_guardians_phone ON public.guardians(phone);
```

### Students Table Updates (`public.students`)

```sql
-- Add guardian_id column
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS guardian_id uuid REFERENCES public.guardians(id);

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_students_guardian_id ON public.students(guardian_id);

-- Phone is now optional (nullable)
ALTER TABLE public.students ALTER COLUMN phone DROP NOT NULL;

-- Note: This migration should be run carefully as it changes validation rules
```

## API Endpoints

### Guardian CRUD

#### GET /api/guardians
List all active guardians for organization.

**Response:**
```json
{
  "guardians": [
    {
      "id": "uuid",
      "first_name": "יוסי",
      "last_name": "כהן",
      "phone": "0541234567",
      "email": "yossi@example.com",
      "relationship": "הורה",
      "is_active": true,
      "created_at": "2026-01-28T10:00:00Z"
    }
  ]
}
```

#### POST /api/guardians
Create new guardian.

**Request:**
```json
{
  "org_id": "uuid",
  "first_name": "יוסי",
  "last_name": "כהן",
  "phone": "0541234567", // Required
  "email": "yossi@example.com", // Optional
  "relationship": "הורה" // Optional
}
```

**Validation:**
- `first_name`: Required
- `last_name`: Required
- `phone`: Required, must be valid Israeli phone
- `email`: Optional, must be valid email format if provided
- `relationship`: Optional

#### PUT /api/guardians/:id
Update existing guardian.

**Request:** Same as POST, all fields optional except phone must be valid if changing.

#### DELETE /api/guardians/:id
Soft delete guardian.

**Error:** Returns 400 `guardian_has_students` if guardian has active students assigned.

### Student Creation with Guardian

#### POST /api/students-list
Create student with optional guardian assignment.

**Request:**
```json
{
  "firstName": "דני",
  "middleName": "משה",
  "lastName": "לוי",
  "identityNumber": "123456789",
  "dateOfBirth": "2015-05-15",
  "guardianId": "uuid-or-null", // Optional
  "phone": "0541234567", // Required if guardianId is null
  "email": "danny@example.com", // Optional
  "notificationMethod": "whatsapp",
  "specialRate": 150.00,
  "medicalFlags": null,
  "onboardingStatus": "not_started",
  "notesInternal": "הערות פנימיות",
  "tags": ["uuid1", "uuid2"],
  "isActive": true
}
```

**Backend Validation:**
```javascript
// Phone required if no guardian
if (!body.guardianId && !body.phone) {
  return respond(context, 400, { 
    error: 'phone_required_without_guardian',
    message: 'Phone number is required when no guardian is assigned'
  });
}

// Validate phone format if provided
if (body.phone && !validateIsraeliPhone(body.phone)) {
  return respond(context, 400, { error: 'invalid_phone' });
}
```

## Frontend Components

### Form Components Created

1. **`useGuardians()` Hook** (`src/hooks/useGuardians.js`)
   - Fetches guardians list
   - Creates new guardians
   - Auto-refreshes after creation

2. **`GuardianSelector`** (`src/features/admin/components/GuardianSelector.jsx`)
   - Dropdown to select existing guardian
   - "+ Create Guardian" button
   - Shows selected guardian details (name, phone, email)
   - Dynamic phone field requirement indicator

3. **`CreateGuardianDialog`** (`src/features/admin/components/CreateGuardianDialog.jsx`)
   - Modal form for creating new guardian
   - Fields: firstName, lastName, phone (required), email (optional), relationship (optional)
   - Validates phone format
   - Auto-selects created guardian

### Form Validation Updates (`AddStudentForm.jsx`)

```javascript
// Phone validation - conditional on guardian
const isPhoneRequired = !values.guardianId;
const phoneProvidedAndValid = values.phone.trim() && validateIsraeliPhone(values.phone);

// Error messages
const phoneErrorMessage = (() => {
  if (!values.guardianId && !values.phone.trim()) {
    return 'יש להזין מספר טלפון או לשייך אפוטרופוס';
  }
  if (values.phone.trim() && !validateIsraeliPhone(values.phone)) {
    return 'יש להזין מספר טלפון ישראלי תקין';
  }
  return '';
})();

// Dynamic description
description={values.guardianId 
  ? "אופציונלי - אפוטרופוס מחובר"
  : "חובה - אין אפוטרופוס מחובר"
}
```

## User Experience Flow

### Creating Student with New Guardian

1. User opens "Create Student" dialog
2. Fills in student basic info (name, identity number, date of birth)
3. Clicks "+ Create Guardian" button in guardian selector
4. Guardian creation dialog opens:
   - Enters guardian name, phone (required), email (optional), relationship (optional)
   - Clicks "Create Guardian"
5. Guardian created, dialog closes, guardian auto-selected
6. Phone field description changes to "אופציונלי - אפוטרופוס מחובר"
7. User can leave student phone blank (guardian's phone will be primary contact)
8. Saves student

### Creating Independent Student (No Guardian)

1. User opens "Create Student" dialog
2. Fills in student basic info
3. Leaves guardian selector empty
4. Phone field shows "חובה - אין אפוטרופוס מחובר"
5. Must fill phone field to proceed
6. Saves student

### Reassigning Guardian Later

1. User edits existing student
2. Can select/change guardian via dropdown
3. If guardian assigned, phone becomes optional
4. If guardian removed, phone becomes required again

## Display Logic (Student Profile View)

### Contact Information Section

```jsx
// Primary Contact
{student.guardian_id ? (
  <div>
    <Label>איש קשר ראשי</Label>
    <p>{guardian.first_name} {guardian.last_name}</p>
    <p>טלפון: {guardian.phone}</p>
    {guardian.email && <p>אימייל: {guardian.email}</p>}
    <p className="text-muted">({guardian.relationship || 'אפוטרופוס'})</p>
  </div>
) : (
  <div>
    <Label>פרטי התקשרות (תלמיד עצמאי)</Label>
    <p>טלפון: {student.phone}</p>
    {student.email && <p>אימייל: {student.email}</p>}
  </div>
)}

// Student's Personal Contact (if guardian connected)
{student.guardian_id && (student.phone || student.email) && (
  <div>
    <Label>פרטי תלמיד (אישיים)</Label>
    {student.phone && <p>טלפון: {student.phone}</p>}
    {student.email && <p>אימייל: {student.email}</p>}
  </div>
)}
```

## Migration Path for Existing Data

### Phase 1: Schema Deployment
1. Create `public.guardians` table
2. Add `guardian_id` column to `public.students`
3. Make `phone` column nullable in `public.students`

### Phase 2: Data Migration (if needed)
If you have existing students with `contact_name` and `contact_phone` (legacy TutTiud schema):

```sql
-- Create guardians from existing contact_name/contact_phone pairs
INSERT INTO public.guardians (first_name, last_name, phone, metadata)
SELECT 
  SPLIT_PART(contact_name, ' ', 1) as first_name,
  COALESCE(SPLIT_PART(contact_name, ' ', 2), SPLIT_PART(contact_name, ' ', 1)) as last_name,
  contact_phone,
  jsonb_build_object('migrated_from', 'contact_fields', 'migrated_at', now())
FROM public.students
WHERE contact_name IS NOT NULL 
  AND contact_phone IS NOT NULL
  AND contact_phone != ''
GROUP BY contact_name, contact_phone;

-- Link students to their guardians
UPDATE public.students s
SET guardian_id = g.id
FROM public.guardians g
WHERE s.contact_name IS NOT NULL
  AND s.contact_phone = g.phone;
```

### Phase 3: Validation
```sql
-- Check students without phone and without guardian
SELECT id, first_name, last_name
FROM public.students
WHERE guardian_id IS NULL
  AND (phone IS NULL OR phone = '')
  AND is_active = true;

-- These students need either phone or guardian assigned
```

## Testing Checklist

### Backend API Tests
- [ ] Create guardian with all required fields → Success
- [ ] Create guardian without phone → Error: `missing_phone`
- [ ] Create guardian with invalid phone → Error: `invalid_phone`
- [ ] Create student with guardian, no phone → Success
- [ ] Create student without guardian, no phone → Error: `phone_required_without_guardian`
- [ ] Create student without guardian, with valid phone → Success
- [ ] Update guardian phone to invalid → Error: `invalid_phone`
- [ ] Delete guardian with active students → Error: `guardian_has_students`
- [ ] Soft delete guardian without students → Success

### Frontend Tests
- [ ] Guardian selector shows all active guardians
- [ ] Create guardian dialog validates phone requirement
- [ ] Phone field shows "חובה" when no guardian selected
- [ ] Phone field shows "אופציונלי" when guardian selected
- [ ] Submit button disabled when: no guardian AND no phone
- [ ] Submit button enabled when: guardian selected (phone optional)
- [ ] Submit button enabled when: no guardian AND valid phone
- [ ] Guardian details card shows selected guardian info
- [ ] Created guardian auto-selected in dropdown

### Integration Tests
- [ ] Create guardian + student in one flow → Both saved correctly
- [ ] Edit student: add guardian → Phone becomes optional
- [ ] Edit student: remove guardian → Phone becomes required
- [ ] Student profile displays guardian contact info correctly
- [ ] Student profile displays student phone when no guardian
- [ ] Student profile shows both contacts when guardian + student phone exist

## Security Considerations

1. **Guardian Privacy**: Guardians belong to organization, but only accessible to org members
2. **Soft Delete**: Guardians are soft-deleted to preserve historical data
3. **Validation**: Phone numbers validated server-side (Israeli format)
4. **Permissions**: Same role-based access as students (admin/owner can manage all, members see only their students' guardians)

## Future Enhancements

1. **Multiple Guardians per Student**: Many-to-many relationship via junction table
2. **Primary Guardian Flag**: Designate which guardian is primary contact
3. **Emergency Contact**: Additional optional emergency contact field
4. **Guardian Portal**: Separate login for guardians to view their children's progress
5. **Notification Preferences**: Per-guardian preferences for notifications
6. **Guardian Sharing**: Allow one guardian to be linked to multiple siblings

## Troubleshooting

### Phone Not Required When It Should Be
- Check that guardian_id is properly null/undefined in form state
- Verify conditional validation logic in `handleSubmit`
- Ensure backend validation matches frontend

### Guardian Not Auto-Selected After Creation
- Check `createGuardian` returns created guardian object
- Verify `handleCreateSuccess` callback receives guardian
- Ensure `onChange` prop passes new guardian ID to form state

### Cannot Delete Guardian
- Check for active students with `guardian_id` reference
- Reassign students to different guardian or remove guardian link first
- Use soft delete (is_active = false) instead of hard delete
