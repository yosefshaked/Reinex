# Research

Conclusions worth finding again: law, external sources, measurements, and code read at length. Not a place for transcripts, drafts or task logs.

## Write it down only when
- the question is likely to come back, AND
- the answer took real effort (external sources, measurement, reading a lot of code), AND
- it is not a decision. A decision goes to [`../product/`](../product/) (business) or [`../project-rules/`](../project-rules/) (development), and links here as its evidence.

Otherwise summarise the finding in the PR, the issue or the plan's Progress log, and stop.

## Find before you write
1. `git grep -i -l "<two or three topic words>" -- docs/` (research, product, plans).
2. **A document on the same topic or decision exists → update it.** A new sub-question is a new section in that document, not a new file.
3. **Open a new document only** for a different topic or a different decision, and link the two.
4. One document per topic. Never "-v2", "-final" or dated copies of the same topic.

## File
`docs/research/<topic>.md`, kebab-case, no date in the name (dates are inside).

## Shape
```markdown
# <Topic, or the decision being researched>
Status: current | adopted into <link> | superseded by <link>
Updated: YYYY-MM-DD

## <Sub-question, as a question>
**Conclusion:** 1-5 lines a reader can act on.
**Evidence:** sources (link + date read), files and commits checked, numbers measured.
**Limits:** what was not checked, assumptions, who must confirm (e.g. the accountant).

(repeat per sub-question)

## Changes
- YYYY-MM-DD: what changed and why.
```

## Where the conclusion and the decision go
- **The conclusion** lives here, under its sub-question, with its evidence and limits.
- **The decision taken because of it** lives in `../product/` (a product decision, with its date and source) or `../project-rules/` (a development rule). It links back here as its evidence. This document then says `Status: adopted into <link>`, and from then on the rule is the truth; this document is only its evidence.
- **Not decided yet:** the domain file in `../product/` lists it under "Needs confirmation", linking here.

## When things change
- **New evidence changes a conclusion:** edit the conclusion in place and add a line under Changes. If the old conclusion had been adopted, update the rule in the same change.
- **Outdated** (the code, the law or the business moved on): set `Status: superseded by <link>`, or delete the document when nothing links to it. Git history keeps it. A wrong document is worse than none.

There is no index: it would go stale, and `git grep` covers search. One document per topic is what prevents overlap.
