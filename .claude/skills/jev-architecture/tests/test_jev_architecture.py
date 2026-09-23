import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from gate_stability import MIN_SAMPLES, stability
from layers import check


def repo(tmp_path, files):
    for rel, body in files.items():
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body)
    return tmp_path


# --- layers: TypeScript -----------------------------------------------------

def test_ts_allowed_scoped_import_passes(tmp_path):
    r = repo(tmp_path, {"packages/hunter/src/a.ts": 'import { x } from "@hydra/core";'})
    assert check(r, {"hunter": ["core"], "core": []}) == []


def test_ts_forbidden_scoped_import_is_flagged(tmp_path):
    r = repo(tmp_path, {"packages/hunter/src/a.ts": 'import { x } from "@hydra/exec";',
                        "packages/exec/src/b.ts": ""})
    v = check(r, {"hunter": ["core"]})
    assert [(x.source, x.target) for x in v] == [("hunter", "exec")]


def test_ts_relative_climb_into_another_package_is_flagged(tmp_path):
    """The form that slips past review."""
    r = repo(tmp_path, {"packages/hunter/src/deep/a.ts": 'import { x } from "../../../exec/src/y.ts";',
                        "packages/exec/src/y.ts": ""})
    assert [(x.target) for x in check(r, {"hunter": []})] == ["exec"]


def test_ts_type_imports_and_reexports_are_edges(tmp_path):
    r = repo(tmp_path, {"packages/hunter/src/a.ts": 'import type { X } from "@hydra/exec";\nexport * from "@hydra/exec";',
                        "packages/exec/src/b.ts": ""})
    assert len(check(r, {"hunter": []})) == 2


def test_deny_by_default_for_an_unlisted_package(tmp_path):
    r = repo(tmp_path, {"packages/newpkg/src/a.ts": 'import { x } from "@hydra/core";',
                        "packages/core/src/c.ts": ""})
    assert len(check(r, {"core": []})) == 1


def test_tests_directories_are_not_checked(tmp_path):
    r = repo(tmp_path, {"packages/hunter/tests/a.ts": 'import { x } from "@hydra/exec";',
                        "packages/exec/src/b.ts": ""})
    assert check(r, {"hunter": []}) == []


# --- layers: Python -----------------------------------------------------------

def test_py_absolute_import_of_a_sibling_package_is_flagged(tmp_path):
    r = repo(tmp_path, {"packages/hunter/a.py": "from exec.orders import send\n",
                        "packages/exec/orders.py": ""})
    assert [x.target for x in check(r, {"hunter": []})] == ["exec"]


def test_py_relative_climb_is_flagged(tmp_path):
    r = repo(tmp_path, {"packages/hunter/sub/a.py": "from ...exec import orders\n",
                        "packages/exec/orders.py": ""})
    assert [x.target for x in check(r, {"hunter": []})] == ["exec"]


def test_py_stdlib_and_third_party_are_ignored(tmp_path):
    r = repo(tmp_path, {"packages/hunter/a.py": "import json\nfrom pathlib import Path\nimport requests\n"})
    assert check(r, {"hunter": []}) == []


def test_py_same_package_relative_import_is_fine(tmp_path):
    r = repo(tmp_path, {"packages/hunter/a.py": "from .b import x\n", "packages/hunter/b.py": ""})
    assert check(r, {"hunter": []}) == []


# --- gate stability -------------------------------------------------------------

def test_the_measured_jev_samples_make_a_0_7_gate_a_coin_flip():
    """Real numbers, 2026-09-23: three identical calls."""
    r = stability(0.7, [0.62, 0.74, 0.67])
    assert r.unstable is True
    assert r.pass_rate == pytest.approx(1 / 3)


def test_a_threshold_below_the_cluster_is_stable():
    assert stability(0.5, [0.62, 0.74, 0.67]).unstable is False


def test_a_threshold_above_the_cluster_is_stable():
    assert stability(0.9, [0.62, 0.74, 0.67]).unstable is False


def test_refuses_too_few_samples():
    """One call always looks decisive."""
    with pytest.raises(ValueError, match="at least"):
        stability(0.7, [0.62] * (MIN_SAMPLES - 1))


def test_refuses_out_of_range_confidence():
    with pytest.raises(ValueError):
        stability(0.7, [0.6, 0.7, 1.2])


def test_threshold_is_inclusive():
    assert stability(0.7, [0.7, 0.7, 0.7]).pass_rate == 1.0
