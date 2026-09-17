---
name: position-fsm
description: Only emit copy or strategy orders from legal position states; never allow duplicate entries or exit from an aborted state.
---

# Position FSM

## Why this rule exists

A position has a lifecycle. If the strategy/copy engine can emit orders from any
state, it will duplicate entries, scale after failure, or exit a position it
never opened.

The FSM keeps the system's behavior legible and prevents order-state
inconsistency.

## States
