import { processTransaction, WalletTracker } from "./services/walletTracker";
import { WalletConfig } from "./utils/discord";

const wallet: WalletConfig = {
  name: "D4U7B",
  x: "@runitbackghost",
  address: "3Z19SwGej4xwKh9eiHyx3eVWHjBDEgGHeqrKtmhNcxsv",
  twProfile_img:
    "https://pbs.twimg.com/profile_images/1907294815081078784/KfZfapna_400x400.jpg",
  discord_ch:
    "https://discord.com/api/webhooks/1359708741129207979/C6vojuylxhUaG1ACa3qvjVM1R2RlzuNtyTjjP7YuN7P2eqV7-4mhPR0HsctLGviDrD7S",
};
const runTest = async () => {
  const walletTracker = new WalletTracker();
  console.log("Test function executed successfully.");
  processTransaction(
    "2XEkpGZkhTW5RbSxN4oAABg3Pwx6f2JQAExiwe3aFRzUYsSGzyzSASBmotqSxMkoeGdwqSg17hv28Rc3jWBqFp48",
    wallet
  );
};

console.log("Starting test...");
runTest().catch((error) => {
  console.error("Error during test execution:", error);
});
console.log("Test completed.");
