---
name: pretrade-sim
description: Ensure every live order has a fresh quote, a simulation or validated route, and minOut before broadcast.
---

# Pretrade Simulation

## Why this rule exists

Quoted output can change between quote time and transaction time. Router paths
can fail. A token can be taxed on transfer. A stale quote can turn a 1 percent
slippage order into a 20 percent loss. Simulation makes the transaction shape
visible and gives the router a baseline to reject.

Hydra is fail-closed on money. If execution cannot validate its own expected
outcome, it must not send.

## Failure scenarios this prevents

1. **Stale quote:** SQLite or memory holds a quote for 30 seconds; price moves;
   live order still uses the old number.
2. **Missing minOut:** A router fills at any price because minOut was not
   attached.
3. **Route mismatch:** Aggregated calldata passes simulation locally but fails
   on-chain because the simulation used a different block or fee environment.
4. **Incorrect amount mode:** The order says `exact_out`, but the adapter treats
   it as `exact_in`.
5. **Chain mismatch:** A Base route is accidentally built with a Robinhood Chain
   Uniswap address.
6. **Tax token surprise:** A token imposes a large transfer tax. Simulation shows
   output shortfall; token-armor can then veto.

## Agent must

- Produce a fresh quote before every candidate live order.
- Respect quote TTL:
  - Solana: 8 seconds.
  - EVM: 12 seconds.
- Run simulation or route validation for the exact calldata or transaction to be
  broadcast.
- Attach `minOut` derived from the quote and configured slippage cap.
- Abort if simulated output differs from quoted output by more than
  `SIM_DRIFT_BPS`.
- Never broadcast live without:
  - a completed simulation,
  - a minOut,
  - a risk-vetted `TradeRequest`,
  - a non-empty clientOrderId,
  - token-armor pass if the asset is not in the trusted token registry.
- Use `dryRun` mode first for new venues or low-confidence routes.

## Process

1. Quote route via the selected venue adapter.
2. Record `QuoteTaken`.
3. Simulate:
   - Solana: validate Jupiter route and expected minimum output.
   - EVM: simulate via viem or aggregator contract call, or use adapter-level
     validation where simulation is not available.
4. Compare quoted vs simulated:
   - If drift > `SIM_DRIFT_BPS`, abort and record `RiskVeto`.
5. Create `OrderIntent`.
6. Submit only after all checks pass.

## Important

`dryRun=true` is still an execution plane action. It may use live quotes and
calldata simulation but must not broadcast. A dry-run order must not contain a
real signed transaction or private key material.
