# 70 Forms And Waiting List

## When to read
- Forms list/builder/rendering work.
- Shared block work.
- Form submission or waiting-list intake/suggestions work.

## Load these files first
- [`../src/features/forms/pages/FormsListPage.jsx`](../src/features/forms/pages/FormsListPage.jsx)
- [`../src/features/forms/pages/FormBuilderPage.jsx`](../src/features/forms/pages/FormBuilderPage.jsx)
- [`../src/features/forms/pages/FormBlocksPage.jsx`](../src/features/forms/pages/FormBlocksPage.jsx)
- [`../src/features/forms/components/SectionedFormRenderer.jsx`](../src/features/forms/components/SectionedFormRenderer.jsx)
- [`../src/features/forms/lib/form-schema.js`](../src/features/forms/lib/form-schema.js)
- [`../src/features/waiting-list/pages/WaitingListPage.jsx`](../src/features/waiting-list/pages/WaitingListPage.jsx)
- [`../api/forms/index.js`](../api/forms/index.js)
- [`../api/form-blocks/index.js`](../api/form-blocks/index.js)
- [`../api/form-submissions/index.js`](../api/form-submissions/index.js)
- [`../api/waiting-list-intake/index.js`](../api/waiting-list-intake/index.js)
- [`../api/waiting-list/index.js`](../api/waiting-list/index.js)
- [`../api/waiting-list-suggestions/index.js`](../api/waiting-list-suggestions/index.js)
- [`../api/_shared/forms-runtime.js`](../api/_shared/forms-runtime.js)
- [`../api/_shared/client-profiles.js`](../api/_shared/client-profiles.js)
- [`../api/_shared/brevo.js`](../api/_shared/brevo.js)

## Shared helpers to reuse
- Builder-side schema helpers in [`../src/features/forms/lib/form-schema.js`](../src/features/forms/lib/form-schema.js)
- Runtime schema helpers in [`../api/_shared/forms-runtime.js`](../api/_shared/forms-runtime.js)
- `resolvePublicFormState`, `prepareAnswersForStorage`, `evaluateAlertFlags`, `materializeSchemaForSnapshot`
- Shared block helpers: `buildSharedBlockMap`, `collectSharedBlockIds`, `resolveSchemaWithSharedBlocks`
- Waiting-list/client-profile helpers in [`../api/_shared/client-profiles.js`](../api/_shared/client-profiles.js)
- `sendBrevoEmail`

## Known patterns / do not reinvent
- Form schemas are normalized both in the builder and in the backend runtime; reuse the existing helper pair instead of inventing a new schema shape.
- Shared blocks are linked explicitly and missing block IDs are treated as real errors.
- Draft and published schemas are separate states inside the form record flow; do not add a parallel publish model.
- Sending flows (`form-submissions` and `waiting-list-intake/send`) must require canonical publish metadata (`metadata.published_form_schema`); legacy `published_at`+draft-schema rows are treated as `form_requires_publish_migration` and are not silently accepted.
- Use `PUT /api/forms/{formId}` with `action: migrate_publish_structure` to migrate legacy-published forms into canonical publish metadata before allowing delivery/invite sends.
- Completed form submissions retain `metadata.schema_snapshot`, `metadata.visibility_rules_snapshot`, and `metadata.alert_rules_snapshot`; submission metadata also stores explicit form/published version stamps (`published_version_at_initiation`, `published_version_at_submission`, etc.) so legacy-version submissions can be filtered without diffing snapshots.
- Deactivated forms (`is_active=false`) are unavailable for new submission initiation, resend, public verify, and final submit. Historical completed submissions remain readable through their stored snapshots.
- Waiting-list intake depends on built-in field IDs and writes into routing/client/guardian flows; keep those identifiers stable.
- Anonymous invite and OTP flows rely on `active_routing` as a generic routing table keyed by route `id` with `category`, `routing_info`, and `expires_at`; do not regress it back to a user-only active-org pointer table.
- Visibility rules and alert rules are runtime-evaluated by shared helpers, not by ad hoc component logic.
- Delivery/status/resend UI should reuse the shared forms-submission tab/component for both students and one-time customers; the canonical selector is `client_profile_id`, with `student_id` only when a real student record exists.
- Waiting-list workflow status meanings: `new` means a new intake/manual lead that has not been checked by staff yet; `open` means staff reviewed it and it is actively being handled; `matched` means it was assigned through scheduling; `closed` means the lead is no longer relevant/interested or otherwise closed. Selecting a `new` entry explicitly in the waiting-list UI auto-marks it `open` after a short review delay, and staff must be able to set it back to `new` when needed.
- Live waiting-list match notices are computed on demand by `GET /api/waiting-list-matches`; do not persist match opportunities. `capacity` mode means filling spare capacity in existing templates, while `clear_space` means finding an empty instructor availability window for a separate template. Actual assignment must still go through `POST /api/lesson-templates` with `waiting_list_entry_id`, where the backend creates/links a student before marking the waiting entry `matched`.
