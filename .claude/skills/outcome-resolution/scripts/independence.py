"""One decision per subject. Correlated samples make n a fiction.

The 97-outcome minimum assumes independent predictions. Twenty decisions about
one wallet are one prediction observed twenty times.
"""
from __future__ import annotations

from collections import Counter
from typing import Iterable

__all__ = ["duplicates", "effective_n"]


def duplicates(subjects: Iterable[str]) -> dict[str, int]:
    """Subjects appearing more than once, with their counts. Case-insensitive."""
    c = Counter(s.lower() for s in subjects)
    return {s: n for s, n in c.items() if n > 1}


def effective_n(subjects: Iterable[str]) -> int:
    """How many INDEPENDENT subjects there actually are."""
    return len({s.lower() for s in subjects})
