import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  NEVER_IN_HUNT, PULSECHAIN_MCP_HUNT_TOOLS, PlaneGuard, PlaneViolation,
  forbiddenVerbIn,
} from "../src/planeGuard.ts";

const hunt = () => new PlaneGuard("hunt", PULSECHAIN_MCP_HUNT_TOOLS);

describe("the noun/verb distinction this guard found the hard way", () => {
  it("allows reads ABOUT swaps and transfers", () => {
    const g = hunt();
    for (const t of ["get_recent_swaps", "get_wallet_swaps", "pulsex_swaps",
                     "get_token_transfers"]) {
      assert.equal(g.permits(t), true, t);
    }
  });
  it("refuses the singular action verbs", () => {
    for (const t of ["prepare_swap", "transfer_pls", "sign_and_send"]) {
      assert.equal(forbiddenVerbIn("hunt", t) !== undefined, true, t);
    }
  });
  it("matches whole tokens, not substrings", () => {
    // "swaps" must not match "swap"; if it did, the entire discovery surface
    // this integration exists for would be refused.
    assert.equal(forbiddenVerbIn("hunt", "get_recent_swaps"), undefined);
    assert.equal(forbiddenVerbIn("hunt", "prepare_swap"), "swap");
  });
  it("tokenises on hyphens and spaces too", () => {
    assert.equal(forbiddenVerbIn("hunt", "agent-sign-tx"), "sign");
  });
});

describe("every signing tool pulsechain-mcp registers is refused", () => {
  // Measured 2026-09-22: registry.ts:24 calls registerWalletTools
  // unconditionally, so these are REGISTERED even in research-only mode.
  const signing = [
    "sign_and_send", "execute_agent_tx", "transfer_pls", "propose_agent_tx",
    "prepare_swap", "piteas_prepare_swap", "switch_prepare_swap",
    "create_agent_wallet", "set_agent_policy", "kill_switch", "approve",
    "revoke", "settle_interrupted_broadcast",
  ];
  for (const tool of signing) {
    it(`refuses ${tool}`, () => {
      assert.throws(() => hunt().assert(tool), PlaneViolation);
    });
  }
});

describe("deny by default", () => {
  it("refuses an unlisted tool rather than allowing it", () => {
    assert.throws(() => hunt().assert("some_new_upstream_tool"),
      /Unlisted tools are\s+refused/);
  });
  it("says why: a third party's registration is not our policy", () => {
    assert.throws(() => hunt().assert("whatever"), /not our policy/);
  });
  it("permits() is false for unlisted", () => {
    assert.equal(hunt().permits("some_new_upstream_tool"), false);
  });
});

describe("construction-time refusal", () => {
  it("refuses a forbidden verb pasted into an allowlist", () => {
    // Finding this at call time means finding it with the tool mounted.
    assert.throws(() => new PlaneGuard("hunt", ["get_token_price", "sign_and_send"]),
      /cannot be allowed in the hunt plane/);
  });
  it("refuses a blank entry", () => {
    assert.throws(() => new PlaneGuard("hunt", ["  "]), /cannot be blank/);
  });
  it("names the offending verb", () => {
    assert.throws(() => new PlaneGuard("hunt", ["transfer_pls"]), /"transfer"/);
  });
});

describe("the exec plane has its own forbidden set", () => {
  it("refuses scraping in exec", () => {
    assert.throws(() => new PlaneGuard("exec", ["browser_fetch"]),
      /cannot be allowed in the exec plane/);
  });
  it("allows signing in exec -- that is what exec is for", () => {
    assert.equal(new PlaneGuard("exec", ["sign_and_send"]).permits("sign_and_send"), true);
  });
});

describe("mounting a server surfaces what it will refuse", () => {
  it("lists the offered tools this plane would reject", () => {
    const refused = hunt().wouldRefuse([
      "get_funding_tree", "execute_agent_tx", "kill_switch", "get_token_price",
    ]);
    assert.deepEqual(refused, ["execute_agent_tx", "kill_switch"]);
  });
  it("returns nothing when every offered tool is allowed", () => {
    assert.deepEqual(hunt().wouldRefuse(["get_funding_tree"]), []);
  });
});

describe("the allowlist itself", () => {
  it("carries the SPEC 4.4 sybil surface", () => {
    assert.equal(hunt().permits("get_funding_tree"), true);
  });
  it("carries the SPEC 4.3 hard-veto reads", () => {
    const g = hunt();
    for (const t of ["get_honeypots", "get_token_safety", "check_address_risk"]) {
      assert.equal(g.permits(t), true, t);
    }
  });
  it("contains no tool its own plane would forbid", () => {
    for (const t of PULSECHAIN_MCP_HUNT_TOOLS) {
      assert.equal(forbiddenVerbIn("hunt", t), undefined, t);
    }
  });
  it("lists the verbs that can never be in hunt", () => {
    assert.ok(NEVER_IN_HUNT.includes("sign"));
    assert.ok(NEVER_IN_HUNT.includes("transfer"));
  });
});
