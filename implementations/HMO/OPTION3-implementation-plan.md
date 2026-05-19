# HMO Option 3 Implementation

## Summary
- HMO handling is now modeled as:
  - `hmo_providers`
  - `hmo_provider_tracks`
  - `hmo_authorizations`
- HMO commitments remain inside `commitments`, but they are system-managed artifacts derived from authorizations.
- Provider setup is shared between the Finance page and the Settings page.
- Student billing no longer creates HMO commitments manually. It creates or edits HMO authorizations, and the linked commitment is updated automatically.

## Business Model
- `hmo_providers` is the organization-wide master list of funding bodies.
- `hmo_provider_tracks` stores reusable billing behavior under each provider.
- `hmo_authorizations` stores the student-specific operational approval for a service.
- Only one active authorization is allowed per `student + service`.
- HMO billing resolution order is:
  1. authorization override
  2. provider track default
  3. fallback zero

## Data Flow
- Admin configures providers and tracks from Finance or Settings.
- Admin creates a student authorization from the student billing screen.
- Backend ensures a linked `commitment_type='hmo'` commitment exists for that authorization.
- Lesson billing sync auto-links the active HMO authorization commitment when a lesson becomes chargeable.
- CSV month-end export uses charged lessons whose HMO context is resolved from authorization-backed commitments.

## Schema
- New tables:
  - `hmo_providers`
  - `hmo_provider_tracks`
  - `hmo_authorizations`
- `commitments` now includes:
  - `hmo_provider_id`
  - `hmo_provider_track_id`
  - `hmo_authorization_id`
- `setup-sql.js` backfills:
  - legacy `Settings.medical_providers`
  - `students.medical_provider`
  - legacy HMO commitments with metadata

## API Contract
- `GET /api/settings/medical-providers`
  - returns providers with embedded tracks
- `POST|PUT|DELETE /api/settings/medical-providers`
  - manages providers and tracks
- `GET /api/hmo-authorizations`
  - lists authorizations, optionally by student
- `POST /api/hmo-authorizations`
  - creates authorization and linked HMO commitment
- `PUT /api/hmo-authorizations`
  - updates authorization and linked HMO commitment
- `DELETE /api/hmo-authorizations`
  - cancels authorization and deactivates the linked HMO commitment

## UI Flow
- Finance page:
  - top settings button opens billing policy + HMO provider/track management
  - month-end HMO CSV export remains on the finance toolbar
- Settings page:
  - dedicated entry opens the same billing/HMO settings workspace
- Student billing:
  - package/subscription/custom balance stay in generic commitments
  - HMO has a dedicated authorization manager
  - linked HMO commitment is shown as system-managed

## Migration / Compatibility
- Legacy medical-provider settings are seeded into `hmo_providers`.
- Legacy student profile provider values are remapped to the new provider IDs.
- Legacy HMO commitments are backfilled to provider, track, and authorization rows.
- Historical billed lessons keep their existing `pricing_breakdown`.
- New HMO writes use only the new provider/track/authorization path.

## Acceptance Criteria
- Provider and track setup works from both Finance and Settings.
- Student profile provider selection still works.
- Creating an authorization creates or updates the linked HMO commitment.
- Only one active authorization can exist per student-service.
- Lesson billing resolves from the linked authorization path.
- Month-end export shows authorization-backed HMO lessons in Israel-local time.
