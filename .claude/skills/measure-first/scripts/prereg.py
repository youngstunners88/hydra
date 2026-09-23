"""Pre-registration: write the prediction down before you can see the result.

Institutionalised because this project's record demands it. THREE confident,
carefully-reasoned predictions have been falsified here:

  1. A cleaner, less cluttered prompt would beat the messy one.  -> 12 points WORSE.
  2. The vendor oversold batching latency.                       -> 1.05x. They were right.
  3. Accuracy would collapse across 255 options.                 -> fell 2.4 points.

Each was caught by an experiment costing under a cent and a few minutes. Each
would otherwise have shipped as a design decision. The common factor is not
carelessness -- all three were reasoned about carefully. The common factor is
that reasoning about behaviour was substituted for probing it.

The mechanism here is deliberately small: a Prediction is SEALED before the run
and cannot be edited afterwards. The value is not the object; it is that
`grade()` refuses to score a hypothesis that was not written down first.
"""
from __future__ import annotations
import hashlib, json, time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable

__all__ = ["Outcome", "Prediction", "PreregError", "Registry"]


class PreregError(RuntimeError):
    pass


class Outcome(str, Enum):
    HELD = "held"
    FALSIFIED = "falsified"
    INCONCLUSIVE = "inconclusive"


@dataclass(frozen=True)
class Prediction:
    """A falsifiable claim plus the rule that decides it, sealed together.

    `decide` must be supplied at construction. A rule chosen after seeing the
    number is not a decision rule, it is a rationalisation, and keeping them in
    one frozen object is what stops the two being separated.
    """
    name: str
    claim: str
    decide: Callable[[Any], bool]
    sealed_at: float = field(default_factory=time.time)

    @property
    def seal(self) -> str:
        return hashlib.sha256(f"{self.name}|{self.claim}".encode()).hexdigest()[:16]


@dataclass
class Result:
    prediction: Prediction
    outcome: Outcome
    observed: Any
    note: str = ""


class Registry:
    """Seal predictions, then grade them. Grading an unsealed claim raises."""

    def __init__(self) -> None:
        self._sealed: dict[str, Prediction] = {}
        self.results: list[Result] = []
        self._graded: set[str] = set()

    def seal(self, name: str, claim: str, decide: Callable[[Any], bool]) -> Prediction:
        if name in self._sealed:
            raise PreregError(
                f"{name!r} is already sealed. Editing a prediction after sealing "
                "is how a falsification becomes a success story."
            )
        if not claim.strip():
            raise PreregError("a prediction needs a claim you could be wrong about")
        p = Prediction(name=name, claim=claim, decide=decide)
        self._sealed[name] = p
        return p

    def grade(self, name: str, observed: Any, note: str = "") -> Result:
        if name not in self._sealed:
            raise PreregError(
                f"{name!r} was never sealed. A hypothesis formed after seeing the "
                "result is not a hypothesis."
            )
        if name in self._graded:
            raise PreregError(f"{name!r} already graded; re-grading is moving the goalposts")
        p = self._sealed[name]
        outcome = Outcome.HELD if p.decide(observed) else Outcome.FALSIFIED
        self._graded.add(name)
        r = Result(prediction=p, outcome=outcome, observed=observed, note=note)
        self.results.append(r)
        return r

    @property
    def falsified(self) -> list[Result]:
        return [r for r in self.results if r.outcome is Outcome.FALSIFIED]

    def ungraded(self) -> list[str]:
        """Sealed but never graded -- an experiment that quietly did not finish."""
        return sorted(set(self._sealed) - self._graded)

    def report(self) -> str:
        if not self.results and not self._sealed:
            return "NO PREDICTIONS SEALED. This run proves nothing it did not already assume."
        lines = []
        for r in self.results:
            mark = "HELD     " if r.outcome is Outcome.HELD else "FALSIFIED"
            lines.append(f"[{mark}] {r.prediction.name}: {r.prediction.claim}")
            lines.append(f"            observed: {r.observed}{'  ' + r.note if r.note else ''}")
        if self.ungraded():
            lines.append(f"UNGRADED (experiment incomplete): {', '.join(self.ungraded())}")
        n = len(self.results)
        f = len(self.falsified)
        lines.append(f"{f}/{n} falsified." + (
            "  Falsifications are the yield." if f else
            "  Zero falsified -- check the predictions were not trivially safe."))
        return "\n".join(lines)

    def to_json(self) -> str:
        return json.dumps([{
            "name": r.prediction.name, "claim": r.prediction.claim,
            "seal": r.prediction.seal, "outcome": r.outcome.value,
            "observed": r.observed, "note": r.note,
        } for r in self.results], indent=1, default=str)
