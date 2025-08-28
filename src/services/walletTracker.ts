import { Connection, PublicKey } from "@solana/web3.js";
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

  constructor() {
    try {
      const rpcUrl = process.env.HELIUS_RPC_URL;
      if (!rpcUrl) {
        throw new Error("HELIUS_RPC_URL environment variable is not set");
      }

      this.connection = new Connection(rpcUrl);
      this.dexPrograms = new Set(Object.values(PROGRAM_ACCOUNTS_DEX).flat());
      this.wallets = new Map();
      this.knownSignatures = new Set();

      this.tokenService = new TokenService(this.connection);

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

  private async getDexName(programId: string): Promise<string> {
    for (const [dex, addresses] of Object.entries(PROGRAM_ACCOUNTS_DEX)) {
      if (addresses.includes(programId)) {
        return dex;
      }
    }
    return "Unknown DEX";
  }

  private async getTradeInformation(
    meta: any,
    walletAddress: string,
    accountKeys: any
  ): Promise<{
    tokenIn: TokenInfo | undefined;
    tokenOut: TokenInfo | undefined;
    qtyIn: number;
    qtyOut: number;
  }> {
    const { preTokenBalances, postTokenBalances, preBalances, postBalances } =
      meta;
    let tokenIn: TokenInfo | undefined;
    let tokenOut: TokenInfo | undefined;
    let qtyIn = 0;
    let qtyOut = 0;

    // SOL balance change
    const walletIndex = accountKeys
      .keySegments()
      .flat()
      .findIndex((key: any) => key.toString() === walletAddress);
    if (walletIndex !== -1) {
      const preSolBalance = preBalances[walletIndex] || 0;
      const postSolBalance = postBalances[walletIndex] || 0;
      const solChange = (postSolBalance - preSolBalance) / 1e9; // Lamports to SOL

      if (solChange > 0) {
        tokenIn = { symbol: "SOL", address: "Solana" };
        qtyIn = solChange;
      } else if (solChange < 0) {
        tokenOut = { symbol: "SOL", address: "Solana" };
        qtyOut = -solChange;
      }
    }

    // Token balance changes
    if (preTokenBalances && postTokenBalances) {
      const balanceChanges = new Map<string, { pre: number; post: number }>();

      preTokenBalances
        .filter((b: any) => b.owner === walletAddress)
        .forEach((b: any) => {
          balanceChanges.set(b.mint, {
            pre: b.uiTokenAmount.uiAmount || 0,
            post: 0,
          });
        });

      postTokenBalances
        .filter((b: any) => b.owner === walletAddress)
        .forEach((b: any) => {
          const existing = balanceChanges.get(b.mint) || { pre: 0, post: 0 };
          balanceChanges.set(b.mint, {
            ...existing,
            post: b.uiTokenAmount.uiAmount || 0,
          });
        });

      for (const [mint, { pre, post }] of balanceChanges.entries()) {
        if (post > pre) {
          if (!tokenIn) {
            tokenIn = await this.tokenService.getTokenInfo(mint);
            qtyIn = post - pre;
          }
        } else if (pre > post) {
          if (!tokenOut) {
            tokenOut = await this.tokenService.getTokenInfo(mint);
            qtyOut = pre - post;
          }
        }
      }
    }

    return { tokenIn, tokenOut, qtyIn, qtyOut };
  }

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

      logger.info(
        `Processing transaction ${signature} for wallet ${wallet.name}`
      );
      // Use getAccountKeys() instead of accessing accountKeys directly
      const message = tx.transaction.message;
      const programIds = message
        .getAccountKeys()
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
        const dexName = await this.getDexName(involvedDexPrograms[0]);

        const meta = tx.meta;
        if (!meta) {
          return;
        }

        const { tokenIn, tokenOut, qtyIn, qtyOut } =
          await this.getTradeInformation(
            meta,
            wallet.address,
            message.getAccountKeys()
          );

        if (!tokenIn || !tokenOut || qtyIn === 0 || qtyOut === 0) {
          logger.info(
            `Insufficient trade information in transaction ${signature}`
          );
          return;
        }

        const stablecoins = ["USDC", "USDT"];
        let mode: "BUY" | "SELL" | "SWAP" = "SWAP";
        if (tokenIn.symbol && stablecoins.includes(tokenIn.symbol)) {
          mode = "SELL";
        } else if (tokenOut.symbol === "SOL") {
          mode = "BUY";
        } else if (tokenIn.symbol === "SOL") {
          mode = "SELL";
        }

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
                console.log(logs);
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
