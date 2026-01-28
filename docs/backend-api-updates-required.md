# Backend API Updates Required for Full Reinex Integration

## Status: ⚠️ **Partially Complete** - Frontend ready, backend needs updates

---

## Overview

The frontend student creation form has been fully updated to the Reinex data model. The backend API (`/api/students-list`) needs updates to handle the new Reinex fields.

**IMPORTANT NOTES:**
1. ✅ **Guardian schema already exists** in `src/lib/setup-sql.js` as a many-to-many relationship through `student_guardians` junction table
2. ✅ **Instructor assignment remains** - students still have `assigned_instructor_id` (optional for waitlist scenarios)
3. ❌ **Remove scheduling fields** - `default_day_of_week`, `default_session_time`, `default_service` moved to lesson_templates

---

## Current State

### ✅ Frontend Complete
- Form sends new Reinex payload structure
- Guardian selection integrated (uses existing many-to-many relationship)
- Instructor assignment field (optional)
- Conditional phone validation working
- All new validation helpers created

### ⚠️ Backend Needs Updates
- `buildStudentPayload()` expects old TutTiud fields
- Missing validation for new Reinex fields
- Not handling many-to-many guardian relationship
- Still targeting `tuttiud."Students"` instead of `public.students`

---

## Required Backend Changes

### File: `api/students-list/index.js`

#### 1. Update `buildStudentPayload()` Function

**Current (TutTiud schema):**
```javascript
function buildStudentPayload(body) {
  // ... existing validation ...
  return {
    payload: {
      first_name: firstName,
      middle_name: middleName || null,
      last_name: lastName,
      identity_number: identityNumberResult.value,
      phone: phoneResult.value,
      email: emailResult.value,
      contact_name: contactNameResult.value,          // ❌ Remove
      contact_phone: contactPhoneResult.value,        // ❌ Remove
      assigned_instructor_id: instructorId,           // ✅ Keep (optional)
      default_day_of_week: dayResult.value,           // ❌ Remove (moved to lesson_templates)
      default_session_time: sessionTimeResult.value,  // ❌ Remove (moved to lesson_templates)
      default_service: defaultServiceResult.value,    // ❌ Remove (moved to lesson_templates)
      notes: notesResult.value,                       // ❌ Remove (use notes_internal)
      tags: tagsResult.value,
      is_active: isActiveValue,
    },
  };
}
```

