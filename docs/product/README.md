# Product rules and decisions

What Reinex must do for the business, and why. A **product rule** stays true even if the code is rewritten; how the code does it belongs in [`../project-rules/`](../project-rules/), and the evidence behind a rule (law, measurements, sources) in [`../research/`](../research/).

**One file per domain:** [`payroll.md`](payroll.md) (pay and leave). Every domain file has the same parts:

- **Rules**, one row each: `ID · rule · why · status · tests`.
  - `status` is read from the tests: **built** (a real test proves it), **partly built** (a real test proves part, an `it.todo` names the rest) or **not built** (only `it.todo`).
  - An ID never changes or moves to another rule. A retired rule keeps its row with the reason.
- **Decisions**, one row each: `ID · decision · date · source · verified by`. A decision explains why a rule is what it is. `source` is where the owner said it (an issue, a plan, a review); `verified by` is the code or test that shows it is applied.
- **Needs confirmation:** a rule or decision that has no owner source yet, or that contradicts another source. **It is not binding.** Until the owner decides, an agent asks before changing behaviour that depends on it, and does not build or remove it silently.

**When the product changes:** change the rule, the decision table and the tests in the same change. A rule written here without a test is "not built", never "built".

**Adding a domain** (the order: billing and HMO, calendar, students and clients, forms, settings):

1. Read the domain's file in `../project-rules/` and its specs in `implementations/`.
2. Extract the rules that are true for the business; leave function names and file paths in `project-rules`.
3. Give each rule an ID with a domain prefix, and link the tests that prove it (`git grep` the behaviour in `tests/` and `api/**/*.test.js`).
4. Write each owner decision with its date and source; anything without one goes under "Needs confirmation".
5. Shrink the `project-rules` file to development content, linking here.
