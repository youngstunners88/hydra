"""Spike: can jev-ultrafast read the tables Hydra's browser-hunter fallback needs?

NOT the sidecar implementation. See spikes/README.md before running this or acting on
its output. This script enforces two things jev-ultrafast does not enforce on its own
(read from its actual source, not assumed):

1. A domain allowlist, checked BEFORE `Agent(url, ...)` is ever constructed. jev-ultrafast's
   `Browser.__init__` navigates to whatever URL it's given -- nothing inside the library
   restricts that. Hydra's own allowlist requirement (SPEC.md section 3.3) has to be enforced
   here, at the call site, or it doesn't exist.
2. A wall-clock time budget. jev-ultrafast caps STEP count internally (MAX_STEPS = 60, in its
   own questions.py) but has no time deadline anywhere in its run() loop. Hydra's
   browser_use.max_seconds config (default 90, see config/default.yaml) is applied here as an
   external deadline around the whole run, not inside the library.

Everything else -- goal, page, whether the result is even useful -- is exactly what this
spike exists to find out. It is deliberately narrow: one page, one goal, one report.

Usage (needs Python >= 3.12, TYPESAFE_API_KEY, TEXT_MODEL_API_KEY, and a Chrome binary
reachable by browser-harness -- none of which this evaluation environment has):

    pip install jev-ultrafast   # or: git clone + `uv sync`, per its own README
    export TYPESAFE_API_KEY=...
    export TEXT_MODEL_API_KEY=...      # or set TEXT_MODEL_BASE_URL/TEXT_MODEL to reuse
                                        # OPENROUTER_API_KEY -- see deep-dive.md addendum
    python jev_ultrafast_spike.py \
        --url "https://www.geckoterminal.com/solana/pools/<pool-address>" \
        --goal "Find the top trader addresses table for this pool and read the first \
5 wallet addresses shown." \
        --max-seconds 90
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_ALLOWLIST = REPO_ROOT / "config" / "allowlists" / "domains.txt"

REQUIRED_ENV = ("TYPESAFE_API_KEY", "TEXT_MODEL_API_KEY")


class SpikeRefused(Exception):
    """Raised when a precondition fails. No browser is ever started in this case."""


def load_allowlist(path: Path) -> set[str]:
    if not path.exists():
        raise SpikeRefused(
            f"allowlist file not found: {path}. Refusing to guess a default -- "
            "an unreadable allowlist must never be treated as an empty (permit-all) one."
        )
    domains = {
        line.strip().lower()
        for line in path.read_text().splitlines()
        if line.strip() and not line.strip().startswith("#")
    }
    if not domains:
        raise SpikeRefused(f"{path} parsed to zero domains. An empty allowlist permits nothing.")
    return domains


def check_allowlisted(url: str, allowlist: set[str]) -> None:
    """Refuse before any browser is started. jev-ultrafast will navigate to
    whatever it's given -- this is the only check standing between an operator
    typo and the agent loading an arbitrary, unvetted site."""
    host = (urlparse(url).hostname or "").lower()
    if not host:
        raise SpikeRefused(f"could not parse a hostname from {url!r}")
    if not any(host == d or host.endswith("." + d) for d in allowlist):
        raise SpikeRefused(
            f"{host!r} is not in the allowlist ({sorted(allowlist)}). "
            "Add it to config/allowlists/domains.txt deliberately, as its own "
            "commit, before pointing this spike at it -- never by editing this script."
        )


def check_environment() -> None:
    missing = [name for name in REQUIRED_ENV if not os.environ.get(name)]
    if missing:
        raise SpikeRefused(
            "missing required environment variable(s): " + ", ".join(missing) + ". "
            "Both are env-var-only, per this project's secret-handling pattern -- "
            "never a file path, never a default, never hardcoded here."
        )
    if sys.version_info < (3, 12):
        raise SpikeRefused(
            f"jev-ultrafast requires Python >= 3.12; running on {sys.version_info.major}."
            f"{sys.version_info.minor}. This is not a soft warning -- the library is not "
            "tested below that version and a partial run would produce an unreliable answer "
            "to the one question this spike exists to answer."
        )
    try:
        import jev_ultrafast  # noqa: F401
    except ImportError as exc:
        raise SpikeRefused(
            "jev_ultrafast is not importable. Install it first (pip install jev-ultrafast, "
            "or clone github.com/browser-use/jev-ultrafast and `uv sync`) -- this spike does "
            "not vendor or reimplement any part of it."
        ) from exc


def run_with_deadline(url: str, goal: str, max_seconds: float) -> dict:
    """Wrap jev_ultrafast.Agent.run() with an external wall-clock deadline.

    The library's own budget (MAX_STEPS = 60, in its questions.py) bounds step
    COUNT, not elapsed time. A page that stalls on a single slow step -- a
    hanging network request, a wait loop that never resolves -- would not be
    caught by that alone. This deadline is enforced here, outside the library,
    on a background thread so a stuck `run()` call cannot block it.
    """
    from jev_ultrafast import Agent

    result: dict = {"steps": [], "final_status": None, "error": None}
    deadline_hit = threading.Event()

    def worker() -> None:
        try:
            with Agent(url, goal) as agent:
                for state in agent.run():
                    if deadline_hit.is_set():
                        result["final_status"] = "deadline_exceeded_mid_run"
                        return
                    result["steps"].append(
                        {
                            "elapsed_ms": state.get("elapsed_ms"),
                            "status": state.get("status"),
                            "url": (state.get("history") or [{}])[-1].get("url")
                            if state.get("history")
                            else state.get("page", {}).get("url"),
                        }
                    )
                result["final_status"] = result["steps"][-1]["status"] if result["steps"] else "no_steps"
        except Exception as exc:  # noqa: BLE001 -- a spike must report the failure, not crash silently
            result["error"] = f"{type(exc).__name__}: {exc}"
            result["final_status"] = "exception"

    thread = threading.Thread(target=worker, daemon=True)
    started = time.monotonic()
    thread.start()
    thread.join(timeout=max_seconds)
    if thread.is_alive():
        deadline_hit.set()
        result["final_status"] = result.get("final_status") or "deadline_exceeded"
        result["note"] = (
            f"run() did not finish within {max_seconds}s. The background thread was signalled "
            "to stop but jev-ultrafast has no cooperative cancellation point inside a single "
            "model call or browser action, so it may keep running briefly after this returns. "
            "This is exactly the gap Hydra's max_seconds config exists to bound externally."
        )
    result["wall_clock_seconds"] = round(time.monotonic() - started, 2)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", required=True, help="Target page. Must resolve to an allowlisted domain.")
    parser.add_argument("--goal", required=True, help="One task, in plain language, for the agent.")
    parser.add_argument("--max-seconds", type=float, default=90.0, help="Matches config/default.yaml's browser_use.max_seconds default.")
    parser.add_argument("--allowlist", type=Path, default=DEFAULT_ALLOWLIST)
    args = parser.parse_args(argv)

    try:
        check_environment()
        allowlist = load_allowlist(args.allowlist)
        check_allowlisted(args.url, allowlist)
    except SpikeRefused as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2

    print(f"Running against {args.url!r} (allowlisted), budget {args.max_seconds}s...", file=sys.stderr)
    result = run_with_deadline(args.url, args.goal, args.max_seconds)
    print(json.dumps(result, indent=2, default=str))

    if result.get("error"):
        return 1
    if result.get("final_status") not in {"done"}:
        print(
            f"\nNOTE: final_status was {result.get('final_status')!r}, not 'done'. "
            "That is itself a real answer -- it means this page/goal did not complete "
            "cleanly, which is exactly what this spike exists to surface before anyone "
            "builds a sidecar around the assumption that it would.",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
