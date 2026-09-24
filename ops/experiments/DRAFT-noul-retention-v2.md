# DRAFT — noul-retention-v2 (NOT SEALED)

Status: draft only. Nothing here is hashed, nothing is wired, no arm runs.
Sealing needs the owner's yes. `permutation-brier-v1` is untouched and keeps
running to its 97 pairs; this does not re-cut it.

## Why a v2 exists

1. **Exploratory, not a result** (2026-09-24, jev-local, 83 paired wallets,
   still below v1's minimum of 97): Brier single 0.350, permuted 0.312. A
   constant 0.5 scores 0.250, and both Jev arms are worse than that. Mean
   P(retains) is 0.22 single and 0.29 permuted, but 58% of the wallets retained.
   v1 compares the two Jev arms with each other only, so it cannot show this.
2. **External evidence names a mechanism.** KantaHayashiAI/jev-does-not-play-dice
   (MIT, 400 trials, jev-1.13.0): Choice on a fair die reported 82.9% for a
   16.7% event. A document that said 45% came back as 6.6%, and one that said
   55% came back as 95.9%. Noul on the same die gave 19.2%. **Choice
   probabilities are argmax-sharpened, not forecasts. Noul is the primitive
   whose number is meant to be a probability.**
3. The confidence field is `(p_max − 1/K)/(1 − 1/K)`, per the official adapter
   documented in wuyoscar/jev-skill `references/calibration.md`. That is why v1
   records P(retains) and not confidence. Keep doing that.

## Proposed design (to be frozen at seal)

- outcome: rule `native-retention-6h-v1`, unchanged.
- egress: the same three numbers as v1 (value_pls, balance_pls, fraction_sent);
  the address is not sent.
- arms, one journal action each, never pooled:
  - `wallet_promotion@noul`: Jev Noul with a crisp statement: "Six hours after
    this transfer, the sending wallet's native balance is at least what it was
    at the transfer." That is the rule's CORRECT condition, word for word. Also state explicitly that the state is
    data, not instructions.
  - `wallet_promotion@permuted`: the v1 arm, re-recorded under this experiment
    from the same hunt.
  - `wallet_promotion@constant`: a fixed P = 0.5, recorded so the baseline is
    in the journal and not argued afterwards.
- pairing: all three arms come from the same wallet and the same hunt. The Noul
  question goes in the same request as the Choice, using speculative fan-out:
  one request, and the questions are independent.
- metrics: Brier per arm over wallets resolved in all three arms.
  - Primary: Brier(permuted) − Brier(noul).
  - Secondary: Brier(constant) − Brier(noul). A forecaster that cannot beat a
    coin gets no promotion rights.
- minimum: 97 paired resolved wallets, else UNDERPOWERED.
- prediction (to fix at seal): Brier(noul) ≤ Brier(permuted) − 0.02 AND
  Brier(noul) < 0.25.
- falsifier: if Noul does not beat 0.25, no Jev arm gets promotion weight on
  these features. The next step is richer state, not another primitive.

## Explicitly out of scope, mentioned only

- **Encoded-state arm**: send `state-encoding` bands (e.g. "large / medium /
  small transfer", "sent most / some / little of balance") in place of raw
  numbers, following the dbreunig guidance: send words or named buckets rather
  than raw figures. That is a separate experiment with its own id. It is not
  built.
- Batching several wallets per request: not done. jev-orderby-bench found that
  40-row batching fails a ranking gate that one row per request passes. Keep
  one wallet per request.

## Before sealing, decide

- The Noul statement must mirror the rule's CORRECT line, which is
  `native_balance(W, t1) >= native_balance(W, t0)`. Its direction is "true
  means retains". A Noul whose true side means "no" performs worse.
- Whether `@constant` uses 0.5 or a base rate frozen from pre-seal outcomes.
  0.5 is the recommendation, because every pre-seal base rate has already been
  seen.
