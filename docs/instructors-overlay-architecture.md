# Reinex Instructors - Overlay Table Architecture

## Visual Schema Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Base Employee Table                     │
│                    public.Employees                         │
├─────────────────────────────────────────────────────────────┤
│ id (uuid, PK)                                               │
│ first_name (text)                                           │
│ middle_name (text, nullable)                                │
│ last_name (text)                                            │
│ email (text)                                                │
│ phone (text)                                                │
│ employee_type ('instructor' | 'admin' | null)               │
│ is_active (boolean)                                         │
│ notes (text, nullable)                                      │
│ metadata (jsonb)                                            │
│ instructor_types (uuid[])                                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Referenced by
                              │
         ┌────────────────────┴────────────────────┐
         │                                         │
         ▼                                         ▼
┌──────────────────────────┐         ┌──────────────────────────┐
│   Instructor Profile     │         │  Service Capabilities    │
│ instructor_profiles      │         │ instructor_service_      │
│ (ONE-TO-ONE)             │         │   capabilities           │
├──────────────────────────┤         │ (ONE-TO-MANY)            │
│ employee_id (uuid, PK/FK)│         ├──────────────────────────┤
│ working_days (int[])     │         │ id (uuid, PK)            │
│ break_time_minutes (int) │         │ employee_id (uuid, FK)   │
│ metadata (jsonb)         │         │ service_id (uuid, FK)    │
└──────────────────────────┘         │ max_students (int)       │
                                     │ base_rate (numeric)      │
                                     │ metadata (jsonb)         │
                                     │ UNIQUE(employee_id,      │
                                     │        service_id)       │
                                     └──────────────────────────┘
                                                 │
                                                 │ References
                                                 ▼
                                     ┌──────────────────────────┐
                                     │    Services Table        │
                                     │   public.Services        │
                                     ├──────────────────────────┤
                                     │ id (uuid, PK)            │
                                     │ name (text)              │
                                     │ description (text)       │
                                     └──────────────────────────┘
```

## Data Flow Example

### Scenario: Get instructor "John Doe" with full profile

**Step 1: Query Employees**
```sql
SELECT id, first_name, middle_name, last_name, email, phone, is_active, notes, metadata, instructor_types
FROM public."Employees"
WHERE employee_type = 'instructor' AND is_active = true;
```

**Result:**
```
id: abc-123
first_name: John
middle_name: M
last_name: Doe
email: john@example.com
phone: 0541234567
is_active: true
notes: "Senior instructor"
metadata: {}
instructor_types: [uuid-1, uuid-2]
```

---

**Step 2: Query Instructor Profiles**
```sql
SELECT employee_id, working_days, break_time_minutes, metadata
FROM public.instructor_profiles
WHERE employee_id = 'abc-123';
```

**Result:**
```
employee_id: abc-123
working_days: [0, 1, 2, 3, 4]  // Sunday-Thursday
break_time_minutes: 30
metadata: {}
```

---

**Step 3: Query Service Capabilities**
```sql
SELECT employee_id, service_id, max_students, base_rate, metadata
FROM public.instructor_service_capabilities
WHERE employee_id = 'abc-123';
```

**Result:**
```
[
  {
    employee_id: abc-123,
    service_id: service-uuid-1,
    max_students: 5,
    base_rate: 150.00,
    metadata: {}
  },
  {
    employee_id: abc-123,
    service_id: service-uuid-2,
    max_students: 3,
    base_rate: 200.00,
    metadata: {}
  }
]
```

---

**Step 4: Merge into Final Response**
```javascript
{
  // Base employee data
  id: "abc-123",
  first_name: "John",
  middle_name: "M",
  last_name: "Doe",
  email: "john@example.com",
  phone: "0541234567",
  is_active: true,
  notes: "Senior instructor",
  metadata: {},
  instructor_types: ["uuid-1", "uuid-2"],
  
  // Overlay: Profile (1:1)
  instructor_profile: {
    working_days: [0, 1, 2, 3, 4],
    break_time_minutes: 30,
    metadata: {}
  },
  
  // Overlay: Capabilities (1:many)
  service_capabilities: [
    {
      service_id: "service-uuid-1",
      max_students: 5,
      base_rate: 150.00,
      metadata: {}
    },
    {
      service_id: "service-uuid-2",
      max_students: 3,
      base_rate: 200.00,
      metadata: {}
    }
  ]
}
```

## Why This Pattern?

### ❌ Alternative 1: Denormalized (Everything in Employees)
**Problem:**
- Repeating service data in JSONB arrays
- Hard to query "all instructors who can teach service X"
- No referential integrity for service_id
- JSONB queries are slow and complex

### ❌ Alternative 2: Single Join Table
**Problem:**
- Mixing concerns (profile data + service data)
- One-to-one and one-to-many in same table (awkward)
- Hard to evolve schema (adding new profile fields affects service rows)

### ✅ Reinex Pattern: Separate Overlay Tables
**Benefits:**
- **Clean separation**: Profile data (1:1) separate from service data (1:many)
- **Referential integrity**: FKs to Services table enforce valid service_id
- **Easy queries**: "Find instructors who can teach service X" is simple JOIN
- **Schema evolution**: Add new profile fields without affecting capabilities
- **Performance**: Proper indexes on FKs for fast lookups
- **ACID compliance**: Transactions work correctly across related tables

## Use Case Examples

### 1. Scheduling: "Which instructors work on Mondays?"
```sql
SELECT e.id, e.first_name, e.last_name
FROM public."Employees" e
JOIN public.instructor_profiles p ON e.id = p.employee_id
WHERE e.employee_type = 'instructor'
  AND e.is_active = true
  AND 1 = ANY(p.working_days);  -- Monday = 1
