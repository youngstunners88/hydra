"""Grade probability forecasts honestly: against baselines, per arm, never pooled.

Why this exists (Hydra, 2026-09-24): two Jev arms were compared with each
other for a day. Only when a constant 0.5 was scored beside them did it show
that BOTH were worse than a coin: Brier 0.350 and 0.312 against 0.250. They
predicted about 25% retention where 58% retained. A comparison between arms
cannot show that, and a baseline shows it in one line.

What this reports, per arm, over the SAME wallets for every arm:
  Brier, NLL (p clipped to [1e-6, 1-1e-6], disclosed), mean p vs base rate
  (bias), share of extreme answers, reliability bins with counts, ECE, and
  Brier for a constant 0.5 and for the in-sample base rate (labelled
  OPTIMISTIC: it has seen the outcomes it is scored on).
  --compare A,B adds the paired Brier difference with a seeded bootstrap 95% CI.

What it never reports: a verdict. Verdicts come from a sealed grader with a
sealed minimum. This tool is labelled EXPLORATORY in its first line, every time.

Input:
  --hydra-journal ops/journal/jev-local.jsonl   (decision + outcome records;
      arm = the action suffix after '@', unit = wallet, y = outcome)
  --jsonl rows.jsonl                             ({"arm","unit","p","y"} per line)
"""
from __future__ import annotations

import argparse
import json
import math
import random
import sys
from collections import defaultdict

__all__ = ["load_hydra", "load_rows", "align", "report", "paired_diff", "wilson", "main"]

EPS = 1e-6


def load_hydra(path: str) -> dict[str, dict[str, tuple[float, int]]]:
    """arm -> unit -> (p, y), resolved decisions only, replayed like the journal."""
    recs: dict[str, dict] = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            ev = json.loads(line)
            if ev.get("kind") == "decision":
                r = ev["record"]
                recs[r["id"]] = dict(r)
            elif ev.get("kind") == "outcome":
                if ev["id"] not in recs:
                    raise ValueError(f"outcome for unknown decision {ev['id']}; log truncated or reordered")
                recs[ev["id"]]["outcome"] = ev["outcome"]
    out: dict[str, dict[str, tuple[float, int]]] = defaultdict(dict)
    for r in recs.values():
        if not isinstance(r.get("outcome"), bool) or "@" not in r["action"]:
            continue
        arm = r["action"].split("@", 1)[1]
        unit = r["answer"].split(":", 1)[0]
        if unit in out[arm]:
            raise ValueError(f"arm {arm}: unit {unit} recorded twice; one decision per unit broke")
        out[arm][unit] = (float(r["confidence"]), 1 if r["outcome"] else 0)
    return dict(out)


def load_rows(path: str) -> dict[str, dict[str, tuple[float, int]]]:
    out: dict[str, dict[str, tuple[float, int]]] = defaultdict(dict)
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            if line.strip():
                r = json.loads(line)
                if r["unit"] in out[r["arm"]]:
                    raise ValueError(f"arm {r['arm']}: unit {r['unit']} twice")
                out[r["arm"]][r["unit"]] = (float(r["p"]), int(r["y"]))
    return dict(out)


def align(data: dict[str, dict[str, tuple[float, int]]], arms: list[str]) -> tuple[list[str], dict[str, list[float]], list[int]]:
    """Units present in EVERY requested arm. Outcomes must agree across arms."""
    missing = [a for a in arms if a not in data]
    if missing:
        raise ValueError(f"no resolved rows for arm(s): {', '.join(missing)}")
    units = sorted(set.intersection(*(set(data[a]) for a in arms)))
    ys: list[int] = []
    for u in units:
        outs = {data[a][u][1] for a in arms}
        if len(outs) != 1:
            raise ValueError(f"unit {u}: arms disagree on the outcome; they were not graded against the same event")
        ys.append(outs.pop())
    return units, {a: [data[a][u][0] for u in units] for a in arms}, ys


def brier(ps: list[float], ys: list[int]) -> float:
    return sum((p - y) ** 2 for p, y in zip(ps, ys)) / len(ys)


def nll(ps: list[float], ys: list[int]) -> float:
    return -sum(math.log(min(max(p if y else 1 - p, EPS), 1 - EPS)) for p, y in zip(ps, ys)) / len(ys)


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (float("nan"), float("nan"))
    ph = k / n
    d = 1 + z * z / n
    c = (ph + z * z / (2 * n)) / d
    h = z * math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n)) / d
    return (c - h, c + h)


