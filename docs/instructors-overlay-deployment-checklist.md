# Instructors Overlay UI - Deployment Checklist

## Pre-Deployment Verification

### Code Quality
- [x] Build successful (`npm run build`)
- [x] No ESLint errors
- [x] No TypeScript/JSDoc errors
- [x] All imports resolved correctly
- [x] No console warnings during build

### Components
- [x] `EditInstructorProfileDialog.jsx` created
- [x] `EditServiceCapabilitiesDialog.jsx` created
- [x] `DirectoryView.jsx` updated with dialogs
- [x] API `instructors/index.js` PUT handler enhanced

### Database Schema Requirements
⚠️ **CRITICAL**: Database must have these tables before deploying!

```sql
-- Run this against the tenant database (tuttiud schema)

-- 1. instructor_profiles table
CREATE TABLE IF NOT EXISTS tuttiud.instructor_profiles (
  employee_id uuid PRIMARY KEY REFERENCES tuttiud."Employees"(id) ON DELETE CASCADE,
  working_days integer[] DEFAULT ARRAY[]::integer[],
  break_time_minutes integer DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_instructor_profiles_employee_id 
  ON tuttiud.instructor_profiles(employee_id);

-- 2. instructor_service_capabilities table
CREATE TABLE IF NOT EXISTS tuttiud.instructor_service_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES tuttiud."Employees"(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES tuttiud."Services"(id) ON DELETE CASCADE,
  max_students integer DEFAULT 1 CHECK (max_students >= 1),
  base_rate numeric(10,2) DEFAULT 0 CHECK (base_rate >= 0),
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW(),
  UNIQUE(employee_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_instructor_service_capabilities_employee_id 
  ON tuttiud.instructor_service_capabilities(employee_id);

CREATE INDEX IF NOT EXISTS idx_instructor_service_capabilities_service_id 
  ON tuttiud.instructor_service_capabilities(service_id);
```

**Verification Query**:
```sql
-- Verify tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'tuttiud' 
  AND table_name IN ('instructor_profiles', 'instructor_service_capabilities');

-- Expected result: 2 rows
```

## Testing Checklist

### Unit Testing
- [ ] Profile dialog opens correctly
- [ ] Capabilities dialog opens correctly
- [ ] Working days selector toggles properly
- [ ] Break time validates range (0-240)
- [ ] Service dropdown shows available services
- [ ] Max students validates >= 1
- [ ] Add service creates new row
- [ ] Remove service deletes row
- [ ] Duplicate service prevented

### Integration Testing
- [ ] Profile save calls correct API endpoint
- [ ] Capabilities save calls correct API endpoint
- [ ] Toast notifications appear
- [ ] Dialogs close after successful save
- [ ] Instructor list refreshes after save
- [ ] Values persist after re-opening dialogs
- [ ] Error handling works correctly

### End-to-End Testing

#### Profile Flow
1. [ ] Navigate to Settings → Employees & Instructors
2. [ ] Click "פרופיל" on active instructor
3. [ ] Dialog opens with current values
4. [ ] Select Sunday, Monday, Tuesday, Wednesday, Thursday
5. [ ] Enter break time: 30
6. [ ] Click "שמור שינויים"
7. [ ] Verify toast: "הפרופיל עודכן בהצלחה"
8. [ ] Verify dialog closes
9. [ ] Re-open dialog
10. [ ] Verify values persisted: days selected, break time = 30

#### Capabilities Flow
1. [ ] Click "שירותים" on active instructor
2. [ ] Dialog opens, services load
3. [ ] Click "הוסף שירות"
4. [ ] Select service from dropdown
5. [ ] Enter max students: 5
6. [ ] Enter base rate: 150.00
7. [ ] Click "הוסף שירות" again
8. [ ] Select different service
9. [ ] Enter max students: 3
10. [ ] Enter base rate: 200.00
11. [ ] Click "שמור שינויים"
12. [ ] Verify toast: "היכולות עודכנו בהצלחה"
13. [ ] Verify dialog closes
14. [ ] Re-open dialog
15. [ ] Verify 2 capabilities saved with correct values

