---
name: outcome-resolution
description: |
  Grade predictions against reality without the grading itself becoming the
  thing that is wrong. Load before writing any resolver, labeller, backtest
  scorer, or "was the decision right?" job — anything that turns a recorded
  prediction into a recorded outcome.

  Recording decisions is half a journal. Hydra recorded 22 and resolved 0:
  calibration was vacuous and the gate could never open. The second write is
  where every subtle bias lives, and five of them are silent.

allowed-tools: Bash Read
usage: |
  python3 -m pytest 10-Skills/outcome-resolution/tests -q
---
<!-- Vendored from Solomons-Chamber@fe673ca 10-Skills/outcome-resolution. Edit upstream, then re-vendor. -->

# Outcome resolution

A resolver has one job — write "right" or "wrong" once per prediction — and
five ways to do it with a straight face while producing a calibration curve
that means nothing.

## The five silent biases

| # | Bias | What it does | Guard |
|---|---|---|---|
| 1 | **Rule chosen after looking** | Any curve can be made to look good | Seal the rule, commit it alone, verify its hash every run |
| 2 | **Unknown resolved as wrong** | Brier moves with the RPC's health | Three fates: resolved / immature / unreadable |
| 3 | **Look-ahead** | State from after the decision leaks in | "Latest at or before", never "nearest" |
| 4 | **Correlated samples** | n is inflated; the interval is fiction | One decision per subject, ever |
| 5 | **Proxy read as the real thing** | A narrow answer gets a broad reading | Name the proxy in the rule text itself |

### 1. Seal the rule before the first outcome

A resolution rule picked after seeing outcomes is re-grading one level up.
Hydra's rule was committed **on its own** (`c62c92b`) with zero outcomes in the
journal — git history is the proof of ordering. The resolver refuses to run
unless the rule in code hashes to the sealed value, **every run**, because the
failure is a later edit nobody re-seals.

Changing the rule needs a new rule id **and a new journal action**. Old and new
resolutions must never share a calibration bucket. `seal.py` does the hashing
and the refusal.

### 2. Unknown is not wrong

Every pending decision gets exactly one fate per run:

- **resolved** — all reads succeeded; judged; written once, *last*
- **immature** — horizon not reached; stays pending; costs **zero reads**
- **unreadable** — a read failed; stays pending; reason reported

Resolving an unreadable decision as "wrong" looks conservative. It isn't: it
couples the calibration to infrastructure uptime, and nothing reports it. A
bad afternoon at the RPC provider becomes a worse Brier score.

Two maturity checks, not one: the **wall clock** (cheap, no reads) and the
**chain head** (the head can lag wall time). Skipping either was caught by a
mutation test.

**Write last.** Every read first, then the one write. A throw between reads
must leave the decision pending, never half-judged.

### 3. No look-ahead

"The block nearest the decision time" can be a block mined *after* the
decision. Reading state from it leaks the future into the baseline. Use the
**latest block at or before** the moment. Binary search, <30 reads over tens of
millions of blocks. `lookahead.py` asserts the invariant.

### 4. One decision per subject

The 97-outcome minimum (`n ≥ (1.96/(2·0.1))²`) assumes independent samples. A
hunter that re-observes the same whale every hour records twenty correlated
copies of one prediction: n says 20, the information says 1. Hydra's hunter
journals **one decision per wallet, ever** — verified live: 20 observed, 3
skipped as already journalled. `independence.py` finds duplicates in an
existing journal.

### 5. Name the proxy in the rule

Hydra's prediction is "this wallet is worth trusting". Profit needs token
prices the hunt plane cannot read, so the rule measures **native-balance
retention over 6 hours**. That is not profit: a wallet that swapped its PLS
into a token that tripled resolves *wrong*.

That's fine **if the rule text says so**. The resulting calibration answers
exactly one question — does the hunter's confidence predict native-balance
retention? — and writing that into the sealed text is what stops it being read
as "does it predict profit" three weeks later.

## Before you run the first resolve

```
[ ] rule written as text, hashed, committed ALONE, zero outcomes present
[ ] resolver verifies the hash on every run
[ ] immature and unreadable stay pending — test that neither writes
[ ] block/time lookup is at-or-before — test the between-blocks case
[ ] one decision per subject — test a re-observed subject is skipped
[ ] live dry run on a synthetic OLD decision, before real ones mature
```

The last one matters. Hydra's first real decision matured at 15:07Z. The live
read path — archive balances, block search — was proven at 09:40Z against a
synthetic 7-hour-old decision in memory. Finding a broken archive endpoint at
maturity would have cost a day.

## See also

- `10-Skills/paper-clock/` — the first write, and four ways the clock lies.
- `10-Skills/measure-first/` — pre-registration generally.
