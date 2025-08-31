import { WebhookClient, EmbedBuilder, APIMessage } from "discord.js";
import logger from "./logger";
import { getDexScreener } from "../services/dexscreener";

export interface WalletConfig {
  name: string;
  address: string;
  x: string;
  twProfile_img: string;
}

export interface TokenInfo {
  symbol: string;
  address: string;
  name?: string;
}

export interface DefiActivity {
  txID: string;
  exchangeName: string;
  tokenIn: TokenInfo; // received by wallet
  tokenOut: TokenInfo; // spent by wallet
  qtyIn: number;
  qtyOut: number;
  timestamp: number;
  mode: "BUY" | "SELL" | "SWAP";
  wallet_address: string;
  // Optional enrichments
  holdingQty?: number;
  holdingValueUsd?: number;
  avgEntryUsd?: number;
  unrealizedPnlUsd?: number;
  unrealizedPnlPct?: number;
  realizedPnlUsd?: number;
  currentPriceUsd?: number;
}

export class DiscordNotifier {
  private static signEmoji(n?: number): string {
    if (n === undefined || !isFinite(n)) return "";
    if (n > 0) return "📈";
    if (n < 0) return "📉";
    return "➖";
  }
  private static formatNumber(num: number): string {
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    }).format(num);
  }

  private static formatUsd(num?: number | string | null): string {
    if (num === undefined || num === null || num === "") return "N/A";
    const n = typeof num === "string" ? Number(num) : num;
    if (!isFinite(n)) return "N/A";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 6,
    }).format(n);
  }

  private static formatUsdCompact(num?: number | string | null): string {
    if (num === undefined || num === null || num === "") return "N/A";
    const n = typeof num === "string" ? Number(num) : num;
    if (!isFinite(n)) return "N/A";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 2,
    }).format(n);
  }

  private static formatPct(num?: number | null): string {
    if (num === undefined || num === null || !isFinite(num)) return "N/A";
    return `${num.toFixed(2)}%`;
  }

  private static diffSince(ts?: number): string {
    if (!ts) return "N/A";
    const ms = ts > 1e12 ? ts : ts * 1000; // sec to ms if needed
    const secs = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ago`;
    if (h > 0) return `${h}h ${m}m ago`;
    return `${m}m ago`;
  }

  public static async sendNotification(
    wallet: WalletConfig,
    activity: DefiActivity
  ): Promise<void> {
    try {
      const primaryWebhook = process.env.DISCORD_WEBHOOK_URL;
      const fallbackWebhook = (process.env.DISCORD_WEBHOOK_URL || "").trim();
      const webhookUrl = primaryWebhook || fallbackWebhook;
      if (!webhookUrl) {
        throw new Error("Discord webhook URL not configured");
      }

      const webhookClient = new WebhookClient({ url: webhookUrl });

      const strAddress = wallet.address.substring(0, 5);

      const inStr = `${this.formatNumber(activity.qtyIn)} ${
        activity.tokenIn.symbol
      }`;
      const outStr = `${this.formatNumber(activity.qtyOut)} ${
        activity.tokenOut.symbol
      }`;

      const dexLink = `https://solscan.io/tx/${activity.txID}`;

      // Determine traded token (prefer non-SOL/non-stablecoin)
      const STABLES = new Set(["USDC", "USDT"]);
      const tradedToken =
        activity.tokenIn.symbol === "SOL" ||
        STABLES.has(activity.tokenIn.symbol)
          ? activity.tokenOut
          : activity.tokenIn;

      // Fetch DexScreener data for traded token
      const pair =
        tradedToken && tradedToken.address
          ? await getDexScreener(tradedToken.address)
          : null;

      // Build message like the requested format
      const addressCheck = tradedToken?.address ?? "";
      const dexPairUrl =
        pair?.url ||
        (addressCheck ? `https://dexscreener.com/solana/${addressCheck}` : "");
      const icon_token = addressCheck
        ? `https://dd.dexscreener.com/ds-data/tokens/solana/${addressCheck}.png?size=lg&key=a192eb`
        : wallet.twProfile_img;

      // Pretty header lines with emojis (used instead of legacy spMessage in final output)
      const infoHeader = pair
        ? [
            `🪙 Token: ${pair.baseToken?.symbol ?? tradedToken?.symbol ?? "N/A"}`,
            `💰 Mkt Cap: ${DiscordNotifier.formatUsdCompact(pair.fdv)}`,
            `💵 Price: ${DiscordNotifier.formatUsd(pair.priceUsd)}`,
            `📈 24h: ${DiscordNotifier.formatPct(pair.priceChange?.h24)}`,
            `🏦 Exchange: ${activity.exchangeName}`,
            `🕒 Pair age: ${DiscordNotifier.diffSince(pair.pairCreatedAt)}`,
          ].join("\n")
        : "";

      let spMessage = "";
      if (pair) {
        spMessage =
          `🪙 Token :  ${
            pair.baseToken?.symbol ?? tradedToken?.symbol ?? "N/A"
          } \n` +
          `💎 Mkt.cap : ${DiscordNotifier.formatUsdCompact(pair.fdv)} \n` +
          `💰 Price ≈  ${DiscordNotifier.formatUsd(pair.priceUsd)} \n` +
          `📊 Price chg : ${DiscordNotifier.formatPct(
            pair.priceChange?.h24
          )} \n` +
          `🏛️ Exchange :  ${activity.exchangeName} \n` +
          `💦 Pair : ${DiscordNotifier.diffSince(pair.pairCreatedAt)} `;
      }

      const chartLine = dexPairUrl
        ? `🔗 Chart: [DexScreener](${dexPairUrl}) \n`
        : "";
      const pumpLine = addressCheck
        ? `🚀 Pump: [pump.fun](https://pump.fun/${addressCheck})`
        : "";
      const walletLine = `\n👛 Wallet: [${strAddress}](https://gmgn.ai/sol/address/${wallet.address})\n`;
      const txnLine = `🔎 Txn: [Solscan](https://solscan.io/tx/${activity.txID}) \n`;
      // Holdings and PnL lines (optional)
      const holdingsLine = (() => {
        if (typeof activity.holdingQty === "number") {
          const qtyStr = this.formatNumber(activity.holdingQty);
          const valStr =
            activity.holdingValueUsd !== undefined
              ? this.formatUsd(activity.holdingValueUsd)
              : "N/A";
          const sym = tradedToken?.symbol ?? "";
          return `📦 Holdings: ${qtyStr} ${sym} (${valStr})\n`;
        }
        return "";
      })();

      const pnlLines = (() => {
        const uUsd = activity.unrealizedPnlUsd;
        const uPct = activity.unrealizedPnlPct;
        const rUsd = activity.realizedPnlUsd;
        const lines: string[] = [];
        if (uUsd !== undefined) {
          const emo = this.signEmoji(uUsd);
          const uStr = `${this.formatUsd(uUsd)}${
            uPct !== undefined ? ` (${this.formatPct(uPct)})` : ""
          }`;
          lines.push(`📊 Unrealized PnL: ${emo} ${uStr}`);
        }
        if (rUsd !== undefined) {
          const emo = this.signEmoji(rUsd);
          const rStr = this.formatUsd(rUsd);
          lines.push(`✅ Realized PnL: ${emo} ${rStr}`);
        }
        return lines.length ? lines.join("\n") + "\n" : "";
      })();

      const avgLine = (() => {
        if (activity.avgEntryUsd !== undefined) {
          const pStr = this.formatUsd(activity.currentPriceUsd);
          const eStr = this.formatUsd(activity.avgEntryUsd);
          return `💹 Current Price: ${pStr} \n 🎯 Avg Entry: ${eStr}\n`;
        }
        return "";
      })();

      const message =
        `${infoHeader}\n\n${holdingsLine}${pnlLines}${avgLine}\n${chartLine}${pumpLine}${walletLine}${txnLine}`.trim();

      const handle = (wallet.x || "").replace(/^@/, "");
      const embedMessage = new EmbedBuilder()
        .setTitle(activity.mode)
        .setDescription(message)
        .setURL(dexPairUrl || dexLink)
        .setColor(activity.mode.includes("BUY") ? 8311585 : 13632027)
        .setTimestamp()
        .setFooter({ text: "Time" })
        .setThumbnail(icon_token)
        .setAuthor({
          name: wallet.name,
          url: `https://x.com/${handle}`,
          iconURL: wallet.twProfile_img,
        })
        .setFields([
          {
            name: "Input",
            value:
              activity.tokenOut.symbol === "SOL"
                ? outStr
                : `[${outStr}](https://dexscreener.com/solana/${activity.tokenOut.address}?maker=${wallet.address})`,
            inline: true,
          },
          {
            name: "Output",
            value:
              activity.tokenIn.symbol === "SOL"
                ? inStr
                : `[${inStr}](https://dexscreener.com/solana/${activity.tokenIn.address}?maker=${wallet.address})`,
            inline: true,
          },
        ]);

      const payload = {
        username: wallet.name,
        avatarURL: wallet.twProfile_img,
        embeds: [embedMessage],
      } as const;

      try {
        await webhookClient.send(payload);
      } catch (err: any) {
        const code = err?.code ?? err?.rawError?.code;
        const isUnknownWebhook = Number(code) === 10015;
        const canRetry =
          isUnknownWebhook &&
          primaryWebhook &&
          fallbackWebhook &&
          primaryWebhook !== fallbackWebhook;
        if (canRetry) {
          const retryClient = new WebhookClient({ url: fallbackWebhook });
          await retryClient.send(payload);
          logger.warn(
            "Primary webhook invalid (10015). Sent via fallback webhook."
          );
        } else {
          throw err;
        }
      }

      logger.info("Discord notification sent successfully");
    } catch (error) {
      logger.error("Error sending Discord notification:", error);
    }
  }
}