**Required (Reinex schema):**
```javascript
import {
  // ... existing imports ...
  coerceOptionalDate,
  coerceNotificationMethod,
  coerceOptionalNumeric,
  coerceOptionalJsonb,
  coerceOnboardingStatus,
} from '../_shared/student-validation.js';

function buildStudentPayload(body) {
  const firstName = normalizeString(body?.first_name ?? body?.firstName);
  const middleName = normalizeString(body?.middle_name ?? body?.middleName);
  const lastName = normalizeString(body?.last_name ?? body?.lastName);

  if (!firstName) {
    return { error: 'missing_first_name' };
  }
  if (!lastName) {
    return { error: 'missing_last_name' };
  }

  // Assigned Instructor (Optional - for waitlist management)
  const assignedInstructorId = body?.assigned_instructor_id ?? body?.assignedInstructorId ?? null;
  if (assignedInstructorId && typeof assignedInstructorId !== 'string') {
    return { error: 'invalid_assigned_instructor_id' };
  }
  if (assignedInstructorId && !UUID_PATTERN.test(assignedInstructorId)) {
    return { error: 'invalid_assigned_instructor_id' };
  }

  // Guardian ID (Optional) - Note: Using many-to-many relationship via student_guardians table
  // This is a convenience field for the form; actual relationship stored in student_guardians
  const guardianId = body?.guardian_id ?? body?.guardianId ?? null;
  if (guardianId && typeof guardianId !== 'string') {
    return { error: 'invalid_guardian_id' };
  }
  if (guardianId && !UUID_PATTERN.test(guardianId)) {
    return { error: 'invalid_guardian_id' };
  }

  // Phone validation: required if no guardian
  const phoneResult = validateIsraeliPhone(body?.phone);
  if (!guardianId && !phoneResult.value) {
    return { error: 'phone_required_without_guardian' };
  }
  if (!phoneResult.valid) {
    return { error: 'invalid_phone' };
  }

  const emailResult = coerceEmail(body?.email);
  if (!emailResult.valid) {
    return { error: 'invalid_email' };
  }

  const identityCandidate = body?.identity_number ?? body?.identityNumber ?? body?.national_id ?? body?.nationalId;
  const identityNumberResult = coerceIdentityNumber(identityCandidate);
  if (!identityNumberResult.valid) {
    return { error: 'invalid_identity_number' };
  }
  if (!identityNumberResult.value) {
    return { error: 'missing_identity_number' };
  }

  // New Reinex fields
  const dateOfBirthResult = coerceOptionalDate(body?.date_of_birth ?? body?.dateOfBirth);
  if (!dateOfBirthResult.valid) {
    return { error: 'invalid_date_of_birth' };
  }

  const notificationMethodResult = coerceNotificationMethod(body?.notification_method ?? body?.notificationMethod);
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

  const onboardingStatusResult = coerceOnboardingStatus(body?.onboarding_status ?? body?.onboardingStatus);
  if (!onboardingStatusResult.valid) {
    return { error: 'invalid_onboarding_status' };
  }

  const notesInternalResult = coerceOptionalText(body?.notes_internal ?? body?.notesInternal);
  if (!notesInternalResult.valid) {
    return { error: 'invalid_notes_internal' };
  }

  const tagsResult = coerceTags(body?.tags);
  if (!tagsResult.valid) {
    return { error: 'invalid_tags' };
  }

  const isActiveResult = coerceBooleanFlag(body?.is_active ?? body?.isActive, { defaultValue: true });
  if (!isActiveResult.valid) {
    return { error: 'invalid_is_active' };
  }
  const isActiveValue = isActiveResult.provided ? Boolean(isActiveResult.value) : true;

  return {
    payload: {
      first_name: firstName,
      middle_name: middleName || null,
      last_name: lastName,
      identity_number: identityNumberResult.value,
      date_of_birth: dateOfBirthResult.value,
      assigned_instructor_id: assignedInstructorId, // ✅ Kept for waitlist management
      phone: phoneResult.value,
      email: emailResult.value,
      default_notification_method: notificationMethodResult.value,
      special_rate: specialRateResult.value,
      medical_flags: medicalFlagsResult.value,
      onboarding_status: onboardingStatusResult.value,
      notes_internal: notesInternalResult.value,
      is_active: isActiveValue,
    },
    guardianId: guardianId, // Return separately for student_guardians insertion
  };
}
```

**Note:** The `guardianId` is returned separately because it needs to be inserted into the `student_guardians` junction table after creating the student.

#### 2. Update POST Handler to Handle Guardian Relationship

After inserting the student, if `guardianId` is provided, insert into `student_guardians`:

```javascript
// In handlePost function, after student creation:
const { payload, guardianId, error } = buildStudentPayload(body);
if (error) {
  return respond(context, 400, { error });
}

// Insert student
const { data: student, error: insertError } = await tenantClient
  .from('students')
  .insert(payload)
  .select()
  .single();

if (insertError || !student) {
  // Handle error
}

// If guardian provided, create the relationship
if (guardianId) {
  const { error: relationError } = await tenantClient
    .from('student_guardians')
    .insert({
      student_id: student.id,
      guardian_id: guardianId,
      relationship: 'parent', // Default, could be made configurable
      is_primary: true,
    });
  
  if (relationError) {
    console.error('[students-list] Failed to create guardian relationship:', relationError);
    // Student created but guardian relation failed - log but don't fail the request
  }
}
```

#### 3. Update `buildStudentUpdates()` Function

