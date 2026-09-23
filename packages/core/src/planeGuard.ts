/**
 * Plane boundary enforcement for external MCP tool surfaces.
 *
 * CLAUDE.md's two-plane rule: "the hunt plane never signs transactions, and
 * the exec plane never scrapes social data." That rule is easy to hold while
 * every tool is ours. It stops being easy the moment we mount someone else's
 * MCP server, because their registration decisions become our attack surface.
 *
 * MEASURED, 2026-09-22, against DavidFeder/pulsechain-mcp v1.0.7 -- a genuinely
 * good PulseChain server whose data tools map almost one-to-one onto Hydra's
 * SPEC 4.3 scoring inputs and 4.4 cluster/sybil work:
 *
 *   registry.ts:24   registerWalletTools(server, config);   // UNCONDITIONAL
 *   wallet/index.ts  if (!cfg.agentWalletEnabled) throw new PolicyError(...)
 *
 * So its signing tools -- sign_and_send, execute_agent_tx, transfer_pls -- are
 * REGISTERED even in "research-only" mode. The refusal is at CALL time, inside
 * each handler, not at REGISTRATION time.
 *
 * To be fair to that project: without AGENT_WALLET_MASTER_KEY no signing can
 * occur at all, and its config throws early if wallets are enabled without a
 * key. This is not a key-compromise hole. It is a SURFACE problem -- a
 * registered tool appears in the model's tool list, and a model that can see
 * `sign_and_send` will eventually try it.
 *
 * A call-time boolean can be reached by any path that sets it. A tool that was
 * never allowed cannot. This module is the second lock, on our side of the
 * boundary, so the plane rule does not depend on a third party's registration
 * order.
 *
 * DENY BY DEFAULT. An unlisted tool is refused, never allowed -- the same
 * permissive-default trap `preflight.Registry` refuses by returning "unknown"
 * rather than "safe", and `router` refuses by raising on an unknown action.
 */

export type Plane = "hunt" | "exec";

export class PlaneViolation extends Error {
  // Declared explicitly rather than as constructor parameter properties:
  // `node --experimental-strip-types` refuses those outright, and this repo's
  // test path deliberately runs with no build step.
  readonly plane: Plane;
  readonly tool: string;

  constructor(plane: Plane, tool: string, message: string) {
    super(message);
    this.plane = plane;
    this.tool = tool;
  }
}

/**
 * Action verbs that may NEVER appear in the hunt plane, whatever an allowlist
 * says.
 *
 * Matched against WHOLE UNDERSCORE-SEPARATED TOKENS, in the singular, not as
 * substrings. That distinction is load-bearing and this guard found it by
 * refusing my own first allowlist:
 *
 *     get_recent_swaps   -> [get, recent, swaps]      a READ about past swaps
 *     prepare_swap       -> [prepare, swap]           PERFORMS one
 *     get_token_transfers-> [get, token, transfers]   a READ
 *     transfer_pls       -> [transfer, pls]           MOVES money
 *
 * The singular token is the action; the plural is data about actions already
 * taken. Substring matching cannot tell a noun from a verb, and refusing every
 * tool with "swap" in its name would have thrown away the entire discovery
 * surface this integration exists for.
 */
export const NEVER_IN_HUNT: readonly string[] = [
  "sign", "execute", "transfer", "swap", "approve", "revoke",
  "send", "broadcast", "settle", "propose", "prepare", "create", "kill",
];

/** Verbs that may never appear in the exec plane. */
export const NEVER_IN_EXEC: readonly string[] = [
  "scrape", "browser", "social", "twitter", "telegram",
];

const FORBIDDEN: Record<Plane, readonly string[]> = {
  hunt: NEVER_IN_HUNT,
  exec: NEVER_IN_EXEC,
};

/**
 * The forbidden verb in a tool name, or undefined.
 *
 * Tokenises on underscores and compares whole tokens, so a plural noun
 * (`swaps`, `transfers`) reads as data while the singular (`swap`,
 * `transfer`) reads as an action.
 */
export function forbiddenVerbIn(plane: Plane, tool: string): string | undefined {
  const tokens = new Set(tool.toLowerCase().split(/[_\-\s]+/).filter(Boolean));
  return FORBIDDEN[plane].find((verb) => tokens.has(verb));
}

