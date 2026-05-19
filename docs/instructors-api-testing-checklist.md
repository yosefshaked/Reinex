# Testing Checklist: Instructors API & Invitation Integration

## Priority 1: Critical Path Tests

### API: GET /api/instructors

#### Test 1.1: Basic GET (Backward Compatibility)
**Setup:**
- Instructor exists with only base Employee data (no overlay records)

**Request:**
```http
GET /api/instructors?org_id=<uuid>
Authorization: Bearer <token>
```

**Expected Response:**
```json
{
  "id": "...",
  "first_name": "John",
  "middle_name": "M",
  "last_name": "Doe",
  "email": "john@example.com",
  "phone": "0541234567",
  "is_active": true,
  "notes": null,
  "metadata": {},
  "instructor_types": [],
  "instructor_profile": null,           // ✅ Null for missing profile
  "service_capabilities": []            // ✅ Empty array for no capabilities
}
```

**Status:** ⬜ Not Tested | ✅ Pass | ❌ Fail

---

#### Test 1.2: GET with Profile Data
**Setup:**
- Instructor with record in instructor_profiles table

**Request:**
```http
GET /api/instructors?org_id=<uuid>
Authorization: Bearer <token>
```

**Expected Response:**
```json
{
  "id": "...",
  ...
  "instructor_profile": {
    "working_days": [0, 1, 2, 3, 4],
    "break_time_minutes": 30,
    "metadata": {}
  },
  "service_capabilities": []
}
```

**Status:** ⬜ Not Tested | ✅ Pass | ❌ Fail

---

#### Test 1.3: GET with Service Capabilities
**Setup:**
- Instructor with records in instructor_service_capabilities table

**Request:**
```http
GET /api/instructors?org_id=<uuid>
Authorization: Bearer <token>
```

**Expected Response:**
```json
{
  "id": "...",
  ...
  "instructor_profile": null,
  "service_capabilities": [
    {
      "service_id": "service-uuid-1",
      "max_students": 5,
      "base_rate": 150.00,
      "metadata": {}
    }
  ]
}
```

**Status:** ⬜ Not Tested | ✅ Pass | ❌ Fail

---

#### Test 1.4: GET with Complete Profile
**Setup:**
- Instructor with both profile AND capabilities

**Expected Response:**
```json
{
  "id": "...",
  ...
  "instructor_profile": {
    "working_days": [0, 1, 2, 3, 4],
    "break_time_minutes": 30,
    "metadata": {}
  },
  "service_capabilities": [
    {
      "service_id": "service-uuid-1",
      "max_students": 5,
      "base_rate": 150.00,
      "metadata": {}
    },
    {
      "service_id": "service-uuid-2",
      "max_students": 3,
      "base_rate": 200.00,
      "metadata": {}
    }
  ]
}
```

**Status:** ⬜ Not Tested | ✅ Pass | ❌ Fail

---

#### Test 1.5: GET with include_inactive
**Setup:**
- Mix of active and inactive instructors

**Request:**
```http
GET /api/instructors?org_id=<uuid>&include_inactive=true
Authorization: Bearer <token>
```

**Expected:**
- Returns both active and inactive instructors
- Overlay data included for all

**Status:** ⬜ Not Tested | ✅ Pass | ❌ Fail

---

#### Test 1.6: GET as Non-Admin (Permission Check)
**Setup:**
- User with non-admin role
- Multiple instructors exist

**Request:**
```http
GET /api/instructors?org_id=<uuid>
Authorization: Bearer <non-admin-token>
```

**Expected:**
- Returns ONLY the instructor record matching user's ID
- 403 or empty array if user is not an instructor

**Status:** ⬜ Not Tested | ✅ Pass | ❌ Fail

---

### API: POST /api/instructors

#### Test 2.1: Create Basic Instructor (No Overlay)
**Request:**
```json
POST /api/instructors
{
  "org_id": "...",
  "first_name": "Jane",
  "middle_name": null,
  "last_name": "Smith",
  "email": "jane@example.com",
  "phone": "0549876543"
}
```

**Expected:**
- Employee record created
- NO instructor_profiles record created
- Response includes `instructor_profile: null`

**Verification:**
```sql
-- Should return 0 rows
SELECT * FROM public.instructor_profiles WHERE employee_id = '<new-id>';
```

**Status:** ⬜ Not Tested | ✅ Pass | ❌ Fail

---

#### Test 2.2: Create Instructor with Profile
**Request:**
```json
POST /api/instructors
{
  "org_id": "...",
  "first_name": "Jane",
  "last_name": "Smith",
  "email": "jane@example.com",
  "working_days": [0, 1, 2, 3, 4],
  "break_time_minutes": 30
}
```

**Expected:**
- Employee record created
- instructor_profiles record created
- Response includes profile data

**Verification:**
```sql
-- Should return 1 row
SELECT * FROM public.instructor_profiles WHERE employee_id = '<new-id>';
```

**Status:** ⬜ Not Tested | ✅ Pass | ❌ Fail

