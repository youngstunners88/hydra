from __future__ import annotations
import sys
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from prereg import Outcome, PreregError, Registry  # noqa: E402


def test_grading_an_unsealed_claim_raises():
    """The whole point: a hypothesis formed after seeing the result is not one."""
    with pytest.raises(PreregError, match="never sealed"):
        Registry().grade("nope", 1.0)


def test_a_sealed_prediction_can_be_graded_held():
    reg = Registry()
    reg.seal("p1", "latency ratio exceeds 1.5", lambda x: x > 1.5)
    assert reg.grade("p1", 2.0).outcome is Outcome.HELD


def test_a_sealed_prediction_can_be_falsified():
    """The real case: I predicted 1.5x, measured 1.05x."""
    reg = Registry()
    reg.seal("p1", "latency ratio exceeds 1.5", lambda x: x > 1.5)
    r = reg.grade("p1", 1.05)
    assert r.outcome is Outcome.FALSIFIED
    assert reg.falsified == [r]


def test_resealing_the_same_name_is_refused():
    reg = Registry()
    reg.seal("p1", "a", lambda x: True)
    with pytest.raises(PreregError, match="falsification becomes a success story"):
        reg.seal("p1", "b", lambda x: True)


def test_regrading_is_refused():
    reg = Registry()
    reg.seal("p1", "a", lambda x: x > 0)
    reg.grade("p1", 1)
    with pytest.raises(PreregError, match="moving the goalposts"):
        reg.grade("p1", -1)


def test_an_empty_claim_is_refused():
    with pytest.raises(PreregError, match="wrong about"):
        Registry().seal("p1", "   ", lambda x: True)


def test_sealed_but_never_graded_is_surfaced():
    """An experiment that quietly did not finish must not read as clean."""
    reg = Registry()
    reg.seal("p1", "a", lambda x: True)
    assert reg.ungraded() == ["p1"]
    assert "UNGRADED" in reg.report()


def test_a_run_with_no_predictions_says_it_proves_nothing():
    assert "proves nothing" in Registry().report()


def test_zero_falsifications_is_flagged_as_suspicious():
    """All-green predictions usually means they were safe, not that you were right."""
    reg = Registry()
    reg.seal("p1", "positive", lambda x: x > 0)
    reg.grade("p1", 5)
    assert "trivially safe" in reg.report()


def test_the_seal_is_stable_and_content_addressed():
    reg = Registry()
    p = reg.seal("p1", "some claim", lambda x: True)
    assert len(p.seal) == 16
    reg2 = Registry()
    assert reg2.seal("p1", "some claim", lambda x: True).seal == p.seal


def test_report_names_falsifications_as_the_yield():
    reg = Registry()
    reg.seal("p1", "x>10", lambda x: x > 10)
    reg.grade("p1", 1)
    assert "Falsifications are the yield" in reg.report()


def test_json_export_round_trips():
    import json
    reg = Registry()
    reg.seal("p1", "x>10", lambda x: x > 10)
    reg.grade("p1", 1, note="measured")
    rows = json.loads(reg.to_json())
    assert rows[0]["outcome"] == "falsified"
    assert rows[0]["claim"] == "x>10"
