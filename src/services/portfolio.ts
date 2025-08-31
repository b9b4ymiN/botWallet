import { Connection, PublicKey } from "@solana/web3.js";
import logger from "../utils/logger";
import { rtdbGet, rtdbSet } from "./firebase";

export interface Position {
  qty: number; // current position quantity
  costUsd: number; // cumulative cost basis (USD) for remaining qty
  avgEntryUsd: number; // derived average entry price
  realizedPnlUsd: number; // cumulative realized PnL (USD)
  updatedAt: number; // epoch seconds
}

export interface PnlSnapshot {
  holdingQty: number;
  holdingValueUsd?: number;
  avgEntryUsd?: number;
  unrealizedPnlUsd?: number;
  unrealizedPnlPct?: number;
  realizedPnlUsd?: number;
}

type Store = Record<string, Record<string, Position>>; // wallet -> mintOrSOL -> Position
// In-process cache only; source of truth is Firebase RTDB
const MEM_CACHE: Store = {};

function keyForToken(address: string, symbol?: string): string {
  // Normalize SOL special-case
  if (symbol === "SOL" || address === "Solana") return "SOL";
  return address;
}

export class PortfolioService {
  constructor(private readonly connection: Connection) {}

  async getHoldingQty(walletAddress: string, tokenAddress: string, symbol?: string): Promise<number> {
    // SOL: use lamports balance
    if (symbol === "SOL" || tokenAddress === "Solana") {
      try {
        const lamports = await this.connection.getBalance(new PublicKey(walletAddress));
        return lamports / 1e9;
      } catch (e) {
        logger.error("Failed to get SOL balance", e);
        return 0;
      }
    }

    // SPL token: sum token accounts for the given mint
    try {
      const owner = new PublicKey(walletAddress);
      const mint = new PublicKey(tokenAddress);
      const res = await this.connection.getParsedTokenAccountsByOwner(owner, { mint });
      let total = 0;
      for (const { account } of res.value) {
        const data: any = account.data;
        const amt = Number(data.parsed?.info?.tokenAmount?.uiAmount || 0);
        total += amt;
      }
      return total;
    } catch (e) {
      logger.error("Failed to get SPL token holdings", e);
      return 0;
    }
  }

  async getPosition(
    walletAddress: string,
    tokenAddress: string,
    symbol?: string
  ): Promise<Position | undefined> {
    const k = keyForToken(tokenAddress, symbol);
    if (MEM_CACHE[walletAddress]?.[k]) return MEM_CACHE[walletAddress][k];
    try {
      const val = await rtdbGet<Position>(`portfolios/${walletAddress}/${k}`);
      if (!MEM_CACHE[walletAddress]) MEM_CACHE[walletAddress] = {};
      if (val) MEM_CACHE[walletAddress][k] = val;
      return val;
    } catch (e) {
      logger.error("Firebase getPosition failed", e);
      return MEM_CACHE[walletAddress]?.[k];
    }
  }

  private async savePosition(
    walletAddress: string,
    tokenAddress: string,
    pos: Position,
    symbol?: string
  ): Promise<void> {
    const k = keyForToken(tokenAddress, symbol);
    if (!MEM_CACHE[walletAddress]) MEM_CACHE[walletAddress] = {};
    MEM_CACHE[walletAddress][k] = pos;
    try {
      await rtdbSet(`portfolios/${walletAddress}/${k}`, pos);
    } catch (e) {
      logger.error("Firebase savePosition failed", e);
    }
  }

  async updateWithTrade(args: {
    walletAddress: string;
    tokenAddress: string;
    symbol?: string;
    tradeSide: "BUY" | "SELL" | "SWAP";
    tokenAmount: number; // amount of the non-cash token bought or sold
    refPriceUsd?: number; // per-token trade price in USD at trade time
  }): Promise<Position> {
    const { walletAddress, tokenAddress, symbol, tradeSide, tokenAmount, refPriceUsd } = args;
    let pos = await this.getPosition(walletAddress, tokenAddress, symbol);
    if (!pos) {
      pos = { qty: 0, costUsd: 0, avgEntryUsd: 0, realizedPnlUsd: 0, updatedAt: Math.floor(Date.now() / 1000) };
    }

    const now = Math.floor(Date.now() / 1000);
    const price = typeof refPriceUsd === "number" && isFinite(refPriceUsd) ? refPriceUsd : undefined;

    if (tradeSide === "BUY") {
      // Increase position; estimate cost using ref price if available
      const addQty = tokenAmount;
      const addCost = price ? addQty * price : 0;
      pos.qty += addQty;
      pos.costUsd += addCost;
      pos.avgEntryUsd = pos.qty > 0 && pos.costUsd > 0 ? pos.costUsd / pos.qty : pos.avgEntryUsd;
      pos.updatedAt = now;
    } else if (tradeSide === "SELL") {
      const sellQty = tokenAmount;
      const proceeds = price ? sellQty * price : 0;
      const costPortion = Math.min(sellQty, pos.qty) * (pos.avgEntryUsd || 0);
      pos.qty = Math.max(0, pos.qty - sellQty);
      // Reduce cost by the proportional amount of quantity removed
      pos.costUsd = Math.max(0, pos.costUsd - costPortion);
      pos.avgEntryUsd = pos.qty > 0 && pos.costUsd > 0 ? pos.costUsd / pos.qty : 0;
      if (price) pos.realizedPnlUsd += proceeds - costPortion;
      pos.updatedAt = now;
    } else {
      // SWAP: ambiguous; skip position updates to avoid incorrect accounting
      pos.updatedAt = now;
    }

    await this.savePosition(walletAddress, tokenAddress, pos, symbol);
    return pos;
  }

  computeSnapshot(pos: Position | undefined, holdingQty: number, currentPriceUsd?: number): PnlSnapshot {
    const snapshot: PnlSnapshot = { holdingQty };
    if (!pos) {
      if (currentPriceUsd) snapshot.holdingValueUsd = holdingQty * currentPriceUsd;
      return snapshot;
    }

    if (currentPriceUsd) {
      snapshot.holdingValueUsd = holdingQty * currentPriceUsd;
      const avg = pos.avgEntryUsd || 0;
      snapshot.avgEntryUsd = avg || undefined;
      if (avg > 0) {
        const diff = currentPriceUsd - avg;
        snapshot.unrealizedPnlUsd = holdingQty * diff;
        snapshot.unrealizedPnlPct = (diff / avg) * 100;
      }
    }
    snapshot.realizedPnlUsd = pos.realizedPnlUsd;
    return snapshot;
  }
}
