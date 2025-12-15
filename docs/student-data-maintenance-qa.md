# Student Data Maintenance Feature - QA Test Plan

**Feature:** Student Data Maintenance (Export/Import with Filtering)  
**Created:** December 2, 2025  
**Status:** Ready for Testing

## Overview
The Student Data Maintenance feature provides admins with tools to export, edit, and import student data in bulk using CSV files. It includes multiple export options with filtering capabilities and smart import validation with instructor name matching.

---

## Test Scenarios

### 1. Export Functionality

#### 1.1 Export All Students
**Test Result:** - [ ] Pass | - [ ] Fail

**Steps:**
1. Navigate to Student Management page
2. Click "תחזוקת נתונים" dropdown button
3. Select "ייצוא כל התלמידים"
4. Wait for file download

**Expected Results:**
- CSV file downloads as `student-data-maintenance.csv`
- File opens correctly in Excel with Hebrew text displayed properly
- UTF-8 BOM present (Hebrew characters don't show as gibberish)
- All students included in export
- Phone numbers preserve leading zero (displayed as `="0546341150"` formula)
- Day of week shows Hebrew names (ראשון, שני, שלישי, etc.)
- Active status shows כן/לא instead of TRUE/FALSE
- Times show as HH:MM without timezone (e.g., 16:00)
- UUID column appears last
- All expected columns present with Hebrew headers

**Columns to verify:**
- שם התלמיד (name)
- מספר זהות (national_id)
- שם איש קשר (contact_name)
- טלפון (contact_phone)
- שם מדריך (assigned_instructor_name)**Name, not UUID**
- שירות ברירת מחדל (default_service)
- יום ברירת מחדל (default_day_of_week)
- שעת מפגש ברירת מחדל (default_session_time)
- הערות (notes)
- תגיות (tags)**Name, not UUID**
- פעיל (is_active)
- מזהה מערכת (UUID) (system_uuid)

#### 1.2 Export Problematic Students
**Test Result:** - [ ] Pass | - [ ] Fail

**Steps:**
1. Click "תחזוקת נתונים" dropdown
2. Select "תלמידים עם בעיות"
3. Wait for file download

**Expected Results:**
- CSV downloads as `students-problematic.csv`
- File contains ONLY students with issues:
  - Missing national_id
  - Assigned to inactive instructor
  - Missing assigned instructor
  - Schedule conflicts (multiple students with same instructor, day, and time)
- Same formatting as "Export All"
- If no problematic students exist, file should be empty (headers only)
- Note: Schedule conflicts may be intentional (group sessions) - use judgment when reviewing

#### 1.3 Filtered Export - Day Only
**Test Result:** - [ ] Pass | - [ ] Fail

**Steps:**
1. Click "תחזוקת נתונים" dropdown
2. Select "ייצוא מסונן"
3. In dialog, select a day (e.g., יום חמישי = Thursday)
4. Leave instructors and tags unchecked
5. Click "ייצא CSV"

**Expected Results:**

**Expected Results:**
- Dialog shows "נבחרו X מדריכים" and "נבחרו Y תגיות" counters (both 0)
- Export button enabled after selecting day
- CSV downloads as `students-filtered.csv`
- File contains ONLY students with default_day_of_week matching selected day
#### 1.4 Filtered Export - Instructors Only
**Test Result:** - [ ] Pass | - [ ] Fail

**Steps:**
1. Open filtered export dialog
2. Select 2-3 instructors using checkboxes
3. Leave day and tags empty
4. Click "ייצא CSV"

**Expected Results:**

**Expected Results:**
- Counter shows "נבחרו 3 מדריכים" (or selected count)
- CSV contains ONLY students assigned to selected instructors
#### 1.5 Filtered Export - Tags Only
**Test Result:** - [ ] Pass | - [ ] Fail

**Steps:**
1. Open filtered export dialog
2. Select 1-2 tags using checkboxes
3. Leave day and instructors empty
4. Click "ייצא CSV"

**Expected Results:**

**Expected Results:**
#### 1.6 Filtered Export - Combined Filters
**Test Result:** - [ ] Pass | - [ ] Fail

**Steps:**
1. Open filtered export dialog
2. Select a day (e.g., יום שלישי)
3. Select 2 instructors
4. Select 1 tag
5. Click "ייצא CSV"

**Expected Results:**rs
4. Select 1 tag
5. Click "ייצא CSV"

**Expected Results:**
- All three counters show selected counts
- CSV contains ONLY students matching ALL three conditions (AND logic):
  - default_day_of_week = selected day
#### 1.7 Filtered Export - No Filters Selected
**Test Result:** - [ ] Pass | - [ ] Fail

**Steps:**
1. Open filtered export dialog
2. Leave all filters empty/unchecked
3. Observe export button state

**Expected Results:**rt dialog
2. Leave all filters empty/unchecked
3. Observe export button state

**Expected Results:**
- Message displayed: "בחר לפחות מסנן אחד כדי לייצא תלמידים מסוימים"
- Export button is disabled (grayed out)
- Cannot proceed without selecting at least one filter

#### 2.1 Import with No Changes
**Test Result:** - [ ] Pass | - [ ] Fail

**Steps:**
1. Export all students
2. Immediately import the same CSV without editing
3. Wait for import to complete

**Expected Results:**s
2. Immediately import the same CSV without editing
3. Wait for import to complete

#### 2.2 Import with Name Changes
**Test Result:** - [ ] Pass | - [ ] Fail

**Steps:**
1. Export CSV
2. Edit 3-4 student names in Excel
3. Save CSV
4. Import the edited file

**Expected Results:**
1. Export CSV
2. Edit 3-4 student names in Excel
3. Save CSV
4. Import the edited file

#### 2.3 Import with Phone Number Changes
**Test Result:** - [ ] Pass | - [ ] Fail

**Steps:**
1. Export CSV
2. Edit phone numbers:
   - Change one to have leading zero: `0541234567`
   - Change one to format `="0549876543"`
   - Change one to 9 digits without leading zero: `546341150`
3. Import

**Expected Results:**:
   - Change one to have leading zero: `0541234567`
   - Change one to format `="0549876543"`
   - Change one to 9 digits without leading zero: `546341150`
3. Import

**Expected Results:**
- All three formats accepted and normalized:
#### 2.4 Import with Instructor Name Matching (UUID)
**Test Result:** - [ ] Pass | - [ ] Fail

**Steps:**
1. Export CSV (has instructor names in "שם מדריך" column)
2. Replace instructor name with valid UUID from database
3. Import

**Expected Results:**Instructor Name Matching (UUID)
**Steps:**
1. Export CSV (has instructor names in "שם מדריך" column)
#### 2.5 Import with Instructor Name Matching (Name)
**Test Result:** - [ ] Pass | - [ ] Fail

**Steps:**
1. Export CSV
2. Change instructor name to a different existing instructor's name (exact match)
3. Import

**Expected Results:**

#### 2.5 Import with Instructor Name Matching (Name)
**Steps:**
1. Export CSV
2. Change instructor name to a different existing instructor's name (exact match)
#### 2.6 Import with Invalid Instructor Name
**Test Result:** - [ ] Pass | - [ ] Fail

**Steps:**
1. Export CSV
2. Change instructor name to "John Doe" (non-existent instructor)
3. Import

**Expected Results:**up required

#### 2.6 Import with Invalid Instructor Name
**Steps:**
1. Export CSV
2. Change instructor name to "John Doe" (non-existent instructor)
#### 2.7 Import with Inactive Instructor Name
**Test Result:** - [ ] Pass | - [ ] Fail

**Steps:**
1. Deactivate an instructor in the system
2. Export CSV
3. Try to assign a student to the inactive instructor's name
4. Import

**Expected Results:**
#### 2.7 Import with Inactive Instructor Name
**Steps:**
1. Deactivate an instructor in the system
#### 2.8 Import with Hebrew Day Names
**Test Result:** - [ ] Pass | - [ ] Fail

**Steps:**
1. Export CSV (contains Hebrew day names)
2. Change days using Hebrew names:
   - ראשון (Sunday)
   - שלישי (Tuesday)
   - חמישי (Thursday)
3. Import

**Expected Results:**
#### 2.8 Import with Hebrew Day Names
**Steps:**
1. Export CSV (contains Hebrew day names)
2. Change days using Hebrew names:
   - ראשון (Sunday)
#### 2.9 Import with Numeric Days
**Test Result:** - [ ] Pass | - [ ] Fail

**Steps:**
1. Export CSV
2. Change day values to numbers:
   - `0` (Sunday)
   - `4` (Thursday)
   - `6` (Saturday)
3. Import

**Expected Results:**
#### 2.9 Import with Numeric Days
**Steps:**
#### 2.10 Import with כן/לא Active Status
**Test Result:** - [ ] Pass | - [ ] Fail

**Steps:**
1. Export CSV
2. Change is_active values:
   - `כן` → student becomes active
   - `לא` → student becomes inactive
   - Mix of both
3. Import

**Expected Results:**nternally
- No errors

#### 2.10 Import with כן/לא Active Status
**Steps:**
1. Export CSV
#### 2.11 Import with Invalid National ID
**Test Result:** - [ ] Pass | - [ ] Fail

**Steps:**
1. Export CSV
2. Change national_id to invalid values:
   - `12345` (too short)
   - `abc123def` (non-numeric)
   - Empty string
3. Import

**Expected Results:**idden from default roster views (status filter = active)
- No errors

#### 2.11 Import with Invalid National ID
**Steps:**
1. Export CSV
#### 2.12 Import with Missing UUID
**Test Result:** - [ ] Pass | - [ ] Fail

**Steps:**
1. Export CSV
2. Delete system_uuid value from a row
3. Import

**Expected Results:**
- Import fails for rows with invalid IDs
- Error message: "תעודת הזהות אינה חוקית"
- Line number and student name included in error
#### 2.13 Import with Non-Existent UUID
**Test Result:** - [ ] Pass | - [ ] Fail

**Steps:**
1. Export CSV
2. Replace a UUID with a randomly generated UUID
3. Import

**Expected Results:**

**Expected Results:**
- Import fails for that row
- Error: "שורת ה-CSV חסרה מזהה תלמיד חוקי"
- Cannot import without valid UUID
#### 2.14 Import with Tag Changes
**Test Result:** - [ ] Pass | - [ ] Fail

**Steps:**
1. Export CSV
2. Edit tags column (text)
3. Import

**Expected Results:**
- Import fails for that row
- Error: "התלמיד לא נמצא במערכת"
#### 2.15 Import with Large File (Edge Case)
**Test Result:** - [ ] Pass | - [ ] Fail

**Steps:**
1. Create CSV with 2000+ rows
2. Import

**Expected Results:**
2. Edit tags column (text)
3. Import

**Expected Results:**
- Tags updated for students
- Tag IDs validated (must exist in catalog)
#### 3.1 Hebrew Text Display
**Test Result:** - [ ] Pass | - [ ] Fail

**Test:**
- Open exported CSV in Excel
- Verify Hebrew displays correctly (not gibberish)

**Expected:** UTF-8 BOM ensures proper encoding

#### 3.2 Phone Number Preservation
**Test Result:** - [ ] Pass | - [ ] Fail

**Test:**
- Open CSV in Excel
- Check phone number cells

**Expected:**

### 3. Excel Compatibility

#### 3.3 Save and Reopen
**Test Result:** - [ ] Pass | - [ ] Fail

**Test:**
- Open CSV in Excel
- Save (overwrite)
- Close and reopen

**Expected:**
#### 3.2 Phone Number Preservation
**Test:**
- Open CSV in Excel
- Check phone number cells
#### 3.4 Non-Excel Editors (LibreOffice, Google Sheets)
**Test Result:** - [ ] Pass | - [ ] Fail

**Test:**
- Open CSV in alternative spreadsheet software

**Expected:**la `="0546341150"` visible in formula bar
- Cell displays as `0546341150`

#### 3.3 Save and Reopen
**Test:**
- Open CSV in Excel
- Save (overwrite)
- Close and reopen

#### 4.1 No Internet Connection
**Test Result:** - [ ] Pass | - [ ] Fail

**Test:**
- Disconnect network
- Attempt export

**Expected:**Excel Editors (LibreOffice, Google Sheets)
**Test:**
- Open CSV in alternative spreadsheet software
#### 4.2 Export During Instructor Delete
**Test Result:** - [ ] Pass | - [ ] Fail

**Test:**
1. Start export
2. Simultaneously delete an instructor
3. Check exported CSV

**Expected:**

### 4. Error Handling & Edge Cases

#### 4.3 Import with Concurrent Edit
**Test Result:** - [ ] Pass | - [ ] Fail

**Test:**
1. Export CSV
2. Edit student in UI
3. Import CSV (with old data for same student)

**Expected:**: "הורדת הקובץ נכשלה"
- No partial download
- Graceful failure

#### 4.2 Export During Instructor Delete
#### 4.4 Large Tag List
**Test Result:** - [ ] Pass | - [ ] Fail

**Test:**
- Create student with 20+ tags
- Export
- Verify tags column

**Expected:**letes with instructor data at time of request
- No crashes or corrupted data

#### 4.5 Empty Organization
**Test Result:** - [ ] Pass | - [ ] Fail

**Test:**
- Export from org with 0 students

**Expected:** (with old data for same student)

**Expected:**
- Last write wins (import overwrites UI changes)
- No data corruption
- Consider: Add warning about potential conflicts

#### 4.4 Large Tag List
**Test:**
#### 5.1 Progress Feedback
**Test Result:** - [ ] Pass | - [ ] Fail

**Test:**
- Export large student list (100+ students)

**Expected:**
- All tags present in CSV
- Comma-separated UUIDs
#### 5.2 Dialog Usability (Filtered Export)
**Test Result:** - [ ] Pass | - [ ] Fail

**Test:**
- Open filtered export dialog
- Scroll through long instructor list (20+ instructors)
- Select/deselect multiple items

**Expected:**
- CSV downloads with headers only
- No errors
- File size ~1KB

---
#### 5.3 Mobile Experience
**Test Result:** - [ ] Pass | - [ ] Fail

**Test:**
- Test export/import on mobile device

**Expected:**
- Export large student list (100+ students)

**Expected:**
- Toast notification: "מוריד..." during download
- Success toast on completion
#### 5.4 RTL Layout
**Test Result:** - [ ] Pass | - [ ] Fail

**Test:**
- Verify all UI elements respect RTL direction

**Expected:**ed export dialog
- Scroll through long instructor list (20+ instructors)
- Select/deselect multiple items

**Expected:**
- Scrollbar appears if list exceeds max-height
- Checkboxes responsive
- Counters update instantly
- Dialog doesn't close accidentally

#### 5.3 Mobile Experience
**Test:**
- Test export/import on mobile device

**Expected:**
- Dropdown menu accessible
- Dialogs render correctly
- File download works on mobile browsers
- Import file picker functional

#### 5.4 RTL Layout
**Test:**
- Verify all UI elements respect RTL direction

**Expected:**
- Dropdown aligns right
- Dialog text flows right-to-left
- Checkboxes positioned correctly
- Buttons in correct order

---

## Validation Rules Summary

| Field | Validation | Error Message |
|-------|-----------|---------------|
| name | Required, max 255 chars | (No explicit error, uses existing validation) |
| national_id | 9 digits, optional | תעודת הזהות אינה חוקית |
| contact_phone | Israeli format (9-10 digits) | מספר הטלפון אינו חוקי |
| assigned_instructor | UUID or name match | מדריך בשם "X" לא נמצא. מדריכים זמינים: ... |
| default_day_of_week | 0-6, 1-7, or Hebrew names | יום ברירת מחדל אינו חוקי |
| default_session_time | HH:MM or HH:MM:SS | שעת ברירת המחדל אינה חוקית |
| is_active | כן/לא, TRUE/FALSE, 1/0 | ערך הפעילות אינו חוקי |
| tags | Comma-separated UUIDs | תוויות אינן חוקיות |
| system_uuid | Required, must exist | שורת ה-CSV חסרה מזהה תלמיד חוקי / התלמיד לא נמצא במערכת |

---

## Known Issues & Limitations

1. **Import Limit:** Maximum 2000 rows per import
2. **No Bulk Create:** Import can only update existing students (UUID required)
3. **Last Write Wins:** Concurrent edits during import may be overwritten
4. **Tag Validation:** Tags must exist in catalog; import doesn't create new tags
5. **Instructor Validation:** Inactive instructors blocked in import but may appear in export
6. **No Partial Rollback:** Failed rows don't block successful rows; no transaction rollback

---

## Performance Benchmarks

| Operation | Student Count | Expected Time |
|-----------|--------------|---------------|
| Export All | 100 | < 2 seconds |
| Export All | 500 | < 5 seconds |
| Export All | 1000 | < 10 seconds |
| Filtered Export | 50 | < 2 seconds |
| Import | 100 | < 5 seconds |
| Import | 500 | < 15 seconds |
| Import | 1000 | < 30 seconds |

---

## Browser Compatibility

| Browser | Version | Status |
|---------|---------|--------|
| Chrome | Latest | ✅ Supported |
| Firefox | Latest | ✅ Supported |
| Safari | Latest | ✅ Supported |
| Edge | Latest | ✅ Supported |
| Mobile Safari (iOS) | Latest | ⚠️ Test file download |
| Mobile Chrome (Android) | Latest | ⚠️ Test file download |

---

## Test Results Log

### Test Session 1: [Date]
**Tester:** [Name]  
**Environment:** [Dev/Staging/Production]

| Test Case | Status | Notes |
|-----------|--------|-------|
| 1.1 Export All | ⬜ Not Tested | |
| 1.2 Export Problematic | ⬜ Not Tested | |
| ... | | |

### Issues Found:
1. [Issue description] - **Priority:** [High/Medium/Low] - **Status:** [Open/Fixed]

---

## Sign-Off

- [ ] All test cases executed
- [ ] Critical issues resolved
- [ ] Documentation updated
- [ ] AGENTS.md updated with patterns
- [ ] Feature ready for production

**QA Lead:** _______________  **Date:** ___________  
**Product Owner:** _______________  **Date:** ___________
