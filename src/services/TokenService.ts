import { Connection, PublicKey } from "@solana/web3.js";
import { Metadata } from "@metaplex-foundation/mpl-token-metadata";
import logger from "../utils/logger";

export interface TokenInfo {
  symbol: string;
  address: string;
  name?: string; // เผื่อเก็บชื่อเต็ม
}

export class TokenService {
  private readonly knownTokens = new Map<
    string,
    { symbol: string; name?: string }
  >([
    [
      "So11111111111111111111111111111111111111112",
      { symbol: "SOL", name: "Solana" },
    ],
    [
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      { symbol: "USDC", name: "USD Coin" },
    ],
    [
      "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
      { symbol: "USDT", name: "Tether" },
    ],
    [
      "JUPyiwrYFCKSxgErm6QdRTxgj4BA6uEjVrDPctE9D2Ad",
      { symbol: "JUP", name: "Jupiter" },
    ],
  ]);

  constructor(private readonly connection: Connection) {}

  public async getTokenInfo(mintAddress: string): Promise<TokenInfo> {
    // 1. เช็คใน knownTokens ก่อน
    if (this.knownTokens.has(mintAddress)) {
      const { symbol, name } = this.knownTokens.get(mintAddress)!;
      return { symbol, name, address: mintAddress };
    }

    try {
      // 2. ดึง metadata จาก on-chain
      const mint = new PublicKey(mintAddress);
      const [metadataPDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata"),
          new PublicKey(
            "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
          ).toBuffer(), // MPL_TOKEN_METADATA_PROGRAM_ID
          mint.toBuffer(),
        ],
        new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s")
      );

      const metadataAccount = await this.connection.getAccountInfo(metadataPDA);
      if (metadataAccount) {
        const metadata = Metadata.fromAccountInfo(metadataAccount)[0];

        const symbol = metadata.data.symbol.replace(/\0/g, "").trim();
        const name = metadata.data.name.replace(/\0/g, "").trim();

        if (symbol) {
          return { symbol, name, address: mintAddress };
        }
      }
    } catch (error) {
      logger.error(
        `❌ Failed to fetch metadata for mint ${mintAddress}:`,
        error
      );
    }

    // 3. fallback (กรณีไม่เจอ symbol)
    return {
      symbol: mintAddress.substring(0, 4) + "...",
      address: mintAddress,
    };
  }
}
