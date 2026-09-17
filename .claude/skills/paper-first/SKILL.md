---
name: paper-first
description: Require a new strategy or copy wallet to survive paper fills before live capital is allowed.
---

# Paper First

## Why this rule exists

Backtests overfit. A strategy can be right in historical data and still lose
live money because fees, slippage, timing, and selection bias are different. A
paper account does not remove all risk, but it exposes gross errors without real
loss.

Hydra requires paper-first validation because promotions are irreversible in
capital terms. Once live money is sent, the loss is real.

## The N fills gate

A new strategy or copy candidate must survive at least **N paper fills** before
it can be considered for live.

Default N: **20**.

This is a floor, not a guarantee.

Why a floor:

- A few fills can be luck.
- One bad market regime can flatter a bad strategy.
- Slippage and fee behavior need repeated samples.
- Copy wallets need multiple trade observations to reveal extractor or sybil
  patterns.
- Execution failures and partial fills need repetition to appear.

Why it is not a guarantee:

- Twenty fills do not prove edge.
- Regime change can still break a profitable paper strategy.
- Paper fills may not reproduce live impact, queue position, or latency.
- A copied wallet's next trade may be its first honeypot.
- Therefore, live still requires all other risk and token/wallet armor gates.

## Failure scenarios this prevents

1. **Three-paper-trade promotion:** A strategy wins three paper trades, then
   goes live and fails because the sample was noise.
2. **Copy from a single wallet tweet:** The system skips paper and buys after a
   social mention.
3. **Retrofit promotion:** A strategy is scored only on historical data and
   promoted without any paper execution.
4. **Promotion by narrative:** Agent-Reach mentions a wallet; the paper book is
   empty; the agent still tries to copy.

## Agent must

- Keep new strategies in paper mode for at least N fills.
- Keep new copy candidates in paper-copy mode before `trusted` can become
  `copy_enabled`.
- Use `scripts/paper_copy_replay.ts` to replay watched trades against historical
  quotes without live sends.
- Promote only if paper metrics beat baseline for the configured
  `promotion_window_hours`.
- Record paper PnL in `watch_book`.
- Never treat paper PnL as a live profit guarantee.
- Do not allow a direct observed-to-live path.

## Workflow

1. Discover and score wallet.
2. Move to `watchlisted`.
3. Paper-copy its observed trades in a virtual book.
4. After at least N fills and promotion window:
   - Compute win rate, hit rate, drawdown, and execution slippage.
5. If paper metrics pass and wallet-armor remains clean:
   - Move to `trusted`.
6. Then require human confirm or `AUTO_PROMOTE=true` plus extra gates to become
   `copy_enabled`.
7. Live copy still re-runs token-armor, wallet-armor, risk, and route checks.

## Paper mode constraint

Paper mode must never import the hot exec private key. It can use live quotes
and public histories, but it cannot sign.
