---
name: kill-switch
description: Honor data/HALT file existence and auto-halt conditions when 5 live transactions fail in 10 minutes.
---

# Kill Switch

## Why this rule exists

An execution bug can lose money in seconds. Human callers may not be able to
stop a fast copy engine or a retry loop. A kill switch gives Hydra a simple,
reliable, file-system-level brake.

Hydra fails closed on money. If the halt file exists, live money actions stop
immediately.

## Exact halt check

`data/HALT` is a plain file.

- Check: `fs.existsSync(path.join("data", "HALT"))` or equivalent in the host
  language.
- If the file exists:
  - No new live/execution orders may be submitted.
  - No signed transaction may be broadcast.
  - No copy trade may be generated.
  - Quoting and paper research may continue unless an additional safety rule
    forbids them.
- If the file does not exist:
  - Live execution may proceed only if all other risk checks pass.

`scripts/halt.sh`:

- Touches `data/HALT`.
- Emits `KillSwitchFlipped`.

`scripts/resume.sh`:

- Removes `data/HALT`.
- Emits an event noting normal operation resumed.

`hydra doctor` must report whether `data/HALT` exists.

## Five failed live transactions in 10 minutes

Auto-halt means Hydra creates `data/HALT` itself when the risk counter reaches
the threshold.

Operationally:

1. A live transaction counts as failed when the order emits `OrderFailed` after
   broadcast.
2. Pre-trade risk vetoes do not count.
3. Simulation aborts do not count.
4. Dry-run and paper fills do not count.
5. The counter tracks a rolling 10-minute window.
6. If `count(failed live txs within last 10 minutes) >= 5`, Hydra:
   - creates `data/HALT`,
   - emits `KillSwitchFlipped`,
   - stops all live execution,
   - notifies the control plane.

This threshold exists so a router bug, RPC outage, or signing misconfiguration
cannot create an uncontrolled error storm.

## Agent must

- Check `data/HALT` before every live order path, including copy.
- Treat halt as fail-closed, even if the cause seems unrelated.
- Not remove `data/HALT` automatically without operator intent.
- Not count dry-run, paper, simulation, or risk-veto failures toward auto-halt.
- Before running live test commands, confirm the halt file is absent or
  explicitly call `scripts/resume.sh` as an operator decision.
- If auto-halt triggers, stop and diagnose before resuming.

## Failure scenarios this prevents

1. **Error storm:** Five rapid live failures due to an RPC chainId mismatch
   would otherwise continue because the service loop remains up.
2. **Manual stop:** An operator can stop live money by creating a file, even if
   a process is stuck.
3. **Copy-loop loss:** A copied wallet repeatedly fails to fill but keeps
   generating new live attempts. Halt stops the loop.
4. **Temporary bridge or router outage:** Live sends keep failing; halt prevents
   accumulation of losses before a human is available.
