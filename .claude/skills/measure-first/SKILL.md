---
name: measure-first
description: |
  The session protocol for this vault. Load it at the START of every session
  and before any build decision.

  Rule: before building anything non-trivial, run the cheapest experiment that
  could falsify the plan — with the prediction written down FIRST.

  Two standing instructions from the user, in force every session:
  LOW VERBOSITY — report only what is necessary, no repetition or elaboration.
  END EVERY SESSION with the recommended prompt for the NEXT build.

  Jev chose this over three alternatives at 0.92 (margin 0.84), judged against
  this project's own record of what actually went wrong.
allowed-tools: Bash Read
usage: |
  python3 -m pytest 10-Skills/measure-first/tests -q

# Measure first

## Why this rule and not a different one

Four experiments have been run in this vault. **Three of four pre-registered
predictions were falsified:**

| Prediction | Reality |
|---|---|
| A cleaner, less cluttered prompt will beat the messy one | **12 points worse** |
| The vendor oversold batching latency | **1.05×** — they were right |
| Accuracy will collapse across 255 options | **fell 2.4 points** |
| Evidence in option descriptions beats bare names | held: 59% → 86% |

None of those three was careless. All were reasoned about carefully, and the
reasoning read well. The common factor is that **reasoning about behaviour was
substituted for probing it** — and each probe cost under a cent and a few
minutes.

That is the entire case for this protocol. It is not a philosophy; it is this
project's measured failure mode.

## The protocol

1. **State the decision** you are about to make.
2. **Write the prediction down and seal it** — `Registry.seal(name, claim, decide)`.
   The decision rule is sealed *with* the claim. A rule chosen after seeing the
   number is a rationalisation.
3. **Find the cheapest falsifying test.** Usually a live call, a binary search,
   or a mutation. Budget: minutes and cents.
4. **Run it. Grade it.** `grade()` refuses to score anything not sealed first.
5. **Record the falsification in the artifact**, not just the chat. Struck-through
   or labelled, never deleted.
6. **Before pushing, run CI's own commands** (`ci-parity`), not your
   paraphrase of them.
7. **Mutation-verify any guard you ship**: break the control, confirm the named
   test fails. Purge `__pycache__` first — a same-length edit inside one mtime
   second leaves stale bytecode valid and the mutant never runs.

## Binding code to a seal (Hydra noul-retention-v2, 2026-09-24)

A seal on text is worthless if the code can drift from the text. Four mechanics:

1. **Seal in a commit of its own, before the wiring.** The seal JSON holds
   `sha256` over its text and `paired_resolved_at_seal: 0`. Wiring comes in the
   next commit. Merge with a **merge commit, not a squash**: a squash folds the
   seal and the wiring into one commit and erases the proof of order.
2. **A test asserts the code's constants appear verbatim in the sealed text.**
   That covers the question wording, the constant arm's value and the action
   names. Rewording the question in code then fails CI, instead of silently
   running a different experiment under the old name.
3. **Mutation-check the grader.** Drop each clause of the sealed prediction in
   turn (e.g. "AND beats the constant"), and drop the all-arms pairing. Each
   mutant must fail a named test. v2's grader: 3 of 3 caught.
4. **Leave the old experiment's inputs byte-identical.** v2's question went in
   a separate request so v1's sealed request did not change. Adding a question
   to v1's request would have altered v1 mid-flight, whatever the vendor says
   about the questions being independent.

## Checks the code enforces

- Grading an unsealed claim **raises**.
- Re-sealing a name **raises** — "editing a prediction after sealing is how a
  falsification becomes a success story."
- Re-grading **raises** — moving the goalposts.
- Sealed-but-never-graded is **surfaced**, so an experiment that quietly died
  does not read as clean.
- **Zero falsifications is flagged as suspicious**, not celebrated: all-green
  usually means the predictions were safe, not that you were right.

## Known failure modes of the tests themselves

Both found here, both twice-bitten:

- **Stale bytecode masking mutants.** Same-length edit, same mtime second, `.pyc`
  still valid. Reported a coverage gap that did not exist. Purge between runs.
- **A test that exercises only one of two conditions.** Setting the other
  threshold to zero makes the test assert the right verdict for the wrong
  reason. Happened twice in one PR. Pin each condition separately, and add the
  "tolerance is not a free pass" case.

## What this replaces

Nothing is banned. But **"this reads better" is not evidence**, and neither is
"the vendor would say that." Both have been wrong here, in writing, with the
receipt committed.

---

## Standing instructions from the user

These are not suggestions and they do not expire with the session.

### 1. Low verbosity

Report only what is necessary. No restating the request, no narrating steps
already visible in the tool calls, no repeating a finding in prose that a table
already carries. The user is token-sensitive and has said so more than once.

What survives the cut: the verdict, the number behind it, anything falsified,
and anything that would change what gets built next. What does not: preamble,
recap, and any sentence whose removal loses no information.

**Terse is not the same as vague.** Cutting the number instead of the padding
is the failure mode to avoid. "It works" is shorter than the measurement and
worth much less.

### 2. End every session with the next build's prompt

The last thing in every session is a prompt the user can paste to start the
next one. Not a summary of what happened — a *runnable instruction* for what
comes next.

It must carry what a cold session cannot reconstruct:

- **State**: what is built, what is green, what commit and PR it sits on.
- **The blocker**: what is actually in the way, named specifically.
- **The next measurement**: what to falsify, and the pre-registered prediction,
  because a prompt that says "keep building" invites building the wrong thing.
- **The constraints still in force**: the seven trading rules, paper-only until
  the gate passes, no key material in any repo.

Write it as an instruction addressed to the next session, in a fenced block so
it can be copied whole.