#### Error Handling
1. [ ] Try to save capabilities with max_students = 0
2. [ ] Verify error message appears
3. [ ] Try to add duplicate service
4. [ ] Verify service not available in dropdown
5. [ ] Simulate API failure (disconnect network)
6. [ ] Verify error toast appears
7. [ ] Verify form remains editable after error

### Browser Testing
- [ ] Chrome (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Edge (latest)
- [ ] Mobile Safari (iOS)
- [ ] Mobile Chrome (Android)

### Responsive Testing
- [ ] Desktop (1920x1080)
- [ ] Laptop (1366x768)
- [ ] Tablet (768x1024)
- [ ] Mobile (375x667)
- [ ] Mobile landscape (667x375)

### RTL Testing
- [ ] All text flows right-to-left
- [ ] Buttons aligned correctly
- [ ] Icons positioned correctly
- [ ] Dialogs display properly
- [ ] Form fields aligned right
- [ ] Error messages aligned right

### Accessibility Testing
- [ ] Keyboard navigation works
- [ ] Tab order logical
- [ ] ESC closes dialogs
- [ ] Enter/Space activates buttons
- [ ] Screen reader announces correctly
- [ ] ARIA labels present
- [ ] Color contrast sufficient (WCAG AA)

## API Testing

### Profile Endpoint
```bash
# Test profile update
curl -X PUT https://your-api.com/api/instructors \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "org_id": "org-uuid",
    "instructor_id": "instructor-uuid",
    "working_days": [0, 1, 2, 3, 4],
    "break_time_minutes": 30
  }'

# Expected: 200 OK with updated instructor data
```

### Capabilities Endpoint
```bash
# Test capabilities update
curl -X PUT https://your-api.com/api/instructors \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "org_id": "org-uuid",
    "instructor_id": "instructor-uuid",
    "service_capabilities": [
      {
        "service_id": "service-1-uuid",
        "max_students": 5,
        "base_rate": 150.00
      },
      {
        "service_id": "service-2-uuid",
        "max_students": 3,
        "base_rate": 200.00
      }
    ]
  }'

# Expected: 200 OK with updated instructor data
```

### Verification Queries
```sql
-- Verify profile was saved
SELECT * FROM tuttiud.instructor_profiles 
WHERE employee_id = 'instructor-uuid';

-- Verify capabilities were saved
SELECT * FROM tuttiud.instructor_service_capabilities 
WHERE employee_id = 'instructor-uuid';
```

## Performance Testing

### Load Testing
- [ ] Open profile dialog for 10 instructors sequentially
- [ ] Verify no memory leaks
- [ ] Verify no performance degradation

### Service Loading
- [ ] Test with 5 services
- [ ] Test with 20 services
- [ ] Test with 50 services
- [ ] Verify dropdown remains responsive

### Capabilities List
- [ ] Test with 1 capability
- [ ] Test with 5 capabilities
- [ ] Test with 10 capabilities
- [ ] Verify UI remains performant

## Security Testing

### Authorization
- [ ] Non-admin cannot edit profiles
- [ ] Non-admin cannot edit capabilities
- [ ] Admin can edit any instructor
- [ ] Owner can edit any instructor
- [ ] Instructor cannot edit own profile

### Input Validation
- [ ] SQL injection prevented (parameterized queries)
- [ ] XSS prevented (React sanitization)
- [ ] CSRF protected (token required)
- [ ] Invalid data rejected

### Data Validation
- [ ] working_days array validates integers 0-6
- [ ] break_time_minutes validates 0-240
- [ ] max_students validates >= 1
- [ ] base_rate validates >= 0
- [ ] service_id validates UUID format

## Rollback Plan

### If Issues Discovered Post-Deployment

1. **Revert Frontend Changes**:
   ```bash
   git revert <commit-hash>
   npm run build
   # Redeploy frontend
   ```

2. **Revert API Changes**:
   ```bash
   # Revert instructors/index.js PUT handler
   git revert <commit-hash>
   # Redeploy API
   ```

3. **Database Rollback** (if needed):
   ```sql
   -- Drop tables (CAUTION: loses data!)
   DROP TABLE IF EXISTS tuttiud.instructor_service_capabilities;
   DROP TABLE IF EXISTS tuttiud.instructor_profiles;
   ```

4. **Verify GET endpoint still works** (doesn't require overlay tables):
   - Returns instructors with null profile/empty capabilities
   - No breaking changes

## Post-Deployment Verification

### Smoke Tests
- [ ] Profile dialog opens
- [ ] Capabilities dialog opens
- [ ] Can save profile changes
- [ ] Can save capabilities changes
- [ ] Data persists after refresh

### Monitoring
- [ ] Check API logs for errors
- [ ] Check browser console for errors
- [ ] Monitor error rates in production
- [ ] Check database query performance

### User Feedback
- [ ] Collect feedback from admin users
- [ ] Identify pain points
- [ ] Document feature requests
- [ ] Plan improvements

## Documentation

### User Documentation
- [ ] Update user manual with new features
- [ ] Add screenshots of new dialogs
- [ ] Document working days feature
- [ ] Document capabilities feature
- [ ] Publish to help center

### Technical Documentation
- [x] `docs/instructors-overlay-ui-implementation.md` created
- [x] `docs/instructors-ui-button-layout.md` created
- [x] AGENTS.md updated with Reinex pattern
- [ ] API documentation updated
- [ ] Swagger/OpenAPI spec updated (if applicable)

## Sign-Off

### Development Team
- [x] Code complete
- [x] Build successful
- [x] Lint passing
- [ ] Tests passing
- [ ] Documentation complete

### QA Team
- [ ] Functional testing complete
- [ ] Integration testing complete
- [ ] Regression testing complete
- [ ] Performance testing complete
- [ ] Security testing complete

### Product Owner
- [ ] Feature acceptance complete
- [ ] User documentation reviewed
- [ ] Training materials prepared
- [ ] Rollout plan approved

### DevOps Team
- [ ] Database schema deployed
- [ ] API deployed
- [ ] Frontend deployed
- [ ] Monitoring configured
- [ ] Rollback tested

## Go-Live Checklist

### Final Verification
- [ ] All tests passing
- [ ] No critical bugs
- [ ] Performance acceptable
- [ ] Security validated
- [ ] Documentation complete

### Deployment Steps
1. [ ] Deploy database schema (off-peak hours)
2. [ ] Verify schema deployment
3. [ ] Deploy API updates
4. [ ] Verify API deployment
5. [ ] Deploy frontend updates
6. [ ] Verify frontend deployment
7. [ ] Run smoke tests
8. [ ] Monitor for 1 hour
9. [ ] Announce to users

### Post-Deployment
- [ ] Send announcement email
- [ ] Update release notes
- [ ] Close related tickets
- [ ] Archive deployment artifacts
- [ ] Celebrate success! 🎉

## Notes

- **Critical Path**: Database schema must be deployed before API/frontend
- **Rollback Window**: First 24 hours, rollback if error rate > 5%
- **Feature Flag**: Not currently implemented; consider for future releases
- **Monitoring**: Watch for increased API latency on PUT endpoint

## Contact Information

- **Developer**: [Your Name]
- **QA Lead**: [QA Lead Name]
- **Product Owner**: [PO Name]
- **DevOps**: [DevOps Contact]
- **Support**: [Support Contact]

---

**Status**: ✅ Code Complete, ⏳ Testing Pending

**Last Updated**: 2025-01-XX

**Version**: 1.0.0
