import { WalletTracker } from './services/walletTracker';
import logger from './utils/logger';

async function main() {
  try {
    const walletTracker = new WalletTracker();
    await walletTracker.startTracking();

    // Keep the process running
    process.on('SIGINT', () => {
      logger.info('Shutting down wallet tracker...');
      process.exit(0);
    });

  } catch (error) {
    logger.error('Error in main:', error);
    process.exit(1);
  }
}

main();
