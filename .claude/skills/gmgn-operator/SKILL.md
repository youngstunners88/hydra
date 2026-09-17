---
name: gmgn-operator
description: Use official GMGN OpenAPI, Skills, or gmgn-cli for on-chain intel; never depend on browser-console scraping as the production path.
---

# GMGN Operator

## Why this rule exists

GMGN is the primary on-chain intel source for Solana and Base. It can tell us
PnL, winrate, holdings, activity, token security, and smart-money flows.
Unofficial browser scraping is fragile, may violate terms, and can expose logged
in session data.

The production path must be official API, skills, or CLI.

## Failure scenarios this prevents

1. **Console scraper breakage:** A browser path depends on page HTML and breaks
   when GMGN changes markup.
2. **Session leakage:** Scraping a logged-in account page captures private
   account data and cookies.
3. **Wrong chain slug:** Calling Solana slug for Base data silently returns bad
   results.
4. **Crash on PulseChain:** Slug is null or 404 and code throws, killing the
   whole hunt engine instead of degrading.
5. **Unauthorized execution:** Using GMGN swap as a hidden copy-trade path can
   send orders outside Hydra risk limits.

## Chain slug map

Maintain in `packages/intel/gmgn/chain-map.ts`:
