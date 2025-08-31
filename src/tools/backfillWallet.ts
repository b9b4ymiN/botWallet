import { Connection, PublicKey } from "@solana/web3.js";
import * as dotenv from "dotenv";
import logger from "../utils/logger";
import { PnlBackfillService } from "../services/pnlBackfill";

dotenv.config();

function parseArgs() {
  const args = process.argv.slice(2);
  const out: Record<string, string> = {};
  for (const a of args) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function main() {
  const { wallet, maxTx } = parseArgs();
  if (!wallet) {
    console.error("Usage: ts-node src/tools/backfillWallet.ts --wallet=<WALLET_ADDRESS> [--maxTx=200]");
    process.exit(1);
  }

  const rpcUrl = process.env.HELIUS_RPC_URL;
  if (!rpcUrl) throw new Error("HELIUS_RPC_URL is not set in .env");

  const connection = new Connection(rpcUrl);
  const owner = new PublicKey(wallet);

  // Token program id
  const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

  console.log(`Scanning token accounts for wallet: ${wallet}`);
  const resp = await connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID });

  const mintSet = new Set<string>();
  for (const { account } of resp.value) {
    const data: any = account.data;
    const mint: string | undefined = data?.parsed?.info?.mint;
    const uiAmt = Number(data?.parsed?.info?.tokenAmount?.uiAmount || 0);
    if (mint && uiAmt > 0) mintSet.add(mint);
  }

  const mints = Array.from(mintSet);
  console.log(`Found ${mints.length} tokens with non-zero balance`);
  if (mints.length === 0) return;

  const perTokenMaxTx = Math.max(1, Number(maxTx || 200));
  const backfill = new PnlBackfillService();

  let processed = 0;
  for (const mint of mints) {
    try {
      console.log(`Backfilling PnL for mint ${mint} (maxTx=${perTokenMaxTx})...`);
      await backfill.reconstructForToken(wallet, mint, { maxTx: perTokenMaxTx });
      processed++;
    } catch (e) {
      logger.warn(`Backfill failed for mint ${mint}: ${e}`);
    }
  }

  console.log(`Done. Backfilled ${processed}/${mints.length} tokens for wallet ${wallet}.`);
}

main().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});

