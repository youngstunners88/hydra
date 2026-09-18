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

**Run for real, and the result reframes the question.** The user supplied the missing
`TYPESAFE_API_KEY`; `TEXT_MODEL_API_KEY` was pointed at the existing `OPENROUTER_API_KEY`.
All three tested allowlisted domains (gmgn.ai, dexscreener.com, geckoterminal.com) returned a
Cloudflare bot-check page instead of real content — not a jev-ultrafast-specific failure, a
network-fingerprint one that would hit base `browser-use` identically. Full writeup:
`RESULTS-2026-09-18.md` in this directory.

**The open question is no longer "which browser-automation engine" — it's whether headless
automated browsing can reach these sites at all from wherever Hydra actually deploys.** That
needs answering before either engine choice matters.
