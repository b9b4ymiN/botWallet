# Solana DeFi Activity Tracker

This project tracks DeFi trading activity for multiple wallets on the Solana blockchain, specifically monitoring transactions related to various DEX programs.

## Features

- Monitors multiple wallet addresses simultaneously
- Detects DeFi trading activity across major protocols (Jupiter, Orca, Raydium, etc.)
- Full logging functionality with Winston
- Docker support
- Uses Helius RPC node for reliable connectivity

## Setup

1. Clone the repository
2. Copy `.env.example` to `.env` and fill in your details:
   ```
   HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY_HERE
   WALLETS_TO_TRACK=wallet1,wallet2,wallet3
   ```
3. Install dependencies:
   ```
   npm install
   ```

## Running with Docker

1. Build the Docker image:
   ```
   docker build -t solana-wallet-tracker .
   ```

2. Run the container:
   ```
   docker run --env-file ./.env solana-wallet-tracker
   ```

## Running Locally

1. Build the project:
   ```
   npm run build
   ```

2. Start the tracker:
   ```
   npm start
   ```

## Development

To run in development mode with hot reloading:
```
npm run dev
```

## Logging

Logs are written to:
- `error.log` - Error-level logs only
- `combined.log` - All logs
- Console output - All logs with colorization

## Error Handling

The application includes comprehensive error handling and logging:
- All main functions are wrapped in try-catch blocks
- Errors are logged with full stack traces
- Critical errors will trigger process termination with non-zero exit codes
