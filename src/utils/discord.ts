import { WebhookClient, EmbedBuilder, APIMessage } from "discord.js";
import logger from "./logger";

export interface WalletConfig {
  name: string;
  address: string;
  x: string;
  twProfile_img: string;
  discord_ch: string;
}

export interface TokenInfo {
  symbol: string;
  address: string;
  name?: string;
}

export interface DefiActivity {
  txID: string;
  exchangeName: string;
  tokenIn: TokenInfo;
  tokenOut: TokenInfo;
  qtyIn: number;
  qtyOut: number;
  timestamp: number;
  mode: "BUY" | "SELL" | "SWAP";
  wallet_address: string;
}

export class DiscordNotifier {
  private static formatNumber(num: number): string {
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    }).format(num);
  }

  public static async sendNotification(
    wallet: WalletConfig,
    activity: DefiActivity
  ): Promise<void> {
    try {
      const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
      if (!webhookUrl) {
        throw new Error("Discord webhook URL not configured");
      }

      const webhookClient = new WebhookClient({ url: webhookUrl });

      const strAddress = wallet.address.substr(0, 5);

      const inStr =
        activity.tokenIn.symbol != "SOL"
          ? `${this.formatNumber(activity.qtyIn)}[${
              activity.tokenIn.symbol
            }](https://dexscreener.com/solana/${activity.tokenIn.address})`
          : `${this.formatNumber(activity.qtyIn)} ${activity.tokenIn.symbol}`;

      const outStr =
        activity.tokenOut.symbol != "SOL"
          ? `${this.formatNumber(activity.qtyOut)}[${
              activity.tokenOut.symbol
            }](https://dexscreener.com/solana/${activity.tokenOut.address})`
          : `${this.formatNumber(activity.qtyOut)} ${activity.tokenOut.symbol}`;

      const dexLink = `https://solscan.io/tx/${activity.txID}`;

      const message = `
🏛️ Exchange: ${activity.exchangeName}
💱 Transaction: [View on Solscan](${dexLink})
👛 Wallet: [${strAddress}](https://solscan.io/account/${wallet.address})
      `;

      const embedMessage = new EmbedBuilder()
        .setTitle(activity.mode)
        .setDescription(message)
        .setURL(dexLink)
        .setColor(activity.mode === "BUY" ? 0x7eba3c : 0xd01f3c)
        .setTimestamp()
        .setFooter({ text: "Solana DeFi Activity" })
        .setAuthor({
          name: wallet.name,
          url: `https://x.com/${wallet.x}`,
          iconURL: wallet.twProfile_img,
        })
        .setFields([
          {
            name: "Input",
            value: inStr,
            inline: true,
          },
          {
            name: "Output",
            value: outStr,
            inline: true,
          },
        ]);

      await webhookClient.send({
        username: wallet.name,
        avatarURL: wallet.twProfile_img,
        embeds: [embedMessage],
      });

      logger.info("Discord notification sent successfully", {
        wallet: wallet.address,
        txId: activity.txID,
      });
    } catch (error) {
      logger.error("Error sending Discord notification:", error);
    }
  }
}
