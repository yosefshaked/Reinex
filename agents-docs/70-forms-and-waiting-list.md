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
- Waiting-list intake depends on built-in field IDs and writes into routing/client/guardian flows; keep those identifiers stable.
- Visibility rules and alert rules are runtime-evaluated by shared helpers, not by ad hoc component logic.
