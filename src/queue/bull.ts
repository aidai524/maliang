import { Queue, QueueOptions } from 'bullmq';
import { connection } from './redis';
import { QUEUE_GENERATE, QUEUE_WEBHOOK } from './queues';

const defaultOptions: QueueOptions = {
  connection,
  defaultJobOptions: {
    removeOnComplete: {
      count: 1000, // keep last 1000 completed jobs
      age: 24 * 3600, // or 24 hours
    },
    removeOnFail: {
      count: 5000, // keep last 5000 failed jobs
      age: 7 * 24 * 3600, // or 7 days
    },
  },
};

export const generateQueue = new Queue(QUEUE_GENERATE, defaultOptions);

export const webhookQueue = new Queue(QUEUE_WEBHOOK, defaultOptions);

// Health check function
export async function getQueueStats() {
  const [generateStats, webhookStats] = await Promise.all([
    generateQueue.getJobCounts(),
    webhookQueue.getJobCounts(),
  ]);

  return {
    generate: generateStats,
    webhook: webhookStats,
  };
}
