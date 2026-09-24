import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  DEFAULT_GATE, DecisionError, DecisionRouter, EgressPolicy, JevHttpEngine, PermutedEngine,
  SAFE_OPTION_JUDGEMENTS, ScriptedEngine, assertNoKeyMaterial, breakEvenEscalation, fromWire,
  journalAction, margin, orderings, passes,
} from "../src/jev/index.ts";
import type { ChoiceQuestion, ChoiceVerdict, Question, Verdict } from "../src/jev/index.ts";

const Q: ChoiceQuestion = { kind: "choice", name: "t", instructions: "pick",
  options: { a: "A", b: "B", c: "C" } };
const P: Question = { kind: "probability", name: "u", statement: "is it?" };

const choice = (over: Partial<ChoiceVerdict> = {}): ChoiceVerdict => ({
  question: "t", kind: "choice", choice: "a", confidence: 0.9,
  probabilities: { a: 0.9, b: 0.05, c: 0.05 }, confidenceKind: "single", engine: "x", ...over,
});

function fakeFetch(answers: unknown, status = 200) {
  const sent: { url: string; init: RequestInit }[] = [];
  const f = async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return new Response(JSON.stringify({ answers }), { status });
  };
  return { f, sent };
}

// --- types -----------------------------------------------------------------

describe("journalAction", () => {
  it("puts the confidence kind in the action, so kinds never share a bucket", () => {
    assert.equal(journalAction("wallet_promotion", "permuted"), "wallet_promotion@permuted");
    assert.notEqual(journalAction("x", "single"), journalAction("x", "permuted"));
  });
  it("refuses a base that already contains a kind separator", () => {
    assert.throws(() => journalAction("x@single", "permuted"));
  });
});

describe("margin", () => {
  it("is top minus runner-up", () => {
    assert.ok(Math.abs(margin(choice({ probabilities: { a: 0.6, b: 0.3, c: 0.1 } })) - 0.3) < 1e-12);
  });
});

// --- wire contract -----------------------------------------------------------

describe("fromWire (Jev contract)", () => {
  const ok = { choice: "a", confidence: 0.7, probabilities: { a: 0.8, b: 0.15, c: 0.05 } };
  it("accepts a well-formed choice and tags it single", () => {
    const v = fromWire(Q, ok, "jev") as ChoiceVerdict;
    assert.equal(v.choice, "a");
    assert.equal(v.confidenceKind, "single");
  });
  it("REFUSES a choice that is not its own most probable option", () => {
    // Observed ~1 in 250 real answers.
    assert.throws(() => fromWire(Q, { ...ok, choice: "b" }, "jev"), /most probable/);
  });
  it("refuses an option that was never offered", () => {
    assert.throws(() => fromWire(Q, { ...ok, choice: "z" }, "jev"), /never offered/);
  });
  it("refuses probabilities over a different option set", () => {
    assert.throws(() => fromWire(Q, { ...ok, probabilities: { a: 0.9, b: 0.1 } }, "jev"), /expected/);
  });
  it("refuses mass that does not sum to 1", () => {
    assert.throws(() => fromWire(Q, { ...ok, probabilities: { a: 0.5, b: 0.1, c: 0.1 } }, "jev"), /sum/);
  });
  it("refuses a non-finite or out-of-range number", () => {
    assert.throws(() => fromWire(Q, { ...ok, confidence: 1.5 }, "jev"), /outside/);
  });
  it("reads a probability answer from `noul`", () => {
    const v = fromWire(P, { noul: 0.3 }, "jev");
    assert.equal(v.kind, "probability");
  });
  it("refuses a missing answer", () => {
    assert.throws(() => fromWire(Q, undefined, "jev"), /no answer/);
  });
});