```

### 2. Capacity Planning: "Which instructors can teach service X with max capacity?"
```sql
SELECT e.id, e.first_name, e.last_name, c.max_students
FROM public."Employees" e
JOIN public.instructor_service_capabilities c ON e.id = c.employee_id
WHERE e.employee_type = 'instructor'
  AND e.is_active = true
  AND c.service_id = 'service-uuid-1'
ORDER BY c.max_students DESC;
```

### 3. Payroll: "Calculate total instructor costs for service Y"
```sql
SELECT 
  s.name AS service_name,
  COUNT(c.employee_id) AS instructor_count,
  AVG(c.base_rate) AS avg_rate,
  SUM(c.base_rate) AS total_base_cost
FROM public.instructor_service_capabilities c
JOIN public."Services" s ON c.service_id = s.id
WHERE c.service_id = 'service-uuid-2'
GROUP BY s.name;
```

### 4. Analytics: "Instructors with most service coverage"
```sql
SELECT 
  e.id,
  e.first_name,
  e.last_name,
  COUNT(c.service_id) AS services_count,
  SUM(c.max_students) AS total_capacity
FROM public."Employees" e
LEFT JOIN public.instructor_service_capabilities c ON e.id = c.employee_id
WHERE e.employee_type = 'instructor'
  AND e.is_active = true
GROUP BY e.id, e.first_name, e.last_name
ORDER BY services_count DESC;
```

## Performance Characteristics

### Query Complexity
- **GET all instructors**: O(n) where n = number of instructors
- **Lookup by ID**: O(1) with proper indexes
- **Filter by service**: O(m) where m = instructors teaching that service

### Index Strategy
```sql
-- Instructor Profiles
CREATE INDEX idx_instructor_profiles_working_days 
  ON public.instructor_profiles USING GIN (working_days);

-- Service Capabilities
CREATE INDEX idx_instructor_capabilities_employee 
  ON public.instructor_service_capabilities (employee_id);
  
CREATE INDEX idx_instructor_capabilities_service 
  ON public.instructor_service_capabilities (service_id);

-- Composite for common queries
CREATE INDEX idx_instructor_capabilities_composite
  ON public.instructor_service_capabilities (employee_id, service_id);
```

### Scalability
- ✅ **100 instructors**: Instant response (<50ms)
- ✅ **1,000 instructors**: Fast response (<200ms)
- ✅ **10,000 instructors**: Add pagination, still fast
- ✅ **100,000 instructors**: Consider materialized view or RPC

Typical Reinex deployment: 10-100 instructors  
Current implementation: Optimal for this scale

## Migration Strategy

### Phase 1: API Update (DONE)
✅ Update GET handler to join overlay tables  
✅ Update POST handler to create profile if provided  
✅ Return backward-compatible responses (null/empty for missing data)

### Phase 2: Frontend Update (NEXT)
- [ ] Add forms for editing working_days
- [ ] Add forms for editing break_time_minutes
- [ ] Add UI for managing service capabilities
- [ ] Display overlay data in instructor cards
- [ ] Update scheduling logic to respect working_days

### Phase 3: Data Backfill (OPTIONAL)
- [ ] Script to backfill working_days from existing schedules
- [ ] Script to backfill capabilities from existing assignments
- [ ] Admin UI to review and approve backfill suggestions

## Summary

The Reinex overlay table pattern provides:
- ✅ **Proper normalization**: Separate concerns, avoid duplication
- ✅ **Referential integrity**: FKs enforce valid relationships
- ✅ **Query flexibility**: Easy to filter, join, aggregate
- ✅ **Schema evolution**: Add fields without breaking existing data
- ✅ **Performance**: Indexed lookups, efficient joins
- ✅ **Backward compatibility**: Null/empty responses for missing data

This is the **correct architectural pattern** for Reinex, matching the PRD requirements and enabling all scheduling, capacity planning, and payroll features.