export class PlaneGuard {
  readonly #allowed: ReadonlySet<string>;
  readonly plane: Plane;

  constructor(plane: Plane, allowed: Iterable<string>) {
    this.plane = plane;
    const set = new Set<string>();
    for (const raw of allowed) {
      const tool = raw.trim();
      if (!tool) {
        throw new PlaneViolation(plane, raw, "an allowlist entry cannot be blank");
      }
      // Refuse at CONSTRUCTION. A forbidden verb reaching an allowlist is a
      // mistake in the list every time, and finding it at call time means
      // finding it with the tool already mounted.
      const hit = forbiddenVerbIn(plane, tool);
      if (hit) {
        throw new PlaneViolation(
          plane,
          tool,
          `${tool} contains "${hit}" and cannot be allowed in the ${plane} plane. ` +
            "CLAUDE.md: the hunt plane never signs, the exec plane never scrapes.",
        );
      }
      set.add(tool);
    }
    this.#allowed = set;
  }

  /** True only for a tool explicitly allowed. Unlisted is refused. */
  permits(tool: string): boolean {
    return this.#allowed.has(tool.trim());
  }

  /**
   * Raise unless the tool is allowed in this plane.
   *
   * There is deliberately NO second verb check here. The constructor already
   * refuses a forbidden verb, and `#allowed` is a private readonly Set, so no
   * forbidden tool can reach this set. A mutation test proved the extra check
   * unreachable -- removing it changed no test outcome. Unreachable defensive
   * code reads as safety and is not, so it is gone rather than kept for
   * comfort. If an `allow()` mutator is ever added, reinstate the check AND a
   * test that kills it.
   */
  assert(tool: string): void {
    const name = tool.trim();
    if (!this.#allowed.has(name)) {
      throw new PlaneViolation(
        this.plane, name,
        `${name} is not on the ${this.plane} allowlist. Unlisted tools are ` +
          "refused, never allowed by default: a third party's registration is " +
          "not our policy.",
      );
    }
  }

  get allowed(): readonly string[] {
    return [...this.#allowed].sort();
  }

  /**
   * Tools a server offers that this plane will refuse.
   *
   * Run it when MOUNTING a server, not when calling one. A surface you did not
   * expect is an absence of refusal, and absences have to be looked for.
   */
  wouldRefuse(offered: Iterable<string>): readonly string[] {
    return [...offered].map((t) => t.trim()).filter((t) => !this.permits(t)).sort();
  }
}

/**
 * The hunt-plane allowlist for DavidFeder/pulsechain-mcp v1.0.7.
 *
 * Every entry is a read. The server offers ~20 more tools that sign, propose,
 * or mutate wallet state; none appear here, and `NEVER_IN_HUNT` would refuse
 * them at construction even if someone pasted one in.
 *
 * Chosen against Hydra SPEC 4.3 (scoring inputs) and 4.4 (cluster/sybil):
 * get_funding_tree is the sybil graph, get_smart_money_feed and
 * get_wallet_swaps are the discovery surface, and the safety reads back the
 * hard vetoes.
 */
export const PULSECHAIN_MCP_HUNT_TOOLS: readonly string[] = [
  // discovery
  "get_smart_money_feed", "get_recent_swaps", "get_wallet_swaps",
  "get_transaction_history", "pulsex_swaps",
  // cluster / sybil  (SPEC 4.4)
  "get_funding_tree", "get_deployer_reputation",
  "get_holder_leagues", "get_holder_rank",
  // safety vetoes    (SPEC 4.3)
  "get_honeypots", "get_token_safety", "check_address_risk", "get_scam_alerts",
  // market context
  "get_token_price", "get_token_liquidity", "get_token_info",
  "get_top_pairs", "get_top_tokens", "get_market_overview",
  "pulsex_pair", "pulsex_pair_day_data", "pulsex_top_pairs", "pulsex_token",
  "dexscreener_pair", "dexscreener_token_pairs", "dexscreener_search",
  // chain reads
  "pulsechain_get_balance", "pulsechain_erc20_balances", "pulsechain_get_logs",
  "pulsechain_get_transaction", "pulsechain_get_receipt", "pulsechain_block_number",
  "pulsechain_chain_id", "pulsechain_health", "get_rpc_health",
  "get_portfolio", "get_wallet_balances", "get_token_transfers",
];