describe("JevHttpEngine", () => {
  it("sends the key ONLY in the Authorization header", async () => {
    const { f, sent } = fakeFetch({ t: { choice: "a", confidence: 0.7, probabilities: { a: 0.8, b: 0.1, c: 0.1 } } });
    await new JevHttpEngine({ getKey: () => "sk-SECRET", fetch: f }).decide({ x: 1 }, [Q]);
    const init = sent[0]?.init as RequestInit;
    assert.equal((init.headers as Record<string, string>).Authorization, "Bearer sk-SECRET");
    assert.ok(!String(init.body).includes("sk-SECRET"));
  });
  it("never puts the key in an error", async () => {
    const { f } = fakeFetch({}, 401);
    await assert.rejects(
      () => new JevHttpEngine({ getKey: () => "sk-SECRET", fetch: f }).decide({}, [Q]),
      (e: Error) => !e.message.includes("sk-SECRET") && /401/.test(e.message),
    );
  });
  it("refuses to call without a key rather than sending an empty bearer", async () => {
    let called = 0;
    const f = async () => { called += 1; return new Response("{}"); };
    await assert.rejects(() => new JevHttpEngine({ getKey: () => undefined, fetch: f }).decide({}, [Q]), /no API key/);
    assert.equal(called, 0);
  });
  it("marks the untrusted state on every question", async () => {
    const { f, sent } = fakeFetch({ t: { choice: "a", confidence: 0.7, probabilities: { a: 0.8, b: 0.1, c: 0.1 } } });
    await new JevHttpEngine({ getKey: () => "k", fetch: f }).decide({}, [Q]);
    assert.match(String(sent[0]?.init.body), /untrusted_input/);
  });
  it("refuses a one-option choice before any call", async () => {
    const { f, sent } = fakeFetch({});
    const one: ChoiceQuestion = { ...Q, options: { a: "A" } };
    await assert.rejects(() => new JevHttpEngine({ getKey: () => "k", fetch: f }).decide({}, [one]), /rubber stamp/);
    assert.equal(sent.length, 0);
  });
  it("refuses duplicate question names", async () => {
    const { f } = fakeFetch({});
    await assert.rejects(() => new JevHttpEngine({ getKey: () => "k", fetch: f }).decide({}, [Q, Q]), /duplicate/);
  });
});

// --- permuted decorator -------------------------------------------------------

/** Inner engine with a first-position bias: +0.3 to whichever option is listed first. */
function biased() {
  const calls: Question[][] = [];
  const engine = new ScriptedEngine("biased", (_s, q) => {
    if (q.kind !== "choice") return { kind: "probability", probability: 0.5, confidenceKind: "single" };
    const labels = Object.keys(q.options);
    const rest = 0.7 / labels.length;
    const probabilities = Object.fromEntries(labels.map((l, i) => [l, rest + (i === 0 ? 0.3 : 0)]));
    return { kind: "choice", choice: labels[0] as string, confidence: 0.5, probabilities, confidenceKind: "single" };
  });
  const wrapped = { id: engine.id, remote: false,
    decide: async (s: Record<string, unknown>, qs: readonly Question[]) => { calls.push([...qs]); return engine.decide(s, qs); } };
  return { wrapped, calls };
}

describe("PermutedEngine", () => {
  it("sends every ordering in ONE inner call", async () => {
    const { wrapped, calls } = biased();
    await new PermutedEngine(wrapped, 6).decide({}, [Q]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.length, 6);
  });
  it("cancels a first-position bias exactly over all orderings", async () => {
    const { wrapped } = biased();
    const [v] = await new PermutedEngine(wrapped, 6).decide({}, [Q]);
    const p = (v as ChoiceVerdict).probabilities;
    assert.ok(Math.abs((p.a as number) - (p.b as number)) < 1e-12);
  });
  it("tags the result permuted, not single", async () => {
    const { wrapped } = biased();
    const [v] = await new PermutedEngine(wrapped, 6).decide({}, [Q]);
    assert.equal(v?.confidenceKind, "permuted");
  });
  it("passes probability questions through unpermuted, in the same call", async () => {
    const { wrapped, calls } = biased();
    const out = await new PermutedEngine(wrapped, 6).decide({}, [Q, P]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.filter((q) => q.name === "u").length, 1);
    assert.equal(out[1]?.confidenceKind, "single");
  });
  it("refuses a batch over the measured token ceiling before calling", async () => {
    const { wrapped, calls } = biased();
    const wide: ChoiceQuestion = { ...Q, options: Object.fromEntries(
      Array.from({ length: 255 }, (_, i) => [`o${i}`, "x"])) };
    await assert.rejects(() => new PermutedEngine(wrapped, 8).decide({}, [wide]), /ceiling/);
    assert.equal(calls.length, 0);
    assert.ok(8 * 255 > SAFE_OPTION_JUDGEMENTS);
  });
  it("renormalises each ordering before averaging", async () => {
    // Ordering 0 returns the same SHAPE with double the mass. Averaged raw, it
    // would dominate; renormalised, both orderings say a:0.6 exactly. The
    // biased fixture above always sums to 1, so it could not catch this.
    const inner = new ScriptedEngine("sloppy", (_s, q) => {
      const scale = q.name.endsWith("__ord0") ? 2 : 1;
      return { kind: "choice", choice: "a", confidence: 0.6,
        probabilities: { a: 0.6 * scale, b: 0.3 * scale, c: 0.1 * scale }, confidenceKind: "single" };
    });
    const [v] = await new PermutedEngine(inner, 2).decide({}, [Q]);
    assert.ok(Math.abs(((v as ChoiceVerdict).probabilities.a as number) - 0.6) < 1e-12);
  });
  it("orderings: first is the caller's own, all distinct, capped at k!", () => {
    const o = orderings(["a", "b", "c"], 20);
    assert.deepEqual(o[0], ["a", "b", "c"]);
    assert.equal(o.length, 6);
    assert.equal(new Set(o.map((x) => x.join())).size, 6);
  });
  it("orderings are reproducible from a seed", () => {
    const l = ["a", "b", "c", "d", "e", "f"];
    assert.deepEqual(orderings(l, 5, 7), orderings(l, 5, 7));
  });
});

