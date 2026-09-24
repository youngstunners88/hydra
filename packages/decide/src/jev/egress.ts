/**
 * What may leave the process. Deny by default.
 *
 * A remote decision engine sees whatever `state` holds, and state is often
 * assembled from things we did not write. The policy is an ALLOW-LIST of
 * top-level keys; anything else is dropped, and dropped keys are reported so
 * a silent drop cannot hide a missing field the decision needed.
 *
 * Independently of the allow-list, any string anywhere in the state that
 * looks like key material is a hard refusal, not a drop: 64 hex chars (a raw
 * private key), a BIP-39-length word run, or a PEM block. Hydra's CI already
 * refuses these in the repo; this refuses them on the wire.
 *
 * Service credentials are refused the same way: an API token (OpenRouter
 * `sk-or-...`, TypeSafe `apikey_`/`ts_live_`, GitHub, Slack, Google), a JWT,
 * a Bearer header, or `scheme://user:password@`. The key that pays for the
 * call must never ride inside the state it pays for. Token shapes adapted
 * from RevocGG/typesafe-jev-bridge lib/redact.cjs (MIT); refused, not
 * redacted, because a redacted state is still a state built by a bug.
 */
import { DecisionError } from "./types.ts";
import type { DecisionState } from "./port.ts";

const PRIVATE_KEY = /(?:^|[^0-9a-fA-F])(?:0x)?[0-9a-fA-F]{64}(?:$|[^0-9a-fA-F])/;
const PEM = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const MNEMONIC = /^(?:[a-z]{3,8}\s+){11,23}[a-z]{3,8}$/;
const API_TOKEN =
  /\b(?:(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|apikey_[A-Za-z0-9_-]{16,}|(?:sk|ts|npm|hf)_[A-Za-z0-9_]{10,}|sk-[A-Za-z0-9_-]{16,}|glpat-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[A-Za-z0-9_-]{30,})/i;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i;
const URL_CREDENTIALS = /\b[a-z][a-z0-9+.-]*:\/\/[^/:\s@]+:[^@/\s]{4,}@/i;

export interface EgressResult {
  readonly state: DecisionState;
  readonly dropped: readonly string[];
}

export class EgressPolicy {
  readonly #allowed: ReadonlySet<string>;

  constructor(allowedKeys: Iterable<string>) {
    this.#allowed = new Set(allowedKeys);
    if (this.#allowed.size === 0) {
      throw new DecisionError(
        "an egress policy that allows nothing sends an empty state; the engine " +
          "would answer from its priors and the verdict would look informed",
      );
    }
  }

  apply(state: DecisionState): EgressResult {
    const out: Record<string, unknown> = {};
    const dropped: string[] = [];
    for (const [k, v] of Object.entries(state)) {
      if (this.#allowed.has(k)) out[k] = v;
      else dropped.push(k);
    }
    assertNoKeyMaterial(out);
    return { state: out, dropped };
  }
}

/** Walk every string in the value; refuse on anything shaped like a secret. */
export function assertNoKeyMaterial(value: unknown, path = "state"): void {
  if (typeof value === "string") {
    // A 20-byte address is 40 hex chars and passes; a 32-byte key is 64 and
    // does not. Transaction hashes are also 64 hex -- they are refused too,
    // deliberately: indistinguishable on the wire, and a decision never
    // needs the raw hash when the block and address are available.
    if (PRIVATE_KEY.test(value) || PEM.test(value) || MNEMONIC.test(value.trim())) {
      throw new DecisionError(
        `refusing egress: ${path} looks like key material. Nothing shaped like ` +
          "a private key, seed phrase or PEM block leaves the process.",
      );
    }
    if (API_TOKEN.test(value) || JWT.test(value) || BEARER.test(value) || URL_CREDENTIALS.test(value)) {
      throw new DecisionError(
        `refusing egress: ${path} looks like a service credential. No API ` +
          "token, JWT, Bearer header or URL password leaves the process.",
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoKeyMaterial(v, `${path}[${i}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) assertNoKeyMaterial(v, `${path}.${k}`);
  }
}
