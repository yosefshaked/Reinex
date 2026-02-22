# Preanswers Permission-Based Cap - Test Plan

## Test Objectives
Verify that the permission-based cap for instructor custom preconfigured answers works correctly across frontend and backend, enforcing the limit from `session_form_preanswers_cap` permission instead of hard-coded values.

## Prerequisites
- Organization set up with at least one instructor
- Session form configured with at least one text/textarea question
- Access to control DB to modify permissions (for admin testing)

## Test Cases

### TC1: Default Cap (50) - No Permission Set
**Setup**: Remove or null out `session_form_preanswers_cap` from org permissions
**Steps**:
1. Login as instructor
2. Open session form
3. Click preanswer button on text question
4. Navigate to "Personal" tab
5. Add 51 answers one by one
**Expected**: 
- UI allows adding up to 50 answers
- 51st answer is not added
- Backend saves exactly 50 answers
- No errors in console or API logs

### TC2: Custom Cap (100) - Permission Set
**Setup**: Set `org_settings.permissions.session_form_preanswers_cap = 100` in control DB
**Steps**:
1. Login as instructor
2. Open session form
3. Click preanswer button on text question
4. Navigate to "Personal" tab
5. Add 101 answers one by one
**Expected**:
- UI allows adding up to 100 answers
- 101st answer is not added
- Backend saves exactly 100 answers
- Cap badge shows "100" if implemented

### TC3: Low Cap (10) - Reduced Limit
**Setup**: Set `org_settings.permissions.session_form_preanswers_cap = 10`
**Steps**:
1. Login as instructor with existing 50 preanswers
2. Open session form
3. Click preanswer button
4. Navigate to "Personal" tab
5. View existing answers (should show all 50)
6. Try to add new answer
**Expected**:
- UI shows all 50 existing answers (data preserved)
- Cannot add 51st answer (new limit enforced)
- If deleting answers, can re-add up to 10 total
- Backend preserves old data but enforces new limit on edits

### TC4: Invalid Permission Values
**Setup**: Test each scenario separately
**Scenarios**:
- `session_form_preanswers_cap = null`
- `session_form_preanswers_cap = 0`
- `session_form_preanswers_cap = -50`
- `session_form_preanswers_cap = "fifty"`
- `session_form_preanswers_cap = []`
- Permission key missing entirely

**Expected**: All scenarios should fallback to default cap of 50

### TC5: Frontend-Backend Consistency
**Setup**: Set `session_form_preanswers_cap = 25`
**Steps**:
1. Open browser dev tools
2. Monitor network traffic
3. Add 26 answers in UI
4. Check API request payload
5. Check API response
**Expected**:
- Frontend prevents adding 26th answer
- If bypassed (e.g., via dev tools), backend rejects and truncates to 25
- No inconsistency between frontend display and backend storage

### TC6: Multiple Instructors, Same Org
**Setup**: Set `session_form_preanswers_cap = 30` for organization
**Steps**:
1. Login as Instructor A
2. Add 30 personal preanswers
3. Logout
4. Login as Instructor B
5. Add 30 personal preanswers
**Expected**:
- Both instructors can add up to 30 (not shared limit)
- Each instructor's data stored separately
- Cap applies per-instructor, not organization-wide

### TC7: Organization Preanswers (Admin)
**Setup**: Set `session_form_preanswers_cap = 20`
**Steps**:
1. Login as admin
2. Open Settings → Session Form Manager
3. Add 21 organization-level preanswers to a text question
**Expected**:
- Admin can add up to 20 organization preanswers
- 21st answer rejected
- Same cap applies to both personal and org-level preanswers

### TC8: Permission Change While Active
**Setup**: Set `session_form_preanswers_cap = 50`
**Steps**:
1. Login as instructor
2. Open session form dialog (keep open)
3. Admin changes cap to 100 in database
4. Instructor continues adding answers
5. Save after reaching answer 60
**Expected**:
- Initial page load uses cap=50
- After save, backend uses cap=100
- Frontend may need refresh to see new limit
- No data loss or corruption

### TC9: Permission Fetch Error Handling
**Setup**: Simulate database error (disconnect control DB temporarily)
**Steps**:
1. Login as instructor
2. Try to save personal preanswers
**Expected**:
- Backend returns 500 error with "failed_to_load_permissions"
- Frontend shows error toast
- No partial data saved
- User can retry after connection restored

### TC10: Very Large Cap (Stress Test)
**Setup**: Set `session_form_preanswers_cap = 10000`
**Steps**:
1. Login as instructor
2. Programmatically add 10000 answers
3. Save to backend
4. Load dialog again
**Expected**:
- Backend accepts and stores 10000 answers
- Frontend renders all answers (may be slow)
- No browser crashes or memory issues
- Consider UX improvements (pagination, virtualization)

