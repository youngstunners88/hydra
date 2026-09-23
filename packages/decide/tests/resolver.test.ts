import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  HORIZON_HOURS, RULE_ID, RULE_TEXT, RuleNotSealed, assertSealed, judge, ruleHash,
} from "../src/resolve/rule.ts";
import { blockAtOrBefore } from "../src/resolve/chain.ts";
import type { BlockHeader, ChainReader } from "../src/resolve/chain.ts";
import { resolvePending, walletFromAnswer } from "../src/resolve/resolver.ts";
import type { PendingDecision } from "../src/resolve/resolver.ts";

const H = 3_600_000;
const W = "0x" + "a".repeat(40);

/** A chain with one block every 10s from t=1000s, and scripted balances. */
function fakeChain(opts: { headAt: number; balances?: (h: number) => bigint; failBalance?: boolean }) {
  const blockTime = 10;
  const t0 = 1000;
  const headNum = Math.floor((opts.headAt - t0) / blockTime);
  const reads: string[] = [];
  const reader: ChainReader = {
    async head() { reads.push("head"); return { number: headNum, timestamp: t0 + headNum * blockTime }; },
    async header(h: number): Promise<BlockHeader> {
      reads.push("header");
      if (h < 0 || h > headNum) throw new Error(`no block ${h}`);
      return { number: h, timestamp: t0 + h * blockTime };
    },
    async balanceAt(_a: string, h: number) {
      reads.push("balance");
      if (opts.failBalance) throw new Error("archive state unavailable");
      return (opts.balances ?? (() => 100n))(h);
    },
  };
  return { reader, reads };
}

function journal(decisions: PendingDecision[]) {
  const resolved = new Map<string, boolean>();
  return {
    resolved,
    pending: () => decisions.filter((d) => !resolved.has(d.id)),
    resolve: (id: string, ok: boolean) => {
      if (resolved.has(id)) throw new Error(`${id} already resolved`);
      resolved.set(id, ok);
    },
  };
}

const decision = (atSec: number, id = "d1", answer = `${W}:watchlisted->trusted`): PendingDecision =>
  ({ id, action: "wallet_promotion", answer, at: atSec * 1000 });

describe("the sealed rule", () => {
  it("matches the committed seal byte for byte", async () => {
    // If this fails, RULE_TEXT was edited after sealing. Do NOT update the
    // sealed file to match: a new rule needs a new id and a new action.
    const sealed = JSON.parse(readFileSync("ops/journal/resolution-rule.json", "utf8"));
    await assertSealed(sealed);
    assert.equal(sealed.text, RULE_TEXT);
  });

  it("refuses to run after RULE_TEXT is edited", async () => {
    const sealed = { rule_id: RULE_ID, sha256: await ruleHash("some other rule"),
      sealed_at: "x", horizon_hours: HORIZON_HOURS, text: "" };
    await assert.rejects(() => assertSealed(sealed), RuleNotSealed);
  });

  it("refuses a different rule id", async () => {
    const sealed = { rule_id: "v2", sha256: await ruleHash(), sealed_at: "x", horizon_hours: HORIZON_HOURS, text: "" };
    await assert.rejects(() => assertSealed(sealed), /new journal action/);
  });

  it("refuses a different horizon", async () => {
    const sealed = { rule_id: RULE_ID, sha256: await ruleHash(), sealed_at: "x", horizon_hours: 1, text: "" };
    await assert.rejects(() => assertSealed(sealed), /horizon/);
  });

  it("judges retention with >=, so an unchanged balance is correct", () => {
    assert.equal(judge(100n, 100n), true);
    assert.equal(judge(100n, 101n), true);
    assert.equal(judge(100n, 99n), false);
  });

  it("compares exact wei, never floats", () => {
    const big = 10n ** 30n;
    assert.equal(judge(big + 1n, big), false);
  });
});

describe("blockAtOrBefore", () => {
  it("returns the latest block at or before the time, never after", async () => {
    // "Nearest" could be a block mined AFTER the moment: look-ahead.
    const { reader } = fakeChain({ headAt: 100_000 });
    const b = await blockAtOrBefore(reader, 1000 + 55); // between blocks 5 (1050) and 6 (1060)
    assert.equal(b.number, 5);
    assert.ok(b.timestamp <= 1055);
  });

  it("returns an exact match when a block has that timestamp", async () => {
    const { reader } = fakeChain({ headAt: 100_000 });
    assert.equal((await blockAtOrBefore(reader, 1060)).number, 6);
  });

  it("returns the head for a time at or past it", async () => {
    const { reader } = fakeChain({ headAt: 2000 });
    assert.equal((await blockAtOrBefore(reader, 9_999_999)).number, 100);
  });

  it("refuses a time before genesis", async () => {
    const { reader } = fakeChain({ headAt: 2000 });
    await assert.rejects(() => blockAtOrBefore(reader, 5), /precedes genesis/);
  });

  it("is logarithmic, not a linear scan", async () => {
    const { reader, reads } = fakeChain({ headAt: 1000 + 10 * 1_000_000 });
    await blockAtOrBefore(reader, 1000 + 10 * 123_456 + 3);
    assert.ok(reads.length < 30, `${reads.length} reads`);
  });
});

