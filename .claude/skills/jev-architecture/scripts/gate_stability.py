"""Is this gate a decision or a coin flip?

Measured 2026-09-23: three identical Jev calls returned confidence 0.62, 0.74
and 0.67. A 0.7 gate on that question passes on some calls and fails on
others -- the verdict depends on which call you happened to make.

Give it a threshold and repeated confidences for the SAME input. It reports
the pass rate. Between LOW and HIGH (default 10%-90%), the gate is unstable:
move the threshold away from where the answers cluster, or treat the band as
UNDECIDED on purpose.

Usage: python3 gate_stability.py <threshold> <sample> <sample> ...
"""
from __future__ import annotations

import statistics
import sys
from dataclasses import dataclass

__all__ = ["GateStability", "stability", "MIN_SAMPLES"]

# Fewer than this and a pass rate of 0% or 100% is not evidence of stability.
MIN_SAMPLES = 3


@dataclass(frozen=True)
class GateStability:
    threshold: float
    n: int
    pass_rate: float
    mean: float
    spread: float
    unstable: bool

    def summary(self) -> str:
        verdict = "UNSTABLE (coin-flip gate)" if self.unstable else "stable"
        return (f"threshold {self.threshold}: passes {self.pass_rate:.0%} of {self.n} "
                f"identical calls (mean {self.mean:.3f}, spread {self.spread:.3f}) -> {verdict}")


def stability(threshold: float, samples: list[float], *, low: float = 0.1,
              high: float = 0.9) -> GateStability:
    if len(samples) < MIN_SAMPLES:
        raise ValueError(
            f"{len(samples)} sample(s); need at least {MIN_SAMPLES}. One call cannot "
            "show that a gate is stable -- it always looks decisive."
        )
    if not all(0.0 <= s <= 1.0 for s in samples):
        raise ValueError("confidences must be in [0, 1]")
    rate = sum(1 for s in samples if s >= threshold) / len(samples)
    return GateStability(
        threshold=threshold, n=len(samples), pass_rate=rate,
        mean=statistics.fmean(samples), spread=max(samples) - min(samples),
        unstable=low < rate < high,
    )


if __name__ == "__main__":
    if len(sys.argv) < 2 + MIN_SAMPLES:
        sys.exit(__doc__)
    r = stability(float(sys.argv[1]), [float(x) for x in sys.argv[2:]])
    print(r.summary())
    sys.exit(1 if r.unstable else 0)
