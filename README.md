# Solana DeFi Activity Tracker

Track DeFi trading activity for multiple wallets on Solana and send rich Discord notifications with market data from DexScreener.

Features
- Monitor multiple wallets and detect trades across major DEX protocols (Jupiter, Orca, Raydium, Meteora, etc.).
- Correctly identify input/output sides from pre/post token balances and classify BUY/SELL/SWAP for both SOL and stablecoins (USDC/USDT).
- Discord embeds include price, FDV, 24h change, pair link, token thumbnail from DexScreener.
- First-class Docker support; optimized for Oracle Cloud Free Tier (Ampere A1).

Project Structure
- `src/services/walletTracker.ts`: Subscribes to logs and processes transactions.
- `src/services/tradeAnalyzer.ts`: Figures out tokenIn/tokenOut and the trading mode.
- `src/services/dexRegistry.ts`: Maps DEX program IDs to human-friendly names.
- `src/services/dexscreener.ts`: Fetches pair/price/FDV from DexScreener.
- `src/utils/discord.ts`: Formats and sends Discord webhook messages.
- `src/constants.ts`: `PROGRAM_ACCOUNTS_DEX` (DEX name → program id[]). Keep this up to date.

Setup

1) Environment file `.env`
```
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/XXXX/XXXXXXXXXXXXXXXX
LOG_LEVEL=info
```

Notes
- Discord webhook selection prefers `wallet.discord_ch` from `wallet.json`. If empty/invalid, it falls back to `DISCORD_WEBHOOK_URL`.

2) Wallet configuration `wallet.json`
```
{
  "wallets": [
    {
      "name": "squirt.sol",
      "address": "<WALLET_ADDRESS>",
      "x": "@squirt.sol",
      "twProfile_img": "https://.../avatar.jpg",
      "discord_ch": "https://discord.com/api/webhooks/XXXX/XXXXXXXXXXXXXXXX"
    }
  ]
}
```

3) Update DEX mapping (if needed)
- File: `src/constants.ts:1`
- Add/adjust program IDs for new DEXes. The app logs a warning when unknown program IDs are detected so you can extend the mapping easily.

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
  - Price (USD), 24h change, 24h volume/liquidity (if available), FDV.
  - Links: Chart (DexScreener), Pump.fun, Wallet (gmgn), Txn (solscan).
  - Token thumbnail from DexScreener.
- Embed fields:
  - Input = what the wallet spent (tokenOut)
  - Output = what the wallet received (tokenIn)

Logging
- Console-only (no file writes), suitable for Free Tier and easy to read.
- Set level via `LOG_LEVEL` (`info`, `warn`, `error`, `debug`).

Next Steps
- Keep `PROGRAM_ACCOUNTS_DEX` up to date (add program IDs seen in logs).
- Add monitoring/alerting (e.g., forward Docker logs to OCI Logging) for reliability.
- Store secrets safely (OCI Vault or CI secrets) instead of committing them.
- Consider multi-stage Dockerfile (already provided) and non-root runtime (already enabled).

FAQ
- 10015 Unknown Webhook: Verify webhook URLs in `wallet.json` or `DISCORD_WEBHOOK_URL` are valid; the code retries with the fallback webhook.
- No DexScreener data: The message still sends without market summary and uses the profile image as a thumbnail.
- RPC rate limits: If using a free Helius plan, consider upgrading when tracking many wallets or heavy tx activity.

Updating after code changes 
  1. git pull
  2. docker build -t wtrack:latest .
  3. docker rm -f wtrack
  4. docker run -d --name wtrack --env-file .env -v $(pwd)/wallet.json:/app/wallet.json:ro --restart unless-stopped wtrack:latest
  5. docker logs -f wtrack
