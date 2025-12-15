# Code Duplication Visualization

## Current State: Data Fetching Spaghetti 🍝

```
┌─────────────────────────────────────────────────────────────┐
│                      Backend APIs                            │
│  /api/students | /api/instructors | /api/settings           │
└─────────────────────────────────────────────────────────────┘
        ↑                 ↑                   ↑
        │                 │                   │
        │ Manual fetch x4 │ Manual fetch x10  │ Manual fetch x6
        │                 │                   │
┌───────┴─────────────────┴───────────────────┴───────────────┐
│                   DUPLICATED CODE                            │
│                                                              │
│  Each file independently implements:                         │
│  • useState for data                                         │
│  • useEffect for loading                                     │
│  • try/catch error handling                                  │
│  • authenticatedFetch call                                   │
│  • Array.isArray() check                                     │
│  • Error logging                                             │
│                                                              │
│  ≈ 30 lines PER FILE × 13 files = 390 lines of duplication  │
└──────────────────────────────────────────────────────────────┘
        ↓                 ↓                   ↓
┌───────┴─────────────────┴───────────────────┴───────────────┐
│                  20+ Components                              │
│                                                              │
│  StudentManagementPage      (S, I)                          │
│  MyStudentsPage             (S)                             │
│  NewSessionModal            (S, I, Sv)                      │
│  ResolvePendingReportDialog (S, I, Sv) ⚠️ WORST            │
│  AddStudentForm             (I, Sv)                         │
│  EditStudentForm            (I, Sv)                         │
│  StudentDetailPage          (I, Sv)                         │
│  DataMaintenanceModal       (I)                             │
│  ProfileEditorView          (I)                             │
│  DirectoryView              (I)                             │
│  DocumentCenterView         (I)                             │
│  ServiceManager             (Sv)                            │
│  ... and more                                               │
│                                                              │
│  Legend: S=Students, I=Instructors, Sv=Services             │
└──────────────────────────────────────────────────────────────┘
```

---

## Proposed State: Centralized Hooks 🎯

```
┌─────────────────────────────────────────────────────────────┐
│                      Backend APIs                            │
│  /api/students | /api/instructors | /api/settings           │
└─────────────────────────────────────────────────────────────┘
        ↑                 ↑                   ↑
        │                 │                   │
        │ Single call     │ Single call       │ Single call
        │                 │                   │
┌───────┴─────────────────┴───────────────────┴───────────────┐
│           SHARED HOOKS (src/hooks/useOrgData.js)            │
│                                                              │
│  export function useStudents(options = {}) {                │
│    const { session } = useAuth();                           │
│    const { activeOrgId } = useOrg();                        │
│    const [data, setData] = useState([]);                    │
│    const [loading, setLoading] = useState(false);           │
│    const [error, setError] = useState(null);                │
│                                                              │
│    const fetch = useCallback(async () => { ... }, [...]);   │
│    useEffect(() => { fetch(); }, [fetch]);                  │
│                                                              │
│    return { data, loading, error, refetch: fetch };         │
│  }                                                           │
│                                                              │
│  export function useInstructors() { ... }                   │
│  export function useServices() { ... }                      │
│                                                              │
│  ✅ Single source of truth                                  │
│  ✅ ~100 lines total (vs 390 duplicated)                    │
│  ✅ Easy to add caching/refetching                          │
└──────────────────────────────────────────────────────────────┘
        ↓                 ↓                   ↓
┌───────┴─────────────────┴───────────────────┴───────────────┐
│                  20+ Components (CLEAN)                      │
│                                                              │
│  All components use simple one-liners:                       │
│                                                              │
│  const { data: students } = useStudents({ status });        │
│  const { data: instructors } = useInstructors();            │
│  const { data: services } = useServices();                  │
│                                                              │
│  ✅ No manual useEffect                                     │
│  ✅ No manual error handling                                │
│  ✅ No manual loading states                                │
│  ✅ Automatic refetch when needed                           │
└──────────────────────────────────────────────────────────────┘
```

---

## ResolvePendingReportDialog: Before & After

### BEFORE (Current): 267 lines ❌

