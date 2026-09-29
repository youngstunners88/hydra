---
name: forecast-grading
description: |
  Score probability forecasts against baselines before trusting or comparing
  them. Load before writing a Brier/calibration comparison, before reading any
  arm's numbers, and whenever a model's probability is about to size, rank or
  gate something.

  Built from Hydra (2026-09-24). Two Jev arms had been compared with each other
  for a day. One line with a constant 0.5 beside them showed that both were
  worse than a coin, and so was the heuristic arm. The reliability table showed
  why: the model ranks wallets in the right order, but its level is off by
  about 0.36.
allowed-tools: Bash Read
usage: |
  python3 10-Skills/forecast-grading/scripts/grade.py \
      --hydra-journal ../hydra/ops/journal/jev-local.jsonl \
      --arms heuristic,single,permuted --compare single,permuted
  python3 10-Skills/forecast-grading/scripts/grade.py --jsonl rows.jsonl --arms a,b
  python3 -m pytest 10-Skills/forecast-grading/tests -q
---

# Forecast grading

## Three rules

1. **Every table has a coin in it.** Show Brier for a constant 0.5 beside every
   arm. A forecaster scoring 0.25 or worse knows less than nothing on this
   data, however good it looks next to a rival arm. `grade.py` prints
   `WORSE THAN A COIN` when this happens.
2. **Same units, every arm.** Grade only the units that are resolved in every
   arm you compare. If two arms disagree on a unit's outcome, the tool raises,
   because they were graded against different events. A unit recorded twice in
   one arm also raises, because one decision per unit broke.
3. **Exploratory is not a verdict.** The first line of the output says so,
   every time. Verdicts come from a sealed grader with a sealed minimum; see
   `measure-first`. A bootstrap CI that excludes 0 at n=83 does not overrule a
   sealed minimum of 97.

## Read the table in this order

| Column | What it tells you |
|---|---|
| **Brier vs const 0.5** | Is there any skill at all? |
| **bias** (mean p − base rate) | Is the level wrong? Hydra's `single` arm: **−0.357**. |
| **reliability bins** | Does the order carry information even when the level is wrong? If the observed rate rises across the bins, the model *discriminates*. That is fixable with recalibration, which is a separate sealed experiment. If the observed rate is flat across the bins, there is nothing to rescue. |
| **extreme** (share with p < 0.1 or p > 0.9) | Sharpening. Choice probabilities are argmax-sharpened (`jev-prompt-design` §7). Hydra `single` 0.20 vs `permuted` 0.01. |
| **base rate, OPTIMISTIC** | The best any constant could have done. It is fitted on the outcomes it is scored on, so it is a ceiling for a constant, not a rival arm. |
| **NLL** | Punishes confident misses harder than Brier does. `p` is clipped to [1e-6, 1−1e-6], as the output states. |

## What the Hydra numbers said (2026-09-24, n=83, exploratory)

```
arm        Brier   mean p   bias    extreme
heuristic  0.2556  0.636   +0.058   0.00
single     0.3498  0.221   -0.357   0.20
permuted   0.3116  0.292   -0.287   0.01
const 0.5  0.2500
reliability single: p=0.07 -> obs 0.29 ... p=0.36 -> obs 0.88  (rises: it discriminates)
```

- No arm beats a coin.
- The Jev arms carry ordering information but are biased low. The sealed
  noul-retention-v2 tests whether a Noul fixes the level.
- A post-hoc recalibration would have to be a new sealed experiment. It must
  never be applied to this data and then reported.

## Input formats

- `--hydra-journal`: the append-only decision/outcome log. The arm is the
  action suffix after `@`, the unit is the wallet, and `y` is the outcome
  (1 = the sealed rule said CORRECT). Unresolved and legacy un-suffixed actions
  are dropped.
- `--jsonl`: one `{"arm", "unit", "p", "y"}` per line, for anything else, such
  as tradecc paper trades or intake classifiers.

## See also

- `measure-first`: seal the prediction and the decision rule before looking.
- `outcome-resolution`: how `y` is produced without biasing it.
- `jev-prompt-design` §7: ask a Noul when the number will be used as a probability.
