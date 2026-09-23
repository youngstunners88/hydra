---
name: jev-architecture
description: |
  How to build a closed-set decision engine (Jev, or anything like it) into a
  system so the concerns stay separate: planes, ports and adapters, state
  that cannot be pooled wrongly, a folder layout a checker enforces, and a
  routing cascade that only pays for what it has to.

  Load before adding Jev to a codebase, before adding a new decision engine
  or tier, before adding a package, and whenever an import "just needs" to
  reach across a boundary.

  Built from Hydra (2026-09-23): SPEC section 8's layer table had been prose
  since day one; the first check found 2 violations. The Jev layer that
  followed has exactly one file that knows Jev exists.

allowed-tools: Bash Read
usage: |
  python3 -m pytest 10-Skills/jev-architecture/tests -q
  python3 10-Skills/jev-architecture/scripts/layers.py <root> <rules.json>
  python3 10-Skills/jev-architecture/scripts/gate_stability.py 0.7 0.62 0.74 0.67
---
<!-- Vendored from Solomons-Chamber@fe673ca 10-Skills/jev-architecture. Edit upstream, then re-vendor. -->

# Jev architecture

## 1. Separation of concerns: planes first, then ports

Hydra's planes (SPEC §1): **hunt** discovers, **decide** judges, **exec**
acts, **state** records, **control** wires them together. Jev belongs to
*decide*: it scores and promotes; it never discovers and never signs.

Inside a plane, **ports and adapters**:

```
callers (router, promotion, scripts)  ──depend on──▶  DecisionEngine (port)
JevHttpEngine / PermutedEngine / ScriptedEngine  ──implement──▶  DecisionEngine
```

Two rules make it hold:

- **The consumer owns the port.** Hydra's resolver needs three chain reads, so
  `decide/resolve/chain.ts` declares a three-method `ChainReader`. The hunt
  plane's `RpcChainReader` satisfies it **structurally, without importing
  it**. Neither plane depends on the other; the control plane's typecheck is
  what proves the adapter fits.
- **Exactly one file knows the vendor.** `adapters/jevHttp.ts` is the only
  file with Jev's wire format. Replacing Jev means replacing one file.

## 2. File and folder system — as data, enforced

```
packages/decide/src/jev/
  types.ts        questions, verdicts, ConfidenceKind   (no I/O)
  port.ts         DecisionEngine                        (the seam)
  egress.ts       what may leave the process            (policy)
  router.ts       the cascade                           (routing)
  adapters/       jevHttp · permuted · scripted         (infrastructure)
```

The dependency rule lives in `ops/layers.json` and a checker fails CI on any
edge not listed. **Deny by default**: an unlisted package may import nothing.

> SPEC §8 stated this rule as a table from the first commit. Nothing checked
> it. The first check found two violations. A rule that is only prose is
> obeyed until the first deadline.

The checker must catch **relative paths that climb into another package**
(`../../../exec/src/x.ts`). That is the form that slips past review, because
it does not look like a dependency. `scripts/layers.py` does this for Python
and TS repos; Hydra ships a TS version in `scripts/check_layers.ts`.

## 3. Modularity: decorators, not flags

Permutation averaging is a `DecisionEngine` wrapping a `DecisionEngine`. Nothing
downstream knows it is on. Turning it on is a composition choice in the
control plane:

```ts
const engine = new PermutedEngine(new JevHttpEngine({ getKey }), 6);
```

A boolean `permute: true` threaded through every call site is the
alternative, and it is how one feature ends up touching forty files.

## 4. State management: the kind travels with the number

Three kinds of confidence exist, and **they are on different scales**:

| Kind | What it is | Measured (identical input ×3) |
|---|---|---|
| `single` | Jev's own confidence | 0.62 / 0.74 / 0.67 |
| — | Jev's top probability, same calls | 0.75 / 0.82 / 0.78 |
| `permuted` | mean top probability over orderings | ≈ top-probability scale |
| `heuristic` | a local rule's score | its own scale |

`single` sits ~0.1 below the top probability. Averaging `single` and
`permuted` in one calibration bucket does not measure a mixture of two
methods — it mixes two rulers.

So the kind is part of the **key**, not a comment:
`journalAction("wallet_promotion", "permuted")` → `wallet_promotion@permuted`.
The journal calibrates per action, so kinds **cannot** share a bucket.

