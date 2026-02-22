# Environments

## Target environments
- Dev
- Prod

## Staging (recommended)
Staging is strongly recommended once we start changing scheduling logic and tenant schema, because it lets you validate:
- schema changes are idempotent and safe
- weekly generation logic does not create duplicates
- role boundaries (instructor vs admin) are enforced correctly
- release candidates behave correctly with real Supabase + Azure Functions

Practical handling:
- Separate Azure Static Web App environment (or separate SWA) with its own Supabase tenant project for a test org.
- Same control DB can be used, but ideally with a dedicated staging organization to avoid mixing real data.

If you want to stay with only Dev + Prod initially:
- We will treat Dev as “staging-like” and enforce extra discipline: feature flags, backup before migrations, and explicit release checklists.
