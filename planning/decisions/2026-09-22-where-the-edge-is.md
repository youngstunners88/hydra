# Where Hydra's edge actually is — 2026-09-22

## The question

"Find a market we have an edge in." I went looking for a market. The answer is
not a market.

## What I got wrong first

**Thesis:** TradeCC blocked rigorous copy-trading on data infrastructure, so
pick a low-throughput chain where enumeration is cheap. Hydra already targets
two chains whose tooling coverage is weak (SPEC §2: GMGN is "weak/no" for
PulseChain, partial for Robinhood Chain).

Three predictions were sealed before measuring. **All three were falsified**,
and two of them for reasons that say more about my method than about the chains:

| | Prediction | Outcome |
|---|---|---|
| P1 | Some Hydra venue has <1/10th Base's throughput | **Unresolvable** — Base RPC blocked |
| P2 | Robinhood Chain is the lowest-throughput EVM venue | **Unresolvable** — its RPC blocked |
| P3 | Every listed RPC responds | **Falsified as stated, but by my environment** |

`mainnet.base.org` and `rpc.mainnet.chain.robinhood.com` both returned **HTTP
403 from the agent proxy** — an organisation policy denial, not a dead chain.
Reporting P3 as "those venues are dead" would have been a false finding produced
by my own sandbox. It is recorded as unresolved.

**Measured, and it is the one real number here:**

```
pulsechain   7.72 tx/s   block 10.91s   84.8 tx/block   head 27,611,138
```

## The deeper error

I scaled enumeration cost against `0.41 tx/s`, treating it as a chain
throughput. It is not. Re-reading
`tradecc/research/backtests/2026-09-12_copy-trading-feasibility-probe.md`, 0.41
tx/s is **our free-tier RPC fetch rate**, and the real figures are one
wallet-year ≈ 4.1 hours, ten wallets ≈ 41 hours.

That document then says plainly what blocks copy-trading:

> **"What actually blocks this: Not data. Not cost. Wallet selection."**

> *"Any published 'smart money' or leaderboard list is selected on realised
> performance up to today. Copying it into a backtest is look-ahead bias by
> construction."*

Data was never the constraint. **A smaller chain does not fix a selection bias.**
My thesis was solving a problem we did not have.

## Where the edge actually is

The same document names the tractable method:

> *"derive the candidate set from something that does not reference
> performance. The tractable version is a **pool's counterparties during a
> fixed early window** — one address to enumerate, and the traders fall out of
> its transaction history. Rank them on a training window, evaluate forward on
> held-out folds."*

**Hydra already implements the defence.** SPEC §4.5:

> *"Paper-copy into a virtual book. Promote only if paper metrics beat baseline
> for PROMOTION_WINDOW."*

That is forward evaluation by construction. A wallet cannot enter Hydra's live
book on the strength of its past — only on the strength of paper performance
measured *after* Hydra selected it. **That is structurally immune to the bias
that blocked TradeCC**, and it was in the spec before any of this analysis.

So the edge is not a market. It is **Hydra's promotion gate**, and the work is
to make sure it is actually enforced rather than merely specified.

### Where the chain choice still helps, secondarily

PulseChain at 7.72 tx/s is genuinely small — Solana runs orders of magnitude
higher. Two consequences, neither yet measured:

1. A pool's counterparty set is small enough to enumerate cheaply at our
   existing fetch rate.
2. Fewer competing copy bots, so `LATENCY_RACE` — which blocks 7 of 14
   strategies in TradeCC's inventory — binds more weakly.

**Both are hypotheses.** Neither is evidence. The honest next measurement is to
pick one PulseChain pool, enumerate its early counterparties, and count them.

## Shipped alongside this

Hydra's risk port was **pre-trade only** — `checkOrder` decides whether an order
may be placed, and then nothing owned the position. Senpi runs 114 strategy
packages and says in its own README that the exit asymmetry, *not* the entry
signal, is "the engine behind every strategy template".

- `packages/risk/src/ratchet.ts` — two-phase exit. Phase 1 a hard floor,
  phase 2 a ratcheting tier ladder that only ever tightens. Pure, no clock, no
  I/O. Refuses a 0%-locking rung and an unsorted ladder **at construction**.
- `packages/risk/src/coverage.ts` — absence detection. An unprotected position
  shows up as a missing row, not a warning. A **vacuous** pass (nothing
  expected) is treated as a failure.

32 tests, 5 guards mutation-verified, all caught. `npm test`.

## The promotion gate: ANSWERED, and it was half-enforced

`lifecycle.ts` genuinely refuses `watchlisted -> trusted` without
`paperMetricsPassed`, and the adjacency table blocks rank-skipping. That part
is real and was already correct.

**But `paperMetricsPassed` was a boolean handed in by the caller.** Nothing
computed it. No paper book, no baseline comparison, no outcome record. A gate
whose evidence is supplied by the thing being gated is a formality.

`packages/risk/src/journal.ts` closes it. `paperMetricsPassed()` is derived
from resolved outcomes and cannot be asserted.

## Open

- Base and Robinhood Chain throughput: **unmeasured**, RPCs blocked here.
- PulseChain pool counterparty count: **unmeasured**, and it is the next test.
- Nothing yet WRITES to the journal — the hunter must call `record()` on each
  paper-copy decision and `resolve()` when the trade closes. Until it does,
  `paperMetricsPassed` correctly returns false on an absence.
