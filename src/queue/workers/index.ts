import { generateWorker } from './generate.worker';
import { webhookWorker } from './webhook.worker';
import { createLogger } from '../../utils/logger';

const logger = createLogger('workers');

const workers = [generateWorker, webhookWorker];

export async function startWorkers() {
  logger.info('Starting workers...');

  for (const worker of workers) {
    await worker.waitUntilReady();
    logger.info(`Worker ready: ${worker.name}`);
  }

  logger.info('All workers started');
}

export async function stopWorkers() {
  logger.info('Stopping workers...');

  for (const worker of workers) {
    await worker.close();
    logger.info(`Worker stopped: ${worker.name}`);
  }

  logger.info('All workers stopped');
}

export { generateWorker, webhookWorker };
