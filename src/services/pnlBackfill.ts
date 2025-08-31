import { Connection, PublicKey } from "@solana/web3.js";
import * as dotenv from "dotenv";
import logger from "../utils/logger";
import { TokenService } from "./TokenService";
import { PortfolioService } from "./portfolio";
import { analyzeTrade, determineMode } from "./tradeAnalyzer";
import { PriceService } from "./priceService";

dotenv.config();

export class PnlBackfillService {
  private connection: Connection;
  private tokenService: TokenService;
  private portfolio: PortfolioService;
  private priceService: PriceService;
  private throttleMs: number;
  private batchSize: number;

  constructor() {
    const rpcUrl = process.env.HELIUS_RPC_URL;
    if (!rpcUrl) throw new Error("HELIUS_RPC_URL not set");
    this.connection = new Connection(rpcUrl);
    this.tokenService = new TokenService(this.connection);
    this.portfolio = new PortfolioService(this.connection);
    this.priceService = new PriceService();
    this.throttleMs = Number(process.env.RPC_THROTTLE_MS || 300);
    this.batchSize = Math.max(
      5,
      Math.min(25, Number(process.env.RPC_BATCH_SIZE || 15))
    );
  }

  private async sleep(ms: number) {
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  }

  private async withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
    const maxRetries = 5;
    let attempt = 0;
    let delay = 500; // ms
    // Simple exponential backoff with jitter
    while (true) {
      try {
        return await fn();
      } catch (e: any) {
        const msg = String(e?.message || e);
        const isRateLimited = /429|Too Many Requests/i.test(msg);
        const isTransient =
          isRateLimited ||
          /timeout|ETIMEDOUT|ECONNRESET|ENETUNREACH|fetch failed/i.test(msg);
        if (attempt >= maxRetries || !isTransient) {
          throw e;
        }
        const jitter = Math.floor(Math.random() * 200);
        await this.sleep(delay + jitter);
        delay = Math.min(5000, Math.floor(delay * 1.8));
        attempt++;
        logger.warn(
          `Retrying ${label} (attempt ${attempt}/${maxRetries}) due to: ${msg}`
        );
      }
    }
  }

  // Compute delta for a specific mint for the given wallet using meta pre/post balances
  private static mintDeltaFromMeta(
    meta: any,
    walletAddress: string,
    mintStr: string
  ): number {
    const preList: any[] = Array.isArray(meta?.preTokenBalances)
      ? meta.preTokenBalances
      : [];
    const postList: any[] = Array.isArray(meta?.postTokenBalances)
      ? meta.postTokenBalances
      : [];

    const sum = (list: any[]) =>
      list
        .filter((b) => b?.owner === walletAddress && b?.mint === mintStr)
        .reduce((acc, b) => acc + Number(b?.uiTokenAmount?.uiAmount || 0), 0);

    const pre = sum(preList);
    const post = sum(postList);
    return (post || 0) - (pre || 0);
  }

  // Reconstruct PnL for a specific wallet + token mint by scanning token account history
  public async reconstructForToken(
    walletAddress: string,
    tokenMint: string,
    opts?: { maxTx?: number }
  ): Promise<void> {
    const maxTx = opts?.maxTx ?? 10; // cap to avoid huge scans
    const owner = new PublicKey(walletAddress);
    const mint = new PublicKey(tokenMint);

    // 1) Find token accounts from wallet+mint
    const accounts = await this.withRetry(
      () => this.connection.getParsedTokenAccountsByOwner(owner, { mint }),
      "getParsedTokenAccountsByOwner"
    );
    const tokenAccounts = accounts.value.map((v) => v.pubkey);
    if (tokenAccounts.length === 0) {
      logger.warn("No token accounts found for wallet/mint", {
        walletAddress,
        tokenMint,
      });
      return;
    }

    // 2) Collect transactions (signatures) from all token accounts
    const sigMap = new Map<string, number | undefined>(); // signature -> blockTime
    for (const ta of tokenAccounts) {
      const sigs = await this.withRetry(
        () =>
          this.connection.getSignaturesForAddress(ta, {
            limit: Math.min(maxTx, 1000),
          }),
        "getSignaturesForAddress"
      );
      for (const s of sigs) {
        if (!sigMap.has(s.signature))
          sigMap.set(s.signature, s.blockTime ?? undefined);
        if (sigMap.size >= maxTx) break;
      }
      if (sigMap.size >= maxTx) break;
      await this.sleep(this.throttleMs);
    }

    const signatures = Array.from(sigMap.entries())
      .map(([sig, bt]) => ({ sig, bt: bt ?? 0 }))
      .sort((a, b) => a.bt - b.bt) // oldest first
      .map((x) => x.sig);

    if (signatures.length === 0) {
      logger.info("No transactions found for token accounts");
      return;
    }

    const STABLES = new Set(["USDC", "USDT"]);
    const isStable = (s?: string) => !!s && STABLES.has(s);
    const isSOL = (s?: string) => s === "SOL";

    // 3) Compute PnL from token-account transactions using getTransaction (singular)
    for (const sig of signatures) {
      const tx = await this.withRetry(
        () =>
          this.connection.getTransaction(sig, {
            maxSupportedTransactionVersion: 0,
            commitment: "confirmed",
          }),
        "getTransaction"
      );
      if (!tx || tx.meta?.err) {
        await this.sleep(this.throttleMs);
        continue;
      }
      const message = tx.transaction.message;
      const accountKeys = message.getAccountKeys({
        accountKeysFromLookups: tx.meta?.loadedAddresses,
      });
      try {
        // Ensure this tx actually changes the target mint balance for this wallet
        const mintDelta = PnlBackfillService.mintDeltaFromMeta(
          tx.meta,
          walletAddress,
          tokenMint
        );
        if (!mintDelta) {
          await this.sleep(this.throttleMs);
          continue; // skip unrelated txs
        }

        // Use general analyzer to identify cash leg for pricing
        const { tokenIn, tokenOut, qtyIn, qtyOut } = await analyzeTrade(
          tx.meta,
          walletAddress,
          accountKeys,
          this.tokenService
        );
        const modeByDelta: "BUY" | "SELL" = mintDelta > 0 ? "BUY" : "SELL";

        // Estimate unit USD price from cash leg (stable or SOL)
        let tradePriceUsd: number | undefined = undefined;
        if (modeByDelta === "BUY") {
          if (isStable(tokenOut?.symbol)) {
            if (qtyIn > 0) tradePriceUsd = (qtyOut || 0) / qtyIn; // spent stable / received target
          } else if (isSOL(tokenOut?.symbol)) {
            const solUsd = await this.priceService.getSolUsd();
            if (solUsd && qtyIn > 0)
              tradePriceUsd = ((qtyOut || 0) * solUsd) / qtyIn; // spent SOL -> USD
          }
        } else if (modeByDelta === "SELL") {
          if (isStable(tokenIn?.symbol)) {
            if (qtyOut > 0) tradePriceUsd = (qtyIn || 0) / qtyOut; // received stable / sold target qty
          } else if (isSOL(tokenIn?.symbol)) {
            const solUsd = await this.priceService.getSolUsd();
            if (solUsd && qtyOut > 0)
              tradePriceUsd = ((qtyIn || 0) * solUsd) / qtyOut; // received SOL -> USD
          }
        }

        // Token amount is absolute delta from this tx for the target mint
        const tokenAmount = Math.abs(mintDelta);

        if (modeByDelta === "BUY" || modeByDelta === "SELL") {
          await this.portfolio.updateWithTrade({
            walletAddress,
            tokenAddress: tokenMint,
            symbol:
              tokenIn?.address === tokenMint ? tokenIn?.symbol : tokenOut?.symbol,
            tradeSide: modeByDelta,
            tokenAmount,
            refPriceUsd: tradePriceUsd,
          });
        }
      } catch (e) {
        // continue with next signature
      }
      await this.sleep(this.throttleMs);
    }

    logger.info("PnL reconstruction completed", {
      walletAddress,
      tokenMint,
      processed: signatures.length,
    });
  }

  // Step 1 only: fetch token accounts for wallet+mint (for rate-limit testing)
  public async listTokenAccounts(
    walletAddress: string,
    tokenMint: string
  ): Promise<string[]> {
    const owner = new PublicKey(walletAddress);
    const mint = new PublicKey(tokenMint);
    const accounts = await this.withRetry(
      () => this.connection.getParsedTokenAccountsByOwner(owner, { mint }),
      "getParsedTokenAccountsByOwner"
    );
    return accounts.value.map((v) => v.pubkey.toBase58());
  }

  // Fetch up to `perAccount` recent parsed transactions for each token account derived from wallet+mint
  public async fetchRecentTransactionsForTokenAccounts(
    walletAddress: string,
    tokenMint: string,
    perAccount: number = 10
  ): Promise<null | []> {
    const accounts = await this.listTokenAccounts(walletAddress, tokenMint);
    if (accounts.length === 0) return [];
    console.log(accounts);
    const sigInfos = await this.connection.getSignaturesForAddress(
      new PublicKey(accounts[0]),
      {
        limit: perAccount,
      }
    );

    const signatures = sigInfos.map((s) => s.signature);
    if (signatures.length === 0) return [];
    console.log(signatures.slice(0, 1));

    const parsed = await this.connection.getTransaction(signatures[0], {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });

    console.log(parsed);

    const STABLES = new Set(["USDC", "USDT"]);
    const isStable = (s?: string) => !!s && STABLES.has(s);
    const isSOL = (s?: string) => s === "SOL";

    return null;
  }
}