def bins(ps: list[float], ys: list[int], k: int = 10) -> list[tuple[float, float, int, float, float]]:
    """(lo, hi, n, mean_p, observed) per non-empty equal-width bin; p=1.0 goes in the last."""
    acc: dict[int, list[tuple[float, int]]] = defaultdict(list)
    for p, y in zip(ps, ys):
        acc[min(int(p * k), k - 1)].append((p, y))
    out = []
    for b in sorted(acc):
        rows = acc[b]
        out.append((b / k, (b + 1) / k, len(rows), sum(p for p, _ in rows) / len(rows),
                    sum(y for _, y in rows) / len(rows)))
    return out


def ece(ps: list[float], ys: list[int], k: int = 10) -> float:
    n = len(ys)
    return sum(cnt / n * abs(mp - obs) for _, _, cnt, mp, obs in bins(ps, ys, k))


def paired_diff(a: list[float], b: list[float], ys: list[int], resamples: int = 2000, seed: int = 7) -> tuple[float, float, float]:
    """Brier(a) - Brier(b) and a percentile bootstrap 95% CI over units. Positive: b is better."""
    d = [(pa - y) ** 2 - (pb - y) ** 2 for pa, pb, y in zip(a, b, ys)]
    n = len(d)
    rng = random.Random(seed)
    means = sorted(sum(d[rng.randrange(n)] for _ in range(n)) / n for _ in range(resamples))
    return (sum(d) / n, means[int(0.025 * resamples)], means[int(0.975 * resamples) - 1])


def report(data: dict[str, dict[str, tuple[float, int]]], arms: list[str], compare: tuple[str, str] | None = None) -> str:
    units, ps, ys = align(data, arms)
    n = len(ys)
    lines = [f"EXPLORATORY -- no verdict. Verdicts come from a sealed grader. n={n} units in all of: {', '.join(arms)}"]
    if n == 0:
        lines.append("nothing to grade")
        return "\n".join(lines)
    base = sum(ys) / n
    lo, hi = wilson(sum(ys), n)
    lines.append(f"base rate {base:.3f}  (Wilson 95% {lo:.3f}-{hi:.3f})")
    lines.append(f"{'arm':<12}{'Brier':>8}{'NLL':>8}{'mean p':>8}{'bias':>8}{'extreme':>9}{'ECE':>7}")
    for a in arms:
        p = ps[a]
        ext = sum(1 for x in p if x < 0.1 or x > 0.9) / n
        lines.append(f"{a:<12}{brier(p, ys):>8.4f}{nll(p, ys):>8.4f}{sum(p) / n:>8.3f}"
                     f"{sum(p) / n - base:>+8.3f}{ext:>9.2f}{ece(p, ys):>7.3f}")
    lines.append(f"{'const 0.5':<12}{brier([0.5] * n, ys):>8.4f}{nll([0.5] * n, ys):>8.4f}")
    lines.append(f"{'base rate':<12}{brier([base] * n, ys):>8.4f}{nll([base] * n, ys):>8.4f}   OPTIMISTIC: fitted on these outcomes")
    beaten = [a for a in arms if brier(ps[a], ys) >= 0.25]
    if beaten:
        lines.append(f"WORSE THAN A COIN (Brier >= 0.25): {', '.join(beaten)}")
    for a in arms:
        lines.append(f"reliability {a}: " + "  ".join(
            f"[{b_lo:.1f},{b_hi:.1f}) n={cnt} p={mp:.2f} obs={obs:.2f}" for b_lo, b_hi, cnt, mp, obs in bins(ps[a], ys)))
    if compare:
        x, y = compare
        d, clo, chi = paired_diff(ps[x], ps[y], ys)
        side = "excludes 0" if clo > 0 or chi < 0 else "includes 0"
        lines.append(f"Brier({x}) - Brier({y}) = {d:+.4f}  bootstrap 95% [{clo:+.4f}, {chi:+.4f}] ({side}; positive favours {y})")
    lines.append(f"NLL clips p to [{EPS}, {1 - EPS}].")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Grade forecasts against baselines. Exploratory; never a verdict.")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--hydra-journal")
    src.add_argument("--jsonl")
    ap.add_argument("--arms", required=True, help="comma-separated, e.g. single,permuted")
    ap.add_argument("--compare", default=None, help="A,B")
    args = ap.parse_args(argv)
    data = load_hydra(args.hydra_journal) if args.hydra_journal else load_rows(args.jsonl)
    arms = [a.strip() for a in args.arms.split(",") if a.strip()]
    cmp = tuple(args.compare.split(",")) if args.compare else None
    if cmp and (len(cmp) != 2 or any(c not in arms for c in cmp)):
        print("--compare needs two arms from --arms", file=sys.stderr)
        return 2
    try:
        print(report(data, arms, cmp))  # type: ignore[arg-type]
    except ValueError as e:
        print(f"grade: {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
