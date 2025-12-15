# Loose Reports Feature - Pre-Deployment Checklist

**Feature:** Loose Reports (Unassigned Session Reports)  
**Target:** Production deployment to Azure Functions  
**Date:** December 9, 2025  

---

## Phase 1: Code Review ✅ COMPLETE

- [x] Backend API endpoint reviewed (`/api/loose-sessions`)
- [x] All error paths return proper Azure responses (`context.res` set)
- [x] Authorization logic verified (admin-only mutations, instructor filtering)
- [x] Frontend components reviewed for completeness
- [x] API client parameters verified (national_id fix applied)
- [x] Error mapping comprehensive (25 error codes mapped)
- [x] ESLint validation passed (0 errors, 0 warnings)
- [x] Production build succeeds
- [x] Security audit completed

---

## Phase 2: Infrastructure Requirements

### Database Schema ✅ REQUIRED
- [ ] Control Database:
  - [ ] `audit_log` table exists with helper functions
  - [ ] Run: `scripts/control-db-audit-log.sql`
  
- [ ] Tenant Database:
  - [ ] `SessionRecords` table has nullable `student_id` column
  - [ ] `Students` table unchanged (standard schema)
  - [ ] RLS policies allow authenticated access

### Environment Variables ✅ REQUIRED
- [ ] Azure Key Vault configured with:
  - [ ] `APP_SUPABASE_URL` - Tenant Supabase URL
  - [ ] `APP_SUPABASE_SERVICE_ROLE_KEY` - Service role key for tenant
  - [ ] Both variables accessible to `/api/loose-sessions` function

### Azure Functions ✅ REQUIRED
- [ ] Function app created: `tuttiud-loose-sessions` (or similar)
- [ ] Runtime: Node.js 20 LTS
- [ ] Memory: 1GB (minimum)
- [ ] Timeout: 60 seconds (default, may need increase for bulk operations)
- [ ] CORS configured for frontend domain
- [ ] Logging configured (Application Insights or equivalent)

---

## Phase 3: Feature Deployment Checklist

### Backend API Deployment
- [ ] `/api/loose-sessions/index.js` deployed
- [ ] `/api/loose-sessions/function.json` configured
- [ ] Endpoint accessible at: `https://<function-app>/api/loose-sessions`
- [ ] Health check: Send GET request with valid bearer token
- [ ] Expected response: 200 with array of pending reports (or empty array if none)

### Frontend Deployment
- [ ] `src/features/sessions/api/loose-sessions.js` included in build
- [ ] `src/features/sessions/pages/PendingReportsPage.jsx` included in build
- [ ] `src/features/sessions/components/*.jsx` (all loose reports components) included
- [ ] `src/lib/error-mapping.js` with all error codes deployed
- [ ] Build artifact generated: `/dist/assets/*.js`
- [ ] Static files deployed to Azure Static Web Apps

---

## Phase 4: Integration Testing

### Admin Workflow
- [ ] **Test 1: Single Report Assignment**
  - [ ] Admin navigates to Pending Reports page
  - [ ] Selects one report
  - [ ] Clicks "Resolve" → Dialog opens
  - [ ] Searches for existing student
  - [ ] Selects student and submits
  - [ ] Success toast appears
  - [ ] Report disappears from list
  - [ ] Verify audit log entry created

- [ ] **Test 2: Bulk Report Assignment**
  - [ ] Admin selects multiple reports (2-5)
  - [ ] Clicks "Bulk Resolve"
  - [ ] Chooses "Assign to existing student"
  - [ ] Selects target student
  - [ ] Clicks "Assign X reports"
  - [ ] Success toast shows count
  - [ ] All reports marked as assigned
  - [ ] Verify audit log entries created

- [ ] **Test 3: Create and Assign**
  - [ ] Admin selects one report
  - [ ] Clicks "Bulk Resolve" (or individual resolve)
  - [ ] Chooses "Create new student"
  - [ ] Fills form: name, national_id, instructor, service, etc.
  - [ ] Submits form
  - [ ] New student created (check database)
  - [ ] Report assigned to new student
  - [ ] Success toast displays
  - [ ] Verify both audit entries created (student + session)