---

#### Test 2.3: Create with Partial Profile (Only working_days)
**Request:**
```json
POST /api/instructors
{
  "org_id": "...",
  "first_name": "Jane",
  "last_name": "Smith",
  "email": "jane@example.com",
  "working_days": [0, 1, 2]
}
```

**Expected:**
- Profile created with working_days
- break_time_minutes is NULL in database

**Status:** ⬜ Not Tested | ✅ Pass | ❌ Fail

---

#### Test 2.4: Validation - Missing Required Fields
**Request:**
```json
POST /api/instructors
{
  "org_id": "...",
  "first_name": "Jane"
  // Missing last_name, email
}
```

**Expected:**
- 400 Bad Request
- Error message indicating missing fields

**Status:** ⬜ Not Tested | ✅ Pass | ❌ Fail

---

### Frontend: DirectoryView with Invitation

#### Test 3.1: Invite Button Visible
**Setup:**
- Navigate to Settings → Employees & Instructors
- User is admin/owner

**Expected:**
- "הזמן משתמש" button appears in header
- Button has MailPlus icon
- Button is not disabled

**Status:** ⬜ Not Tested | ✅ Pass | ❌ Fail

---

#### Test 3.2: Invite Dialog Opens
**Action:**
- Click "הזמן משתמש" button

**Expected:**
- Dialog opens with proper RTL layout
- Title: "הזמן משתמש חדש לארגון"
- Email input field visible
- Submit button: "שלח הזמנה"
- Cancel button visible

**Status:** ⬜ Not Tested | ✅ Pass | ❌ Fail

---

#### Test 3.3: Invite User - Success Flow
**Action:**
1. Open invite dialog
2. Enter valid email: "newuser@example.com"
3. Click "שלח הזמנה"

**Expected:**
1. Button shows loading state
2. Success toast appears
3. Dialog closes automatically
4. Directory refreshes (new member may appear in "חברי ארגון" tab)

**Status:** ⬜ Not Tested | ✅ Pass | ❌ Fail

---

#### Test 3.4: Invite User - Duplicate Email
**Action:**
1. Invite email that already has pending invitation
2. Submit

**Expected:**
- Error toast: "כבר קיימת הזמנה בתוקף למשתמש זה."
- Dialog stays open
- Email field remains filled

**Status:** ⬜ Not Tested | ✅ Pass | ❌ Fail

---

#### Test 3.5: Invite User - Existing Member
**Action:**
1. Invite email of existing org member
2. Submit

**Expected:**
- Error toast: "לא נשלחה הזמנה. המשתמש כבר חבר בארגון."
- Dialog stays open

**Status:** ⬜ Not Tested | ✅ Pass | ❌ Fail

---

#### Test 3.6: Invite User - Invalid Email
**Action:**
1. Enter invalid email: "notanemail"
2. Try to submit

**Expected:**
- HTML5 validation prevents submission
- OR backend returns 400 error
- User-friendly error message

**Status:** ⬜ Not Tested | ✅ Pass | ❌ Fail

---

### Frontend: OrgMembersCard Deprecation

#### Test 4.1: Deprecation Notice Visible
**Setup:**
- Navigate to Settings page
- Scroll to "חברי ארגון" card

**Expected:**
- Amber banner visible at top of card
- Contains AlertTriangle icon
- Text mentions moving to "הגדרות → עובדים ומדריכים"
- Uses proper Hebrew RTL

**Status:** ⬜ Not Tested | ✅ Pass | ❌ Fail

---

#### Test 4.2: Existing Functionality Still Works
**Setup:**
- In Settings → חברי ארגון card

**Actions to Test:**
1. View current members list
2. Change member role
3. Edit member name
4. Remove member (if permissions allow)
5. Send invitation from old UI

**Expected:**
- All features work as before
- No errors in console
- Deprecation notice doesn't interfere

**Status:** ⬜ Not Tested | ✅ Pass | ❌ Fail

---

## Priority 2: Edge Cases & Error Handling

### Database Tests

#### Test 5.1: Orphaned Profile Record
**Setup:**
- Create instructor_profiles record without matching Employee

