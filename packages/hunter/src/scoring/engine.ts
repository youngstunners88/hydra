/**
 * Hunter wallet scoring engine.
 *
 * Security vetoes are checked first and short-circuit the composite score.
 * This is intentional: a veto means "this wallet must not be copied", not
 * "this wallet should receive fewer points". A high-PnL wallet with a
 * honeypot or sybil signal is still an absolute no.
 */

export interface WalletScore {
  walletId: string;
  composite: number; // 0-100
  copyTradeable: 0 | 1;
  reasons: string[];
  vetoes: string[];
}

export interface WalletFeatures {
  walletId: string;

  /** Profit/loss signals, normalized 0-1. Higher is better. */
  pnl_7d: number;
  pnl_30d: number;

  /** Winrate normalized 0-1. */
  winrate: number;

  /** Average holding period in minutes. */
  avg_hold_minutes: number;

  /** Total trade count. */
  trade_count: number;

  /** Number of unique tokens traded by this wallet. */
  unique_tokens: number;

  /** Fraction of capital in the largest single token. */
  max_token_concentration: number;

  /** Fraction of wallet trades that turned out to be honeypots. */
  honeypot_ratio: number;

  /** Fraction of very fast trades often associated with snipers or wash flow. */
  fast_tx_ratio: number;

  /** Overlap with known bundler wallets, normalized 0-1. */
  bundler_overlap: number;

  /** Number of wallets in the same cluster. */
  sybil_cluster_size: number;

  /** True when this wallet appears to be fresh and launch-focused. */
  fresh_wallet: boolean;

  /** Agreement across discovery sources, normalized 0-1. */
  source_agreement: number;

  /** Maximum drawdown over the last 30 days, normalized 0-1. */
  drawdown_30d: number;

  /** Median position size in USD. Decimal-safe string. */
  median_size_usd: string;

  /** Largest single order allowed by Hydra for this wallet. Decimal string. */
  maxOrderUsd: string;

  /** True when on-chain proof exists for at least one observed trade. */
  hasOnChainProof: boolean;

  /** True when the only evidence is a social-media claim. */
  isSocialOnly: boolean;

  /** True when extractor sees sold > bought across the majority of tokens. */
  soldGtBoughtOnMajorityTokens: boolean;

  /** True when the address is known bundler or same-block multi-wallet cluster. */
  knownBundlerOrSameBlockCluster: boolean;

  /** Percent of volume traded against its own cluster, 0-100. */
  volumeAgainstOwnClusterPct: number;

  /** Tax in basis points for the last three entries. */
  tokenTaxBpsLast3: number[];

  /** Configurable maximum acceptable token tax in basis points. */
  maxTokenTaxCapBps: number;
}

const COPY_TRADEABLE_THRESHOLD = 80;

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function clamp100(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function decimalStringToNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function score(features: WalletFeatures): WalletScore {
  const vetoes: string[] = [];

  // Hard vetoes first. These are absolute and do not subtract points.
  if (features.honeypot_ratio > 0.15) {
    vetoes.push("honeypot_ratio > 0.15");
  }

  if (features.soldGtBoughtOnMajorityTokens) {
    vetoes.push("sold > bought pattern on majority of tokens");
  }

  if (features.knownBundlerOrSameBlockCluster) {
    vetoes.push("known bundler / same-block multi-wallet cluster");
  }

  if (features.volumeAgainstOwnClusterPct >= 40) {
    vetoes.push("40% volume against its own cluster");
  }

  if (
    features.tokenTaxBpsLast3.some(
      (bps) => bps > features.maxTokenTaxCapBps,
    )
  ) {
    vetoes.push("token tax > configured cap on last 3 entries");
  }

  if (features.isSocialOnly && !features.hasOnChainProof) {
    vetoes.push("social-only mention with zero on-chain proof");
  }

  if (vetoes.length > 0) {
    return {
      walletId: features.walletId,
      composite: 0,
      copyTradeable: 0,
      reasons: ["veto"],
      vetoes,
    };
  }

  const medianSizeUsd = decimalStringToNumber(features.median_size_usd);
  const maxOrderUsd = decimalStringToNumber(features.maxOrderUsd);

  const tradeCountScore = clamp01(Math.min(1, features.trade_count / 50));
  const diversityScore = clamp01(Math.min(1, features.unique_tokens / 20));
  const sizeFitScore =
    maxOrderUsd <= 0
      ? 0
      : clamp01(
          Math.max(
            0,
            1 - Math.abs(medianSizeUsd - maxOrderUsd) / maxOrderUsd,
          ),
        );
  const drawdownInvScore = clamp01(1 - features.drawdown_30d);
  const sybilPenalty = clamp01(
    Math.min(1, features.sybil_cluster_size / 4),
  );

  const positive =
    clamp01(features.pnl_7d) * 18 +
    clamp01(features.pnl_30d) * 18 +
    clamp01(features.winrate) * 18 +
    clamp01(features.source_agreement) * 10 +
    tradeCountScore * 10 +
    diversityScore * 8 +
    sizeFitScore * 10 +
    drawdownInvScore * 8;

  const negative =
    clamp01(features.honeypot_ratio) * 22 +
    clamp01(features.fast_tx_ratio) * 18 +
    clamp01(features.bundler_overlap) * 22 +
    clamp01(features.max_token_concentration) * 18 +
    sybilPenalty * 20;

  const freshWalletPenalty = features.fresh_wallet ? 5 : 0;

  const composite = clamp100(
    Math.round(positive - negative - freshWalletPenalty),
  );

  return {
    walletId: features.walletId,
    composite,
    copyTradeable: composite >= COPY_TRADEABLE_THRESHOLD ? 1 : 0,
    reasons: [
      "composite weighted score computed from normalized profit, winrate, diversity, size fit, drawdown, and sybil/predatory penalties",
    ],
    vetoes,
  };
}
