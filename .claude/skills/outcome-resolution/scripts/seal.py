"""Seal a resolution rule before any outcome exists; refuse to grade under an edit.

A rule chosen after seeing outcomes is re-grading one level up. The seal is a
SHA-256 of the rule's exact text, committed alone before the first resolve.
`verify` is called on EVERY run, because the failure it guards is a later edit
to the rule that nobody re-seals.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone

__all__ = ["SealedRule", "SealError", "seal", "verify"]


class SealError(RuntimeError):
    pass


@dataclass(frozen=True)
class SealedRule:
    rule_id: str
    sha256: str
    sealed_at: str
    text: str
    outcomes_at_seal: int

    def to_json(self) -> str:
        return json.dumps(asdict(self), indent=2) + "\n"


def _digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def seal(rule_id: str, text: str, *, outcomes_present: int, now: datetime | None = None) -> SealedRule:
    """Refuses if any outcome already exists -- that is the whole point."""
    if outcomes_present:
        raise SealError(
            f"{outcomes_present} outcome(s) already resolved. A rule sealed after "
            "outcomes exist cannot prove it was not chosen to fit them. Use a new "
            "journal action and seal before its first resolve."
        )
    if not text.strip():
        raise SealError("an empty rule cannot be wrong, so it cannot be sealed")
    when = (now or datetime.now(timezone.utc)).isoformat()
    return SealedRule(rule_id, _digest(text), when, text, 0)


def verify(sealed: SealedRule, rule_id: str, text: str) -> None:
    if sealed.rule_id != rule_id:
        raise SealError(
            f"sealed {sealed.rule_id!r}, code implements {rule_id!r}. A new rule "
            "needs a new seal AND a new journal action."
        )
    if sealed.sha256 != _digest(text):
        raise SealError(
            "rule text no longer matches the seal. Grading under it would record "
            "outcomes against a rule the audit trail does not contain."
        )