- [ ] **Test 4: Report Rejection**
  - [ ] Admin selects report
  - [ ] Clicks "Reject"
  - [ ] Selects reason from dropdown (or "Other" + custom)
  - [ ] Clicks "Reject"
  - [ ] Toast confirms rejection
  - [ ] Report disappears from list
  - [ ] Verify session marked deleted with rejection metadata

### Instructor Workflow
- [ ] **Test 5: View Own Reports**
  - [ ] Instructor logs in and navigates to My Students
  - [ ] Sees "הדיווחים הממתינים שלי" button with count badge
  - [ ] Clicks button → Modal opens
  - [ ] Shows pending reports (read-only)
  - [ ] Shows recently resolved reports
  - [ ] No edit/delete/reject buttons visible
  - [ ] Modal closes properly on ESC or close button

### Session Creation
- [ ] **Test 6: Regular Session (No Time Field)**
  - [ ] Instructor starts new session form
  - [ ] Time field NOT visible on form
  - [ ] Submits session without time value
  - [ ] Session created successfully
  - [ ] Time stored as NULL in database

- [ ] **Test 7: Loose Report (Time Field Required)**
  - [ ] Opens new session form
  - [ ] Enables loose mode checkbox
  - [ ] Time field becomes VISIBLE
  - [ ] Attempts to submit without time
  - [ ] Form blocks submission (visual feedback)
  - [ ] Enters time (e.g., 14:30)
  - [ ] Submits form
  - [ ] Loose report created with time, name, reason, etc.
  - [ ] Time stored in database

### Error Scenarios
- [ ] **Test 8: Error Messages**
  - [ ] Attempt duplicate national_id → Hebrew error message appears
  - [ ] Attempt to assign to non-existent student → Error message
  - [ ] Attempt to reject without reason → Form blocks submission
  - [ ] Attempt non-admin operation as instructor → 403 error
  - [ ] Send invalid bearer token → 401 error
  - [ ] All errors display in Hebrew with actionable guidance

---

## Phase 5: Performance & Load Testing

- [ ] **Bulk Operation Performance**
  - [ ] Test bulk reject of 10 reports → Should complete in < 5 seconds
  - [ ] Test bulk assign of 50 reports → Should complete in < 30 seconds
  - [ ] Monitor function execution time in Application Insights
  - [ ] Verify no timeout errors (default 60s should be sufficient)

- [ ] **Concurrent Requests**
  - [ ] Simulate 5 admins resolving reports simultaneously
  - [ ] Verify no data corruption or race conditions
  - [ ] All operations complete successfully

- [ ] **Database Query Performance**
  - [ ] List 1000 pending reports → Should load in < 1 second
  - [ ] Search/filter across 1000 reports → Should filter in < 500ms
  - [ ] Verify indexes exist on `student_id`, `deleted`, `instructor_id`

---

## Phase 6: Security Verification

- [ ] **Authentication**
  - [ ] All API requests require bearer token
  - [ ] Invalid token returns 401
  - [ ] Expired token returns 401
  - [ ] No token returns 401