## Performance Tests

### PT1: Permission Fetch Overhead
**Setup**: Normal organization with cap=50
**Steps**:
1. Measure PUT request time without permission fetch (before change)
2. Measure PUT request time with permission fetch (after change)
3. Compare difference
**Expected**:
- Overhead < 50ms
- No significant impact on user experience
- Single DB query adds minimal latency

### PT2: Large Preanswers List Rendering
**Setup**: Instructor with 50 preanswers across 10 questions
**Steps**:
1. Open session form dialog
2. Measure time to render dialog
3. Measure time to open each preanswer picker
**Expected**:
- Dialog opens in < 1s
- Picker opens in < 500ms
- Smooth scrolling in answer list
- No UI jank or lag

## Security Tests

### ST1: Permission Spoofing (Frontend)
**Setup**: Set `session_form_preanswers_cap = 20` in org settings
**Steps**:
1. Login as instructor
2. Open dev tools
3. Modify `activeOrg.connection.permissions.session_form_preanswers_cap` to 1000
4. Try to add 1000 answers
5. Save to backend
**Expected**:
- Frontend may allow adding 1000 (modified client)
- Backend rejects and truncates to 20 (server-side validation)
- No security breach or data corruption

### ST2: Direct API Call (Bypass Frontend)
**Setup**: Set `session_form_preanswers_cap = 15`
**Steps**:
1. Use Postman/curl to call PUT `/api/instructors`
2. Send payload with 100 preanswers
3. Check database after save
**Expected**:
- Backend enforces cap=15
- Only 15 answers saved
- Excess answers silently truncated
- No error returned (graceful handling)

### ST3: Non-Instructor Access
**Setup**: Regular member (non-instructor) tries to save preanswers
**Steps**:
1. Login as member (non-instructor role)
2. Try to access instructor metadata API
**Expected**:
- 403 Forbidden response
- No ability to view/edit preanswers
- Permission check happens before cap enforcement

## Regression Tests

### RT1: Org-Level Preanswers Still Work
**Steps**:
1. Admin adds org-level preanswers in Settings
2. Instructor opens dialog and sees org preanswers
3. Instructor selects org preanswer in form
**Expected**: No impact on org-level preanswers functionality

### RT2: Session Save Still Works
**Steps**:
1. Instructor completes session form with preanswers
2. Saves session report
**Expected**: Session saves successfully, preanswers populated in answers

### RT3: Auto-Save Functionality
**Steps**:
1. Instructor adds personal preanswer
2. Wait for auto-save (no explicit save button)
3. Close and reopen dialog
**Expected**: Preanswer persisted correctly

## Edge Cases

### EC1: Concurrent Edits (Same Instructor)
**Steps**:
1. Open dialog in two browser tabs
2. Add preanswers in both tabs simultaneously
3. Save both
**Expected**: Last-write-wins, no data corruption

### EC2: Unicode and Special Characters
**Steps**:
1. Add preanswers with Hebrew, Arabic, emoji, etc.
2. Save and reload
**Expected**: All characters preserved correctly

### EC3: Very Long Answer Text
**Steps**:
1. Add preanswer with 10000 characters
2. Save
**Expected**: Truncated or rejected gracefully (if max length enforced)

## Test Data

### Sample Permission Values
```json
{
  "session_form_preanswers_cap": 50
}
```

### Sample Preanswer Payload
```json
{
  "id": "instructor-uuid",
  "metadata": {
    "custom_preanswers": {
      "question-uuid-1": [
        "Answer 1",
        "Answer 2",
        "Answer 3"
      ],
      "question-uuid-2": [
        "Answer A",
        "Answer B"
      ]
    }
  }
}
```

## Acceptance Criteria

All test cases must pass before considering the feature complete:
- ✅ Default cap (50) works when permission not set
- ✅ Custom cap enforced when permission set
- ✅ Frontend and backend enforce same limit
- ✅ Invalid permissions fallback to default
- ✅ Existing data preserved when cap reduced
- ✅ Security: backend validation cannot be bypassed
- ✅ Performance: no significant overhead added
- ✅ No regressions in existing functionality

## Test Environment

**Control DB Access Required**: Yes (to modify permissions)
**Test Organizations**: Create dedicated test org with multiple instructors
**Test Data**: Prepare questions with various types (text, textarea, select)

## Test Schedule

- **Unit Tests**: Automated via Jest (if implemented)
- **Integration Tests**: Manual testing following this plan
- **UAT**: Real instructors test in staging environment
- **Production Smoke Test**: Verify default cap after deployment

## Reporting

Document results for each test case:
- ✅ Pass
- ❌ Fail (with details)
- ⚠️ Warning (works but needs improvement)
- 🚧 Blocked (cannot test due to dependency)

Create test report with screenshots and logs for failed cases.
