import { processTransaction, WalletTracker } from "./services/walletTracker";
import { WalletConfig } from "./utils/discord";

const wallet: WalletConfig = {
  name: "fascist.eth",
  x: "@squirt.sol",
  address: "5CoxdsuoRHDwDPVYqPoeiJxWZ588jXhpimCRJUj8FUN1",
  twProfile_img:
    "https://pbs.twimg.com/profile_images/1907294815081078784/KfZfapna_400x400.jpg",
  discord_ch:
    "https://discord.com/api/webhooks/1359708741129207979/C6vojuylxhUaG1ACa3qvjVM1R2RlzuNtyTjjP7YuN7P2eqV7-4mhPR0HsctLGviDrD7S",
};
const runTest = async () => {
  const walletTracker = new WalletTracker();
  console.log("Test function executed successfully.");
  processTransaction(
    "5CtJeohRukX8GP4bLok3DZTHHHSeZorf76GzB25YfPnheFh7N1THNU3aJaqe14ciZzXP2rfmwvnspD1UD3ydnji9",
    wallet
  );
};

console.log("Starting test...");
runTest().catch((error) => {
  console.error("Error during test execution:", error);
});
console.log("Test completed.");
