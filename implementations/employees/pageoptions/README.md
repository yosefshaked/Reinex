# Employees UI Directions

This folder contains static HTML mockups for a future employee-management rebuild.

## Files

- `index.html`
  Overview page linking to the three directions.
- `option-a-directory-workspace.html`
  Recommended default: directory on the left, employee workspace on the right.
- `option-b-operations-board.html`
  More operational: stronger daily actions, leaves, communication, and reporting emphasis.
- `option-c-profile-hub.html`
  Profile-first: best if the employee page should feel like an HR file with operations attached.
- `option-d-reinex-hybrid-workspace.html`
  Hybrid direction: Option A information architecture with Option C visual tone.

## Recommended Direction

`option-a-directory-workspace.html`

Why:

- Best balance between quick navigation and deep management
- Supports both instructors and office employees without feeling like two different products
- Easy place to grow future sections:
  - financial reports
  - accountant export
  - leaves
  - scheduled/completed instances
  - communication

## Features Worth Adding Beyond The Initial List

- User linkage status
  - linked user / manual employee / invitation pending
- Role and permissions surface
  - instructor / office / admin-support tags
- Emergency contact and internal notes
- Documents and certifications
  - contract, NDA, certifications, doctor note, identity
- Availability and weekly working pattern
  - especially important for instructors
- Audit trail
  - who changed what and when
- Payroll/export status
  - last accountant export, pending exceptions
- Communication history
  - last WhatsApp / email / call note
- Leave balances and approvals
  - not only leave requests
- Performance and operational KPIs
  - completed lessons, cancellations, no-show handling

## Design Principle

The page should not be "just a list of employees".

It should feel like:

- a searchable organization roster
- a person workspace
- an operations cockpit

That is why all three proposals separate:

1. roster navigation
2. employee identity and status
3. operational actions
4. historical data
5. future finance/reporting surface

## Hybrid Recommendation

If the final choice is between A and C, the most likely best production result is:

- structure from A
- visual tone from C

That hybrid is represented in:

- `option-d-reinex-hybrid-workspace.html`