Add handling for new fields in PUT operations:

```javascript
function buildStudentUpdates(body) {
  const updates = {};
  let hasAny = false;

  // ... existing firstName, middleName, lastName handling ...

  // Assigned Instructor (optional)
  if (Object.prototype.hasOwnProperty.call(body, 'assigned_instructor_id') || Object.prototype.hasOwnProperty.call(body, 'assignedInstructorId')) {
    const raw = Object.prototype.hasOwnProperty.call(body, 'assigned_instructor_id') ? body.assigned_instructor_id : body.assignedInstructorId;
    if (raw === null) {
      updates.assigned_instructor_id = null;
      hasAny = true;
    } else if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) {
        updates.assigned_instructor_id = null;
        hasAny = true;
      } else if (UUID_PATTERN.test(trimmed)) {
        updates.assigned_instructor_id = trimmed;
        hasAny = true;
      } else {
        return { error: 'invalid_assigned_instructor_id' };
      }
    } else if (raw !== undefined) {
      return { error: 'invalid_assigned_instructor_id' };
    }
  }

  // Phone (with guardian validation)
  if (Object.prototype.hasOwnProperty.call(body, 'phone')) {
    const { value, valid } = validateIsraeliPhone(body.phone);
    if (!valid) {
      return { error: 'invalid_phone' };
    }
    // Note: Guardian validation should be done after fetching student record
    updates.phone = value;
    hasAny = true;
  }

  // Date of birth
  if (Object.prototype.hasOwnProperty.call(body, 'date_of_birth') || Object.prototype.hasOwnProperty.call(body, 'dateOfBirth')) {
    const { value, valid } = coerceOptionalDate(
      Object.prototype.hasOwnProperty.call(body, 'date_of_birth') ? body.date_of_birth : body.dateOfBirth
    );
    if (!valid) {
      return { error: 'invalid_date_of_birth' };
    }
    updates.date_of_birth = value;
    hasAny = true;
  }

  // Notification method
  if (Object.prototype.hasOwnProperty.call(body, 'default_notification_method') || Object.prototype.hasOwnProperty.call(body, 'notificationMethod')) {
    const { value, valid } = coerceNotificationMethod(
      Object.prototype.hasOwnProperty.call(body, 'default_notification_method') ? body.default_notification_method : body.notificationMethod
    );
    if (!valid) {
      return { error: 'invalid_notification_method' };
    }
    updates.default_notification_method = value;
    hasAny = true;
  }

  // Special rate
  if (Object.prototype.hasOwnProperty.call(body, 'special_rate') || Object.prototype.hasOwnProperty.call(body, 'specialRate')) {
    const { value, valid } = coerceOptionalNumeric(
      Object.prototype.hasOwnProperty.call(body, 'special_rate') ? body.special_rate : body.specialRate
    );
    if (!valid) {
      return { error: 'invalid_special_rate' };
    }
    updates.special_rate = value;
    hasAny = true;
  }

  // Medical flags
  if (Object.prototype.hasOwnProperty.call(body, 'medical_flags') || Object.prototype.hasOwnProperty.call(body, 'medicalFlags')) {
    const { value, valid } = coerceOptionalJsonb(
      Object.prototype.hasOwnProperty.call(body, 'medical_flags') ? body.medical_flags : body.medicalFlags
    );
    if (!valid) {
      return { error: 'invalid_medical_flags' };
    }
    updates.medical_flags = value;
    hasAny = true;
  }

  // Onboarding status
  if (Object.prototype.hasOwnProperty.call(body, 'onboarding_status') || Object.prototype.hasOwnProperty.call(body, 'onboardingStatus')) {
    const { value, valid } = coerceOnboardingStatus(
      Object.prototype.hasOwnProperty.call(body, 'onboarding_status') ? body.onboarding_status : body.onboardingStatus
    );
    if (!valid) {
      return { error: 'invalid_onboarding_status' };
    }
    updates.onboarding_status = value;
    hasAny = true;
  }

  // Internal notes
  if (Object.prototype.hasOwnProperty.call(body, 'notes_internal') || Object.prototype.hasOwnProperty.call(body, 'notesInternal')) {
    const { value, valid } = coerceOptionalText(
      Object.prototype.hasOwnProperty.call(body, 'notes_internal') ? body.notes_internal : body.notesInternal
    );
    if (!valid) {
      return { error: 'invalid_notes_internal' };
    }
    updates.notes_internal = value;
    hasAny = true;
  }

  // ... rest of existing code (tags, is_active, etc.) ...

  return { updates };
}
```javascript
import {
  // ... existing imports ...
  coerceOptionalDate,
  coerceNotificationMethod,
  coerceOptionalNumeric,
  coerceOptionalJsonb,
  coerceOnboardingStatus,
} from '../_shared/student-validation.js';

