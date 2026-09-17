import type {
  ChainId,
  HealthStatus,
  PageDoc,
  WalletMention,
} from "@hydra/core";
import type { Result } from "@hydra/core";

export type IntelError = string;

export interface WalletRank {
  walletId: string;
  chain: ChainId;
  label?: string;
  tags?: string[];
  rank: number;
  source: string;
}

export interface WalletProfile {
  walletId: string;
  chain: ChainId;
  pnl7d?: string;
  pnl30d?: string;
  winrate?: number;
  honeypotRatio?: number;
  fastTxRatio?: number;
  tags?: string[];
}

export interface WalletHoldings {
  walletId: string;
  chain: ChainId;
  holdings: Array<{
    assetAddress: string;
    symbol?: string;
    valueUsd?: string;
  }>;
}

export interface WalletActivity {
  walletId: string;
  chain: ChainId;
  txHash: string;
  side: "buy" | "sell";
  assetAddress: string;
  valueUsd?: string;
  timestamp: string;
}

export interface WalletStats {
  walletId: string;
  chain: ChainId;
  pnl7d?: string;
  pnl30d?: string;
  winrate?: number;
}

export interface TokenSecurity {
  chain: ChainId;
  tokenAddress: string;
  isHoneypot: boolean;
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked?: boolean;
  taxBps?: number;
  lpLocked?: boolean;
}

export interface TokenHolder {
  chain: ChainId;
  tokenAddress: string;
  holderAddress: string;
  amount: string;
  fraction?: number;
}

export interface TopTrader {
  chain: ChainId;
  tokenAddress: string;
  walletId: string;
  pnlUsd?: string;
  volumeUsd?: string;
}

export interface FlowSignal {
  chain: ChainId;
  walletId: string;
  tokenAddress: string;
  direction: "buy" | "sell";
  amountUsd?: string;
  timestamp: string;
  signalSource: string;
}

export interface CreatedToken {
  chain: ChainId;
  walletId: string;
  tokenAddress: string;
  createdAt: string;
}

/**
 * GMGN-first intel port used by the hunt plane.
 *
 * Implementations wrap GMGN OpenAPI / Skills / gmgn-cli and may fall back to
 * Browser Use or explorers only when GMGN has no API coverage. They never
 * import exec adapters or private keys.
 */
export interface IntelPort {
  rankWallets(
    chain: ChainId,
    options?: { limit?: number; tags?: string[] },
  ): Promise<Result<WalletRank[], IntelError>>;

  walletProfile(
    walletId: string,
    chain: ChainId,
  ): Promise<Result<WalletProfile, IntelError>>;

  walletHoldings(
    walletId: string,
    chain: ChainId,
  ): Promise<Result<WalletHoldings, IntelError>>;

  walletActivity(
    walletId: string,
    chain: ChainId,
  ): Promise<Result<WalletActivity[], IntelError>>;

  walletStats(
    walletIds: string[],
    chain: ChainId,
  ): Promise<Result<WalletStats[], IntelError>>;

  tokenSecurity(
    chain: ChainId,
    tokenAddress: string,
  ): Promise<Result<TokenSecurity, IntelError>>;

  tokenHolders(
    chain: ChainId,
    tokenAddress: string,
  ): Promise<Result<TokenHolder[], IntelError>>;

  topTraders(
    chain: ChainId,
    tokenAddress: string,
  ): Promise<Result<TopTrader[], IntelError>>;

  trackSmartMoney(
    chain: ChainId,
    options?: { limit?: number },
  ): Promise<Result<FlowSignal[], IntelError>>;

  trackKol(
    chain: ChainId,
    options?: { limit?: number },
  ): Promise<Result<FlowSignal[], IntelError>>;

  createdTokens(
    walletId: string,
    chain: ChainId,
  ): Promise<Result<CreatedToken[], IntelError>>;
}

/**
 * Agent-Reach public-web / social intel port.
 *
 * This interface keeps non-blocking Promise returns as specified. It is a
 * capability layer, not a wrapper to reimplement.
 */
export interface SocialIntelPort {
  readUrl(url: string): Promise<PageDoc>;
  search(
    platform: "x" | "reddit" | "web" | "youtube" | "github",
    q: string,
  ): Promise<PageDoc[]>;
  extractWalletMentions(doc: PageDoc): WalletMention[];
  doctor(): Promise<HealthStatus>;
}