- [ ] **Authorization**
  - [ ] Non-admin user cannot POST to loose-sessions
  - [ ] Instructor can only see their own reports (not other instructors')
  - [ ] Admin can see all reports regardless of instructor

- [ ] **Data Validation**
  - [ ] Invalid UUID for session_id returns 400
  - [ ] Missing required fields return 400
  - [ ] Request body > 64KB logged as warning (observe mode)
  - [ ] National_id duplicates detected before insert

- [ ] **Audit Logging**
  - [ ] All mutations create audit log entries
  - [ ] Audit entries include user_id, user_email, user_role
  - [ ] Audit entries include action type, resource type, details
  - [ ] Rejection reasons stored in audit metadata
  - [ ] No audit log entries missing or corrupted

---

## Phase 7: Monitoring & Alerting

### Application Insights Setup
- [ ] Endpoint: `/api/loose-sessions`
- [ ] Alert on:
  - [ ] 5XX errors (> 1 in 5 minutes)
  - [ ] High latency (> 5 seconds)
  - [ ] Auth failures (> 10 in 5 minutes)
  - [ ] Audit log failures (indicates potential compliance issue)

### Log Queries to Create
- [ ] ```
  traces
  | where message contains "loose-sessions"
  | where severityLevel >= 2 // Errors and above
  | summarize count() by severityLevel, message
  ```

- [ ] ```
  customMetrics
  | where name == "loose-sessions-bulk-operation-duration"
  | summarize avg(value), max(value) by tostring(customDimensions.operation_type)
  ```

---

## Phase 8: Documentation Review

- [ ] [ ] User documentation created for:
  - [ ] Admin pending reports workflow
  - [ ] Bulk operations
  - [ ] Error messages and recovery
  - [ ] Instructor self-view instructions

- [ ] [ ] Technical documentation includes:
  - [ ] API endpoint specification
  - [ ] Error code reference
  - [ ] Audit logging details
  - [ ] Troubleshooting guide

- [ ] [ ] Team training completed:
  - [ ] Admins trained on resolution workflows
  - [ ] Support team trained on common errors
  - [ ] DBAs trained on monitoring queries

---

## Phase 9: Backup & Rollback Plan

- [ ] **Backup Strategy**
  - [ ] Database backup before deployment
  - [ ] Application state snapshot taken
  - [ ] Backup location: `<location>`
  - [ ] Restore time estimate: `<time>`

- [ ] **Rollback Procedure**
  - [ ] Previous API version available: `<version>`
  - [ ] Previous frontend build available: `<version>`
  - [ ] Rollback procedure documented
  - [ ] Rollback time estimate: `<time>`

- [ ] **Communication Plan**
  - [ ] Stakeholder notification template created
  - [ ] Success notification ready
  - [ ] Incident notification template ready

---

## Phase 10: Final Go/No-Go Decision

### Sign-Off Checklist
- [ ] Code review: ✅ APPROVED
- [ ] Security review: ✅ APPROVED
- [ ] Performance testing: ✅ PASSED
- [ ] Integration testing: ✅ PASSED
- [ ] Database schema: ✅ READY
- [ ] Environment variables: ✅ CONFIGURED
- [ ] Monitoring: ✅ CONFIGURED
- [ ] Documentation: ✅ COMPLETE
- [ ] Team training: ✅ COMPLETE
- [ ] Backup & rollback: ✅ READY

### Go/No-Go Decision
- [ ] **GO** - Proceed with production deployment
- [ ] **NO-GO** - Hold deployment, address issues:
  - Issue #1: `_________________________`
  - Issue #2: `_________________________`

**Decision Made By:** `_________________________`  
**Decision Date:** `_________________________`

---

## Phase 11: Post-Deployment Monitoring (First 24 Hours)

### Hourly Checks
- [ ] 1 hour: Check error rate (should be < 1%)
- [ ] 2 hours: Verify audit logs being created
- [ ] 4 hours: Check performance metrics (latency < 2s)
- [ ] 8 hours: Review user feedback (support tickets)
- [ ] 24 hours: Generate deployment report

### Success Criteria
- ✅ Zero critical errors
- ✅ Error rate < 1%
- ✅ Average latency < 1 second
- ✅ Audit logging 100% successful
- ✅ User workflow tests pass
- ✅ No data corruption

---

## Contact & Escalation

**Feature Owner:** `_________________________`  
**Tech Lead:** `_________________________`  
**DevOps Lead:** `_________________________`  
**Database Admin:** `_________________________`  
**On-Call Support:** `_________________________`

---

## Sign-Off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| QA Lead | `________` | `________` | `________` |
| Tech Lead | `________` | `________` | `________` |
| Product Manager | `________` | `________` | `________` |
| DevOps Lead | `________` | `________` | `________` |

---

**Deployment Status:** [ ] Ready to Deploy [ ] Hold [ ] Deploy

**Notes:**
```
_________________________________________________________________
_________________________________________________________________
_________________________________________________________________
```

---

**Document Last Updated:** December 9, 2025  
**Version:** 1.0 - Initial Release
