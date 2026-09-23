import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from fates import classify
from independence import duplicates, effective_n
from lookahead import LookAheadError, assert_no_lookahead, at_or_before
from seal import SealError, seal, verify

RULE = "CORRECT iff balance(t1) >= balance(t0)"


# --- seal ------------------------------------------------------------------

def test_seal_then_verify_passes_on_the_same_text():
    s = seal("r1", RULE, outcomes_present=0)
    verify(s, "r1", RULE)


def test_seal_refuses_once_outcomes_exist():
    """The whole point: a rule sealed after outcomes can't prove it didn't fit them."""
    with pytest.raises(SealError, match="already resolved"):
        seal("r1", RULE, outcomes_present=1)


def test_verify_refuses_an_edited_rule():
    s = seal("r1", RULE, outcomes_present=0)
    with pytest.raises(SealError, match="no longer matches"):
        verify(s, "r1", RULE + " ")          # one trailing space is an edit


def test_verify_refuses_a_different_rule_id():
    s = seal("r1", RULE, outcomes_present=0)
    with pytest.raises(SealError, match="new journal action"):
        verify(s, "r2", RULE)


def test_seal_refuses_an_empty_rule():
    with pytest.raises(SealError, match="empty"):
        seal("r1", "  ", outcomes_present=0)


# --- fates -----------------------------------------------------------------

def _read_ok():
    return (100, 120)


def _judge(a, b):
    return b >= a


def test_resolves_when_mature_and_readable():
    f = classify(0, 10, now=20, head_time=20, read=_read_ok, judge=_judge)
    assert f.kind == "resolved" and f.correct is True and f.writes


def test_immature_by_wall_clock_does_not_write_or_read():
    calls = []
    f = classify(0, 10, now=5, head_time=99, read=lambda: calls.append(1), judge=_judge)
    assert f.kind == "immature" and not f.writes
    assert calls == [], "an immature decision must cost zero reads"


def test_immature_by_lagging_source_head_even_when_wall_clock_says_mature():
    calls = []
    f = classify(0, 10, now=99, head_time=5, read=lambda: calls.append(1), judge=_judge)
    assert f.kind == "immature" and not f.writes
    assert calls == []


def test_unreadable_is_NEVER_resolved_as_wrong():
    """Resolving it as wrong couples calibration to infrastructure uptime."""
    def boom():
        raise ConnectionError("archive node down")
    f = classify(0, 10, now=20, head_time=20, read=boom, judge=_judge)
    assert f.kind == "unreadable"
    assert f.correct is None
    assert not f.writes
    assert "archive" in f.reason


def test_unreadable_has_a_reason_even_for_a_bare_exception():
    def boom():
        raise RuntimeError()
    assert classify(0, 10, now=20, head_time=20, read=boom, judge=_judge).reason == "RuntimeError"


def test_exactly_at_maturity_resolves():
    f = classify(0, 10, now=10, head_time=10, read=_read_ok, judge=_judge)
    assert f.kind == "resolved"


# --- look-ahead ------------------------------------------------------------

def test_between_points_returns_the_EARLIER_one():
    """'Nearest' to 17 is 20 -- observed after the decision. Must return 10."""
    assert at_or_before([0, 10, 20, 30], 17) == 1


def test_exact_match_returns_that_point():
    assert at_or_before([0, 10, 20], 20) == 2


def test_past_the_end_returns_the_last():
    assert at_or_before([0, 10], 999) == 1


def test_before_the_first_refuses():
    with pytest.raises(LookAheadError, match="precedes"):
        at_or_before([10, 20], 5)


def test_unsorted_input_is_refused():
    with pytest.raises(LookAheadError, match="sorted"):
        at_or_before([0, 20, 10], 15)


def test_assert_no_lookahead_catches_a_future_baseline():
    assert_no_lookahead(observed_at=5, decided_at=5)
    with pytest.raises(LookAheadError, match="leaked"):
        assert_no_lookahead(observed_at=6, decided_at=5)


# --- independence ----------------------------------------------------------

def test_duplicates_finds_a_re_observed_subject_case_insensitively():
    assert duplicates(["0xAB", "0xab", "0xcd"]) == {"0xab": 2}


def test_effective_n_counts_independent_subjects_not_rows():
    """20 decisions about one whale are one prediction observed 20 times."""
    assert effective_n(["0xa"] * 20 + ["0xb"]) == 2


def test_no_duplicates_in_a_clean_journal():
    assert duplicates(["0xa", "0xb"]) == {}
