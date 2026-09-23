"""At-or-before lookup, and the invariant that makes it safe.

"Nearest" can return a point observed AFTER the decision, which leaks the
future into the baseline. Always the latest point at or before.
"""
from __future__ import annotations

from bisect import bisect_right
from typing import Sequence

__all__ = ["LookAheadError", "at_or_before", "assert_no_lookahead"]


class LookAheadError(RuntimeError):
    pass


def at_or_before(times: Sequence[float], t: float) -> int:
    """Index of the latest element of sorted `times` that is <= t."""
    if not times:
        raise LookAheadError("no observations to look up")
    if any(b < a for a, b in zip(times, times[1:])):
        raise LookAheadError("times must be sorted ascending")
    i = bisect_right(times, t) - 1
    if i < 0:
        raise LookAheadError(f"{t} precedes the first observation {times[0]}")
    return i


def assert_no_lookahead(observed_at: float, decided_at: float) -> None:
    if observed_at > decided_at:
        raise LookAheadError(
            f"baseline observed at {observed_at}, after the decision at "
            f"{decided_at}: the future has leaked into the baseline"
        )
