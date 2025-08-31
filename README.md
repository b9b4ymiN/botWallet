# wTrack — Solana Wallet Tracker (Discord + Firebase)

Track DeFi activity on Solana for multiple wallets, send rich Discord notifications, and persist portfolio/PNL to Firebase Realtime Database.

Features
- Monitor multiple wallets and detect trades across major DEX protocols (Jupiter, Orca, Raydium, Meteora, etc.).
- Correctly identify input/output sides from pre/post token balances and classify BUY/SELL/SWAP for both SOL and stablecoins (USDC/USDT).
- Discord embeds include price, FDV, 24h change, pair link, token thumbnail from DexScreener — with emojis for readability.
- Holdings + PnL enrichment and persistence to Firebase RTDB.
- Backfill PnL from historical token-account transactions per wallet/mint.
- First-class Docker support.

Project Structure
- `src/services/walletTracker.ts:1`: Subscribes to logs and processes transactions.
- `src/services/tradeAnalyzer.ts:1`: Figures out tokenIn/tokenOut and the trading mode.
- `src/services/portfolio.ts:1`: Position storage + PnL snapshotting.
- `src/services/firebase.ts:1`: Firebase Admin SDK init + RTDB helpers.
- `src/services/pnlBackfill.ts:1`: Backfills PnL from token-account history (rate-limit aware).
- `src/services/dexscreener.ts:1`: Fetches pair/price/FDV from DexScreener.
- `src/utils/discord.ts:1`: Formats and sends Discord webhook messages.
- `src/tools/backfillWallet.ts:1`: CLI to scan non-zero tokens for a wallet and backfill PnL to Firebase.
- `Dockerfile:1`: Multi-stage build, non-root runtime.
- `.env.example:1`: Comprehensive environment template.

Setup

1) Environment file `.env`
- Copy from template:
  - `cp .env.example .env`
- Required minimal values:
  - `HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY`
  - `DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/XXXX/XXXXXXXXXXXXXXXX`
  - `FIREBASE_DATABASE_URL=https://<project-id>-default-rtdb.firebaseio.com`
  - Firebase Admin credentials (choose ONE):
    - `FIREBASE_SERVICE_ACCOUNT_BASE64=<base64 of serviceAccountKey.json>` (recommended), or
    - `FIREBASE_CLIENT_EMAIL=...` + `FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n`, or
    - `FIREBASE_SERVICE_ACCOUNT_FILE=/absolute/path/to/serviceAccountKey.json`, or place `serviceAccountKey.json` at project root

Notes
- Discord webhook selection prefers `wallet.discord_ch` from `wallet.json`. If empty/invalid, it falls back to `DISCORD_WEBHOOK_URL`.
- Throttling knobs for RPC: `RPC_THROTTLE_MS` (e.g., 800), `RPC_BATCH_SIZE` (e.g., 5).

2) Wallet configuration `wallet.json`
```
{
  "wallets": [
    {
      "name": "your-handle",
      "address": "<WALLET_ADDRESS>",
      "x": "@twitter",
      "twProfile_img": "https://.../avatar.png",
      "discord_ch": "https://discord.com/api/webhooks/XXXX/XXXXXXXXXXXXXXXX" // optional override per wallet
    }
  ]
}
```

Run with Docker (Oracle Cloud Free Tier friendly: Ampere A1)

Prereqs: Docker and git installed on your server.

- Build image
```
docker build -t wtrack:latest .
```

- Run container (load env from `.env`)
```
docker run -d \
  --name wtrack \
  --env-file .env \
  --restart unless-stopped \
  wtrack:latest
```

- Mount `wallet.json` read-only to update without rebuilding
```
docker run -d \
  --name wtrack \
  --env-file .env \
  -v $(pwd)/wallet.json:/app/wallet.json:ro \
  --restart unless-stopped \
  wtrack:latest
```

- Tail logs
```
docker logs -f wtrack
```

Ampere A1 note
- If you build on x86_64 but run on Ampere (arm64), either build on the Ampere VM or produce a multi-arch image.

Local development (without Docker)

- Install dependencies
```
npm install
```
- Dev mode
```
npm run dev
```
- Or build + start
```
npm run build
npm start
```

Discord Behavior (summary)
- Selects the non-SOL/stable token as the traded asset to fetch DexScreener data and display:
  - Price (USD), 24h change, FDV, and links.
  - Links: Chart (DexScreener), Pump.fun, Wallet (gmgn), Txn (solscan).
  - Token thumbnail from DexScreener.
- Embed fields:
  - Input = what the wallet spent (tokenOut)
  - Output = what the wallet received (tokenIn)
- Enhanced styling: emojis for Holdings, PnL (Unrealized/Realized), Price/Avg Entry.

Backfill PnL (CLI)
- Find non-zero token holdings for a wallet and backfill PnL to Firebase for each mint:
  - `npm run backfill:wallet -- --wallet=<WALLET_ADDRESS> --maxTx=200`
- Internals:
  - Scans token accounts for the wallet; collects txs; fetches each with `getTransaction` (sequential to avoid 429); computes mint delta + cash-leg USD price; updates positions in Firebase.
- Rate-limit tuning (env):
  - `RPC_THROTTLE_MS=800` (delay between RPC calls)
  - `RPC_BATCH_SIZE=5`
  - Reduce `--maxTx` if needed

Security
- `.gitignore` excludes `serviceAccountKey.json` and Admin SDK key patterns. Do not commit secrets.
- Prefer base64 credentials via env in containers/CI.

FAQ
- 10015 Unknown Webhook: Verify webhook URLs in `wallet.json` or `DISCORD_WEBHOOK_URL` are valid; the code retries with the fallback webhook.
- No DexScreener data: The message still sends without market summary and uses the profile image as a thumbnail.
- RPC rate limits: If using a free Helius plan, consider upgrading when tracking many wallets or heavy tx activity. Use the provided throttling knobs.

License
- See repository for license details.
