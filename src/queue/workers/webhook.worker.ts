import { Worker, Job } from 'bullmq';
import { connection } from '../redis';
import { QUEUE_WEBHOOK } from '../queues';
import { prisma } from '../../db/prisma';
import { sendWebhook, type WebhookPayload } from '../../services/webhook.service';
import { createLogger } from '../../utils/logger';
import { config } from '../../config/env';

const logger = createLogger('webhook.worker');

export interface WebhookJobData {
  tenantId: string;
  jobId: string;
}

export const webhookWorker = new Worker<WebhookJobData>(
  QUEUE_WEBHOOK,
  async (job: Job<WebhookJobData>) => {
    const { tenantId, jobId } = job.data;

    logger.info('Processing webhook job', { jobId, tenantId, jobAttempt: job.attemptsMade });

    // Get job details
    const dbJob = await prisma.job.findUnique({
      where: { id: jobId },
    });

    if (!dbJob) {
      logger.warn('Job not found for webhook', { jobId });
      return;
    }

    // Get tenant details
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant || !tenant.webhookEnabled || !tenant.webhookUrl || !tenant.webhookSecret) {
      logger.info('Webhook not configured for tenant', { tenantId });
      return;
    }

    // Build webhook payload
    const payload: WebhookPayload = {
      eventId: job.id!,
      jobId: dbJob.id,
      tenantId: tenant.id,
      status: dbJob.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED',
      resultUrls: (dbJob.resultUrls as string[]) ?? undefined,
      error:
        dbJob.status === 'FAILED'
          ? { code: dbJob.errorCode ?? 'UNKNOWN', message: dbJob.errorMessage ?? 'Unknown error' }
          : undefined,
      timestamp: Date.now(),
    };

    // Send webhook
    try {
      await sendWebhook({
        url: tenant.webhookUrl,
        secret: tenant.webhookSecret,
        payload,
        timeout: 10000,
      });

      logger.info('Webhook delivered successfully', {
        eventId: job.id,
        jobId,
        tenantId,
        status: payload.status,
      });
    } catch (error) {
      logger.error('Webhook delivery failed', {
        eventId: job.id,
        jobId,
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Re-throw for BullMQ retry
      throw error;
    }
  },
  {
    connection,
    concurrency: 50,
  }
);

webhookWorker.on('completed', (job) => {
  logger.info('Webhook job completed', { eventId: job.id });
});

webhookWorker.on('failed', (job, error) => {
  if (job) {
    logger.error('Webhook job failed permanently', {
      eventId: job.id,
      tenantId: job.data.tenantId,
      error: error.message,
    });
  }
});
