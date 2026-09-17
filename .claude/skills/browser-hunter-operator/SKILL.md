---
name: browser-hunter-operator
description: Use the Browser Use sidecar only for structured fallback extraction when an official API has no coverage.
---

# Browser Hunter Operator

## Why this rule exists

Browser Use can extract wallet and token data from public UI pages that do not
have official APIs, especially on PulseChain and some Robinhood Chain pages.

A browser is also a dangerous tool. It can follow links, read authenticated
pages, and expose cookies. Therefore it must be isolated in a Python sidecar
with strict budgets, schemas, and an allowlist.

## When to use Browser Use

Only when:

- GMGN has no API coverage, such as PulseChain and some Robinhood Chain pages.
- A public leaderboard or UI is the only source.
- An explorer page must be extracted into a schema.

Do not use Browser Use to scrape GMGN logged-in account pages when the official
API exists.

## Sidecar

- Python >= 3.11.
- Located at `services/browser-hunter/`.
- Returns structured `WalletCandidate` lists only.
- No screenshots persisted by default.
- Must be headless.
- Must use domain allowlist from `config/allowlists/domains.txt`.

## Failure scenarios this prevents

1. **Playwright in exec path:** A TS swap adapter launches a browser and slows
   or contaminates execution.
2. **Off-allowlist drift:** A task follows a link to a personal profile or
   credential-gated page.
3. **Credential autofill:** Browser session fills a password manager entry on a
   page that should be anonymous.
4. **Private key leak:** Sidecar inherits the hot wallet environment and a page
   task reads it.
5. **Unstructured extraction:** Browser returns raw HTML without a schema,
   making data validation impossible.

## Agent must

- Use the sidecar, not inline Playwright in TS exec.
- Enforce domain allowlist.
- Use structured Pydantic or Zod output.
- Apply budgets:
  - max steps default 20
  - max seconds default 90
- Run headless.
- Disable password manager.
- Never type seed, private key, or 2FA from the hot wallet.
- Return only `WalletCandidate` records from fallback tasks.
- Never persist screenshots by default.
- Throw on off-allowlist domains.

## PulseChain and Robinhood fallback example

PulseChain has no GMGN slug. The flow:

1. GMGN slug map returns `null` or API 404.
2. Set venue intel degraded.
3. Route to browser hunter tasks:
   - `pulse_smart_wallets`
   - GeckoTerminal top traders
   - PulseScanner or PulseX UI
4. Extract `WalletCandidate` records.
5. Merge into hunter pipeline as observations.
6. Never let browser hunter create live orders.

## Hard rule

Browser Hunter is Hunt plane. It cannot import `EVM_PRIVATE_KEY`,
`SOLANA_PRIVATE_KEY`, or any hot wallet seed.
