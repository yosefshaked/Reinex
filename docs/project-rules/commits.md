# Commits

The commit policy for every development agent and person working in Reinex.

## When to read
- Before you commit.

## Format
- Messages follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) and are written in English.
- **Why:** one shape lets a reader scan history by kind and area, and revert or review one unit at a time.

## Title
`<type>(<scope>): <description>`

- **Type:** one of `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `build`, `ci`, `perf`, `style`, `revert`.
- **Scope:** optional. Add it when it helps to identify the area. Scopes in use include `payroll`, `leave`, `calendar`, `billing`, `tests`, `plans`, `db`, `api`, `docs`, `lint`.
- **Description:** short, and starts with a verb in the imperative ("add", "fix", "move"), not "added" or "fixes".

## Body
- Explain why the change was made, or what follows from it, when that is not clear from the title and the diff.
- Otherwise leave the body out.

## One logical change per commit
A commit can be reviewed and reverted as one unit.
- **Belongs together:** moving `test/` to `tests/` together with updating its npm scripts, the ESLint config and the ignore rules. Without those updates the move alone breaks the build.
- **Separate commits:** adding new tests to cover a missing scenario is its own change, not part of the move.

## Examples
- `docs(plans): add repository restructure plan`
- `refactor(tests): move shared tests to tests/`
- `fix(payroll): use the rate effective on the lesson date`

## Out of scope
- The language you use in conversation is a personal preference. It is not part of this policy.
- This policy says nothing about attribution trailers such as `Co-authored-by`. Keep the existing attribution settings.

## History
The policy applies from its adoption (2026-11-24). Earlier commits are not rewritten.
