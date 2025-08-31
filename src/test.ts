import { PnlBackfillService } from "./services/pnlBackfill";
import { WalletConfig } from "./utils/discord";

const wallet: WalletConfig = {
  name: "pow🧲",
  x: "@squirt.sol",
  address: "8zFZHuSRuDpuAR7J6FzwyF3vKNx4CVW3DFHJerQhc7Zd",
  twProfile_img:
    "https://cdn.kolscan.io/profiles/8zFZHuSRuDpuAR7J6FzwyF3vKNx4CVW3DFHJerQhc7Zd.png",
};
const runTest = async () => {
  // Backfill PnL for a specific token using token account history
  const backfill = new PnlBackfillService();
  const mint = "DHJVYXsikcimtcVo49FAZqYd1XPYPaXezYhbKArJbonk";

  const taList = await backfill.listTokenAccounts(wallet.address, mint);
  console.log("Token accounts for mint:", mint, taList);

  // Reconstruct PnL and write to Firebase (uses Admin SDK)
  await backfill.reconstructForToken(wallet.address, mint, { maxTx: 50 });
  console.log("Backfill completed for:", wallet.address, mint);
};

console.log("Starting test...");
runTest().catch((error) => {
  console.error("Error during test execution:", error);
});
console.log("Test completed.");
