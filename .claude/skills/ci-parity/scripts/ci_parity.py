"""Run a GitHub Actions workflow's own `run:` steps locally, in order.

Why this exists (Hydra PR #5, 2026-09-24): the local check was
`pnpm -s typecheck 2>&1 | tail -3`. It printed nothing, the push went out, and
CI's `npx tsc --noEmit --project tsconfig.base.json` failed on three
`noUncheckedIndexedAccess` errors. Three separate things hid the failure:
`-s` silenced the parallel `pnpm -r` child output, `| tail` threw away the
exit code, and "typecheck" was a paraphrase of CI's command, not CI's command.

The fix is not "be more careful". Do not paraphrase CI: read the workflow and
run exactly its commands, with the same shell flags, and stop on the first
failure.

    python3 ci_parity.py .github/workflows/test.yml            # run
    python3 ci_parity.py .github/workflows/test.yml --list     # show the plan
    python3 ci_parity.py wf.yml --matrix python-version=3.12   # fill ${{ matrix.* }}

Handled:
  - `run: |`, `run: >` and single-line `run:` values
  - `id:` plus $GITHUB_OUTPUT, so `${{ steps.<id>.outputs.<k> }}` resolves as in CI
  - `${{ matrix.<k> }}` from --matrix
  - `$RUNNER_TEMP` and `$GITHUB_OUTPUT` point at a scratch directory

Not handled, and reported as SKIP (never silently dropped):
  - steps with `if:`, and `uses:` actions (checkout, setup-node, ...)
  - any other `${{ ... }}` expression
  - any step that runs `git push`, unless --allow-push: a workflow that
    commits to main (Hydra's paper-run.yml does) must not do it from a laptop

Standard library only. No YAML dependency: it reads the step shapes that
workflows actually use, and it is tested against them.
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field

__all__ = ["Step", "parse_steps", "substitute", "main"]

EXPR = re.compile(r"\$\{\{\s*([^}]*?)\s*\}\}")
PUSH = re.compile(r"\bgit\s+push\b")


@dataclass
class Step:
    name: str = ""
    id: str = ""
    run: str | None = None
    uses: str | None = None
    condition: str | None = None
    job: str = ""
    extra: dict = field(default_factory=dict)


def _indent(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def _scalar(v: str) -> str:
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
        return v[1:-1]
    return v


def parse_steps(text: str) -> list[Step]:
    """Every step under every job's `steps:`, in file order."""
    lines = text.splitlines()
    steps: list[Step] = []
    job = ""
    jobs_indent = job_level = -1
    in_steps = False
    steps_indent = -1
    cur: Step | None = None
    item_indent = -1
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            i += 1
            continue
        ind = _indent(line)
        if in_steps and ind <= steps_indent and not stripped.startswith("-"):
            in_steps = False
            cur = None
        # A job header is a key at the FIRST indent level under `jobs:`.
        # Anything deeper (strategy:, matrix:, env:) is not a job.
        if stripped == "jobs:":
            jobs_indent, job_level = ind, -1
            i += 1
            continue
        m_job = re.match(r"^(\s*)([A-Za-z0-9_-]+):\s*$", line)
        if jobs_indent >= 0 and not in_steps and ind > jobs_indent:
            if job_level < 0:
                job_level = ind
            if m_job and ind == job_level:
                job = m_job.group(2)
        elif jobs_indent >= 0 and ind <= jobs_indent:
            jobs_indent = -1
        if stripped == "steps:":
            in_steps, steps_indent, cur = True, ind, None
            i += 1
            continue
        if not in_steps:
            i += 1
            continue
        if stripped.startswith("- "):
            cur = Step(job=job)
            steps.append(cur)
            item_indent = ind
            key_line = " " * (ind + 2) + stripped[2:]
            lines[i] = key_line
            continue  # re-read the same line as a key of the new item
        if cur is None:
            i += 1
            continue
        m = re.match(r"^\s*([A-Za-z_-]+):\s*(.*)$", line)
        if not m or ind <= item_indent:
            i += 1
            continue
        key, val = m.group(1), m.group(2)
        if val.strip() in ("|", ">", "|-", ">-", "|+", ">+"):
            folded = val.strip().startswith(">")
            body: list[str] = []
            j = i + 1
            block_indent = None
            while j < len(lines):
                nxt = lines[j]
                if nxt.strip() == "":
                    body.append("")
                    j += 1
                    continue
                ni = _indent(nxt)
                if ni <= ind:
                    break
                block_indent = ni if block_indent is None else min(block_indent, ni)
                body.append(nxt)
                j += 1
            while body and body[-1] == "":
                body.pop()
            bi = block_indent or 0
            body = [b[bi:] if b else b for b in body]
            value = (" ".join(b for b in body if b) if folded else "\n".join(body))
            i = j
        else:
            value = _scalar(val)
            i += 1
        if key == "run":
            cur.run = value
        elif key == "uses":
            cur.uses = value
        elif key == "name":
            cur.name = value
        elif key == "id":
            cur.id = value
        elif key == "if":
            cur.condition = value
        else:
            cur.extra[key] = value
    return steps


def substitute(cmd: str, outputs: dict[str, dict[str, str]], matrix: dict[str, str]) -> tuple[str, list[str]]:
    """Resolve ${{ steps.X.outputs.Y }} and ${{ matrix.K }}. Returns (cmd, unresolved)."""
    unresolved: list[str] = []

    def rep(m: re.Match[str]) -> str:
        expr = m.group(1)
        sm = re.fullmatch(r"steps\.([A-Za-z0-9_-]+)\.outputs\.([A-Za-z0-9_-]+)", expr)
        if sm and sm.group(2) in outputs.get(sm.group(1), {}):
            return outputs[sm.group(1)][sm.group(2)]
        mm = re.fullmatch(r"matrix\.([A-Za-z0-9_-]+)", expr)
        if mm and mm.group(1) in matrix:
            return matrix[mm.group(1)]
        unresolved.append(expr)
        return m.group(0)

    return EXPR.sub(rep, cmd), unresolved


def _read_outputs(path: str) -> dict[str, str]:
    out: dict[str, str] = {}
    try:
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                if "=" in line:
                    k, v = line.rstrip("\n").split("=", 1)
                    out[k] = v
    except FileNotFoundError:
        pass
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("workflow")
    ap.add_argument("--list", action="store_true", help="print the plan, run nothing")
    ap.add_argument("--matrix", action="append", default=[], metavar="K=V")
    ap.add_argument("--job", default=None, help="only this job")
    ap.add_argument("--keep-going", action="store_true")
    ap.add_argument("--allow-push", action="store_true",
                    help="run steps that `git push` (off by default)")
    args = ap.parse_args(argv)

    with open(args.workflow, encoding="utf-8") as fh:
        steps = parse_steps(fh.read())
    if args.job:
        steps = [s for s in steps if s.job == args.job]
    matrix = dict(kv.split("=", 1) for kv in args.matrix)
    if not steps:
        print("ci-parity: no steps found -- refusing to report a pass on nothing", file=sys.stderr)
        return 2

    scratch = tempfile.mkdtemp(prefix="ci-parity-")
    env = dict(os.environ, RUNNER_TEMP=scratch, CI="true")
    outputs: dict[str, dict[str, str]] = {}
    ran = failed = 0
    for n, s in enumerate(steps, 1):
        label = s.name or s.uses or (s.run or "").splitlines()[0][:60]
        if s.run is None:
            print(f"SKIP  {n:>2} {label}  (uses: action)")
            continue
        if s.condition:
            print(f"SKIP  {n:>2} {label}  (if: {s.condition})")
            continue
        if PUSH.search(s.run) and not args.allow_push:
            print(f"SKIP  {n:>2} {label}  (git push; pass --allow-push to run it)")
            continue
        cmd, unresolved = substitute(s.run, outputs, matrix)
        if args.list and unresolved and all(u.startswith("steps.") for u in unresolved):
            print(f"RUN   {n:>2} {label}  (uses earlier step outputs)")
            continue
        if unresolved:
            print(f"SKIP  {n:>2} {label}  (unresolved: {', '.join(unresolved)})")
            continue
        if args.list:
            print(f"RUN   {n:>2} {label}")
            continue
        out_file = os.path.join(scratch, f"output-{n}")
        open(out_file, "w").close()
        r = subprocess.run(["bash", "-e", "-c", cmd], env=dict(env, GITHUB_OUTPUT=out_file))
        ran += 1
        if s.id:
            outputs[s.id] = _read_outputs(out_file)
        if r.returncode != 0:
            failed += 1
            print(f"FAIL  {n:>2} {label}  (exit {r.returncode})")
            if not args.keep_going:
                break
        else:
            print(f"PASS  {n:>2} {label}")
    if args.list:
        return 0
    print(f"ci-parity: {ran} run, {failed} failed")
    if ran == 0:
        print("ci-parity: nothing ran -- that is not a pass", file=sys.stderr)
        return 2
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
