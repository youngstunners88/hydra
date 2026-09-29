import json
import math
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import grade as g  # noqa: E402


def journal(tmp_path, rows):
    """rows: (id, action, wallet, p, outcome-or-None)"""
    p = tmp_path / "j.jsonl"
    with open(p, "w") as fh:
        for rid, action, w, conf, _ in rows:
            fh.write(json.dumps({"kind": "decision", "record": {"id": rid, "action": action,
                     "answer": f"{w}:watchlisted->trusted", "confidence": conf, "outcome": None}}) + "\n")
        for rid, _, _, _, out in rows:
            if out is not None:
                fh.write(json.dumps({"kind": "outcome", "id": rid, "outcome": out, "outcomeAt": 1}) + "\n")
    return str(p)


def test_hydra_replay_keeps_arms_apart_and_drops_unresolved(tmp_path):
    d = g.load_hydra(journal(tmp_path, [
        ("d1", "wallet_promotion@single", "0xa", 0.2, True),
        ("d2", "wallet_promotion@permuted", "0xa", 0.3, True),
        ("d3", "wallet_promotion@single", "0xb", 0.9, None),
        ("d4", "wallet_promotion", "0xc", 0.9, True),          # legacy, no arm
    ]))
    assert d == {"single": {"0xa": (0.2, 1)}, "permuted": {"0xa": (0.3, 1)}}


def test_duplicate_unit_in_one_arm_raises(tmp_path):
    with pytest.raises(ValueError, match="twice"):
        g.load_hydra(journal(tmp_path, [
            ("d1", "wallet_promotion@single", "0xa", 0.2, True),
            ("d2", "wallet_promotion@single", "0xa", 0.4, False)]))


def test_outcome_for_unknown_decision_raises(tmp_path):
    p = tmp_path / "j.jsonl"
    p.write_text(json.dumps({"kind": "outcome", "id": "zz", "outcome": True, "outcomeAt": 1}) + "\n")
    with pytest.raises(ValueError, match="unknown decision"):
        g.load_hydra(str(p))


def test_align_uses_only_units_in_every_arm_and_checks_outcomes():
    data = {"a": {"u1": (0.9, 1), "u2": (0.1, 0)}, "b": {"u1": (0.5, 1), "u3": (0.5, 0)}}
    units, ps, ys = g.align(data, ["a", "b"])
    assert units == ["u1"] and ys == [1] and ps == {"a": [0.9], "b": [0.5]}
    with pytest.raises(ValueError, match="disagree"):
        g.align({"a": {"u": (0.5, 1)}, "b": {"u": (0.5, 0)}}, ["a", "b"])
    with pytest.raises(ValueError, match="no resolved rows"):
        g.align(data, ["a", "zzz"])


def test_brier_nll_and_the_coin():
    assert g.brier([0.5] * 4, [1, 0, 1, 0]) == 0.25
    assert math.isclose(g.nll([0.5, 0.5], [1, 0]), math.log(2))
    assert g.nll([0.0], [1]) < 14                     # clipped, finite


def test_wilson_matches_known_value():
    lo, hi = g.wilson(48, 83)
    assert abs(lo - 0.471) < 0.002 and abs(hi - 0.679) < 0.002


def test_ece_zero_when_calibrated_and_large_when_biased():
    ys = [1] * 7 + [0] * 3
    assert g.ece([0.7] * 10, ys) < 1e-9
    assert g.ece([0.2] * 10, ys) == pytest.approx(0.5)


def test_paired_bootstrap_is_seeded_and_signed():
    ys = [1, 0] * 50
    good = [0.8 if y else 0.2 for y in ys]
    bad = [0.5] * 100
    d, lo, hi = g.paired_diff(bad, good, ys)
    assert d > 0 and lo > 0                           # positive favours the second arm
    assert g.paired_diff(bad, good, ys) == (d, lo, hi)  # deterministic


def test_report_flags_worse_than_coin_and_labels_itself_exploratory():
    data = {"sharp": {f"u{i}": (0.1, 1) for i in range(10)},
            "fair": {f"u{i}": (0.9, 1) for i in range(10)}}
    out = g.report(data, ["sharp", "fair"], ("sharp", "fair"))
    first = out.splitlines()[0]
    assert first.startswith("EXPLORATORY -- no verdict")
    assert "WORSE THAN A COIN (Brier >= 0.25): sharp" in out
    assert "OPTIMISTIC" in out
    assert "favours fair" in out


def test_cli_refuses_bad_compare(tmp_path, capsys):
    rows = tmp_path / "r.jsonl"
    rows.write_text("\n".join(json.dumps({"arm": a, "unit": "u", "p": 0.5, "y": 1}) for a in "ab"))
    assert g.main(["--jsonl", str(rows), "--arms", "a,b", "--compare", "a,c"]) == 2
    assert g.main(["--jsonl", str(rows), "--arms", "a,b"]) == 0