```
┌─────────────────────────────────────────────────────────────┐
│  ResolvePendingReportDialog.jsx                             │
│                                                              │
│  Line 28:  const [students, setStudents] = useState([]);    │
│  Line 37:  const [instructors, setInstructors] = ...        │
│  Line 38:  const [services, setServices] = ...              │
│                                                              │
│  Lines 47-77:   ┌─────────────────────────────┐            │
│  Manual student │  useEffect(() => {          │ 30 lines   │
│  fetching       │    async function load() {  │            │
│                 │      try { ... }            │            │
│                 │    }                        │            │
│                 │  }, [session, activeOrgId]) │            │
│                 └─────────────────────────────┘            │
│                                                              │
│  Lines 95-108:  ┌─────────────────────────────┐            │
│  Manual         │  useEffect(() => {          │ 15 lines   │
│  instructor     │    async function load() {  │            │
│  fetching       │      try { ... }            │            │
│                 │    }                        │            │
│                 │  }, [session, activeOrgId]) │            │
│                 └─────────────────────────────┘            │
│                                                              │
│  Lines 110-124: ┌─────────────────────────────┐            │
│  Manual         │  useEffect(() => {          │ 15 lines   │
│  services       │    async function load() {  │            │
│  fetching       │      try { ... }            │            │
│                 │    }                        │            │
│                 │  }, [session, activeOrgId]) │            │
│                 └─────────────────────────────┘            │
│                                                              │
│  Lines 213-216: Manual national_id validation               │
│                 (instead of useNationalIdGuard hook)        │
│                                                              │
│  Lines 130-267: Inline student creation form                │
│                 (instead of AddStudentForm component)       │
│                                                              │
│  DUPLICATES:                                                │
│  • Data fetching logic (60 lines)                           │
│  • Validation logic (50 lines)                              │
│  • Form state management (100 lines)                        │
│                                                              │
│  TOTAL: 210 lines of duplication                            │
└──────────────────────────────────────────────────────────────┘
```

### AFTER (Proposed): ~100 lines ✅

```
┌─────────────────────────────────────────────────────────────┐
│  ResolvePendingReportDialog.jsx                             │
│                                                              │
│  Imports:                                                    │
│  import { useStudents, useInstructors,                      │
│           useServices } from '@/hooks/useOrgData';          │
│  import { useNationalIdGuard }                              │
│         from '@/features/admin/hooks/useStudentDedup...';   │
│                                                              │
│  Data Loading (3 lines):                                    │
│  const { data: students } = useStudents({ status });        │
│  const { data: instructors } = useInstructors();            │
│  const { data: services } = useServices();                  │
│                                                              │
│  Validation (1 line):                                       │
│  const { duplicate } = useNationalIdGuard(                  │
│    formData.national_id, session                            │
│  );                                                          │
│                                                              │
│  Form Rendering:                                            │
│  {action === 'create_new' && (                              │
│    <AddStudentForm                                          │
│      onSubmit={handleCreateStudent}                         │
│      onCancel={() => setAction(null)}                       │
│    />                                                        │
│  )}                                                          │
│                                                              │
│  REUSES:                                                    │
│  • Shared data hooks (eliminates 60 lines)                  │
│  • Validation hooks (eliminates 50 lines)                   │
│  • AddStudentForm component (eliminates 100 lines)          │
│                                                              │
│  RESULT: 210 lines eliminated (78% reduction)               │
└──────────────────────────────────────────────────────────────┘
```

---

## Validation: Manual vs Hook

### BEFORE: Manual Validation ❌

```javascript
// ResolvePendingReportDialog.jsx - lines 213-216
const trimmedNationalId = formData.national_id.trim();
if (trimmedNationalId && trimmedNationalId.length < 5) {
  toast.error('תעודת זהות צריכה להיות לפחות 5 תווים');
  return;
}

// Problems:
// • No real-time feedback
// • No duplicate checking
// • No debouncing
// • Inconsistent with AddStudentForm
```

### AFTER: Hook-Based Validation ✅

```javascript
// Use existing useNationalIdGuard hook
const { duplicate, loading, error } = useNationalIdGuard(
  formData.national_id,
  session,
  excludeStudentId
);

// Benefits:
// ✅ Real-time duplicate checking
// ✅ Debounced API calls (250ms)
// ✅ Loading states for UX
// ✅ Consistent validation across all forms
// ✅ Support for excludeStudentId
// ✅ Detailed error messages
```

