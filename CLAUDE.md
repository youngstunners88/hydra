# HYDRA — Agent Operating Contract

This file is the binding version of SPEC.md section 15. Read it before writing or
running any Hydra code.

Hydra is an intelligence + execution platform. It can discover public smart-money
wallets and, eventually, submit real transactions. That power requires hard
boundaries. Every rule below exists because a real loss can happen when a
component crosses the wrong lane.

---

## 1. Two-plane rule

Hydra has two operational planes plus a decision layer:
