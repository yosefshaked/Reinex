# Instructors API Response Structure Changes

## Before (TutTiud Pattern)

```json
GET /api/instructors?org_id=<uuid>

[
  {
    "id": "abc-123",
    "first_name": "John",
    "middle_name": "M",
    "last_name": "Doe",
    "email": "john@example.com",
    "phone": "0541234567",
    "is_active": true,
    "notes": "Senior instructor",
    "metadata": {},
    "instructor_types": ["uuid-1", "uuid-2"]
  }
]
```

**Problems:**
- ❌ Missing `working_days` data
- ❌ Missing `break_time_minutes` data
- ❌ No service capabilities
- ❌ No `max_students` per service
- ❌ No `base_rate` per service

**Why This is Bad:**
- Scheduling system can't determine instructor availability
- Capacity planning can't calculate how many students per instructor
- Payroll calculations have no base rate data
- Doesn't match Reinex PRD requirements

## After (Reinex Pattern)

```json
GET /api/instructors?org_id=<uuid>

[
  {
    "id": "abc-123",
    "first_name": "John",
    "middle_name": "M",
    "last_name": "Doe",
    "email": "john@example.com",
    "phone": "0541234567",
    "is_active": true,
    "notes": "Senior instructor",
    "metadata": {},
    "instructor_types": ["uuid-1", "uuid-2"],
    
    // NEW: Instructor profile overlay
    "instructor_profile": {
      "working_days": [0, 1, 2, 3, 4],  // Sunday-Thursday
      "break_time_minutes": 30,
      "metadata": {}
    },
    
    // NEW: Service capabilities overlay
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
  },
  {
    "id": "def-456",
    "first_name": "Jane",
    "middle_name": null,
    "last_name": "Smith",
    "email": "jane@example.com",
    "phone": "0549876543",
    "is_active": true,
    "notes": null,
    "metadata": {},
    "instructor_types": ["uuid-3"],
    
    // Instructor without overlay data yet (backward compatible)
    "instructor_profile": null,
    "service_capabilities": []
  }
]
```

**Benefits:**
- ✅ Complete scheduling data (working_days)
- ✅ Break time tracking (break_time_minutes)
- ✅ Service-specific capacity (max_students per service)
- ✅ Payroll base rates (base_rate per service)
- ✅ Backward compatible (nulls/empty arrays for missing data)
- ✅ Matches Reinex PRD Section 9.1

## POST Request Examples

### Create Basic Instructor (TutTiud-style, still works)

```json
POST /api/instructors

{
  "org_id": "org-uuid",
  "first_name": "John",
  "middle_name": "M",
  "last_name": "Doe",
  "email": "john@example.com",
  "phone": "0541234567",
  "instructor_types": ["uuid-1"]
}
```

**Response:**
```json
{
  "id": "abc-123",
  "first_name": "John",
  "middle_name": "M",
  "last_name": "Doe",
  "email": "john@example.com",
  "phone": "0541234567",
  "is_active": true,
  "notes": null,
  "metadata": {...},
  "instructor_types": ["uuid-1"],
  "instructor_profile": null,  // No overlay created
  "service_capabilities": []    // No capabilities yet
}
```

### Create Instructor with Profile (Reinex-style)

```json
POST /api/instructors

{
  "org_id": "org-uuid",
  "first_name": "John",
  "middle_name": "M",
  "last_name": "Doe",
  "email": "john@example.com",
  "phone": "0541234567",
  "instructor_types": ["uuid-1"],
  "working_days": [0, 1, 2, 3, 4],  // NEW: Sunday-Thursday
  "break_time_minutes": 30           // NEW: 30-minute break
}
```

**Response:**
```json
{
  "id": "abc-123",
  "first_name": "John",
  "middle_name": "M",
  "last_name": "Doe",
  "email": "john@example.com",
  "phone": "0541234567",
  "is_active": true,
  "notes": null,
  "metadata": {...},
  "instructor_types": ["uuid-1"],
  "instructor_profile": {            // Overlay created!
    "working_days": [0, 1, 2, 3, 4],
    "break_time_minutes": 30,
    "metadata": {}
  },
  "service_capabilities": []
}
```

## Frontend Usage Examples

### Basic Display (Backward Compatible)

```jsx
import { formatInstructorName } from '@/lib/format-name';

function InstructorCard({ instructor }) {
  const name = formatInstructorName(instructor);
  
  return (
    <div>
      <h3>{name}</h3>
      <p>{instructor.email}</p>
      
      {/* NEW: Check for profile data */}
      {instructor.instructor_profile && (
        <div>
          <p>Working Days: {instructor.instructor_profile.working_days?.length || 0}</p>
          <p>Break: {instructor.instructor_profile.break_time_minutes || 0} min</p>
        </div>
      )}
      
      {/* NEW: Check for capabilities */}
      {instructor.service_capabilities?.length > 0 && (
        <div>
          <h4>Services</h4>
          <ul>
            {instructor.service_capabilities.map((cap) => (
              <li key={cap.service_id}>
                Max Students: {cap.max_students} | Rate: ₪{cap.base_rate}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

### Advanced Scheduling Logic

```jsx
function canInstructorWorkOnDay(instructor, dayOfWeek) {
  if (!instructor.instructor_profile) {
    // No profile = assume available (backward compatible)
    return true;
  }
  
  const workingDays = instructor.instructor_profile.working_days || [];
  return workingDays.includes(dayOfWeek);
}

function getInstructorCapacityForService(instructor, serviceId) {
  const capability = instructor.service_capabilities?.find(
    (cap) => cap.service_id === serviceId
  );
  
  return capability?.max_students || 1; // Default to 1 if not specified
}

function calculateInstructorPayrollRate(instructor, serviceId) {
  const capability = instructor.service_capabilities?.find(
    (cap) => cap.service_id === serviceId
  );
  
  return capability?.base_rate || 0; // Default to 0 if not specified
}
```

## Implementation Notes

### Query Pattern (Backend)

The API uses a **manual join pattern** since Supabase doesn't support multi-table LEFT JOINs well:

```javascript
// Step 1: Get base instructor data
const { data: employees } = await tenantClient
  .from('Employees')
  .select('id, first_name, middle_name, last_name, ...')
  .eq('employee_type', 'instructor');

// Step 2: Get profiles for all instructors
const employeeIds = employees.map(e => e.id);
const { data: profiles } = await tenantClient
  .from('instructor_profiles')
  .select('employee_id, working_days, break_time_minutes, metadata')
  .in('employee_id', employeeIds);

// Step 3: Get capabilities for all instructors
const { data: capabilities } = await tenantClient
  .from('instructor_service_capabilities')
  .select('employee_id, service_id, max_students, base_rate, metadata')
  .in('employee_id', employeeIds);

// Step 4: Build maps for efficient lookup
const profilesMap = new Map(profiles.map(p => [p.employee_id, p]));
const capabilitiesMap = new Map();
capabilities.forEach(c => {
  if (!capabilitiesMap.has(c.employee_id)) {
    capabilitiesMap.set(c.employee_id, []);
  }
  capabilitiesMap.get(c.employee_id).push(c);
});

// Step 5: Merge data
const enriched = employees.map(emp => ({
  ...emp,
  instructor_profile: profilesMap.get(emp.id) || null,
  service_capabilities: capabilitiesMap.get(emp.id) || [],
}));
```

**Performance:**
- ✅ O(n) time complexity (3 queries + linear merge)
- ✅ Efficient for <1000 instructors
- ✅ Uses Map for O(1) lookups during merge
- ✅ Single network round-trip per query

**Scalability:**
- For >1000 instructors, consider pagination
- For >10,000 instructors, consider RPC function or view
- Current implementation is sufficient for typical Reinex deployment (<100 instructors)

## Migration Guide for Frontend

### Step 1: Update API Client
```javascript
// Old (still works)
const instructors = await fetchInstructors(orgId, session);
// Returns: [{ id, name, email, ... }]

// New (same call, richer response)
const instructors = await fetchInstructors(orgId, session);
// Returns: [{ id, name, email, ..., instructor_profile, service_capabilities }]
```

### Step 2: Update Components
```jsx
// Old code (still works, just ignores new fields)
<div>{instructor.name}</div>

// New code (uses overlay data when available)
<div>
  {instructor.name}
  {instructor.instructor_profile && (
    <Badge>
      Works {instructor.instructor_profile.working_days?.length || 0} days
    </Badge>
  )}
</div>
```

### Step 3: Update Forms (Future Enhancement)
```jsx
// Add fields to instructor creation/edit forms:
<FormField label="Working Days">
  <DayOfWeekMultiSelect
    value={workingDays}
    onChange={setWorkingDays}
  />
</FormField>

<FormField label="Break Time (minutes)">
  <Input
    type="number"
    value={breakTimeMinutes}
    onChange={(e) => setBreakTimeMinutes(e.target.value)}
  />
</FormField>
```

## Database Schema Details

### instructor_profiles Table
```sql
CREATE TABLE public.instructor_profiles (
  employee_id uuid PRIMARY KEY,
  working_days integer[],        -- Array [0-6] (0=Sunday, 6=Saturday)
  break_time_minutes integer,    -- Break duration in minutes
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  FOREIGN KEY (employee_id) REFERENCES public."Employees"(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX idx_instructor_profiles_working_days 
  ON public.instructor_profiles USING GIN (working_days);
```

### instructor_service_capabilities Table
```sql
CREATE TABLE public.instructor_service_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  service_id uuid NOT NULL,
  max_students integer DEFAULT 1,  -- Maximum students per session
  base_rate numeric(10,2),          -- Hourly rate in local currency
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  FOREIGN KEY (employee_id) REFERENCES public."Employees"(id) ON DELETE CASCADE,
  FOREIGN KEY (service_id) REFERENCES public."Services"(id) ON DELETE CASCADE,
  UNIQUE (employee_id, service_id)  -- One capability per instructor per service
);

-- Indexes
CREATE INDEX idx_instructor_capabilities_employee 
  ON public.instructor_service_capabilities (employee_id);
CREATE INDEX idx_instructor_capabilities_service 
  ON public.instructor_service_capabilities (service_id);
```

## Testing Checklist

### Backend Tests
- [ ] GET returns null profile for instructors without overlay data
- [ ] GET returns profile for instructors with working_days
- [ ] GET returns empty array for instructors without capabilities
- [ ] GET returns capabilities array for instructors with services
- [ ] POST creates profile when working_days provided
- [ ] POST skips profile creation when no overlay data provided
- [ ] PUT updates existing profile correctly
- [ ] Non-admin users only see their own instructor record

### Frontend Tests
- [ ] Display works for instructors without overlay data
- [ ] Display shows working days when profile exists
- [ ] Display shows service capabilities when available
- [ ] Forms handle null/empty overlay fields gracefully
- [ ] Scheduling logic respects working_days constraints
- [ ] Capacity calculations use max_students from capabilities
- [ ] Payroll calculations use base_rate from capabilities

## Conclusion

This API refactor transforms the instructors endpoint from a basic employee query into a comprehensive instructor management system that supports:

1. **Scheduling** - via working_days
2. **Capacity Planning** - via max_students per service
3. **Payroll** - via base_rate per service
4. **Break Management** - via break_time_minutes

The changes are **fully backward compatible** - existing code continues to work, new features are opt-in, and the migration path is straightforward.
