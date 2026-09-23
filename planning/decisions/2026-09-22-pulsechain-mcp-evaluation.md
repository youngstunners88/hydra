# pulsechain-mcp: adopt the reads, refuse the surface — 2026-09-22

Evaluated `DavidFeder/pulsechain-mcp` v1.0.7 (52 commits, 178 files, MIT).

## Why it matters

Hydra's SPEC §2 says PulseChain has **"Weak/no GMGN"** coverage — the one venue
where our primary on-chain intel provider does not reach. This server fills
exactly that hole, and its tool surface maps almost one-to-one onto our spec:

| Hydra need | Their tool |
|---|---|
| §4.4 cluster / sybil graph | `get_funding_tree` |
| §4.3 discovery | `get_smart_money_feed`, `get_wallet_swaps`, `pulsex_swaps` |
| §4.3 hard vetoes | `get_honeypots`, `get_token_safety`, `check_address_risk` |
| §4.3 reputation | `get_deployer_reputation`, `get_holder_leagues` |

That is a better fit than anything else evaluated this week. Alexandria
returned `tools: 0` for on-chain; this returns ~90 tools, most of them reads.

## The problem, measured not assumed

Pre-registered before reading the enforcement code:

> **P1.** Research-only mode is enforced by NOT REGISTERING the signing tools,
> rather than by a flag checked inside each handler.

**FALSIFIED.**

```
registry.ts:24      registerWalletTools(server, config);   // UNCONDITIONAL
wallet/index.ts:177 if (!cfg.agentWalletEnabled) throw new PolicyError(...)
```

`sign_and_send`, `execute_agent_tx`, `transfer_pls`, `propose_agent_tx`,
`create_agent_wallet`, `kill_switch` and the rest are **registered even in
research-only mode**. The refusal is at CALL time, inside each handler.

**In their favour, and it matters:** without `AGENT_WALLET_MASTER_KEY` no
signing can occur at all, and their config throws early if wallets are enabled
without a key. This is **not a key-compromise hole**. It is a *surface*
problem — a registered tool appears in the model's tool list, and a model that
can see `sign_and_send` will eventually try it.

P2 (kill switch in code, not prompt) **held** — `wallet/service.ts`.
P3 (one process serves both planes) **held**.

## Why that collides with us specifically

`CLAUDE.md`: *"the hunt plane never signs transactions, and the exec plane
never scrapes social data."*

Mounting this server in the hunt plane puts thirteen signing tools in the hunt
plane's tool list. Their call-time boolean is their policy; it is not ours.

## The decision

**Adopt the reads. Enforce the boundary on our side.**

`packages/risk/src/planeGuard.ts` — deny-by-default allowlist per plane, with
forbidden action verbs refused **at construction**, so a bad list is caught
before anything is mounted. `PULSECHAIN_MCP_HUNT_TOOLS` is 38 reads; every
signing tool the server offers is refused, and a test asserts that per tool.

`wouldRefuse()` is for **mount** time, not call time: an unexpected surface is
an absence of refusal, and absences have to be looked for.

## Two things the guard taught us while being built

**1. Substring matching cannot tell a noun from a verb.** My first allowlist
was refused by my own construction check, because `get_recent_swaps` contains
"swap". But that is a *read about past swaps*; `prepare_swap` *performs* one.
The rule now tokenises on `_` and compares whole singular tokens:

```
get_recent_swaps    -> [get, recent, swaps]      READ   (swaps != swap)
prepare_swap        -> [prepare, swap]           ACTION
get_token_transfers -> [get, token, transfers]   READ
transfer_pls        -> [transfer, pls]           ACTION
```

A substring rule would have thrown away the entire discovery surface this
integration exists for.

**2. A mutation test found unreachable defensive code — and it was removed.**
`assert()` originally re-checked the forbidden verbs. Deleting that branch
changed no test outcome, because the constructor already guarantees no
forbidden tool is in the set and `#allowed` is private and readonly. Kept, it
would have read as safety while being unreachable. If an `allow()` mutator is
ever added, reinstate the check *and* a test that kills it.

## Not done, and deliberately

- **Nothing is mounted.** This ships the guard, not the integration. Wiring the
  server in is a separate change that should carry its own `wouldRefuse()`
  output in the diff.
- **`AGENT_WALLET_ENABLED` stays unset.** Hydra's exec plane has its own signing
  path; we do not need theirs, and two signing paths is one too many.
- Their data quality is **unverified** — the tool surface is a promise, not a
  measurement. First integration test should compare `get_funding_tree` against
  a cluster we can verify by hand.
