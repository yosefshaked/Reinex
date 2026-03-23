# Employee Leave Ledger Reference Review

## Purpose
This note records the first implementation step of the employees-page leave redesign: review reusable ideas from the older employee-management project without copying its backend model blindly into Reinex.

## Verified External Findings
- Repository reviewed: [yosefshaked/Employee-Management](https://github.com/yosefshaked/Employee-Management)
- Verified source available during implementation: the repository README
- Verified behavior from the README:
  - The employees page leave area is informational, not the mutation surface
  - Leave creation is handled in a dedicated operational flow
  - Leave mutations are synchronized into a `LeaveBalances` ledger tied to another operational record

## Reinex Constraints
- Tenant schema is `public`
- Control DB remains shared with TutTiud
- Routes must stay domain-based
- Reinex already contains legacy `WorkSessions` and `LeaveBalances` tables in [setup-sql.js](/C:/dev/Reinex/src/lib/setup-sql.js)
- Reinex also contains an explicit warning that legacy selector-based leave/payroll access was retired in [selectors.js](/C:/dev/Reinex/src/lib/selectors.js)

## Patterns Reused
- Separate leave policy/config from operational balances/history
- Keep the employees page read-oriented for leave data
- Use a dedicated leave read API for the employee page instead of overloading `/api/instructors`
- Treat ledger entries as a distinct domain object that can be inspected independently from the employee row

## Patterns Rejected
- Do not port the old `WorkSessions` coupling as-is
- Do not present any derived remaining-balance number as authoritative before Reinex leave semantics are fully reviewed
- Do not assume the old repo's schema, routes, or delete/restore rules map directly to Reinex
- Do not reintroduce deprecated selector usage

## Current Reinex Implementation Decision
- New read-only endpoint: `/api/employee-leave`
- Immediate UI usage:
  - read employee leave policy from `Employees`
  - read legacy `LeaveBalances` entries if they exist
  - expose ledger status as `legacy` or `unavailable`
  - avoid rendering authoritative remaining balances in the employees page

## Follow-Up
- Review the old project's `api/leave-balances/index.js` directly when accessible
- Decide whether Reinex should:
  - normalize around the existing `LeaveBalances` table
  - replace it with a new ledger model
  - or bridge it through a SessionRecords-compatible layer
