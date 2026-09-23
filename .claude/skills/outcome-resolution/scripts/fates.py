"""Three fates, and why unknown is never wrong.

Resolving an unreadable decision as incorrect couples calibration to
infrastructure uptime. A bad afternoon at the data provider becomes a worse
Brier score and nothing reports why.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

__all__ = ["Fate", "classify"]


@dataclass(frozen=True)
class Fate:
    kind: str                  # "resolved" | "immature" | "unreadable"
    correct: bool | None = None
    reason: str = ""

    @property
    def writes(self) -> bool:
        """Only a resolved fate may write. The other two stay pending."""
        return self.kind == "resolved"


def classify(
    decided_at: float,
    horizon: float,
    now: float,
    head_time: float,
    read: Callable[[], tuple[object, object]],
    judge: Callable[[object, object], bool],
) -> Fate:
    """Decide the fate of ONE pending prediction.

    Two maturity checks: wall clock first (costs nothing), then the data
    source's own head, which can lag wall time. `read` is only called once
    both pass, so an immature decision costs zero reads.
    """
    matures = decided_at + horizon
    if matures > now:
        return Fate("immature", reason=f"matures at {matures}")
    if matures > head_time:
        return Fate("immature", reason=f"source head {head_time} behind {matures}")
    try:
        before, after = read()
    except Exception as e:  # noqa: BLE001 -- ANY read failure is unreadable
        return Fate("unreadable", reason=str(e) or type(e).__name__)
    return Fate("resolved", correct=bool(judge(before, after)))
