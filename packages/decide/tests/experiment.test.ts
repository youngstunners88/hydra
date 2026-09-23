import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { DecisionJournal } from "../../risk/src/journal.ts";
import { promote, PROMOTION_ACTION } from "../src/promotion.ts";
import { ScriptedEngine } from "../src/jev/adapters/scripted.ts";
import { CapturingEngine } from "../src/jev/adapters/capture.ts";
import type { DecisionState } from "../src/jev/port.ts";
import type { Question } from "../src/jev/types.ts";
import {
  ARM_ACTIONS, RETAIN_QUESTION, confidenceFromValue, features, jevForecasts,
} from "../src/experiment/retentionArms.ts";
import { pairedBrier, SEALED_MINIMUM, SEALED_THRESHOLD } from "../src/experiment/pairedBrier.ts";
import { CachedChainReader } from "../src/resolve/chain.ts";
import type { BlockHeader, ChainReader } from "../src/resolve/chain.ts";

/** Jev stand-in with a SECOND-position bias, as measured: +0.28 to whichever option is listed second. */
function secondBiased() {
  const seen: { state: DecisionState; questions: readonly Question[] }[] = [];
  const e = new ScriptedEngine("jev-fake", (_s, q) => {
    if (q.kind !== "choice") throw new Error("unexpected");
    const [first, second] = Object.keys(q.options) as [string, string];
    const probabilities = { [first]: 0.86, [second]: 0.14 };
    if (first === "declines") { probabilities.declines = 0.58; probabilities.retains = 0.42; }
    return { kind: "choice", choice: first, confidence: 0.7, probabilities, confidenceKind: "single" };
  });
  const wrapped = { id: e.id, remote: false, decide: async (state: DecisionState, questions: readonly Question[]) => {
    seen.push({ state, questions }); return e.decide(state, questions); } };
  return { wrapped, seen };
}

describe("retention arms", () => {
  it("arm actions are distinct and carry their confidence kind", () => {
    assert.equal(ARM_ACTIONS.single, "wallet_promotion@single");
    assert.equal(ARM_ACTIONS.permuted, "wallet_promotion@permuted");
    assert.equal(new Set(Object.values(ARM_ACTIONS)).size, 3);
  });

  it("the canonical order lists `retains` FIRST, as sealed", () => {
    assert.deepEqual(Object.keys(RETAIN_QUESTION.options), ["retains", "declines"]);
  });

  it("single and permuted come from ONE request", async () => {
    const { wrapped, seen } = secondBiased();
    await jevForecasts(wrapped, features(100, 900));
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.questions.length, 2);
  });

  it("single is the canonical ordering's P(retains); permuted is the mean", async () => {
    const { wrapped } = secondBiased();
    const f = await jevForecasts(wrapped, features(100, 900));
    assert.ok(Math.abs(f.single - 0.86) < 1e-12);
    assert.ok(Math.abs(f.permuted - (0.86 + 0.42) / 2) < 1e-12);
  });

  it("sends only the three sealed features -- never the address", async () => {
    const { wrapped, seen } = secondBiased();
    await jevForecasts(wrapped, features(100, 900));
    assert.deepEqual(Object.keys(seen[0]?.state ?? {}).sort(), ["balance_pls", "fraction_sent", "value_pls"]);
  });

  it("fraction_sent is the share of the pre-transfer balance", () => {
    assert.equal(features(100, 300).fraction_sent, 0.25);
    assert.equal(features(0, 0).fraction_sent, 0);
  });

  it("refuses negative features", () => {
    assert.throws(() => features(-1, 5));
  });

  it("records no pair when the engine fails -- never a single without its twin", async () => {
    const boom = { id: "x", remote: false, decide: async () => { throw new Error("503"); } };
    await assert.rejects(() => jevForecasts(boom, features(1, 1)), /503/);
  });

  it("confidenceFromValue is clamped and monotone", () => {
    assert.equal(confidenceFromValue(10, 10), 0.5);
    assert.ok(confidenceFromValue(1e12, 10) <= 0.95);
    assert.ok(confidenceFromValue(100, 10) > confidenceFromValue(20, 10));
  });

  it("the experiment seal still matches its text", () => {
    const s = JSON.parse(readFileSync("ops/experiments/permutation-brier-v1.json", "utf8"));
    assert.equal(createHash("sha256").update(s.text).digest("hex"), s.sha256);
    assert.equal(s.paired_resolved_at_seal, 0);
  });
});

describe("CapturingEngine", () => {
  it("exposes the inner verdicts of the latest call and resets per call", async () => {
    const e = new CapturingEngine(new ScriptedEngine("s", () => ({ kind: "probability", probability: 0.3, confidenceKind: "single" })));
    await e.decide({}, [{ kind: "probability", name: "a", statement: "x" }]);
    assert.ok(e.last.has("a"));
    await e.decide({}, [{ kind: "probability", name: "b", statement: "x" }]);
    assert.ok(!e.last.has("a") && e.last.has("b"));
  });
});

