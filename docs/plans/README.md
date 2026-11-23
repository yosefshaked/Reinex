# Plans

Work plans for Reinex: what we intend to build or change, in what order, and the evidence that each step was done.

- **Where a plan lives.** A plan is a `.md` file directly under a topic folder: `docs/plans/<topic>/<plan>.md`, for example `repository/directory-restructure.md`.
  - A topic folder is created when the first plan for it is written.
  - A plan that crosses domains lives under the topic that leads the change.
  - Supporting files (mockups, data) go in `docs/plans/<topic>/<plan>/` and are not registered.
- **The path never changes.** A plan stays where it is when its status changes.
- **Status lives only in [`index.csv`](index.csv).**
  - Columns are `path,title,status`, and `path` is relative to `docs/plans/`.
  - `status` is one of `planned`, `active`, `completed`, `canceled`.
  - Standard CSV quoting applies: wrap a field that contains a comma, a double quote or a line break in double quotes, and write an inner double quote twice.
  - Change a plan's status in `index.csv`, not in the plan.
- **Inside a plan, keep:**
  - a short "Resume here" block at the top: current stage, next subtask, blockers;
  - subtasks as checkboxes, ticked with their evidence;
  - a Progress log, with one entry per step: date, commit, checks run, gaps;
  - open questions, each with its answer written under it when it is decided.
- **Check:** `npm run lint:plans`. It verifies that every plan has exactly one row, every row points to an existing plan, and every status is valid.
