# API Naming and Route Conventions

Hard rules:
- Do NOT include "reinex" in route names.
- Prefer domain-based nouns.
- Keep routes stable; avoid renames after adoption.

## Suggested MVP route surface
- `GET/POST/PUT /api/students`
- `GET/POST/PUT /api/instructors`
- `GET/POST/PUT /api/lesson-templates`
- `GET/POST/PUT /api/lesson-instances`
- `POST /api/weekly-generation` (dry-run + apply + undo later)
- `GET /api/calendar/day` (day view payload)
- `GET /api/calendar/week` (manager weekly overview payload)
- `GET/POST/PUT /api/commitments`
- `GET/POST /api/consumption`

Notes:
- Existing TutTiud routes present in this repo (e.g., `students-list`, `sessions`, `weekly-compliance`) should be removed or disabled for Reinex MVP to prevent accidental coupling.
- Control-plane endpoints (`/api/user-context`, `/api/org-memberships`, `/api/invitations`, etc.) remain valid and are reusable.