describe("resolvePending", () => {
  const decidedAt = 2000;
  const mature = decidedAt + HORIZON_HOURS * 3600 + 100;

  it("resolves CORRECT when the balance was retained", async () => {
    const j = journal([decision(decidedAt)]);
    const { reader } = fakeChain({ headAt: mature + 1000, balances: (h) => (h < 200 ? 100n : 150n) });
    const r = await resolvePending(j, reader, "wallet_promotion", mature * 1000);
    assert.equal(r.resolved, 1);
    assert.equal(j.resolved.get("d1"), true);
  });

  it("resolves INCORRECT when the balance fell", async () => {
    const j = journal([decision(decidedAt)]);
    const { reader } = fakeChain({ headAt: mature + 1000, balances: (h) => (h < 200 ? 100n : 40n) });
    await resolvePending(j, reader, "wallet_promotion", mature * 1000);
    assert.equal(j.resolved.get("d1"), false);
  });

  it("leaves an IMMATURE decision pending -- never resolves it as wrong", async () => {
    const j = journal([decision(decidedAt)]);
    const { reader, reads } = fakeChain({ headAt: mature + 1000 });
    const r = await resolvePending(j, reader, "wallet_promotion", (decidedAt + 60) * 1000);
    assert.equal(r.immature, 1);
    assert.equal(j.resolved.size, 0);
    assert.equal(reads.length, 0, "an immature decision should cost no reads");
  });

  it("treats a lagging chain head as immature even when wall time says mature", async () => {
    const j = journal([decision(decidedAt)]);
    const { reader } = fakeChain({ headAt: decidedAt + 60 });
    const r = await resolvePending(j, reader, "wallet_promotion", mature * 1000);
    assert.equal(r.immature, 1);
    assert.equal(j.resolved.size, 0);
  });

  it("leaves an UNREADABLE decision pending -- never resolves it as wrong", async () => {
    // Defaulting an unknown to "incorrect" would move the Brier score with
    // the RPC endpoint's health, silently.
    const j = journal([decision(decidedAt)]);
    const { reader } = fakeChain({ headAt: mature + 1000, failBalance: true });
    const r = await resolvePending(j, reader, "wallet_promotion", mature * 1000);
    assert.equal(r.unreadable, 1);
    assert.equal(j.resolved.size, 0);
    const f = r.fates[0];
    assert.ok(f && f.kind === "unreadable" && /archive/.test(f.reason));
  });

  it("does not resolve a decision whose answer is not a promotion", async () => {
    const j = journal([decision(decidedAt, "d1", "something-else")]);
    const { reader } = fakeChain({ headAt: mature + 1000 });
    const r = await resolvePending(j, reader, "wallet_promotion", mature * 1000);
    assert.equal(r.unreadable, 1);
    assert.equal(j.resolved.size, 0);
  });

  it("reads the balance at the decision block and at the horizon block", async () => {
    const heights: number[] = [];
    const j = journal([decision(decidedAt)]);
    const { reader } = fakeChain({ headAt: mature + 1000, balances: (h) => { heights.push(h); return 1n; } });
    await resolvePending(j, reader, "wallet_promotion", mature * 1000);
    assert.equal(heights.length, 2);
    const [b0, b1] = heights as [number, number];
    assert.equal(b0, Math.floor((decidedAt - 1000) / 10));
    assert.equal(b1, Math.floor((decidedAt + HORIZON_HOURS * 3600 - 1000) / 10));
  });

  it("resolves each decision at most once across runs", async () => {
    const j = journal([decision(decidedAt)]);
    const { reader } = fakeChain({ headAt: mature + 1000 });
    await resolvePending(j, reader, "wallet_promotion", mature * 1000);
    const second = await resolvePending(j, reader, "wallet_promotion", mature * 1000);
    assert.equal(second.resolved, 0);
  });

  it("one failure does not stop the others from resolving", async () => {
    const j = journal([
      decision(decidedAt, "d1", "garbage"),
      decision(decidedAt, "d2"),
    ]);
    const { reader } = fakeChain({ headAt: mature + 1000 });
    const r = await resolvePending(j, reader, "wallet_promotion", mature * 1000);
    assert.equal(r.unreadable, 1);
    assert.equal(r.resolved, 1);
  });

  it("reports the rule it resolved under", async () => {
    const r = await resolvePending(journal([]), fakeChain({ headAt: 5000 }).reader, "wallet_promotion");
    assert.equal(r.rule, RULE_ID);
  });
});

describe("walletFromAnswer", () => {
  it("extracts a lowercase wallet from a promotion answer", () => {
    assert.equal(walletFromAnswer(`${W}:watchlisted->trusted`), W);
  });
  it("refuses anything else rather than guessing", () => {
    assert.equal(walletFromAnswer(`${W}:observed->candidate`), null);
    assert.equal(walletFromAnswer(`0xABC:watchlisted->trusted`), null);
  });
});
