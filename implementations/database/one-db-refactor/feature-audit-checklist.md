# Feature Audit Checklist

- [ ] Core: Auth & Org Selection: Login, MFA, switching orgs, and verifying x-org-id is in the header.
- [ ] Core: System Admin Console: Health checks, Sanity checks, and MFA enrollment.
- [ ] Module: Clients & Students: Create/Read/Update/Delete (CRUD). Critical: Verify org_id in DB for every insert.
- [ ] Module: Calendar: Generating lesson instances, updating attendance. Critical: Check cross-org isolation on schedule views.
- [ ] Module: Finance: Ledger entry creation, balance recalculation, billing sync. Critical: Ensure no cross-tenant balance leaking.
- [ ] Module: Forms: Public submissions via waiting-list-intake and OTP flows.
