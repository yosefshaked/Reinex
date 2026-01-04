# Reinex Docs (English)

This folder is the canonical documentation location for the Reinex repository.

Guiding rules:
- Reinex uses tenant `public` schema only.
- Reinex must not modify TutTiud production behavior. This repo can diverge freely.
- API routes must be domain-based (do not prefix routes with "reinex").
- Control DB is shared with TutTiud (organizations, memberships, auth).

Start here:
- MVP scope and acceptance: [MVP.md](MVP.md)
- Environments (dev/prod + staging recommendation): [ENVIRONMENTS.md](ENVIRONMENTS.md)
- API naming + route conventions: [API-NAMING.md](API-NAMING.md)
- Tenant DB schema notes + collision rules: [DB-NOTES.md](DB-NOTES.md)