The broader state rules, from the paper-clock and outcome-resolution skills:
append-only log; derive (clock start = oldest decision), never store a claim;
a resolve is a new line, never an edit.

## 5. Abstraction layers (do not collapse)

```
Skills / CLI              scripts/*.ts — the control plane, wires adapters
Application services      promote(), resolvePending(), DecisionRouter
Domain ports              DecisionEngine, ChainReader, PromotionJournal
Infrastructure            JevHttpEngine, RpcChainReader, FileSink
```

A service that constructs its own adapter has collapsed two layers. Pass it
in.

## 6. Routing: a cascade that must earn its keep

```
tier 0  local heuristic   free, instant, nothing leaves the machine
tier 1  Jev               ~0.4 s, state crosses the egress policy
```

Enforced at construction:

- **Break-even.** Costs c₀ < c₁, escalation rate p. The cascade wins iff
  **p < 1 − c₀/c₁**. A config that can't win is refused.
- **Remote tier ⇒ egress policy.** What leaves the process is decided once, by
  the router. Deny by default; anything shaped like a private key, mnemonic or
  PEM block is a hard refusal even inside an allowed key.
- **UNDECIDED is a result.** If no tier clears its gate, or a tier throws, the
  answer is undecided with a reason. A failed remote call **never** falls
  back to the cheap tier's *rejected* guess as though it had passed.
- **Batch per tier.** Everything to tier 0 in one call; everything it rejected
  to tier 1 in one call.

### Set gates away from where the engine's answers cluster

Identical input gave confidence 0.62, 0.74, 0.67. A **0.7 gate on that
question is a coin flip**: it passes on some calls and not others.
`scripts/gate_stability.py` takes repeated samples and reports the pass rate
at a threshold. Anything between 10% and 90% is an unstable gate.

Each tier's gate is set on **its own engine's scale** (see §4). One threshold
shared across a `single` tier and a `permuted` tier is two different gates.

## 7. Paired experiments: one request, one scale, power per arm

Hydra's `permutation-brier-v1` (sealed before its data) is the worked example.

- **Pair from ONE request.** A `CapturingEngine` inside a `PermutedEngine`
  hands back ordering 0, the canonical order, from the same call as the
  average. Two separate calls would add call-to-call noise (0.62–0.74 on
  identical input) to every paired difference.
- **Compare on one scale.** Both arms forecast P(event), not Jev's
  `confidence` field, which describes the argmax and sits ~0.1 lower.
- **Power is per arm.** Three arms per subject means 97 outcomes *across*
  arms is ~33 subjects, three correlated outcomes counted as independent. The
  minimum holds within one action. Hydra's status tool had this wrong; it was
  caught before shipping.

**Measured order bias on a two-option question:** P(retains) came out ≈2×
higher in the averaged forecast than in the canonical order on every wallet
(0.30 vs 0.16), meaning the option listed **second** was favoured, a ~0.28
swing. That is the opposite direction to a first-position bias, and larger
than the 17pp seen at width 25. Don't assume which way the bias runs; measure
it per question shape.

## 8. The wire adapter refuses rather than coerces

A malformed answer quietly coerced into a plausible one is worse than an
error, because the caller acts on it. Refuse: wrong option set; mass not
summing to 1 ± 0.02; a `choice` that is not its own most probable option
(observed ~1 in 250). The API key appears only in the Authorization header;
test that it is absent from the body and from every error.

## Checklist: adding an engine, tier or package

```
[ ] new engine implements the port; nothing else imports it except scripts/
[ ] its confidenceKind is new or correct, and journalled under its own action
[ ] its tier's gate is set on its own scale, away from its answer cluster
[ ] remote? it has an egress policy with the minimum keys
[ ] cascade still beats break-even with the new costs
[ ] new package? add it to layers.json — until you do, it may import nothing
[ ] layers check, typecheck and tests pass; mutation-test the new guards
```

## See also

- `10-Skills/decision-cascade/` — break-even derivation and Python cascade.
- `10-Skills/rapid-assessment/` — the measured batching envelope and permute.py.
- `10-Skills/outcome-resolution/`, `10-Skills/paper-clock/` — the state rules.
