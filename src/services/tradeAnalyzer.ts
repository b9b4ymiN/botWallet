import { MessageAccountKeys, PublicKey } from "@solana/web3.js";
import { TokenService } from "./TokenService";
import { TokenInfo } from "../utils/discord";

export interface TradeAnalysisResult {
  tokenIn: TokenInfo | undefined;
  tokenOut: TokenInfo | undefined;
  qtyIn: number;
  qtyOut: number;
}

export async function analyzeTrade(
  meta: any,
  walletAddress: string,
  accountKeys: MessageAccountKeys,
  tokenService: TokenService
): Promise<TradeAnalysisResult> {
  const { preTokenBalances, postTokenBalances, preBalances, postBalances } = meta;
  let tokenIn: TokenInfo | undefined;
  let tokenOut: TokenInfo | undefined;
  let qtyIn = 0;
  let qtyOut = 0;

  // SOL delta for the owner index
  const walletIndex = accountKeys
    .keySegments()
    .flat()
    .findIndex((key: PublicKey) => key.toString() === walletAddress);

  let solChange = 0;
  if (walletIndex !== -1) {
    const preSolBalance = preBalances[walletIndex] || 0;
    const postSolBalance = postBalances[walletIndex] || 0;
    solChange = (postSolBalance - preSolBalance) / 1e9; // lamports -> SOL
  }

  // SPL token delta aggregation
  if (preTokenBalances && postTokenBalances) {
    const balanceChanges = new Map<string, { pre: number; post: number }>();

    preTokenBalances
      .filter((b: any) => b.owner === walletAddress)
      .forEach((b: any) => {
        balanceChanges.set(b.mint, {
          pre: b.uiTokenAmount?.uiAmount || 0,
          post: 0,
        });
      });

    postTokenBalances
      .filter((b: any) => b.owner === walletAddress)
      .forEach((b: any) => {
        const existing = balanceChanges.get(b.mint) || { pre: 0, post: 0 };
        balanceChanges.set(b.mint, {
          ...existing,
          post: b.uiTokenAmount?.uiAmount || 0,
        });
      });

    let topIn: { mint: string; delta: number } | undefined;
    let topOut: { mint: string; delta: number } | undefined;
    for (const [mint, { pre, post }] of balanceChanges.entries()) {
      const delta = (post || 0) - (pre || 0);
      if (delta > 0) {
        if (!topIn || delta > topIn.delta) topIn = { mint, delta };
      } else if (delta < 0) {
        const abs = -delta;
        if (!topOut || abs > topOut.delta) topOut = { mint, delta: abs };
      }
    }

    if (topIn) {
      tokenIn = await tokenService.getTokenInfo(topIn.mint);
      qtyIn = topIn.delta;
    }
    if (topOut) {
      tokenOut = await tokenService.getTokenInfo(topOut.mint);
      qtyOut = topOut.delta;
    }
  }

  // Fill missing side with SOL delta if applicable
  if (!tokenIn && solChange > 0) {
    tokenIn = { symbol: "SOL", address: "Solana" };
    qtyIn = solChange;
  }
  if (!tokenOut && solChange < 0) {
    tokenOut = { symbol: "SOL", address: "Solana" };
    qtyOut = -solChange;
  }

  return { tokenIn, tokenOut, qtyIn, qtyOut };
}

export function determineMode(
  tokenIn?: TokenInfo,
  tokenOut?: TokenInfo
): "BUY" | "SELL" | "SWAP" {
  const stablecoins = ["USDC", "USDT"];
  const isCash = (s?: string) => !!s && (s === "SOL" || stablecoins.includes(s));
  if (!tokenIn || !tokenOut) return "SWAP";
  if (isCash(tokenOut.symbol) && !isCash(tokenIn.symbol)) return "BUY";
  if (isCash(tokenIn.symbol) && !isCash(tokenOut.symbol)) return "SELL";
  return "SWAP";
}