**Expected:**
- Foreign key constraint prevents creation
- OR record is ignored by API (doesn't appear in results)

**Status:** ⬜ Not Tested | ✅ Pass | ❌ Fail

---

#### Test 5.2: Multiple Capabilities for Same Service
**Setup:**
- Attempt to insert two records with same (employee_id, service_id)

**Expected:**
- UNIQUE constraint violation
- Second insert fails
- Error message clear

**Status:** ⬜ Not Tested | ✅ Pass | ❌ Fail

---

#### Test 5.3: Cascade Delete
**Action:**
- Delete Employee record that has profile and capabilities

**Expected:**
- Employee deleted
- instructor_profiles record auto-deleted (CASCADE)
- instructor_service_capabilities records auto-deleted (CASCADE)
- No orphaned records remain

**Verification:**
```sql
SELECT * FROM public.instructor_profiles WHERE employee_id = '<deleted-id>';
-- Should return 0 rows

SELECT * FROM public.instructor_service_capabilities WHERE employee_id = '<deleted-id>';
-- Should return 0 rows
```

**Status:** ⬜ Not Tested | ✅ Pass | ❌ Fail

---

### Performance Tests

#### Test 6.1: GET with Many Instructors
**Setup:**
- 100+ instructors in database
- Various overlay data combinations

**Request:**
```http
GET /api/instructors?org_id=<uuid>
```

**Expected:**
- Response time < 1 second
- All overlay data correctly merged
- No duplicate records
- No memory issues

**Status:** ⬜ Not Tested | ✅ Pass | ❌ Fail

---

#### Test 6.2: GET with Many Capabilities per Instructor
**Setup:**
- Instructor with 20+ service capabilities

**Expected:**
- All capabilities returned in array
- No truncation
- Reasonable response time

**Status:** ⬜ Not Tested | ✅ Pass | ❌ Fail

---

## Priority 3: Integration Tests

### Full Flow Test 1: Invite → Accept → Promote → Profile
**Steps:**
1. Admin invites new user via DirectoryView
2. New user accepts invitation and logs in
3. New user appears in "חברי ארגון" tab
4. Admin promotes user to instructor
5. Admin adds working_days and capabilities (future feature)
6. GET /api/instructors returns complete profile

**Expected:**
- Seamless flow from invitation to full instructor
- All data persists correctly
- No orphaned records

**Status:** ⬜ Not Tested | ✅ Pass | ❌ Fail

---

### Full Flow Test 2: Create Instructor → Update → Deactivate
**Steps:**
1. Create instructor with profile via POST
2. Update working_days via PUT (future feature)
3. Add service capabilities via separate API (future feature)
4. GET confirms all updates
5. Deactivate instructor (DELETE with soft delete)
6. GET without include_inactive doesn't return them
7. GET with include_inactive returns them

**Expected:**
- All CRUD operations work correctly
- Overlay data persists through updates
- Soft delete preserves overlay data

**Status:** ⬜ Not Tested | ✅ Pass | ❌ Fail

---

## Test Environment Setup

### Prerequisites
- [ ] Reinex database with latest schema (instructor_profiles, instructor_service_capabilities tables)
- [ ] Admin user account
- [ ] Non-admin user account
- [ ] Test organization with existing instructors
- [ ] Test Services configured (for capabilities testing)

### Data Setup Script
```sql
-- Insert test instructor with profile
INSERT INTO public."Employees" (id, first_name, last_name, email, phone, employee_type, is_active)
VALUES ('test-instructor-1', 'Test', 'Instructor', 'test@example.com', '0541111111', 'instructor', true);

INSERT INTO public.instructor_profiles (employee_id, working_days, break_time_minutes)
VALUES ('test-instructor-1', ARRAY[0,1,2,3,4], 30);

-- Insert test service for capabilities
INSERT INTO public."Services" (id, name, description)
VALUES ('test-service-1', 'Test Service 1', 'For testing');

INSERT INTO public.instructor_service_capabilities (employee_id, service_id, max_students, base_rate)
VALUES ('test-instructor-1', 'test-service-1', 5, 150.00);
```

### Cleanup Script
```sql
-- Cleanup test data (cascades will handle overlays)
DELETE FROM public."Employees" WHERE id LIKE 'test-instructor-%';
DELETE FROM public."Services" WHERE id LIKE 'test-service-%';
```

---

## Summary Checklist

### Must-Have (P0)
- [ ] GET returns overlay data when present
- [ ] GET returns null/empty when overlay missing
- [ ] POST creates profile when provided
- [ ] POST skips profile when not provided
- [ ] Invite button visible in DirectoryView
- [ ] Invite dialog works end-to-end
- [ ] Deprecation notice appears in Settings
- [ ] Non-admin users only see own instructor record

### Should-Have (P1)
- [ ] Validation prevents bad data
- [ ] Foreign key constraints enforced
- [ ] Cascade deletes work correctly
- [ ] Performance acceptable for 100+ instructors
- [ ] Error messages are user-friendly (Hebrew)
- [ ] Loading states work correctly
- [ ] Toast notifications appear properly

### Nice-to-Have (P2)
- [ ] Edge cases handled gracefully
- [ ] Stress testing with large datasets
- [ ] Mobile UI works well
- [ ] RTL layout perfect on all screen sizes
- [ ] Accessibility (screen readers, keyboard nav)

---

## Test Results Template

**Date:** _________________  
**Tester:** _________________  
**Environment:** _________________  

**Overall Status:** ⬜ All Pass | ⬜ Some Failures | ⬜ Blocked

**Critical Issues Found:**
1. 
2. 
3. 

**Minor Issues Found:**
1. 
2. 
3. 

**Recommendations:**


**Sign-off:** ⬜ Approved for Production | ⬜ Needs Fixes | ⬜ Blocked
