# HYDRA — Claude Code Implementation Spec

**Product:** Multi-chain execution + smart-wallet hunter
**Consumers:** Claude Code, human operators
**Status:** v2.0 — implement against this document
**Repos / tools in scope:** GMGN.ai · [Agent-Reach](https://github.com/Panniantong/Agent-Reach) · [Browser Use](https://github.com/browser-use/browser-use)

Read this file before writing code. Do not flatten layers. Do not put hunter logic inside swap adapters. Do not trade from a scrape path.

---

## 0. Mission

Build **Hydra**: a modular system that can

1. **Execute** spot trades on **Solana**, **Base**, **Robinhood Chain**, and **PulseChain**
2. Optionally place **Robinhood Crypto CEX** orders
3. **Hunt public smart-money wallets** using GMGN, Agent-Reach, and Browser Use
4. Score, cluster, and watch those wallets
5. Optionally copy-trade **only after** security + quality gates pass
6. Stay dynamic: sources fail over, strategies promote/demote wallets, routing picks the best venue per asset

This is an **intelligence + execution platform**, not a single script.

### Hard ethical / safety boundary

Wallet hunting means **public on-chain addresses and public social posts**.

Forbidden:

- Doxxing private identities
- Harassment, intimidation, or "find this person IRL"
- Logging into someone else's exchange / email / bank
- Pasting seeds, private keys, or session cookies into the browser agent
- Scraping GMGN logged-in account pages when an official API exists
- Auto-copying a wallet that fails security gates

---

## 1. Operating model (two planes)

```
                   ┌──────────────────────────┐
                   │     CONTROL PLANE        │
                   │  CLI · API · Claude Code │
                   │  Skills · Doctor · Halt  │
                   └────────────┬─────────────┘
                                │
             ┌──────────────────┼──────────────────┐
             │                  │                  │
    ┌────────▼────────┐ ┌───────▼────────┐ ┌───────▼────────┐
    │  HUNT PLANE     │ │  DECISION      │ │  EXEC PLANE    │
    │  discover       │ │  score/risk    │ │  quote/sim/tx  │
    │  enrich         │ │  promote       │ │  confirm/fill  │
    │  watch          │ │  size          │ └────────────────┘
    └─────────────────┘ └────────────────┘
             │                  │
             └────────┬─────────┘
                      ▼
             STATE PLANE (event log + projections)
```

- Hunt plane **never signs transactions**.
- Exec plane **never scrapes social**.
- Decision plane is the only place a hunted wallet can become a live order.

---

## 2. Venues

| Venue ID | Kind | Chain ID | Gas | Default router | Hunter coverage |
|---|---|---|---|---|---|
| solana | DEX | Solana | SOL | Jupiter Swap API v2 | GMGN first-class (sol) |
| base | EVM L2 | 8453 | ETH | Aggregator → Aerodrome + Uniswap v3/v4 | GMGN first-class (base) |
| robinhood_chain | EVM L2 | 4663 | ETH | Uniswap v3/v4 on 4663, then aggregator if live | GMGN chain slug `robinhood` where API supports it; else Browser Use + explorers |
| pulsechain | EVM L1 | 369 | PLS | PulseSwap / Piteas → PulseX v1/v2/stable | Weak/no GMGN. Use Browser Use + GeckoTerminal + PulseScanner + Agent-Reach |
| robinhood_crypto | CEX | n/a | n/a | Official Robinhood Crypto API v2 | Not a hunt target |

Network constants (config, not scattered magic):

```yaml
solana:
  cluster: mainnet-beta
  wrapped_native: So11111111111111111111111111111111111111112
  exec: https://api.jup.ag/swap/v2

base:
  chainId: 8453
  rpc_public: https://mainnet.base.org   # prod must use paid RPC
  explorer: https://basescan.org

robinhood_chain:
  chainId: 4663
  testnetChainId: 46630
  rpc_public: https://rpc.mainnet.chain.robinhood.com
  rpc_alchemy: https://robinhood-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}
  explorer: https://robinhoodchain.blockscout.com
  robinscan: https://robin.etherscan.io

pulsechain:
  chainId: 369
  rpc: https://rpc.pulsechain.com
  wss: wss://rpc.pulsechain.com
  explorer: https://scan.pulsechain.com
  token_standard: PRC-20
```

PulseChain must **not** reuse Ethereum Uniswap addresses.
Robinhood Chain must **not** reuse Base Uniswap addresses.

---

## 3. Tooling stack (required integrations)

### 3.1 GMGN.ai — primary on-chain intel

Use **official GMGN OpenAPI / GMGN Skills / gmgn-cli**. Do not depend on unofficial browser-console scrapers as the production path.

Install as a Claude Code skill from [GMGNAI/gmgn-skills](https://github.com/GMGNAI/gmgn-skills).

Auth: local keypair → upload public key at gmgn.ai/ai → `GMGN_API_KEY` (+ private key only for critical portfolio routes).

**Capabilities Hydra must wrap:**

| Port method | GMGN capability | Used for |
|---|---|---|
| rankWallets | wallet leaderboards / tags | discover |
| walletProfile | PnL, winrate, honeypot_ratio, fast_tx_ratio | score |
| walletHoldings | current bag | enrich / copy-size |
| walletActivity | recent buys/sells | watch |
| walletStats | batch stats | re-score |
| tokenSecurity | honeypot, renounce, mint, tax | pre-trade |
| tokenHolders / topTraders | holder graph | cluster / sybil |
| trackSmartMoney / trackKol | live flow | signals |
| createdTokens | dev history | rug filter |

GMGN chain slugs (`packages/intel/gmgn/chain-map.ts`):

```
solana            -> sol
base              -> base
robinhood_chain   -> robinhood
ethereum          -> eth          # intel only in v1
bsc               -> bsc          # intel only in v1
pulsechain        -> null         # no official slug assumed; use fallback hunters
```

If a slug 404s, mark venue intel degraded and route to Browser Use / explorers. Never crash the engine.

**Copy-trade execution via GMGN swap is optional and off by default.** Hydra executes on *our* venue adapters so risk limits stay in-process.

### 3.2 Agent-Reach — public-web / social intel

Repo: https://github.com/Panniantong/Agent-Reach

Agent-Reach is a **capability layer**, not a wrapper you reimplement. Install it, run `agent-reach doctor --json`, then call **upstream tools directly**.

Use it to hunt *mentions of wallets and tokens*, not to invent on-chain data.

Allowed channels: Web page read (Jina), X/Twitter, Reddit, YouTube transcripts, GitHub, RSS, Exa web search.

Disallowed by default: job boards / dating-adjacent / personal-profile scraping unrelated to token/wallet activity; primary personal social accounts (secondary research account only).

Hydra port (`packages/intel/agent-reach/`):

```ts
interface SocialIntelPort {
  readUrl(url: string): Promise<PageDoc>;
  search(platform: "x" | "reddit" | "web" | "youtube" | "github", q: string): Promise<PageDoc[]>;
  extractWalletMentions(doc: PageDoc): WalletMention[];
  doctor(): Promise<HealthStatus>;
}
```

Wallet mention extractor accepts only:

- Solana base58 32–44 chars
- EVM `0x` + 40 hex
- Explicit "CA:" / "wallet:" contexts

Drop anything that looks like an email, phone, home address, or government ID.

### 3.3 Browser Use — UI fallback hunter

Library: `browser-use` (Python >= 3.11). Hydra talks to it through a sidecar, not by inlining Playwright in the TS exec path.

Use Browser Use **only when**:

- GMGN has no API coverage (PulseChain, some Robinhood Chain pages)
- A public leaderboard/UI is the only source
- An explorer page must be extracted into a schema

Always: domain allowlist, structured Pydantic/Zod output, time budget + step budget, headless, no password manager, never type a seed / private key / 2FA from the hot wallet.

Allowlist (v1): `gmgn.ai`, `dexscreener.com`, `www.geckoterminal.com`, `basescan.org`, `robinhoodchain.blockscout.com`, `robin.etherscan.io`, `scan.pulsechain.com`, `pulsescanner.io`, `app.pulsex.com`, `solscan.io`, `jup.ag`.

Sidecar: `services/browser-hunter/` (Python). `services/browser-hunter/tasks/pulse_smart_wallets.py` returns `List[WalletCandidate]` only. No screenshots persisted by default.

---

## 4. Progressive intelligence (the hunter)

Hunting is a **pipeline with ranks**, not a single scrape.

### 4.1 Candidate lifecycle

```
observed → candidate → scored → watchlisted → trusted → copy_enabled → retired
```

State machine (`packages/hunter/lifecycle.ts`):

| From | To | Gate |
|---|---|---|
| observed | candidate | valid address + chain + ≥1 source |
| candidate | scored | profile + security features computed |
| scored | watchlisted | score ≥ WATCH_MIN and not sybil |
| watchlisted | trusted | 7d live paper-copy Sharpe/hit-rate pass |
| trusted | copy_enabled | human confirm **or** AUTO_PROMOTE=true + extra gates |
| any | retired | rug cluster, wash, honeypot ratio, drawdown, inactivity |

No wallet jumps from observed to copy_enabled.

### 4.2 Discovery sources (composable hunters)

```ts
interface Hunter {
  id: string;
  modality: "api" | "social" | "browser" | "chain";
  chains: ChainId[];
  discover(ctx: HuntContext): Promise<Observation[]>;
}
```

Ship these hunters:

| ID | Modality | What it finds |
|---|---|---|
| gmgn.rank | api | tagged smart / KOL / fresh / sniper / whale |
| gmgn.radar | api | gold_dog, smart_money, kol_buy, whale_buy |
| gmgn.tokenTraders | api | top traders on a CA you already care about |
| reach.x | social | wallets posted with CA + PnL claims (treat claims as rumor) |
| reach.reddit | social | recurring addresses in alpha threads |
| browser.gmgn_ui | browser | UI-only tabs if API gaps |
| browser.pulse_dex | browser | PulseX / GeckoTerminal top traders |
| browser.robinhood_dex | browser | Uniswap/RobinSwap leaderboards on 4663 |
| chain.early_buyer | chain | first N unique buyers after pool create (own indexer later; v1 via GMGN/DEX APIs) |

Fan-in through `HunterOrchestrator` with concurrency limits and source weights.

### 4.3 Scoring model

`packages/hunter/scoring/engine.ts`

Inputs (normalized 0–1 unless noted): `pnl_7d`, `pnl_30d`, `winrate`, `avg_hold_minutes` (too-low = sniper/wash), `trade_count` (too-low = luck), `unique_tokens` vs repeated winner (diversity), `max_token_concentration`, `honeypot_ratio`, `fast_tx_ratio`, `bundler_overlap`, `sybil_cluster_size`, `fresh_wallet` penalty unless configured for launches, `source_agreement` (GMGN + social + chain), `drawdown_30d`, `median_size_usd` vs our max order (copy-fit).

Output:

```ts
interface WalletScore {
  walletId: string;
  composite: number;          // 0-100
  copyTradeable: 0 | 1;
  reasons: string[];
  vetoes: string[];
}
```

Hard vetoes (composite ignored):

- honeypot_ratio > 0.15
- sold > bought pattern on majority of tokens (extractor)
- known bundler / same-block multi-wallet cluster
- 40% volume against its own cluster
- token tax > configured cap on last 3 entries
- social-only mention with zero on-chain proof

### 4.4 Cluster / sybil

`packages/hunter/graph/` — build an undirected graph on: funded-by, same-block entry, shared funding parent, identical trade sequences ± 2s.

If cluster size ≥ SYBIL_N, mark all members sybil and refuse copy.

### 4.5 Watcher

`packages/hunter/watch/subscription.ts`

- Poll GMGN activity + chain logs
- Emit `WalletTradeSeen`
- Paper-copy into a virtual book
- Promote only if paper metrics beat baseline for PROMOTION_WINDOW

---

## 5. Execution architecture

```ts
interface TradeRequest {
  clientOrderId: string;
  venue: VenueId;
  side: "buy" | "sell";
  inputAsset: AssetRef;
  outputAsset: AssetRef;
  amount: Amount;
  amountMode: "exact_in" | "exact_out";
  slippageBps: number;
  maxImpactBps: number;
  urgency: "low" | "normal" | "high";
  deadlineSec: number;
  dryRun: boolean;
  origin: {
    type: "manual" | "limit_watch" | "copy" | "research";
    walletId?: string;
    observationId?: string;
    conviction: number;
  };
}
```

Copy trades must pass **token security + wallet score + risk + route quality** again at T+0. A trusted wallet can still buy a honeypot.

### 5.1 Venue adapters

`VenueAdapter` contract: quote / simulate / execute / confirm / balances.

```
OrderRouter
  ├─ SolanaRouter        Jupiter v2 only in v1
  ├─ EvmAggregatorRouter Base / RH chain (0x, LiFi, Uniswap Trade API)
  ├─ UniswapDirectRouter RH chain fallback
  └─ PulseRouter         PulseSwap → Piteas → PulseX
```

`packages/exec/routing/score.ts` picks the route with best net out after gas, impact ≤ cap, venue health, recent fail rate.

### 5.2 EVM shared vs chain-specific

`packages/exec/evm-common` owns: viem clients, failover RPC, ERC-20/PRC-20, approvals, receipts, EIP-1559.

Chain packs only supply: chainId, routers, wrapped native, token registry, explorer URL builder.

Approval default: exact amount + 1% buffer. Infinite approve is a config flag default false.

---

## 6. Security measures (skills + runtime)

Claude Code must install these as skills in `.claude/skills/`. Each skill is a `SKILL.md` the agent loads before touching keys or live mode.

### 6.1 Security skills (required)

| Skill | File | Agent must |
|---|---|---|
| secrets-hygiene | `.claude/skills/secrets-hygiene/SKILL.md` | never print keys; 0600 files; separate hunt vs hot wallets |
| pretrade-sim | `.claude/skills/pretrade-sim/SKILL.md` | no broadcast without simulate + minOut |
| token-armor | `.claude/skills/token-armor/SKILL.md` | honeypot, mint, freeze, tax, LP lock |
| wallet-armor | `.claude/skills/wallet-armor/SKILL.md` | sybil, wash, extractor, bundler vetoes |
| kill-switch | `.claude/skills/kill-switch/SKILL.md` | honor `data/HALT`, error storms |
| allowlist-domains | `.claude/skills/allowlist-domains/SKILL.md` | browser-use stays on allowlist |
| no-dox | `.claude/skills/no-dox/SKILL.md` | store addresses + public handles only |
| paper-first | `.claude/skills/paper-first/SKILL.md` | new strategy lives in paper ≥ N fills |

### 6.2 Progressive skills (required)

| Skill | Purpose |
|---|---|
| hunt-pipeline | run discover → score → watch, never jump |
| gmgn-operator | how to call gmgn-cli / OpenAPI safely |
| agent-reach-operator | doctor --json then upstream tools |
| browser-hunter-operator | structured extract only |
| copy-promote | paper metrics before live copy |
| venue-failover | degrade intel vs halt exec separately |
| position-fsm | entry / scale / trail / exit |

### 6.3 Runtime security controls

- Two wallets: HUNT_READONLY (optional) and HOT_EXEC
- Hunt plane keys cannot sign exec
- Daily loss halt, per-token cap, per-wallet copy cap
- Max concurrent copy wallets
- Quote TTL: 8s Solana, 12s EVM
- Idempotent clientOrderId
- Simulation mismatch > SIM_DRIFT_BPS aborts
- Auto-halt if 5 failed live txs / 10 min
- Token deny-list persisted
- Browser sidecar cannot import EVM_PRIVATE_KEY or SOLANA_PRIVATE_KEY (different env files)

---

## 7. State management

Do **not** use a single mutable "god object".

### 7.1 Event log (source of truth)

SQLite WAL `data/hydra.db` + optional Postgres later.

Append-only events: `ObservationIngested`, `WalletScored`, `WalletPromoted`, `WalletRetired`, `QuoteTaken`, `OrderIntent`, `OrderSubmitted`, `OrderConfirmed`, `OrderFailed`, `RiskVeto`, `KillSwitchFlipped`, `IntelDegraded`.

### 7.2 Projections (read models)

| Projection | Owner | Contents |
|---|---|---|
| wallets | hunter | lifecycle, score, tags, cluster_id |
| watch_book | hunter | last trade, paper PnL |
| orders | exec | intent → fill |
| positions | portfolio | per venue + token |
| risk_counters | risk | daily notional, loss, fails |
| source_health | intel | GMGN / Reach / Browser / RPC |

Rebuildable from events (`hydra project --rebuild`).

### 7.3 In-memory runtime

`packages/core/runtime/store.ts` — a typed store for process state, namespaced (`exec`, `hunt`, `risk`, `intel`); updates only via reducers subscribed to events; strategies read snapshots, never write DB directly.

### 7.4 Position FSM

```
flat → entering → open → scaling → trailing → exiting → flat
                 ↘ aborted
```

Copy engine may only emit orders from `flat|open|scaling|trailing` according to policy.

---

## 8. File and folder system

Monorepo, pnpm workspaces, TypeScript for core/exec, Python sidecar for Browser Use. See the repo tree checked into this scaffold — it mirrors this section exactly.

Separation of concerns, enforced:

| Package | May import | Must not import |
|---|---|---|
| core | nothing in-repo | exec, hunter, intel |
| intel/* | core, config | exec adapters, private keys |
| hunter | core, intel ports, storage | viem send, Jupiter execute |
| exec | core, risk, tokens, storage | agent-reach, browser-use |
| strategies | ports only | concrete adapters |
| apps/cli | all ports | raw SDKs except doctor |

---

## 9. Scripts Claude Code must ship

- `scripts/doctor.sh` — venue RPC chainId checks, Jupiter key presence, GMGN auth ping, `agent-reach doctor --json`, browser sidecar health, halt file, token registry load.
- `scripts/hunt_once.ts` — writes `ObservationIngested` only.
- `scripts/promote_wallet.ts` — loads score + paper book, refuses without gates, writes `WalletPromoted`.
- `scripts/paper_copy_replay.ts` — replays last N watched trades against historical quotes. No live sends.
- `scripts/smoke_dust_swap.ts` — dust swap per enabled venue, dryRun then optional `--live`, capped at $5.
- `scripts/halt.sh` / `resume.sh` — touch/remove `data/HALT` and emit an event.

### CLI surface

```
hydra doctor
hydra venues
hydra hunt run --chain base --min-score 70
hydra wallets ls --state watchlisted
hydra wallets show <id>
hydra wallets promote <id>
hydra watch start
hydra quote --venue solana --in SOL --out USDC --amount 0.05
hydra swap --venue pulsechain --in WPLS --out HEX --amount 500 --dry-run
hydra copy start --wallet <id> --size-usd 25 --venue auto
hydra halt
```

`venue auto` for copy = token's home chain from registry/GMGN, never bridge.

---

## 10. Dynamic behavior

1. **Source health matrix** — each intel source is ok | degraded | down. Orchestrator skips down sources.
2. **Adaptive poll** — hot watchlisted wallets poll 2–5s; cold every 60s.
3. **Conviction decay** — unused trusted wallets decay toward watchlisted.
4. **Route memory** — last 20 route outcomes bias next router choice.
5. **Narrative boost (capped)** — Agent-Reach mention can add ≤5 score points, never override a veto.
6. **Chain coverage mode** — Full: Solana, Base. Partial: Robinhood Chain. Explorer/browser: PulseChain.
7. **Fail-open intel, fail-closed money** — lost GMGN does not halt quotes; lost simulation does halt sends.

---

## 11. Config sketch

```yaml
mode: paper
halt: false
auto_promote: false

intel:
  gmgn: { enabled: true, skills: true }
  agent_reach: { enabled: true, platforms: [x, reddit, web, youtube, github] }
  browser_use:
    enabled: true
    max_steps: 20
    max_seconds: 90
    allowlist: config/allowlists/domains.txt

hunt:
  min_watch_score: 72
  min_trust_score: 80
  promotion_window_hours: 24
  sybil_n: 4
  max_watchlist: 200
  max_copy_wallets: 5
  source_weights:
    gmgn.rank: 1.0
    gmgn.radar: 0.9
    chain.early_buyer: 0.8
    reach.x: 0.25
    browser.pulse_dex: 0.7

venues:
  solana: { enabled: true, maxOrderUsd: 250, maxSlippageBps: 100 }
  base: { enabled: true, chainId: 8453, maxOrderUsd: 250 }
  robinhood_chain: { enabled: true, chainId: 4663, maxOrderUsd: 250 }
  pulsechain: { enabled: true, chainId: 369, maxOrderUsd: 100, maxSlippageBps: 150 }
  robinhood_crypto: { enabled: false }

risk:
  maxDailyUsd: 1000
  maxDailyLossUsd: 150
  maxTokenUsd: 200
  maxCopyFractionOfWallet: 0.15
  allowUnknownTokens: false
  approvalMode: exact
```

---

## 12. Abstraction layers (do not collapse)

```
Skills / CLI          # human + Claude interface
Application services  # HuntService, TradeService, CopyService
Domain ports          # Hunter, VenueAdapter, IntelPort, RiskPort
Infrastructure        # GMGN client, viem, Jupiter, Browser sidecar, Agent-Reach
```

A new chain = new token JSON + adapter pack + chain map.
A new hunter = one file implementing `Hunter`.
A new strategy = one file emitting `TradeRequest`s.

---

## 13. Implementation order for Claude Code

1. Repo skeleton, SPEC.md, CLAUDE.md, skills stubs, config zod
2. Event store + projections + halt
3. Risk + token registries
4. Exec adapters: Base → Robinhood Chain → PulseChain → Solana → RH Crypto
5. GMGN intel port + chain map including robinhood
6. Hunter pipeline + scoring + sybil graph
7. Agent-Reach port (doctor + search/read + mention extract)
8. Browser-use sidecar + Pulse / RH fallback tasks
9. Paper copy watcher
10. Promote + live copy behind flags
11. Dust smoke + integration tests

Do not start with Browser Use scraping GMGN if the official API works.

---

## 14. Tests that must exist

- Lifecycle cannot skip ranks
- Veto beats high PnL
- Sybil cluster retires members
- GMGN 404 on pulsechain degrades, hunt continues via browser hunter
- Browser task off-allowlist throws
- Agent-Reach extractor ignores emails
- Exec idempotency
- Copy origin still runs token-armor
- Paper mode never imports exec private key
- doctor fails on wrong chainId

---

## 15. CLAUDE.md contract

See `CLAUDE.md` in the repo root — it is the binding version of this section.

---

## 16. Acceptance

v2 is complete when:

1. Dust quote/swap works on Solana, Base, Robinhood Chain, PulseChain through one CLI.
2. `hydra hunt run` returns scored wallets on Solana and Base via GMGN.
3. Robinhood Chain hunt returns candidates via GMGN robinhood **or** browser fallback without crashing.
4. PulseChain hunt returns candidates via Browser Use + Dex/Gecko pages.
5. Agent-Reach can attach public X/Reddit mentions to a wallet record without storing personal data.
6. A high-PnL sybil wallet is vetoed.
7. Copy stays paper until promote.
8. Skills listed in §6 exist and are referenced from CLAUDE.md.
9. Folder layout matches §8.
