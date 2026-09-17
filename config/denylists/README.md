# Denylists

These files are populated **at runtime** by `RiskVeto` events, `WalletRetired`
events, or explicit operator action via the CLI.

They are **not** the primary control surface and should **never** be
hand-curated as the first line of defense. The primary defense is the
risk / scoring pipeline in `packages/hunter` and `packages/risk`.

- `tokens.json` — token addresses that must not be traded.
- `wallets.json` — wallet addresses that must not be copied or followed.

Both are plain JSON arrays of strings.
