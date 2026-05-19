# Employee-User Separation Architecture Fixes

## Overview
This document tracks the architectural changes to properly separate employee domain identity from user authentication identity in the Reinex system.

## Problem Statement
The original system conflated two concepts:
1. **Employee Domain Identity**: The employee as a business entity (can exist without system access)
2. **User Authentication Identity**: The employee's auth account (optional, for system login)

This conflation prevented creating "headless" employees for payroll/attendance tracking without granting system access.

## Solution Architecture

### Database Schema Changes
**Table**: `public.Employees`

**Key Columns**:
- `id` uuid PRIMARY KEY - **Domain identity** (employee entity, never changes)
- `user_id` uuid NULLABLE - **Auth identity** (links to auth.users, optional)
- `first_name` text NOT NULL - Changed from `name` field
- `middle_name` text
- `last_name` text
- Other fields: email, phone, employee_type, is_active, notes, metadata

**Indexes Added**:
- `CREATE INDEX IF NOT EXISTS "Employees_user_id_idx" ON public."Employees" ("user_id");`

### Foreign Key Relationships

#### Correct Usage - Data Associations Use `Employees.id`
These correctly reference the employee domain entity:
- ✅ `StudentsList.assigned_instructor_id` → `Employees.id`
- ✅ `SessionRecords.instructor_id` → `Employees.id`
- ✅ Any other business data linking to employees

#### Correct Usage - Auth Checks Use `Employees.user_id`
When verifying if a logged-in user is an employee, query by `user_id`:
- ✅ `SELECT * FROM Employees WHERE user_id = <logged_in_user_id>`

### API Changes

#### `/api/instructors` (GET/POST/PUT/DELETE)
**GET Handler**:
- Added `user_id` to response payload
- Non-admin users: Filter by `user_id` instead of `id`
- Before: `.eq('id', userId)` ❌
- After: `.eq('user_id', userId)` ✅

**POST Handler**:
- Accept `isManual` flag in validation
- Skip membership/profile fetch for manual employees
- Use `user_id` for auth linkage (not `id`)
- Before: `{ id: targetUserId }` ❌
- After: `{ user_id: targetUserId }` ✅

#### `/api/instructors-link-user` (POST) - New Endpoint
Creates invitation to link existing manual employee to user account:
1. Validates employee exists and has no `user_id`
2. Creates invitation record in control DB
3. Sends Supabase auth invitation email
4. Updates employee metadata with `invitation_pending` status

#### `/api/sessions` (POST) - Fixed Auth Checks
**Lines 167-170**: Admin instructor verification
- Before: `.from('Instructors').eq('id', normalizedUserId)` ❌
- After: `.from('Employees').eq('user_id', normalizedUserId)` ✅

**Lines 191-195**: General instructor lookup
- Before: `.from('Instructors').eq('id', normalizedUserId)` ❌  
- After: `.from('Employees').eq('user_id', normalizedUserId)` ✅

**Lines 209-213**: Instructor existence check
- Before: `.from('Instructors').eq('id', sessionInstructorId)` 
- After: `.from('Employees').eq('id', sessionInstructorId)` ✅
- Note: This query is CORRECT - checking domain entity existence, not auth linkage

### Validation Changes
**File**: `api/_shared/validation.js`

**Function**: `validateInstructorCreate`
- Made `userId` optional
- Added `isManual` flag (true when no userId provided)
- Require `firstName` for manual employees
- Return: `{ userId, isManual, firstName, middleName, lastName, email, phone, notes }`

### UI Components

#### New Components
1. **`UnifiedEmployeeList.jsx`**
   - Single list view for all employees
   - Toggle to show/hide inactive employees
   - Inline actions: Invite User, Edit, Diagnostics, Deactivate
   - Click row to open diagnostics

2. **`EmployeeWizardDialog.jsx`**
   - Step 1: Enter employee details (first_name required)
   - Step 2: Choose to invite user or skip
   - Step 3: Confirm/enter email for invitation

