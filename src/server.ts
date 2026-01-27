import 'dotenv/config';
import { config } from './config/env';
import { app } from './app';
import { redis } from './queue/redis';
import { createLogger } from './utils/logger';
import { startWorkers } from './queue/workers/index';

const logger = createLogger('server');

/**
 * Start the API server
 */
async function startServer() {
  // Check Redis connection
  try {
    await redis.ping();
    logger.info('Redis connection verified');
  } catch (error) {
    logger.error('Redis connection failed', { error });
    throw error;
  }

  // Start workers
  await startWorkers();

  // Start HTTP server
  const server = app.listen(config.port, () => {
    logger.info(`Server started`, {
      port: config.port,
      nodeEnv: config.nodeEnv,
    });
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');

    server.close(async () => {
      logger.info('HTTP server closed');

      // Close Redis connection
      await redis.quit();
      logger.info('Redis connection closed');

      process.exit(0);
    });

    // Force shutdown after 10 seconds
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Start server
startServer().catch((error) => {
  logger.error('Failed to start server', { error });
  process.exit(1);
});