// --- egress -------------------------------------------------------------------

describe("EgressPolicy", () => {
  it("drops keys not on the allow-list and reports them", () => {
    const r = new EgressPolicy(["a"]).apply({ a: 1, b: 2 });
    assert.deepEqual(r.state, { a: 1 });
    assert.deepEqual(r.dropped, ["b"]);
  });
  it("refuses an empty allow-list (the engine would answer from priors)", () => {
    assert.throws(() => new EgressPolicy([]), DecisionError);
  });
  it("REFUSES a private-key-shaped string even inside an allowed key", () => {
    const key = "0x" + "ab".repeat(32);
    assert.throws(() => new EgressPolicy(["a"]).apply({ a: { nested: [key] } }), /key material/);
  });
  it("allows a 20-byte address", () => {
    assertNoKeyMaterial({ w: "0x" + "ab".repeat(20) });
  });
  it("refuses a 12-word mnemonic", () => {
    assert.throws(() => assertNoKeyMaterial("abandon ability able about above absent absorb abstract absurd abuse access accident"));
  });
  it("refuses a PEM private key", () => {
    // Assembled at runtime so this file never contains a literal PEM header:
    // the repo's key-material scan (test.yml) rightly refuses one, and it
    // cannot tell a fixture from a leak. Do not weaken the scan to fit a test.
    const pem = ["-----BEGIN EC", "PRIVATE KEY-----"].join(" ");
    assert.throws(() => assertNoKeyMaterial(pem));
  });
  // Fixtures assembled at runtime: a literal token in the repo is exactly
  // what secret scanners exist to flag, fixture or not.
  const tok = (...parts: string[]) => parts.join("");
  it("refuses an OpenRouter key inside an allowed key", () => {
    const k = tok("sk-or-v1-", "0123456789abcdef0123");
    assert.throws(() => new EgressPolicy(["a"]).apply({ a: `note ${k}` }), /service credential/);
  });
  it("refuses TypeSafe, GitHub, JWT, Bearer and URL-password shapes", () => {
    for (const s of [
      tok("apikey_", "abcdefghijklmnop1234"),
      tok("ts_live_", "abcdef123456"),
      tok("ghp_", "abcdefghijklmnop1234"),
      tok("eyJ", "hbGciOiJIUzI1", ".", "eyJzdWIiOiIx", ".", "sig_abcd"),
      tok("Authorization: Bearer ", "abcdefghijklmnop"),
      tok("https://user:", "hunter22", "@rpc.example"),
    ]) assert.throws(() => assertNoKeyMaterial({ s }), /service credential/, s.slice(0, 12));
  });
  it("passes the numbers and labels the hunter actually sends", () => {
    assertNoKeyMaterial({ value_pls: 500000, balance_pls: 1.2e6, fraction_sent: 0.41,
      note: "pulsechain-rpc-value-transfers", url: "https://rpc.pulsechain.com" });
  });
});

// --- router ---------------------------------------------------------------------

const fixed = (id: string, v: Omit<Verdict, "engine" | "question">, remote = false) => {
  const e = new ScriptedEngine(id, () => v);
  return remote ? Object.assign(Object.create(Object.getPrototypeOf(e)), e, { remote: true, decide: e.decide.bind(e) }) as ScriptedEngine : e;
};
const confident = { kind: "choice", choice: "a", confidence: 0.9, probabilities: { a: 0.9, b: 0.05, c: 0.05 }, confidenceKind: "single" } as const;
const unsure = { kind: "choice", choice: "a", confidence: 0.4, probabilities: { a: 0.4, b: 0.35, c: 0.25 }, confidenceKind: "heuristic" } as const;

