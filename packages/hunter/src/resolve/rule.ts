/**
 * THE RESOLUTION RULE -- what "the promotion prediction was correct" means.
 *
 * Sealed BEFORE any outcome was resolved. The seal is a hash of RULE_TEXT,
 * recorded in ops/journal/resolution-rule.json in its own commit, ahead of the
 * first resolve run. Git history is the proof of ordering.
 *
 * WHY SEAL IT
 *
 * A resolution rule chosen after seeing outcomes is the re-grading that the
 * journal's refusal #1 forbids -- it just happens one level up. Pick the rule
 * after looking, and any calibration curve can be made to look good. So the
 * resolver refuses to run unless the rule in code hashes to the sealed value.
 * Changing the rule means a NEW rule id AND a new journal action, so old and
 * new resolutions can never share a calibration bucket.
 *
 * WHAT THE RULE ACTUALLY MEASURES -- a PROXY, stated plainly
 *
 * The prediction is "this wallet is worth trusting". Profitability would need
 * token prices, which the hunt plane's two-method allowlist cannot read. So
 * this rule measures NATIVE-BALANCE RETENTION over a fixed horizon: did the
 * wallet still hold at least as much PLS six hours later as when we decided?
 *
 * That is not profit. A wallet that swapped all its PLS into a token that
 * tripled resolves WRONG here. A wallet that received a gift resolves RIGHT.
 * The calibration this produces answers exactly one question: does the
 * hunter's confidence predict native-balance retention? Read it as that and
 * nothing broader.
 */

export const RULE_ID = "native-retention-6h-v1";

/** Hours after the decision at which the outcome is read. */
export const HORIZON_HOURS = 6;

export const RULE_TEXT = [
  `rule: ${RULE_ID}`,
  "decision: promote wallet W from watchlisted to trusted, confidence c",
  "t0: the latest block with timestamp <= the decision's recorded time",
  `t1: the latest block with timestamp <= t0 + ${HORIZON_HOURS} hours`,
  "CORRECT iff native_balance(W, t1) >= native_balance(W, t0)",
  "IMMATURE if t0 + horizon is later than the chain head: NOT resolved",
  "UNREADABLE if any balance or block read fails: NOT resolved",
  "never resolve an immature or unreadable decision as incorrect",
].join("\n");

/**
 * The judgement. Pure, and deliberately trivial: every subtlety of this rule
 * lives in WHICH blocks are read, not in this comparison.
 *
 * Balances are bigint wei. Comparing floats would let two identical balances
 * differ in the last bit and flip a verdict.
 */
export function judge(balanceAtDecision: bigint, balanceAtHorizon: bigint): boolean {
  return balanceAtHorizon >= balanceAtDecision;
}

/** SHA-256 of RULE_TEXT, hex. What the sealed file must contain. */
export async function ruleHash(text: string = RULE_TEXT): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface SealedRule {
  readonly rule_id: string;
  readonly sha256: string;
  readonly sealed_at: string;
  readonly horizon_hours: number;
  readonly text: string;
}

export class RuleNotSealed extends Error {}

/**
 * Refuse unless the rule in code is byte-for-byte the rule that was sealed.
 *
 * Checked on every resolve run, not once: the failure this guards against is
 * a later edit to RULE_TEXT or HORIZON_HOURS that nobody re-seals, after which
 * every new resolution is graded under a rule the record never mentions.
 */
export async function assertSealed(sealed: SealedRule): Promise<void> {
  if (sealed.rule_id !== RULE_ID) {
    throw new RuleNotSealed(
      `sealed rule is ${sealed.rule_id}, code implements ${RULE_ID}. A new ` +
        "rule needs a new seal AND a new journal action.",
    );
  }
  if (sealed.horizon_hours !== HORIZON_HOURS) {
    throw new RuleNotSealed(
      `sealed horizon ${sealed.horizon_hours}h, code uses ${HORIZON_HOURS}h`,
    );
  }
  const actual = await ruleHash();
  if (sealed.sha256 !== actual) {
    throw new RuleNotSealed(
      "RULE_TEXT no longer matches the sealed hash. The rule was edited after " +
        "sealing. Resolving under it would grade outcomes against a rule the " +
        "audit record does not contain.",
    );
  }
}