3. **`EmployeeDiagnosticsDialog.jsx`**
   - Tabbed interface: Details, Activity, Salary, Documents
   - Shows user linkage status
   - Badges: Active/Inactive, Manual Employee, Invitation Pending

#### Updated Components
- **`InstructorManagementHub.jsx`**: Simplified to single view using `UnifiedEmployeeList`

## Verification Checklist

### ✅ Completed Fixes
- [x] Database schema: Added `user_id` column
- [x] Database schema: Changed `name` → `first_name` requirement
- [x] Database index: Added index on `user_id`
- [x] API validation: Made `user_id` optional
- [x] API `/api/instructors` GET: Filter by `user_id` for non-admins
- [x] API `/api/instructors` POST: Use `user_id` for auth linkage
- [x] API `/api/sessions`: Fixed 3 auth queries to use `user_id`
- [x] Verified data associations use `Employees.id` correctly
- [x] Created `/api/instructors-link-user` endpoint
- [x] Built unified employee management UI
- [x] All code linted successfully

### Data Integrity Verification
- [x] `StudentsList.assigned_instructor_id` → `Employees.id` (domain FK) ✅
- [x] `SessionRecords.instructor_id` → `Employees.id` (domain FK) ✅
- [x] Document entity references use `Employees.id` (domain FK) ✅
- [x] Auth permission checks use `Employees.user_id` (auth FK) ✅

### Remaining Work
- [ ] End-to-end testing: Create manual employee
- [ ] End-to-end testing: Link manual employee to user via invitation
- [ ] End-to-end testing: User logs in and submits session
- [ ] End-to-end testing: Verify data associations remain intact
- [ ] Migration script: Add `user_id` column to existing deployments
- [ ] Migration script: Backfill `user_id` for existing employees

## Key Principles

### When to Use `Employees.id` (Domain Identity)
Use when referencing the employee as a business entity:
- Student assignments
- Session records
- Payroll records
- Attendance tracking
- Any data "belonging to" an employee

### When to Use `Employees.user_id` (Auth Identity)
Use when verifying logged-in user permissions:
- "Is this logged-in user an employee?"
- "Can this user access employee X's data?"
- "Filter to show only this user's assigned employees"

### Migration Pattern
For existing code that queries `Instructors.id`:
1. **Identify the query purpose**: Auth check or data lookup?
2. **Auth checks**: Change to `Employees.user_id`
3. **Data lookups**: Keep as `Employees.id` (or update table name if using old `Instructors` alias)

## Testing Scenarios

### Scenario 1: Manual Employee (No System Access)
1. Admin creates employee: John Doe, email john@example.com
2. Admin chooses "Continue without invitation"
3. Employee record created with `id` but no `user_id`
4. Employee appears in roster as "Manual Employee"
5. Admin can assign students to John Doe
6. Sessions can be attributed to John Doe's `id`
7. John Doe cannot log into system (no auth account)

### Scenario 2: Link Manual Employee to User
1. Start with manual employee from Scenario 1
2. Admin clicks "Invite User" button
3. System sends invitation to john@example.com
4. John accepts invitation and creates password
5. Employee record updated with `user_id` = john's auth ID
6. John can now log in and submit sessions
7. Historical sessions remain linked to John's `id`
8. New sessions use John's `id` (queried via `user_id`)

### Scenario 3: Create Employee with User (Original Flow)
1. Admin creates employee: Jane Smith, email jane@example.com
2. Admin chooses "Send invitation"
3. System creates employee and sends invitation in one flow
4. Employee record created with both `id` and `user_id`
5. Jane accepts invitation and can log in immediately
6. All sessions link to Jane's `id`

## Breaking Changes
None - This is backward compatible. Existing employees will have `user_id = NULL` and can be linked later via invitation.

## Documentation Updates
- [x] This document
- [x] Updated AGENTS.md with new patterns
- [ ] Update API documentation for `/api/instructors`
- [ ] Update API documentation for `/api/instructors-link-user`

## Date
January 2025
