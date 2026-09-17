---
name: venue-failover
description: Keep intel source failure and execution venue failure separate; fail open for intel, fail closed for money.
---

# Venue Failover

## Why this rule exists

Hydra spans multiple chains, RPCs, intel sources, and routers. Failure is
normal. The correct response depends on what failed.

An intel source going down may reduce wallet discovery. It must not stop
quotes.

A simulation or risk path going down may cause bad fills. It must stop live
sends.

## Failure scenarios this prevents

1. **PulseChain GMGN 404 crashes hunter:** A slug is unsupported, and the code
   throws. Other chains stop hunting.
2. **Lost GMGN halts quotes:** Intel failure is treated like execution failure
   and live swaps stop even though quotes are fine.
3. **Router outage forces bad route:** One aggregator fails, but the router
   silently chooses a high-impact fallback instead of degrading.
4. **Wrong chain reuse:** An EVM adapter reuses Base Uniswap addresses on
   Robinhood Chain or PulseChain because failover logic is too generic.
5. **Bridge surprise:** Venue auto for copy tries to bridge an asset instead of
   using the token's home chain.

## Intel failover

- Each intel source has health state:
