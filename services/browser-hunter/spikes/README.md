# Spikes — pre-adoption evaluation, not the sidecar

Code here is **not** `services/browser-hunter`'s implementation. SPEC.md §3.3 names
`browser-use` as Hydra's browser-automation library; nothing here changes that decision.

`jev_ultrafast_spike.py` exists to answer one narrow question before any such decision gets
made: **can `jev-ultrafast` actually read the specific tables Hydra needs, on the specific
pages Hydra needs them from** — GeckoTerminal top-trader views, PulseX/PulseScanner explorer
pages — given its own MVP disclaimer excludes shadow DOM, iframes, canvas, file uploads,
popup tabs, and nested scrolling.

See `10-Skills/jev-fast-tools/references/hydra-browser-hunter-proposal.md` (Solomons-Chamber
vault) for the full proposal this spike serves. Full research, including four load-bearing
findings from reading jev-ultrafast's actual source rather than its README, is in that skill's
`references/deep-dive.md`.

**Do not promote this into `services/browser-hunter/tasks/` on a passing run alone.** A
passing spike means the engine can read the page. It says nothing about the data-egress
question (page content — including on-chain addresses — travels to `api.typesafe.ai` and,
for any `TYPE_TEXT` step, to a second text-completion endpoint) that the proposal identifies
as unresolved for this project. That's still a decision for the repo owner, not an outcome of
this script passing.

## Status as of 2026-09-18

**Not run.** This environment has none of: `TYPESAFE_API_KEY`, `TEXT_MODEL_API_KEY`, a Chrome
binary, or Python ≥ 3.12 (jev-ultrafast's stated minimum; this environment has 3.11). The
script below is written and statically checked (`py_compile` clean, imports verified against
the real package layout at commit `452c1ad`) but has not executed against a live page. Running
it for real needs an environment with all four of those present.