---

## Impact Timeline

### Week 1: Create Shared Hooks
```
Day 1-2:  Create useOrgData.js with 3 hooks
Day 3:    Replace in ResolvePendingReportDialog
Day 4:    Replace in NewSessionModal
Day 5:    Replace in StudentManagementPage

Result:   -120 lines, 4 files cleaner
```

### Week 2: Refactor Validation
```
Day 1-2:  Update ResolvePendingReportDialog validation
Day 3:    Option A: Embed AddStudentForm, or
          Option B: Use validation hooks

Result:   -150 lines, consistent validation
```

### Week 3: Replace Remaining Files
```
Day 1-3:  Replace remaining 7 files
Day 4-5:  Testing and cleanup

Result:   -230 lines, all files using shared hooks
```

**Total Impact:**
- 500+ lines eliminated
- 20+ files cleaner
- Single source of truth
- Easier maintenance

---

## Duplication Heat Map 🌡️

```
Files ranked by duplication severity:

🔴 CRITICAL (combines multiple patterns):
1. ResolvePendingReportDialog.jsx  ████████████ 210 lines
2. NewSessionModal.jsx             ████████     120 lines
3. AddStudentForm.jsx              ██████        90 lines
4. EditStudentForm.jsx             ██████        90 lines

🟡 HIGH (single pattern repeated):
5. StudentDetailPage.jsx           ████          60 lines
6. StudentManagementPage.jsx       ████          60 lines
7. MyStudentsPage.jsx              ██            30 lines
8. DataMaintenanceModal.jsx        ██            30 lines

🟢 MEDIUM (will benefit from shared hooks):
9-12. Settings components          ██            30 lines each
13-20. Other consumers             █             15 lines each

TOTAL: 950+ lines of duplication
```

---

## The Win Graph 📈

```
Code Reduction:

Before:  ████████████████████████████████████  950 lines (duplicated)
After:   ████                                  100 lines (shared hooks)

Savings: ████████████████████████████████      850 lines eliminated!

Maintenance Burden:

Before:  ████████████████████████████████████  20+ files to update
After:   ████                                  3 hooks to maintain

Improvement: 85% reduction in maintenance surface
```

---

## Risk vs Reward

```
          │
   High   │     🎯 [Shared Hooks]
          │         High reward
   Reward │         Medium risk
          │
   Medium │                      [Validation Hooks]
          │                       Medium reward
          │                       Low risk
          │
   Low    │                                    [Message Catalog]
          │                                     Low reward
          │                                     Low risk
          │
          └────────────────────────────────────────────────
             Low            Medium            High
                          Risk

Recommendation: Start with shared hooks (best ROI)
```

---

## Developer Experience Before/After

### BEFORE: Adding a new filter to student fetching ❌

```
Step 1: Update StudentManagementPage.jsx
Step 2: Update MyStudentsPage.jsx
Step 3: Update NewSessionModal.jsx
Step 4: Update ResolvePendingReportDialog.jsx
Step 5: Update AddStudentForm.jsx (if applicable)
Step 6: Update EditStudentForm.jsx (if applicable)
Step 7: Test all 6 components
Step 8: Hope you didn't miss any files

Time: 2-3 hours
Risk: HIGH (easy to miss files)
```

### AFTER: Adding a new filter to student fetching ✅

```
Step 1: Update useStudents() hook in useOrgData.js
Step 2: All components automatically get the feature
Step 3: Test (hook has unit tests)

Time: 15-30 minutes
Risk: LOW (single source of truth)
```

---

## Summary

**Current State:** 🔴
- 950+ lines of duplicated code
- 20+ files with manual data fetching
- Inconsistent validation
- High maintenance burden

**Proposed State:** 🟢
- 100 lines of shared hooks
- Single source of truth
- Consistent validation
- Low maintenance burden

**Path Forward:**
1. Week 1: Shared hooks → -390 lines
2. Week 2: Validation → -150 lines
3. Week 3: Cleanup → -230 lines

**Total Savings:** 770+ lines, 85% reduction in duplication

---

See `docs/code-duplication-analysis.md` for full details.
