import { CoinGeckoClient } from "coingecko-api-v3";
import logger from "../utils/logger";

export class PriceService {
  private cg: CoinGeckoClient;
  private cache: Map<string, { value: number; ts: number }> = new Map();
  private ttlMs: number;

  constructor() {
    this.cg = new CoinGeckoClient({ timeout: 10000, autoRetry: true });
    const ttlSec = Number(process.env.WTRACK_PRICE_CACHE_SECONDS || 30);
    this.ttlMs = Math.max(5, ttlSec) * 1000;
  }

  private getCache(key: string): number | undefined {
    const e = this.cache.get(key);
    if (!e) return undefined;
    if (Date.now() - e.ts < this.ttlMs) return e.value;
    this.cache.delete(key);
    return undefined;
  }

  private setCache(key: string, value: number) {
    this.cache.set(key, { value, ts: Date.now() });
  }

  async getSolUsd(): Promise<number | undefined> {
    const cached = this.getCache("SOL_USD");
    if (cached !== undefined) return cached;
    try {
      const res = await this.cg.simplePrice({ ids: "solana", vs_currencies: "usd" });
      const val = (res as any)?.solana?.usd;
      if (typeof val === "number" && isFinite(val)) {
        this.setCache("SOL_USD", val);
        return val;
      }
    } catch (e) {
      logger.warn("Failed to fetch SOL price from CoinGecko", e);
    }
    return undefined;
  }
}

