---
name: ci-parity
description: |
  Run CI's own commands locally before every push. Do not run your paraphrase
  of them. Load before pushing to any repo with a .github/workflows file, and
  whenever a push turned CI red.

  Built from Hydra PR #5 (2026-09-24). The local check printed nothing and
  the push failed CI on three type errors, for three separate reasons: `-s`
  silenced the output, `| tail` dropped the exit code, and "typecheck" was not
  CI's typecheck command. ci_parity.py, run on that commit, fails it with
  exit 1.
allowed-tools: Bash Read
usage: |
  python3 10-Skills/ci-parity/scripts/ci_parity.py .github/workflows/test.yml --list
  python3 10-Skills/ci-parity/scripts/ci_parity.py .github/workflows/test.yml
  python3 10-Skills/ci-parity/scripts/ci_parity.py wf.yml --matrix python-version=3.12
  python3 -m pytest 10-Skills/ci-parity/tests -q
---

# CI parity

## The rule

**Before a push, run the workflow's own `run:` steps, in order, and stop at the
first failure.** Do not run what you remember them to be.

```bash
python3 10-Skills/ci-parity/scripts/ci_parity.py .github/workflows/test.yml
```

Exit 0 means every runnable step passed. Exit 1 means a step failed; its output
is above the FAIL line. Exit 2 means nothing ran, and that is never a pass.

## Why each part is there

| Mechanism | The failure it prevents |
|---|---|
| Reads the YAML; commands are never retyped | "typecheck" ran `pnpm -r typecheck`. CI ran `npx tsc --project tsconfig.base.json`. The two diverged. |
| Each step runs with `bash -e`, as GitHub does; a step's own `set -o pipefail` is honoured | `cmd \| tail -3` makes the pipeline's exit code tail's exit code, which is 0 |
| Full output, never `-s` or `--silent` | `pnpm -s -r` hid the parallel children's errors completely |
| `id:` plus `$GITHUB_OUTPUT` chained between steps | Without it, "Run tests" (which uses `${{ steps.find.outputs.files }}`) would be skipped: the step that matters most |
| Exit 2 when zero steps ran | A green result on nothing is worse than no check |
| `git push` steps skipped unless `--allow-push` | Hydra's `paper-run.yml` and tradecc's `pumpfun-clock.yml` commit to main. A local run must not do that. |

## What it does not do

Each of these is printed as **SKIP** with the reason, never dropped silently:

- `uses:` actions (checkout, setup-node, ...). You own the toolchain versions:
  when CI pins Node 22 and 24, the test is on whichever you have installed.
- Steps with `if:`. The guards those steps implement, such as "fail if no
  tests found", are still covered: exit 2 above does the same job.
- Any `${{ }}` expression other than step outputs and `--matrix`.

## Scope

- **Target the test workflow**, not the cron ones. `pumpfun-clock.yml` has a
  `Poll` step that appends to the local clock log. Run `--list` first on any
  workflow you have not run before.
- `--job NAME` limits the run to one job.
- It takes a few seconds on these repos. That is the cost of not paying one
  red CI cycle and one lost reviewer's trust per mistake.

## Checklist before any push

1. `ci_parity.py <the workflow that runs on push>`, and get exit 0.
2. If you changed a guard, also mutation-check it. See `measure-first`.
3. Re-read your diff for anything the workflow does not exercise.

## See also

- `measure-first`: mutation-verify every guard, and the stale-bytecode trap.
- `paper-clock`: why scheduled workflows are not a parity target.
