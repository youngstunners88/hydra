---
name: no-dox
description: Store only public wallet addresses and public handles; never collect personal identity, email, phone, or home address.
---

# No Dox

## Why this rule exists

Hydra hunts wallet mentions across public social pages. The same scraping path
that finds a public wallet address can also find an email address, phone number,
home address, or government ID. Those are not required for on-chain trading and
must not be persisted.

Doxxing is not just a policy failure; it is a life-safety risk. A trading
system must not become a tool that connects a wallet to a private person.

## Precise wallet-mention rules

The agent and extractor may accept only these shapes:

1. Solana base58 address, 32 to 44 characters.
2. EVM address, `0x` followed by exactly 40 hex characters.
3. Explicit `CA:` or `wallet:` context containing one of the above shapes.

Everything else is rejected.

The extractor must drop anything that looks like:

- email addresses
- phone numbers
- physical addresses
- government IDs
- passport numbers
- social security or tax identifiers
- account login names that are not wallet-related public handles

## Why email and phone leakage is a specific risk

Hydra's whole job is scraping social media and public web pages. Social posts
often include:
