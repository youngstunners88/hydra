# HYDRA — Agent Operating Contract

This file is the binding version of SPEC.md section 15. Read it before writing or
running any Hydra code.

Hydra is an intelligence + execution platform. It can discover public smart-money
wallets and, eventually, submit real transactions. That power requires hard
boundaries. Every rule below exists because a real loss can happen when a
component crosses the wrong lane.

---

## 1. Two-plane rule

Hydra has two operational planes plus a decision layer:

| Plane | Does | Never |
|---|---|---|
| **Hunt** (`packages/hunter`) | discover, enrich, watch; public reads only | signs, holds a key, calls a venue |
| **Decision** (`packages/decide`, `packages/risk`) | score, promote, resolve, size; Jev lives here | discovers, signs |
| **Exec** (`packages/exec`) | quote, simulate, send, confirm | scrapes social or intel |
| **Control** (`scripts/`, `apps/`) | the ONLY place adapters from different planes are wired together | holds business logic |
| **State** (`ops/journal/`, event log) | append-only record; projections rebuild from it | is edited in place |

Hunt never signs. Exec never scrapes. The decision plane is the only place a
hunted wallet can become an order. **Enforced, not just stated:**
`ops/layers.json` + `pnpm layers` fail CI on any import across a forbidden edge.

## 2. The seven TradeCC rules (verbatim, binding here too)

Hydra will eventually submit real transactions, so TradeCC's rules apply
unchanged. Source: `tradecc/CLAUDE.md`.

1. **Never hardcode or commit a private key, seed phrase, or `.env` file.**
   Keys are loaded at runtime from a secrets manager or injected env var
   only. See `ops/CONTEXT.md` for the required pattern.
2. **Use a dedicated hot wallet for this bot — never the user's main
   wallet.** Fund it only with capital the user can afford to lose.
3. **Every swap simulates before it sends.** No transaction goes to the
   network without a `simulateTransaction` (or equivalent) check first.
4. **Enforce a slippage cap** (default 0.5–1% for liquid pairs) and a
   **per-trade loss limit** and **daily loss circuit breaker** in code,
   not just in docs. These are load-bearing safety features, not
   optional polish — do not remove or bypass them to "get something
   working faster."
5. **No live trading until the validation gate in `planning/specs/mvp_spec.md`
   is met.** Default mode is paper trading (simulated fills against real
   quotes, no real transactions sent).
6. **Position sizing defaults to $5–$10** unless the user explicitly
   raises it. Do not silently scale up position size.
7. If any instruction elsewhere in this repo conflicts with these seven
   rules, follow these rules and flag the conflict to the user instead of
   guessing.

## 3. Keys and secrets

- **No model key and no wallet key on GitHub** — not in the repo, and not in
  GitHub Actions secrets (user decision, 2026-09-23). `paper-run.yml`
  references no secret, and must not.
- Jev runs **locally** (`pnpm jev:local`) with the key from the environment of
  the machine running it, into `ops/journal/jev-local.jsonl`.
- `AGENT_WALLET_ENABLED` stays unset. Nothing here signs.
- CI refuses committed key material; the egress policy refuses key-shaped
  strings on the wire.

## 4. State you must not break

- **`ops/journal/decisions.jsonl` is owned by `paper-run.yml` on main.** Never
  commit it from a feature branch: two writers appending to one file conflict.
- **Sealed rules are immutable.** `ops/journal/resolution-rule.json` and
  `ops/experiments/*.json` are hash-checked on every run. A new rule means a
  new id AND a new journal action, sealed before its first outcome.
- **97 resolved outcomes per action, never pooled.** Confidence kinds
  (`@heuristic`, `@single`, `@permuted`, `@noul`, `@constant`) are on different scales.
- **No live trading until the TradeCC gate passes.** Paper/hunt only.

## 5. Working rules

- Read `.claude/skills/measure-first/SKILL.md` first: pre-register before
  measuring; LOW VERBOSITY; end every session with the next build's prompt.
- Run through **pnpm** (`pnpm hunt -- --flag`), not just `node`: pnpm
  forwards `--`, and that difference once crashed every scheduled run.
- Every script `package.json` advertises must exist (a test enforces it).
  Do not restore `promote`/`replay`/`smoke`; `smoke_dust_swap` is exec-plane
  and must not exist before the gate passes.
- Before pushing: `pnpm install --frozen-lockfile`, typecheck, `pnpm layers`,
  tests. Mutation-test new guards.

## 6. Skills

Vendored from Solomons-Chamber into `.claude/skills/` so this repo is
self-contained. Edit them **upstream** in Solomons-Chamber and re-vendor; a
local edit creates a second source of truth.

`measure-first` · `jev-architecture` · `paper-clock` · `outcome-resolution`