function buildStudentPayload(body) {
  const firstName = normalizeString(body?.first_name ?? body?.firstName);
  const middleName = normalizeString(body?.middle_name ?? body?.middleName);
  const lastName = normalizeString(body?.last_name ?? body?.lastName);

  if (!firstName) {
    return { error: 'missing_first_name' };
  }
  if (!lastName) {
    return { error: 'missing_last_name' };
  }

  // Guardian ID (optional)
  const guardianId = body?.guardian_id ?? body?.guardianId ?? null;
  if (guardianId && typeof guardianId !== 'string') {
    return { error: 'invalid_guardian_id' };
  }
  if (guardianId && !UUID_PATTERN.test(guardianId)) {
    return { error: 'invalid_guardian_id' };
  }

  // Phone validation: required if no guardian
  const phoneResult = validateIsraeliPhone(body?.phone);
  if (!guardianId && !phoneResult.value) {
    return { error: 'phone_required_without_guardian' };
  }
  if (!phoneResult.valid) {
    return { error: 'invalid_phone' };
  }

  const emailResult = coerceEmail(body?.email);
  if (!emailResult.valid) {
    return { error: 'invalid_email' };
  }

  const identityCandidate = body?.identity_number ?? body?.identityNumber ?? body?.national_id ?? body?.nationalId;
  const identityNumberResult = coerceIdentityNumber(identityCandidate);
  if (!identityNumberResult.valid) {
    return { error: 'invalid_identity_number' };
  }
  if (!identityNumberResult.value) {
    return { error: 'missing_identity_number' };
  }

  // New Reinex fields
  const dateOfBirthResult = coerceOptionalDate(body?.date_of_birth ?? body?.dateOfBirth);
  if (!dateOfBirthResult.valid) {
    return { error: 'invalid_date_of_birth' };
  }

  const notificationMethodResult = coerceNotificationMethod(body?.notification_method ?? body?.notificationMethod);
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

  const onboardingStatusResult = coerceOnboardingStatus(body?.onboarding_status ?? body?.onboardingStatus);
  if (!onboardingStatusResult.valid) {
    return { error: 'invalid_onboarding_status' };
  }

  const notesInternalResult = coerceOptionalText(body?.notes_internal ?? body?.notesInternal);
  if (!notesInternalResult.valid) {
    return { error: 'invalid_notes_internal' };
  }

  const tagsResult = coerceTags(body?.tags);
  if (!tagsResult.valid) {
    return { error: 'invalid_tags' };
  }

  const isActiveResult = coerceBooleanFlag(body?.is_active ?? body?.isActive, { defaultValue: true });
  if (!isActiveResult.valid) {
    return { error: 'invalid_is_active' };
  }
  const isActiveValue = isActiveResult.provided ? Boolean(isActiveResult.value) : true;

  return {
    payload: {
      first_name: firstName,
      middle_name: middleName || null,
      last_name: lastName,
      identity_number: identityNumberResult.value,
      date_of_birth: dateOfBirthResult.value,
      guardian_id: guardianId,
      phone: phoneResult.value,
      email: emailResult.value,
      notification_method: notificationMethodResult.value,
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

#### 2. Update `buildStudentUpdates()` Function

Add handling for new fields in PUT operations:

```javascript
function buildStudentUpdates(body) {
  const updates = {};
  let hasAny = false;

  // ... existing firstName, middleName, lastName handling ...

  // Guardian ID
  if (Object.prototype.hasOwnProperty.call(body, 'guardian_id') || Object.prototype.hasOwnProperty.call(body, 'guardianId')) {
    const raw = Object.prototype.hasOwnProperty.call(body, 'guardian_id') ? body.guardian_id : body.guardianId;
    if (raw === null) {
      updates.guardian_id = null;
      hasAny = true;
    } else if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) {
        updates.guardian_id = null;
        hasAny = true;
      } else if (UUID_PATTERN.test(trimmed)) {
        updates.guardian_id = trimmed;
        hasAny = true;
      } else {
        return { error: 'invalid_guardian_id' };
      }
    } else if (raw !== undefined) {
      return { error: 'invalid_guardian_id' };
    }
  }

  // Phone (with guardian validation)
  if (Object.prototype.hasOwnProperty.call(body, 'phone')) {
    const { value, valid } = validateIsraeliPhone(body.phone);
    if (!valid) {
      return { error: 'invalid_phone' };
    }
    // If clearing phone, ensure guardian exists
    if (!value && !updates.guardian_id && !body.guardian_id) {
      // Need to check existing student record for guardian_id
      // This validation may need to be done in the handler after fetching the student
    }
    updates.phone = value;
    hasAny = true;
  }

  // Date of birth
  if (Object.prototype.hasOwnProperty.call(body, 'date_of_birth') || Object.prototype.hasOwnProperty.call(body, 'dateOfBirth')) {
    const { value, valid } = coerceOptionalDate(
      Object.prototype.hasOwnProperty.call(body, 'date_of_birth') ? body.date_of_birth : body.dateOfBirth
    );
    if (!valid) {
      return { error: 'invalid_date_of_birth' };
    }
    updates.date_of_birth = value;
    hasAny = true;
  }

  // Notification method
  if (Object.prototype.hasOwnProperty.call(body, 'notification_method') || Object.prototype.hasOwnProperty.call(body, 'notificationMethod')) {
    const { value, valid } = coerceNotificationMethod(
      Object.prototype.hasOwnProperty.call(body, 'notification_method') ? body.notification_method : body.notificationMethod
    );
    if (!valid) {
      return { error: 'invalid_notification_method' };
    }
    updates.notification_method = value;
    hasAny = true;
  }

  // Special rate
  if (Object.prototype.hasOwnProperty.call(body, 'special_rate') || Object.prototype.hasOwnProperty.call(body, 'specialRate')) {
    const { value, valid } = coerceOptionalNumeric(
      Object.prototype.hasOwnProperty.call(body, 'special_rate') ? body.special_rate : body.specialRate
    );
    if (!valid) {
      return { error: 'invalid_special_rate' };
    }
    updates.special_rate = value;
    hasAny = true;
  }

  // Medical flags
  if (Object.prototype.hasOwnProperty.call(body, 'medical_flags') || Object.prototype.hasOwnProperty.call(body, 'medicalFlags')) {
    const { value, valid } = coerceOptionalJsonb(
      Object.prototype.hasOwnProperty.call(body, 'medical_flags') ? body.medical_flags : body.medicalFlags
    );
    if (!valid) {
      return { error: 'invalid_medical_flags' };
    }
    updates.medical_flags = value;
    hasAny = true;
  }

  // Onboarding status
  if (Object.prototype.hasOwnProperty.call(body, 'onboarding_status') || Object.prototype.hasOwnProperty.call(body, 'onboardingStatus')) {
    const { value, valid } = coerceOnboardingStatus(
      Object.prototype.hasOwnProperty.call(body, 'onboarding_status') ? body.onboarding_status : body.onboardingStatus
    );
    if (!valid) {
      return { error: 'invalid_onboarding_status' };
    }
    updates.onboarding_status = value;
    hasAny = true;
  }

  // Internal notes
  if (Object.prototype.hasOwnProperty.call(body, 'notes_internal') || Object.prototype.hasOwnProperty.call(body, 'notesInternal')) {
    const { value, valid } = coerceOptionalText(
      Object.prototype.hasOwnProperty.call(body, 'notes_internal') ? body.notes_internal : body.notesInternal
    );
    if (!valid) {
      return { error: 'invalid_notes_internal' };
    }
    updates.notes_internal = value;
    hasAny = true;
  }

  // ... rest of existing code (tags, is_active, etc.) ...

  return { updates };
}
```

#### 3. Update Database Query Target

**Current:**
```javascript
const { data, error } = await tenantClient
  .from('tuttiud.Students')  // ❌ Old schema
  .select('*')
```

**Required:**
```javascript
const { data, error } = await tenantClient
  .from('students')  // ✅ Public schema (Supabase client configured with db: { schema: 'public' })
  .select('*')
```

**Note:** Ensure tenant Supabase client is created with:
```javascript
const tenantClient = createClient(TENANT_URL, TENANT_KEY, {
  db: { schema: 'public' },  // ✅ Required for Reinex
  auth: { persistSession: false }
});
```

#### 4. Add Error Codes

In the error mapping section, add new error codes:

```javascript
const errorMessages = {
  // ... existing errors ...
  phone_required_without_guardian: 'יש להזין מספר טלפון או לשייך אפוטרופוס',
  invalid_guardian_id: 'מזהה אפוטרופוס לא תקין',
  invalid_date_of_birth: 'תאריך לידה לא תקין (נדרש פורמט YYYY-MM-DD)',
  invalid_notification_method: 'שיטת התראה לא תקינה (whatsapp או email)',
  invalid_special_rate: 'תעריף מיוחד לא תקין',
  invalid_medical_flags: 'דגלי רפואה לא תקינים',
  invalid_onboarding_status: 'סטטוס אונבורדינג לא תקין',
  invalid_notes_internal: 'הערות פנימיות לא תקינות',
};
```

---

## Testing Requirements

### Unit Tests for Validation

```javascript
// Test phone requirement with/without guardian
test('buildStudentPayload: phone required if no guardian', () => {
  const result = buildStudentPayload({
    firstName: 'דני',
    lastName: 'לוי',
    identityNumber: '123456789',
    guardianId: null,
    phone: null,
  });
  expect(result.error).toBe('phone_required_without_guardian');
});

test('buildStudentPayload: phone optional if guardian provided', () => {
  const result = buildStudentPayload({
    firstName: 'דני',
    lastName: 'לוי',
    identityNumber: '123456789',
    guardianId: 'uuid-valid-guardian',
    phone: null,
  });
  expect(result.payload).toBeDefined();
  expect(result.error).toBeUndefined();
});

// Test new Reinex fields
test('buildStudentPayload: validates date_of_birth format', () => {
  const result = buildStudentPayload({
    firstName: 'דני',
    lastName: 'לוי',
    identityNumber: '123456789',
    phone: '0541234567',
    dateOfBirth: 'invalid-date',
  });
  expect(result.error).toBe('invalid_date_of_birth');
});

test('buildStudentPayload: accepts valid Reinex payload', () => {
  const result = buildStudentPayload({
    firstName: 'דני',
    lastName: 'לוי',
    identityNumber: '123456789',
    dateOfBirth: '2015-05-15',
    guardianId: 'uuid-valid',
    phone: null, // Optional with guardian
    email: 'danny@example.com',
    notificationMethod: 'whatsapp',
    specialRate: 150.00,
    onboardingStatus: 'not_started',
    notesInternal: 'הערות',
    tags: ['uuid1', 'uuid2'],
  });
  expect(result.payload).toBeDefined();
  expect(result.error).toBeUndefined();
});
```

### Integration Tests

1. **Create student with guardian (no phone)**
   ```bash
   POST /api/students-list
   {
     "firstName": "דני",
     "lastName": "לוי",
     "identityNumber": "123456789",
     "guardianId": "uuid-exists",
     "phone": null
   }
   # Expected: 201 Created
   ```

2. **Create student without guardian (with phone)**
   ```bash
   POST /api/students-list
   {
     "firstName": "דני",
     "lastName": "לוי",
     "identityNumber": "123456789",
     "guardianId": null,
     "phone": "0541234567"
   }
   # Expected: 201 Created
   ```

3. **Create student without guardian and phone**
   ```bash
   POST /api/students-list
   {
     "firstName": "דני",
     "lastName": "לוי",
     "identityNumber": "123456789",
     "guardianId": null,
     "phone": null
   }
   # Expected: 400 { error: 'phone_required_without_guardian' }
   ```

4. **Update student: remove guardian → phone required**
   ```bash
   PUT /api/students-list/{id}
   {
     "guardianId": null,
     "phone": null
   }
   # Expected: 400 or database trigger error
   ```

---

## Database Trigger Validation

The database trigger will also validate the contact requirement:

```sql
-- This will block invalid updates at the database level
UPDATE public.students 
SET guardian_id = NULL, phone = NULL 
WHERE id = 'some-uuid';
-- Result: ERROR: Active student must have either phone or guardian
```

Backend should handle this gracefully:

```javascript
try {
  const { data, error } = await tenantClient
    .from('students')
    .update(updates)
    .eq('id', studentId);
    
  if (error) {
    if (error.message.includes('either phone or guardian')) {
      return respond(context, 400, { 
        error: 'contact_method_required',
        message: 'חייב להזין מספר טלפון או לשייך אפוטרופוס'
      });
    }
    // ... other error handling ...
  }
} catch (err) {
  // ...
}
```

---

## Deployment Order

1. **Deploy database schema**
   ```bash
   psql -d tenant_db -f scripts/tenant-db-guardians-schema.sql
   ```

2. **Deploy guardian API**
   ```bash
   cd api/guardians
   # Deploy via Azure Functions CLI or CI/CD
   ```

3. **Update students-list API**
   - Update `buildStudentPayload()`
   - Update `buildStudentUpdates()`
   - Add new validation helpers
   - Change schema to `public.students`
   - Deploy

4. **Deploy frontend**
   - Already complete (no changes needed)

---

## Rollback Plan

If issues arise:

1. **Revert API code** to previous version
2. **Revert database** (see rollback SQL in schema file)
3. **Frontend gracefully degrades** (guardian selector hidden if API returns 404)

---

## Completion Checklist

Backend updates needed:

- [ ] Import new validation helpers in `students-list/index.js`
- [ ] Update `buildStudentPayload()` function (remove 4 old fields, add 6 new fields)
- [ ] Update `buildStudentUpdates()` function (add 6 new field handlers)
- [ ] Change database query target from `tuttiud.Students` to `students`
- [ ] Ensure tenant client uses `db: { schema: 'public' }`
- [ ] Add new error codes and Hebrew messages
- [ ] Add guardian contact validation logic
- [ ] Add unit tests for new validation rules
- [ ] Add integration tests for guardian scenarios
- [ ] Update API documentation with new schema
- [ ] Deploy and test in staging environment

---

## References

- **Frontend changes**: Complete (see `AddStudentForm.jsx`)
- **Validation helpers**: Complete (see `student-validation.js`)
- **Guardian API**: Complete (see `api/guardians/index.js`)
- **Database schema**: Ready (see `scripts/tenant-db-guardians-schema.sql`)
- **Integration guide**: [docs/guardian-integration-guide.md](./guardian-integration-guide.md)
- **Implementation summary**: [docs/guardian-integration-implementation-summary.md](./guardian-integration-implementation-summary.md)
