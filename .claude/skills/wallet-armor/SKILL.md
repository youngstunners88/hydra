---
name: wallet-armor
description: Veto sybil, wash, extractor, bundler, and social-only wallets before they can become copyable.
---

# Wallet Armor

## Why this rule exists

Smart-money wallets can be faked. A cluster can make one wallet look profitable
by buying and selling against itself. Social feeds can signal a wallet with no
real on-chain edge.

If a wallet is not actually smart, copy trading it means buying into another
player's exit liquidity. Wallet-armor protects the pipeline from promoting a
narrative instead of an edge.

## Failure scenarios this prevents

1. **High-PnL sybil:** A cluster of four wallets buys the same token at the same
   block, pumps its own PnL, and looks like a sniper. The wallet passes score but
   fails cluster check.
2. **Bundler:** Wallets are funded by the same parent and enter within the same
   block. They are one actor, not independent evidence.
3. **Wash trading:** A wallet sells to itself or cluster members at favorable
   prices, creating fake volume and fake win rate.
4. **Extractor pattern:** On most tokens, sold value exceeds bought value while
   PnL appears high from unrealized or selective reporting.
5. **Social-only signal:** A wallet is named on X with no on-chain proof. Search
   score must not override the veto.

## Hard vetoes

Composite score is ignored when any of these apply:

- `honeypot_ratio > 0.15`
- Majority of tokens show sold > bought extractor pattern
- Known bundler or same-block multi-wallet cluster
- At least 40 percent of volume against its own cluster
- Token tax above configured cap on last 3 entries
- Social-only mention with zero on-chain proof

## Agent must

- Never copy a wallet with an unresolved hard veto, even if its composite score
  is high.
- Build the sybil graph from:
  - funded-by edges
  - same-block entry edges
  - shared funding parent
  - identical trade sequences within 2 seconds
- If cluster size is at least `SYBIL_N`, default 4, mark all cluster members as
  sybil and refuse copy.
- Re-run wallet-armor at promotion time and again at T+0 for each copy order.
- Record vetoes in `WalletScored.vetoes` and retirement events when appropriate.
- Treat social PnL claims as rumor, not proof.

## Workflow

1. Collect wallet profile and history.
2. Compute normalized score inputs.
3. Build cluster edges from activity and funding graph.
4. Run scoring engine.
5. If any hard veto fires:
   - Do not copy.
   - Emit `RiskVeto`.
   - Mark wallet as `retired` if the veto indicates sybil, wash, or extractor.
6. If no veto, continue to watch/promote gating.

## Key Hydra constraint

A high PnL wallet that is sybil is not a high-quality wallet. It is a trap.
Veto is absolute.
