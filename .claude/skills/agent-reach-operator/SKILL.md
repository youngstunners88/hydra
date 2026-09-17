---
name: agent-reach-operator
description: Run agent-reach doctor --json first, then call upstream Agent-Reach tools directly for public web and social intel extraction.
---

# Agent-Reach Operator

## Why this rule exists

Agent-Reach is a capability layer. It already provides web reading, social
search, YouTube transcripts, GitHub, RSS, and Exa web search through upstream
tools. Reimplementing it inside Hydra creates duplicated code, broken
permissions, and insufficient tool validation.

Hydra should call upstream tools directly after verifying the Agent-Reach
installation.

## Failure scenarios this prevents

1. **Broken local wrapper:** A custom wrapper calls tools without first checking
   `agent-reach doctor --json`.
2. **Over-scraping:** A path pulls personal profiles instead of token/wallet
   mentions.
3. **Rumor as fact:** A X post claims PnL and the system stores it as on-chain
   truth.
4. **No extraction control:** Search results return emails and phone numbers,
   and they get stored without filtering.

## Hydra port

`packages/intel/agent-reach/` exposes:
