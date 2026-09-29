import os
import sys

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))

import ci_parity as cp  # noqa: E402

WF = """\
name: test
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        py: ["3.11", "3.12"]
    steps:
      - uses: actions/checkout@v4
        with:
          ref: main
      - name: Single line
        run: echo one
      # a comment between steps
      - name: Literal block
        run: |
          set -euo pipefail
          echo two
          echo three
      - name: Folded
        run: >
          echo folded
          words
      - name: Find
        id: find
        run: |
          echo "files=a b c" >> "$GITHUB_OUTPUT"
      - name: Guarded
        if: steps.find.outputs.files == ''
        run: exit 1
      - name: Use output
        run: test "${{ steps.find.outputs.files }}" = "a b c"
      - name: Matrix
        run: test "${{ matrix.py }}" = "3.12"
      - name: Commit
        run: |
          git add x
          git push
  other:
    runs-on: ubuntu-latest
    steps:
      - name: In other job
        run: echo other
"""


def write(tmp_path, text):
    p = tmp_path / "wf.yml"
    p.write_text(text)
    return str(p)


def test_parses_every_step_shape_in_order():
    steps = cp.parse_steps(WF)
    names = [s.name or s.uses for s in steps]
    assert names == ["actions/checkout@v4", "Single line", "Literal block", "Folded", "Find",
                     "Guarded", "Use output", "Matrix", "Commit", "In other job"]
    assert steps[1].run == "echo one"
    assert steps[2].run == "set -euo pipefail\necho two\necho three"
    assert steps[3].run == "echo folded words"
    assert steps[4].id == "find"
    assert steps[5].condition == "steps.find.outputs.files == ''"
    assert [s.job for s in steps] == ["test"] * 9 + ["other"]


def test_substitute_resolves_outputs_and_matrix_and_reports_the_rest():
    cmd, unresolved = cp.substitute(
        "x ${{ steps.find.outputs.files }} ${{ matrix.py }} ${{ github.sha }}",
        {"find": {"files": "a b"}}, {"py": "3.12"})
    assert cmd.startswith("x a b 3.12 ")
    assert unresolved == ["github.sha"]


def test_full_run_passes_and_skips_push_if_and_uses(tmp_path, capsys):
    rc = cp.main([write(tmp_path, WF), "--matrix", "py=3.12"])
    out = capsys.readouterr().out
    assert rc == 0, out
    assert "SKIP   9 Commit  (git push" in out
    assert "SKIP   6 Guarded  (if:" in out
    assert "SKIP   1 actions/checkout@v4  (uses: action)" in out
    assert "PASS   7 Use output" in out          # GITHUB_OUTPUT chained through
    assert "ci-parity: 7 run, 0 failed" in out


def test_unfilled_matrix_is_a_skip_not_a_guess(tmp_path, capsys):
    cp.main([write(tmp_path, WF)])
    assert "SKIP   8 Matrix  (unresolved: matrix.py)" in capsys.readouterr().out


def test_stops_at_first_failure_with_exit_1(tmp_path, capsys):
    wf = WF.replace("run: echo one", "run: exit 3")
    rc = cp.main([write(tmp_path, wf), "--matrix", "py=3.12"])
    out = capsys.readouterr().out
    assert rc == 1
    assert "FAIL   2 Single line  (exit 3)" in out
    assert "Literal block" not in out            # stopped


def test_keep_going_runs_the_rest(tmp_path, capsys):
    wf = WF.replace("run: echo one", "run: exit 3")
    rc = cp.main([write(tmp_path, wf), "--matrix", "py=3.12", "--keep-going"])
    out = capsys.readouterr().out
    assert rc == 1 and "PASS   3 Literal block" in out and "1 failed" in out


def test_pipefail_inside_the_step_is_honoured(tmp_path, capsys):
    # The Hydra #5 shape: a failing command piped into tail. With the step's
    # own `set -o pipefail` the failure must surface, not vanish into tail.
    wf = WF.replace("echo two\n", "false | tail -1\n")
    rc = cp.main([write(tmp_path, wf), "--matrix", "py=3.12"])
    assert rc == 1 and "FAIL   3 Literal block" in capsys.readouterr().out


def test_nothing_to_run_is_exit_2_not_a_pass(tmp_path):
    only_uses = "jobs:\n  t:\n    steps:\n      - uses: actions/checkout@v4\n"
    assert cp.main([write(tmp_path, only_uses)]) == 2
    assert cp.main([write(tmp_path, "name: empty\n")]) == 2


def test_job_filter(tmp_path, capsys):
    rc = cp.main([write(tmp_path, WF), "--job", "other"])
    out = capsys.readouterr().out
    assert rc == 0 and "In other job" in out and "Single line" not in out


def test_list_runs_nothing(tmp_path, capsys):
    marker = tmp_path / "ran"
    wf = WF.replace("run: echo one", f"run: touch {marker}")
    assert cp.main([write(tmp_path, wf), "--list"]) == 0
    assert not marker.exists()
    assert "RUN    7 Use output  (uses earlier step outputs)" in capsys.readouterr().out
