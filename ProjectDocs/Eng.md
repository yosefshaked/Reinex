# Project Documentation (English)

## Intake Review Queue Dashboard Enhancements
- Pending intake student rows now show key identifiers (ID, contact name, phone) in a single horizontal row for desktop readability.
- Admins see the assigned instructor label inline with the same row.
- Admins can filter pending intake items by instructor, unassigned, or all.
- Mobile layout wraps the row into stacked pill groups for comfortable scanning.
- The intake queue now renders a collapsed summary header with total pending counts split into new (unassigned) and existing (assigned) students.
- The summary highlights large-number tiles for unassigned vs assigned pending intakes for quick scanning in a scorecard layout sized to a half-page card.
- Clicking the scorecard tiles (or the "Open Queue" action) opens the detailed queue in a modal with the matching filter applied, and the modal provides quick filter buttons for assigned/unassigned/all.
- The summary stays visible with loading, error, and empty states, and exposes a retry action on load failures.
- The "assigned to me" shortcut is shown only for admins who are also instructors (non-admin instructors already see a single combined queue, and non-instructor admins cannot be assigned).
- Admins can assign the intake to an instructor (plus contact details and notes) from the queue modal, which makes the intake visible to the assigned instructor for approval.
- Intake notes for instructors are stored in `Students.metadata.intake_notes` (not the main `notes` field).
- Intake rows show a status badge next to the student name (needs instructor assignment vs ready for approval), and the dismiss action is represented by a trash icon to save space.
- Admins can dismiss an intake submission from the queue modal to remove accidental or duplicate intakes.
- Dismissed intakes are tracked separately from inactive students and can be restored into the queue when needed.
- Dismissed intakes are filtered out of the main students list on the server and are only available through the dedicated dismissed intake endpoint, shown behind a toggle in the intake queue.
- Admins can merge intake submissions into an existing student from the intake queue, choosing field-by-field values to keep.
- The merge flow reattaches intake responses to the target student and preserves any prior target intake payload in metadata.
- The merge dialog resolves instructor names and tag labels using the same catalog used on the student profile, avoiding raw IDs in the comparison view.
- Merging permanently deletes the source student row and stores a full source/target snapshot in `metadata.merge_backup` for recovery audits.
- Intake approvals are now completed by the assigned instructor after the admin assignment step.
- Dashboard quick-action cards for students and new session were removed; use the right-side menu entries for navigation and session creation.