describe("DecisionRouter", () => {
  it("accepts tier 0 when its gate passes and never calls tier 1", async () => {
    const t1 = fixed("t1", confident);
    const r = new DecisionRouter([{ engine: fixed("t0", confident), gate: DEFAULT_GATE, cost: 0.01 },
      { engine: t1, gate: DEFAULT_GATE, cost: 1 }]);
    const [out] = await r.route({}, [Q]);
    assert.equal(out?.status, "decided");
    assert.equal(t1.calls, 0);
  });
  it("escalates what tier 0's gate rejects", async () => {
    const r = new DecisionRouter([{ engine: fixed("t0", unsure), gate: DEFAULT_GATE, cost: 0.01 },
      { engine: fixed("t1", confident), gate: DEFAULT_GATE, cost: 1 }]);
    const [out] = await r.route({}, [Q]);
    assert.ok(out?.status === "decided" && out.tier === 1);
    assert.equal(r.stats().escalated, 1);
  });
  it("returns UNDECIDED when no tier clears its gate -- never a sub-gate answer", async () => {
    const r = new DecisionRouter([{ engine: fixed("t0", unsure), gate: DEFAULT_GATE, cost: 1 }]);
    const [out] = await r.route({}, [Q]);
    assert.equal(out?.status, "undecided");
  });
  it("a failed remote tier does NOT fall back to tier 0's rejected guess", async () => {
    const boom = { id: "boom", remote: true, decide: async () => { throw new Error("503"); } };
    const r = new DecisionRouter([{ engine: fixed("t0", unsure), gate: DEFAULT_GATE, cost: 0.01 },
      { engine: boom, gate: DEFAULT_GATE, cost: 1, egress: new EgressPolicy(["x"]) }]);
    const [out] = await r.route({ x: 1 }, [Q]);
    assert.ok(out?.status === "undecided" && /503/.test(out.reason));
  });
  it("refuses a remote tier with no egress policy", () => {
    const remote = { id: "r", remote: true, decide: async () => [] };
    assert.throws(() => new DecisionRouter([{ engine: remote, gate: DEFAULT_GATE, cost: 1 }]), /EgressPolicy/);
  });
  it("applies egress before a remote tier sees the state", async () => {
    let seen: unknown;
    const remote = { id: "r", remote: true, decide: async (s: unknown) => { seen = s; return [{ ...confident, question: "t", engine: "r" }]; } };
    await new DecisionRouter([{ engine: remote, gate: DEFAULT_GATE, cost: 1, egress: new EgressPolicy(["ok"]) }])
      .route({ ok: 1, private_note: 2 }, [Q]);
    assert.deepEqual(seen, { ok: 1 });
  });
  it("refuses a cascade whose tiers do not get more expensive", () => {
    assert.throws(() => new DecisionRouter([{ engine: fixed("a", confident), gate: DEFAULT_GATE, cost: 1 },
      { engine: fixed("b", confident), gate: DEFAULT_GATE, cost: 1 }]), /MORE expensive/);
  });
  it("refuses a cascade that cannot beat going straight to the top", () => {
    // c0/c1 = 0.5 -> break-even 0.5. Expecting 60% escalation loses.
    assert.equal(breakEvenEscalation(0.5, 1), 0.5);
    assert.throws(() => new DecisionRouter([{ engine: fixed("a", confident), gate: DEFAULT_GATE, cost: 0.5 },
      { engine: fixed("b", confident), gate: DEFAULT_GATE, cost: 1 }], { expectedEscalation: 0.6 }), /break-even/);
  });
  it("batches: all escalated questions reach tier 1 in ONE call", async () => {
    const t1 = fixed("t1", confident);
    const r = new DecisionRouter([{ engine: fixed("t0", unsure), gate: DEFAULT_GATE, cost: 0.01 },
      { engine: t1, gate: DEFAULT_GATE, cost: 1 }]);
    await r.route({}, [Q, { ...Q, name: "t2" }, { ...Q, name: "t3" }]);
    assert.equal(t1.calls, 1);
  });
});

describe("passes (gate)", () => {
  it("needs confidence AND margin for a choice", () => {
    assert.equal(passes(choice({ confidence: 0.9, probabilities: { a: 0.5, b: 0.45, c: 0.05 } }), DEFAULT_GATE), false);
    assert.equal(passes(choice({ confidence: 0.5 }), DEFAULT_GATE), false);
    assert.equal(passes(choice(), DEFAULT_GATE), true);
  });
  it("decides a probability only outside the (low, high) band", () => {
    const pv = (p: number): Verdict => ({ question: "u", kind: "probability", probability: p, confidenceKind: "single", engine: "x" });
    assert.equal(passes(pv(0.5), DEFAULT_GATE), false);
    assert.equal(passes(pv(0.85), DEFAULT_GATE), true);
    assert.equal(passes(pv(0.1), DEFAULT_GATE), true);
  });
  it("a verdict exactly on the threshold passes despite float noise", () => {
    assert.equal(passes(choice({ confidence: 0.7, probabilities: { a: 0.6, b: 0.35, c: 0.05 } }),
      { ...DEFAULT_GATE, minConfidence: 0.7, minMargin: 0.25 }), true);
  });
});
