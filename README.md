# Hydra

> **Status: scaffold only, no live trading, no live scraping until skills +
> tests in SPEC.md section 6 and 14 are wired and reviewed.**

Hydra is a modular multi-chain execution + smart-wallet hunter platform. It
discovers public smart-money wallets, scores and clusters them, and — only
after security and quality gates pass — can optionally copy-trade them on
Solana, Base, Robinhood Chain, and PulseChain.

**Two-plane safety rule:** the hunt plane never signs transactions, and the
exec plane never scrapes social data. A hunted wallet can only become a live
order after passing through the decision plane's full scoring and risk gates.

- [SPEC.md](SPEC.md) — full implementation spec
- [CLAUDE.md](CLAUDE.md) — binding operational contract

## Quickstart
