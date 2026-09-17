---
name: allowlist-domains
description: Keep Browser Use confined to the exact public domains required for fallback intel extraction.
---

# Allowlist Domains

## Why this rule exists

Browser automation can follow links, open new tabs, store local data, and access
authenticated sessions. Without a strict allowlist, a browser task can drift
into email, banking, personal profiles, or internal pages.

The browser sidecar exists to extract structured data from public trading and
explorer pages when official APIs do not cover a chain. It is not a general web
agent.

## Allowed domains for v1

The browser sidecar may visit only these domains:
