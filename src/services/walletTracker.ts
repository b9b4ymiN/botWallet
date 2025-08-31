import { Connection, MessageAccountKeys, PublicKey } from "@solana/web3.js";
import { PROGRAM_ACCOUNTS_DEX } from "../constants";
import logger from "../utils/logger";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import {
  WalletConfig,
  DiscordNotifier,
  DefiActivity,
  TokenInfo,
} from "../utils/discord";
import { TokenService } from "./TokenService";
import { getAllDexProgramsSet, getDexName } from "./dexRegistry";
import { analyzeTrade, determineMode } from "./tradeAnalyzer";
import { getDexScreener } from "./dexscreener";
import { PortfolioService } from "./portfolio";
import { PriceService } from "./priceService";

dotenv.config();

interface WalletData {
  wallets: WalletConfig[];
}

export class WalletTracker {
  private connection: Connection;
  private dexPrograms: Set<string>;
  private wallets: Map<string, WalletConfig>;
  private knownSignatures: Set<string>;
  private tokenService: TokenService;
  private portfolio: PortfolioService;
  private priceService: PriceService;

  constructor() {
    try {
      const rpcUrl = process.env.HELIUS_RPC_URL;
      if (!rpcUrl) {
        throw new Error("HELIUS_RPC_URL environment variable is not set");
      }

      this.connection = new Connection(rpcUrl);
      this.dexPrograms = getAllDexProgramsSet();
      this.wallets = new Map();
      this.knownSignatures = new Set();

      this.tokenService = new TokenService(this.connection);
      this.portfolio = new PortfolioService(this.connection);
      this.priceService = new PriceService();

      // Load wallet configurations
      this.loadWalletConfigs();

      logger.info("WalletTracker initialized successfully");
    } catch (error) {
      logger.error("Error initializing WalletTracker:", error);
      throw error;
    }
  }

  private loadWalletConfigs(): void {
    try {
      const walletPath = path.join(process.cwd(), "wallet.json");
      const walletData: WalletData = JSON.parse(
        fs.readFileSync(walletPath, "utf-8")
      );
      logger.info("Loaded wallet configurations from wallet.json");
      //logger.info(walletData.wallets);

      walletData.wallets.forEach((wallet) => {
        this.wallets.set(wallet.address, wallet);
      });

      logger.info(`Loaded ${this.wallets.size} wallet configurations`);
    } catch (error) {
      logger.error("Error loading wallet configurations:", error);
      throw error;
    }
  }

  // getDexName moved to dexRegistry.ts

  // trade analysis moved to tradeAnalyzer.ts

  async processTransaction(
    signature: string,
    wallet: WalletConfig
  ): Promise<void> {
    try {
      if (this.knownSignatures.has(signature)) {
        return;
      }
      this.knownSignatures.add(signature);

      const tx = await this.connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      if (!tx || tx.meta?.err) {
        return;
      }

      // Use getAccountKeys() instead of accessing accountKeys directly
      const message = tx.transaction.message;
      const accountKeys = message.getAccountKeys({
        accountKeysFromLookups: tx.meta?.loadedAddresses,
      });
      const programIds = accountKeys
        .keySegments()
        .flat()
        .map((key) => key.toString());

      const error = tx.meta?.err;
      if (error) {
        return;
      }

      if (programIds.length === 0) {
        logger.info(`No program IDs found in transaction ${signature}`);
        return;
      }

      const involvedDexPrograms = programIds.filter((id) =>
        this.dexPrograms.has(id)
      );

      if (involvedDexPrograms.length > 0) {
        const firstProgram = involvedDexPrograms[0];
        const dexName = getDexName(firstProgram);
        if (dexName === "Unknown DEX") {
          logger.warn(`Unknown DEX program detected`, {
            programId: firstProgram,
          });
        }

        const meta = tx.meta;
        if (!meta) {
          return;
        }

        const { tokenIn, tokenOut, qtyIn, qtyOut } = await analyzeTrade(
          meta,
          wallet.address,
          accountKeys,
          this.tokenService
        );

        if (!tokenIn || !tokenOut || qtyIn === 0 || qtyOut === 0) {
          logger.info(
            `Insufficient trade information in transaction ${signature}`
          );
          return;
        }

        const mode = determineMode(tokenIn, tokenOut);

        // Identify tokens that changed for the wallet
        // This is a simplified example - in a real application, you'd need to decode
        // the transaction data to get actual token information
        const activity: DefiActivity = {
          txID: signature,
          exchangeName: dexName,
          tokenIn,
          tokenOut,
          qtyIn,
          qtyOut,
          timestamp: tx.blockTime || Math.floor(Date.now() / 1000),
          mode, // Would need transaction parsing to determine if buy or sell
          wallet_address: wallet.address,
        };

        // Optionally enrich with holdings and PnL before notifying
        try {
          const ENABLE_HOLDINGS = String(process.env.WTRACK_ENRICH_HOLDINGS || "true").toLowerCase() === "true";
          const ENABLE_PNL = String(process.env.WTRACK_ENRICH_PNL || "true").toLowerCase() === "true";

          if (!ENABLE_HOLDINGS && !ENABLE_PNL) {
            // Skip enrichment entirely
            await DiscordNotifier.sendNotification(wallet, activity);
            return;
          }

          const STABLES = new Set(["USDC", "USDT"]);
          const tradedToken =
            activity.tokenIn.symbol === "SOL" || STABLES.has(activity.tokenIn.symbol)
              ? activity.tokenOut
              : activity.tokenIn;

          if (tradedToken && tradedToken.address) {
            const pair = await getDexScreener(tradedToken.address);
            const priceUsd = pair?.priceUsd ? Number(pair.priceUsd) : undefined;

            // Compute per-trade entry/exit price in USD using cash legs when available
            let tradePriceUsd: number | undefined = undefined;
            const stable = (s?: string) => !!s && STABLES.has(s);
            const isSOL = (s?: string) => s === "SOL";
            const needSolPrice = async (): Promise<number | undefined> => {
              return await this.priceService.getSolUsd();
            };

            if (mode === "BUY") {
              // Spent cash (tokenOut) to acquire traded token (tokenIn)
              if (stable(activity.tokenOut.symbol)) {
                if (activity.qtyIn > 0) tradePriceUsd = activity.qtyOut / activity.qtyIn;
              } else if (isSOL(activity.tokenOut.symbol)) {
                const solUsd = await needSolPrice();
                if (solUsd && activity.qtyIn > 0)
                  tradePriceUsd = (activity.qtyOut * solUsd) / activity.qtyIn;
              }
            } else if (mode === "SELL") {
              // Received cash (tokenIn) by selling traded token (tokenOut)
              if (stable(activity.tokenIn.symbol)) {
                if (activity.qtyOut > 0) tradePriceUsd = activity.qtyIn / activity.qtyOut;
              } else if (isSOL(activity.tokenIn.symbol)) {
                const solUsd = await needSolPrice();
                if (solUsd && activity.qtyOut > 0)
                  tradePriceUsd = (activity.qtyIn * solUsd) / activity.qtyOut;
              }
            }

            // Determine token amount for portfolio update based on trade side
            const side = mode;
            let tokenAmount = 0;
            if (tradedToken.address === activity.tokenIn.address) tokenAmount = activity.qtyIn;
            if (tradedToken.address === activity.tokenOut.address) tokenAmount = activity.qtyOut;

            // Current holdings on-chain
            const holdingQty = ENABLE_HOLDINGS
              ? await this.portfolio.getHoldingQty(
                  wallet.address,
                  tradedToken.address,
                  tradedToken.symbol
                )
              : 0;

            // Update local position estimates for BUY/SELL (skip SWAP to avoid ambiguity)
            if (ENABLE_PNL && (side === "BUY" || side === "SELL")) {
              await this.portfolio.updateWithTrade({
                walletAddress: wallet.address,
                tokenAddress: tradedToken.address,
                symbol: tradedToken.symbol,
                tradeSide: side,
                tokenAmount,
                refPriceUsd: tradePriceUsd ?? priceUsd,
              });
            }

            const pos = ENABLE_PNL
              ? await this.portfolio.getPosition(
                  wallet.address,
                  tradedToken.address,
                  tradedToken.symbol
                )
              : undefined;
            const snapshot = this.portfolio.computeSnapshot(pos, holdingQty, priceUsd);

            // Attach to activity (optional fields supported by notifier)
            if (ENABLE_HOLDINGS) (activity as any).holdingQty = snapshot.holdingQty;
            if (ENABLE_HOLDINGS) (activity as any).holdingValueUsd = snapshot.holdingValueUsd;
            if (ENABLE_PNL) (activity as any).avgEntryUsd = snapshot.avgEntryUsd;
            if (ENABLE_PNL) (activity as any).unrealizedPnlUsd = snapshot.unrealizedPnlUsd;
            if (ENABLE_PNL) (activity as any).unrealizedPnlPct = snapshot.unrealizedPnlPct;
            if (ENABLE_PNL) (activity as any).realizedPnlUsd = snapshot.realizedPnlUsd;
            if (ENABLE_PNL || ENABLE_HOLDINGS) (activity as any).currentPriceUsd = priceUsd;
          }
        } catch (e) {
          logger.warn("Failed to enrich activity with holdings/PNL", e);
        }

        // Send Discord notification
        await DiscordNotifier.sendNotification(wallet, activity);
      }
    } catch (error) {
      logger.error("Error processing transaction:", error);
    }
  }

  public async startTracking(): Promise<void> {
    try {
      const walletAddresses = Array.from(this.wallets.keys());

      if (walletAddresses.length === 0) {
        throw new Error("No wallets configured for tracking");
      }

      logger.info(`Starting to track ${walletAddresses.length} wallets`);

      // Subscribe to logs for each wallet individually
      for (const address of walletAddresses) {
        const pubKey = new PublicKey(address);

        this.connection.onLogs(
          pubKey,
          async (logs) => {
            try {
              const wallet = this.wallets.get(address);

              if (wallet && !this.knownSignatures.has(logs.signature)) {
                logger.info(
                  `New activity detected for wallet: ${wallet.name} , signature: ${logs.signature}`
                );
                await this.processTransaction(logs.signature, wallet);
              }
            } catch (error) {
              logger.error(
                `Error processing logs for wallet ${address}:`,
                error
              );
            }
          },
          "confirmed"
        );
      }

      logger.info("Successfully set up log tracking for specified wallets");
    } catch (error) {
      logger.error("Error starting wallet tracking:", error);
      throw error;
    }
  }
}

export async function processTransaction(
  signature: string,
  wallet: WalletConfig
): Promise<void> {
  const tracker = new WalletTracker();
  await tracker.processTransaction(signature, wallet);
}
