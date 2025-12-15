# Race Condition Fix: Student Filtering Issue

## Problem Description

When using filters on the student management pages (both admin and instructor views) and navigating to a student's detail page and back, the filtered list would disappear, showing no students even though data was fetched from the server.

**Symptoms:**
- Apply a filter (e.g., show inactive students)
- Navigate into a student's profile
- Navigate back to the student list
- The list appears empty despite the network tab showing the correct data was fetched

## Root Cause

A **race condition** existed between multiple React `useEffect` hooks with conflicting execution orders:

### StudentManagementPage.jsx Flow (Before Fix)

```
1. Component mounts with canFetch potentially already true
2. Effect #1 (line 187-197): if (canFetch) { refreshRoster(true); loadTags(); }
   → Fetches students with CURRENT statusFilter value (default='active')
   → Sets students array to active students
3. Effect #2 (line 176-184): Load saved filters from sessionStorage
   → Sets statusFilter to saved value (e.g., 'inactive')
4. Effect #3 (line 217-222): if (canFetch && statusFilter changed) { fetchStudents(); }
   → Should refetch with statusFilter='inactive'
   → BUT timing issues can cause misalignment
```

**The Issue:** These effects could execute in different orders depending on React's rendering cycle:
- If filters load AFTER the initial fetch, the `students` state is already populated with wrong data
- The filter state gets saved to sessionStorage while the students array is stale
- When returning from the detail page, the same race condition repeats

### MyStudentsPage.jsx Similar Issue

MyStudentsPage had a more complex flow involving visibility setting permission checks, but suffered from the same race condition where data fetches could happen before filters were properly restored.

## Solution

Added a **`filtersRestored` flag** to ensure proper effect sequencing:

### Changes to StudentManagementPage.jsx

1. **Added state:**
   ```javascript
   const [filtersRestored, setFiltersRestored] = useState(false);
   ```

2. **Modified filter loading effect** (was lines 176-184):
   ```javascript
   // Load saved filter state on mount FIRST, before any fetching happens
   useEffect(() => {
     if (!activeOrgId) {
       setFiltersRestored(false);
       return;
     }
     
     const savedFilters = loadFilterState(activeOrgId, 'admin');
     if (savedFilters) {
       // ... restore all filters ...
     }
     
     // Mark filters as restored so fetching can proceed
     setFiltersRestored(true);
   }, [activeOrgId]);
   ```

3. **Modified data fetching effect** (was lines 187-197):
   ```javascript
   // Fetch students and instructors only AFTER filters have been restored
   useEffect(() => {
     if (canFetch && filtersRestored) {  // ← NEW: added filtersRestored check
       refreshRoster(true);
       void loadTags();
     } else {
       setStudents([]);
       setInstructors([]);
     }
   }, [canFetch, filtersRestored, refreshRoster, loadTags]);  // ← NEW: added filtersRestored
   ```

4. **Modified statusFilter change effect** (was lines 217-222):
   ```javascript
   // Refetch students when statusFilter changes (after initial restore)
   useEffect(() => {
     if (canFetch && filtersRestored) {  // ← NEW: added filtersRestored check
       void fetchStudents();
     }
   }, [statusFilter, canFetch, filtersRestored, fetchStudents]);  // ← NEW: added filtersRestored
   ```

### Changes to MyStudentsPage.jsx

Applied the same pattern:

1. **Added state:**
   ```javascript
   const [filtersRestored, setFiltersRestored] = useState(false);
   ```

2. **Modified filter loading effect** to set `filtersRestored = true` after loading non-statusFilter filters

3. **Modified main fetch effect** to check both `canFetch && filtersRestored` before fetching

4. **Updated dependency arrays** to include `filtersRestored`

## How It Works

### Guaranteed Execution Order

1. **Mount:** `activeOrgId` changes → filters restore effect runs first
   - Restores all saved filters from sessionStorage
   - Sets `filtersRestored = true`

2. **First Fetch:** Both `canFetch` and `filtersRestored` are true → data fetching effect runs
   - Fetches students with correctly restored filters
   - All subsequent effects have access to correct filter values

3. **Return from Detail Page:** sessionStorage still contains filters
   - `filtersRestored` flag gates all fetches
   - Filters are re-loaded in the same controlled sequence
   - No race conditions possible

## Benefits

✅ **Prevents stale data:** Filters are always restored before any data fetches  
✅ **Consistent behavior:** Multiple navigations work reliably  
✅ **No UI flicker:** Filters apply correctly on page load  
✅ **Maintains sessionStorage persistence:** Filters still survive page navigation  

## Testing Recommendations

1. **Basic filter test:**
   - Open admin student list
   - Apply "inactive" filter
   - Verify inactive students display
   - Navigate into a student detail
   - Go back to list
   - **Expected:** Inactive filter still applied, students visible

2. **Filter combination test:**
   - Apply multiple filters (status + instructor + day of week)
   - Navigate to detail page
   - Navigate back
   - **Expected:** All filters remain applied

3. **Instructor view test:**
   - Access "My Students" page as instructor
   - Apply filters
   - Navigate to detail
   - Go back
   - **Expected:** Filters persist correctly

4. **Org switching test:**
   - Use filters on org A
   - Switch to org B
   - Switch back to org A
   - **Expected:** Org A filters restored from sessionStorage

## Files Modified

- `src/features/admin/pages/StudentManagementPage.jsx`
- `src/features/instructor/pages/MyStudentsPage.jsx`
