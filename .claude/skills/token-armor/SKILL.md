---
name: token-armor
description: Check honeypot, mint, freeze, tax, and LP-lock features before any trade, including copy trades.
---

# Token Armor

## Why this rule exists

A wallet can be good and still buy a bad token. Copy trading does not eliminate
token risk; it amplifies it because a trusted wallet can make the same mistake
you would.

On-chain token contracts can:

- Prevent selling except for privileged addresses.
- Freeze transfers.
- Mint new supply and dump it.
- Enforce a transfer tax so high that even a winning trade becomes a loss.
- Have liquidity removed or never meaningfully locked.

These are features, not accidents. Token-armor checks are the only automated
barrier between a copied wallet signal and an unsellable token.

## Failure scenarios this prevents

1. **Honeypot:** A high-PnL wallet buys a token that only it can sell. Copy
   trader buys and cannot exit.
2. **Tax surprise:** Slippage is 2 percent but token has an 8 percent transfer
   tax. The fill is possible but the position is deeply negative.
3. **Freeze/mint:** Token has an admin mint. One transaction later, the copy
   trader's position is diluted.
4. **No LP lock:** Liquidity is removed after the copied wallet's buy.
5. **Copy at T+0:** A trusted wallet buys a newly created token with strong
   social momentum but terrible security. Token-armor at signal time and at
   order time catches this.

## Agent must

- Run token security checks before any trade in an unknown or non-allowlisted
  asset.
- Use official GMGN token-security data where available:
  - honeypot
  - renounce
  - mint authority
  - freeze authority
  - transfer tax
  - LP lock
- Use on-chain checks as fallback:
  - symbol, decimals, name, total supply
  - owner/mint/freeze authority where applicable
  - transfer tax simulation or balance delta check
- Treat these as hard vetoes:
  - honeypot or obvious sell restriction
  - active mint authority without safe config
  - freeze authority with ability to freeze normal holders
  - transfer tax above configured cap
  - unlocked or missing LP with concentrated risk
- Persist denied tokens to the token deny-list.
- Re-run token-armor for copy trades at T+0, even if the wallet is trusted and
  the token was checked earlier.
- Respect `allowUnknownTokens: false` for live trading.

## Workflow

1. Normalize token address and chain.
2. Fetch security features from intel and/or chain.
3. Compare each feature to configured caps.
4. If a veto exists, record `RiskVeto` and abort.
5. If pass, allow routing to continue with a normal token-risk score.
6. For copy trades, never skip this step.

## Copy-specific warning

Copy origin must still run token-armor. A trusted wallet is not a token auditor.
A promoted wallet can buy a honeypot, and the copy engine must refuse that
specific order.