describe("promote with an explicit action", () => {
  it("records under the given action and judges paperMetricsPassed on it alone", () => {
    const j = new DecisionJournal();
    for (const a of [PROMOTION_ACTION, ARM_ACTIONS.single]) j.setThreshold(a, 0.7, "t", "t");
    // Plenty of resolved history in the LEGACY action...
    for (let i = 0; i < 120; i += 1) { const r = j.record(PROMOTION_ACTION, `w${i}`, 0.9); j.resolve(r.id, true); }
    const out = promote(j, { walletId: "0x" + "a".repeat(40), from: "watchlisted", to: "trusted", confidence: 0.4,
      gates: { hasValidAddress: true, hasAtLeastOneSource: true, hasProfileAndSecurityFeatures: true,
        meetsWatchMinScore: true, isNotSybil: true, isConfirmedByHumanOrAutoPromote: true } },
      { baseline: 0.5 }, ARM_ACTIONS.single);
    // ...does not let a different action's promotion through.
    assert.equal(out.paperMetricsPassed, false);
    assert.equal(j.all(ARM_ACTIONS.single).length, 1);
  });
});

describe("pairedBrier", () => {
  const W = (i: number) => `0x${i.toString(16).padStart(40, "0")}:watchlisted->trusted`;
  const arm = (n: number, conf: number, outcome: (i: number) => boolean | null) =>
    Array.from({ length: n }, (_, i) => ({ answer: W(i), confidence: conf, outcome: outcome(i) }));

  it("is UNDERPOWERED below the sealed minimum, whatever the difference", () => {
    const r = pairedBrier(arm(50, 0.1, () => true), arm(50, 0.9, () => true));
    assert.equal(r.verdict, "UNDERPOWERED");
    assert.equal(r.pairs, 50);
  });

  it("HELD when permuted beats single by at least the threshold", () => {
    const r = pairedBrier(arm(100, 0.2, () => true), arm(100, 0.5, () => true));
    assert.equal(r.verdict, "HELD");
    assert.ok(r.improvement >= SEALED_THRESHOLD);
  });

  it("FALSIFIED when the improvement is below the threshold", () => {
    const r = pairedBrier(arm(100, 0.5, () => true), arm(100, 0.5, () => true));
    assert.equal(r.verdict, "FALSIFIED");
  });

  it("counts only wallets resolved in BOTH arms", () => {
    const r = pairedBrier(arm(100, 0.5, (i) => (i < 60 ? true : null)), arm(100, 0.5, () => true));
    assert.equal(r.pairs, 60);
  });

  it("...in BOTH directions: an unresolved permuted twin is dropped too", () => {
    // The case above only left arm A unresolved; a mutation that checked A
    // alone survived it.
    const r = pairedBrier(arm(100, 0.5, () => true), arm(100, 0.5, (i) => (i < 60 ? true : null)));
    assert.equal(r.pairs, 60);
  });

  it("refuses a wallet recorded twice in one arm", () => {
    const a = [...arm(2, 0.5, () => true), ...arm(1, 0.5, () => true)];
    assert.throws(() => pairedBrier(a, arm(2, 0.5, () => true)), /twice/);
  });

  it("refuses a pair whose arms resolved to different outcomes", () => {
    assert.throws(() => pairedBrier(arm(1, 0.5, () => true), arm(1, 0.5, () => false)), /different outcomes/);
  });

  it("uses the sealed numbers", () => {
    assert.equal(SEALED_MINIMUM, 97);
    assert.equal(SEALED_THRESHOLD, 0.02);
  });
});

describe("CachedChainReader", () => {
  function inner() {
    const calls = { head: 0, header: 0, balance: 0 };
    let fail = 1;
    const r: ChainReader = {
      async head(): Promise<BlockHeader> { calls.head += 1; return { number: 10, timestamp: 100 }; },
      async header(h: number): Promise<BlockHeader> { calls.header += 1; return { number: h, timestamp: h * 10 }; },
      async balanceAt() { calls.balance += 1; if (fail-- > 0) throw new Error("transient"); return 5n; },
    };
    return { r, calls };
  }

  it("serves repeated header and balance reads from cache", async () => {
    const { r, calls } = inner();
    const c = new CachedChainReader(r);
    await c.header(3); await c.header(3);
    assert.equal(calls.header, 1);
  });

  it("never caches head() -- it is supposed to move", async () => {
    const { r, calls } = inner();
    const c = new CachedChainReader(r);
    await c.head(); await c.head();
    assert.equal(calls.head, 2);
  });

  it("does not cache a failed read", async () => {
    const { r, calls } = inner();
    const c = new CachedChainReader(r);
    await assert.rejects(() => c.balanceAt("0xa", 1));
    await new Promise((res) => setImmediate(res));
    assert.equal(await c.balanceAt("0xa", 1), 5n);
    assert.equal(calls.balance, 2);
  });
});
