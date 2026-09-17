import { z } from "zod";

const gmgnSchema = z
  .object({
    enabled: z.boolean(),
    skills: z.boolean(),
  })
  .strict();

const agentReachSchema = z
  .object({
    enabled: z.boolean(),
    platforms: z.array(
      z.enum(["x", "reddit", "web", "youtube", "github"]),
    ),
  })
  .strict();

const browserUseSchema = z
  .object({
    enabled: z.boolean(),
    max_steps: z.number().int().positive(),
    max_seconds: z.number().int().positive(),
    allowlist: z.string(),
  })
  .strict();

const huntSchema = z
  .object({
    min_watch_score: z.number().min(0).max(100),
    min_trust_score: z.number().min(0).max(100),
    promotion_window_hours: z.number().int().positive(),
    sybil_n: z.number().int().positive(),
    max_watchlist: z.number().int().positive(),
    max_copy_wallets: z.number().int().positive(),
    source_weights: z
      .object({
        "gmgn.rank": z.number().nonnegative(),
        "gmgn.radar": z.number().nonnegative(),
        "chain.early_buyer": z.number().nonnegative(),
        "reach.x": z.number().nonnegative(),
        "browser.pulse_dex": z.number().nonnegative(),
      })
      .strict(),
  })
  .strict();

const solanaVenueSchema = z
  .object({
    enabled: z.boolean(),
    maxOrderUsd: z.number().positive(),
    maxSlippageBps: z.number().nonnegative(),
  })
  .strict();

const baseVenueSchema = z
  .object({
    enabled: z.boolean(),
    chainId: z.number().int().positive(),
    maxOrderUsd: z.number().positive(),
  })
  .strict();

const robinhoodChainVenueSchema = z
  .object({
    enabled: z.boolean(),
    chainId: z.number().int().positive(),
    maxOrderUsd: z.number().positive(),
  })
  .strict();

const pulsechainVenueSchema = z
  .object({
    enabled: z.boolean(),
    chainId: z.number().int().positive(),
    maxOrderUsd: z.number().positive(),
    maxSlippageBps: z.number().nonnegative(),
  })
  .strict();

const robinhoodCryptoVenueSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();

const venuesSchema = z
  .object({
    solana: solanaVenueSchema,
    base: baseVenueSchema,
    robinhood_chain: robinhoodChainVenueSchema,
    pulsechain: pulsechainVenueSchema,
    robinhood_crypto: robinhoodCryptoVenueSchema,
  })
  .strict();

const riskSchema = z
  .object({
    maxDailyUsd: z.number().positive(),
    maxDailyLossUsd: z.number().positive(),
    maxTokenUsd: z.number().positive(),
    maxCopyFractionOfWallet: z.number().min(0).max(1),
    allowUnknownTokens: z.boolean(),
    approvalMode: z.enum(["exact", "infinite"]),
  })
  .strict();

export const configSchema = z
  .object({
    mode: z.enum(["paper", "live"]),
    halt: z.boolean(),
    auto_promote: z.boolean(),
    intel: z
      .object({
        gmgn: gmgnSchema,
        agent_reach: agentReachSchema,
        browser_use: browserUseSchema,
      })
      .strict(),
    hunt: huntSchema,
    venues: venuesSchema,
    risk: riskSchema,
  })
  .strict();

export type HydraConfig = z.infer<typeof configSchema>;
