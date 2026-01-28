import { Worker, Job } from 'bullmq';
import { connection } from '../redis';
import { QUEUE_GENERATE } from '../queues';
import { prisma } from '../../db/prisma';
import { pickProviderKey, markKeySuccess, markKeyFailure, ProviderKeyError } from '../../services/keypool.service';
import { acquireRpm, acquireConcurrency, releaseConcurrency } from '../../services/limiter.service';
import { putImage } from '../../services/storage.service';
import { markJobRunning, markJobSucceeded, markJobFailed, updateProviderRequestId, appendJobResultUrl } from '../../services/job.service';
import { geminiGenerate } from '../../providers/gemini';
import { config } from '../../config/env';
import { webhookQueue } from '../bull';
import { isRetryableError, getErrorMessage } from '../../utils/errors';
import { createLogger } from '../../utils/logger';
import { checkCache, saveToCache } from '../../services/request-cache.service';

const logger = createLogger('generate.worker');

const GLOBAL_RPM = config.rateLimits.globalRpm;
const GLOBAL_CONC = config.rateLimits.globalConcurrency;

export interface GenerateJobData {
  jobId: string;
}

export const generateWorker = new Worker<GenerateJobData>(
  QUEUE_GENERATE,
  async (job: Job<GenerateJobData>) => {
    const { jobId } = job.data;

    logger.info('Processing generate job', { jobId, jobAttempt: job.attemptsMade });

    const dbJob = await prisma.job.findUnique({
      where: { id: jobId },
      include: { tenant: true },
    });

    if (!dbJob) {
      logger.warn('Job not found', { jobId });
      return;
    }

    if (dbJob.status === 'CANCELED') {
      logger.info('Job canceled, skipping', { jobId });
      return;
    }

    // ========== GLOBAL RATE LIMITING ==========
    const globalRpmResult = await acquireRpm('lim:global:rpm', GLOBAL_RPM, 60);
    if (!globalRpmResult.ok) {
      logger.debug('Global rate limit hit', { count: globalRpmResult.count });
      throw new Error('GLOBAL_RATE_LIMIT');
    }

    const globalConcResult = await acquireConcurrency('lim:global:conc', GLOBAL_CONC, 3600);
    if (!globalConcResult.ok) {
      logger.debug('Global concurrency limit hit', { value: globalConcResult.value });
      throw new Error('GLOBAL_CONC_LIMIT');
    }

    let keyConcKey: string | null = null;
    let keyConcLimit = 0;

    try {
    // ========== PICK PROVIDER KEY ==========
    const providerKey = await pickProviderKey('gemini');

    if (!providerKey) {
      logger.error('No provider key available', {
        provider: 'gemini',
        error: 'NO_PROVIDER_KEY_AVAILABLE',
        tenantId: dbJob.tenantId,
        jobId: dbJob.id,
      });
      throw new Error('NO_PROVIDER_KEY_AVAILABLE');
    }

      keyConcKey = `lim:key:${providerKey.id}:inflight`;
      keyConcLimit = providerKey.conc;

      logger.info('Provider key selected', {
        keyId: providerKey.id,
        rpm: providerKey.rpm,
        conc: providerKey.conc,
      });

      // ========== KEY-LEVEL RATE LIMITING ==========
      const keyRpmResult = await acquireRpm(`lim:key:${providerKey.id}:rpm`, providerKey.rpm, 60);
      if (!keyRpmResult.ok) {
        logger.debug('Key rate limit hit', { keyId: providerKey.id, count: keyRpmResult.count });
        throw new Error('KEY_RATE_LIMIT');
      }

      const keyConcResult = await acquireConcurrency(keyConcKey, providerKey.conc, 3600);
      if (!keyConcResult.ok) {
        logger.debug('Key concurrency limit hit', { keyId: providerKey.id, value: keyConcResult.value });
        throw new Error('KEY_CONC_LIMIT');
      }

      // ========== TENANT-LEVEL RATE LIMITING ==========
      const tenant = dbJob.tenant;
      const tenantRpmResult = await acquireRpm(`lim:tenant:${tenant.id}:rpm`, tenant.planRpm, 60);
      if (!tenantRpmResult.ok) {
        logger.debug('Tenant rate limit hit', { tenantId: tenant.id, count: tenantRpmResult.count });
        throw new Error('TENANT_RATE_LIMIT');
      }

      const tenantConcResult = await acquireConcurrency(
        `lim:tenant:${tenant.id}:conc`,
        tenant.planConcurrency,
        3600
      );
      if (!tenantConcResult.ok) {
        logger.debug('Tenant concurrency limit hit', { tenantId: tenant.id, value: tenantConcResult.value });
        throw new Error('TENANT_CONC_LIMIT');
      }

      // ========== MARK JOB AS RUNNING ==========
      await markJobRunning(dbJob.id, providerKey.id);

      // ========== CHECK CACHE ==========
      const cachedImages = await checkCache(dbJob.prompt, {
        mode: dbJob.mode,
        resolution: dbJob.resolution as '1K' | '2K' | undefined,
        aspectRatio: dbJob.aspectRatio as string | undefined,
        sampleCount: dbJob.sampleCount ?? undefined,
      });

      if (cachedImages && cachedImages.length > 0) {
        logger.info('Using cached images', {
          jobId,
          count: cachedImages.length,
        });

        // 直接使用缓存结果，跳过 API 调用
        for (const url of cachedImages) {
          await appendJobResultUrl(dbJob.id, url);
        }

        // 标记任务成功
        await markJobSucceeded(dbJob.id, cachedImages);
        await markKeySuccess(providerKey.id);

        logger.info('Job completed from cache', { jobId, urls: cachedImages });

        // 如果配置了 webhook，触发通知
        if (tenant.webhookEnabled && tenant.webhookUrl && tenant.webhookSecret) {
          await webhookQueue.add(
            'send',
            {
              tenantId: tenant.id,
              jobId: dbJob.id,
            },
            {
              attempts: 8,
              backoff: {
                type: 'exponential',
                delay: 2000,
              },
            }
          );
          logger.info('Webhook queued (from cache)', { jobId, tenantId: tenant.id });
        }

        return; // 缓存命中，直接返回
      }

      // ========== CALL PROVIDER ==========
      logger.info('Cache miss, calling Gemini API', {
        jobId,
        mode: dbJob.mode,
        promptLength: dbJob.prompt.length,
      });

      const result = await geminiGenerate({
        apiKey: providerKey.secret,
        prompt: dbJob.prompt,
        inputImageUrl: dbJob.inputImageUrl ?? undefined,
        mode: dbJob.mode as 'draft' | 'final',
        resolution: dbJob.resolution as '1K' | '2K' | undefined,
        aspectRatio: dbJob.aspectRatio as '1:1' | '9:16' | '16:9' | '4:3' | '3:2' | '2:3' | '5:4' | '4:5' | '21:9' | undefined,
        sampleCount: dbJob.sampleCount ?? undefined,
      }, {
        maxAttempts: 60,
        intervalMs: 3000,
        enableFallback: true,
      });

      // ========== PROCESS RESULT ==========
      if (result.status === 'FAILED') {
        throw new Error(result.error || 'Generation failed');
      }

      // Store images in parallel with progressive updates
      const uploadPromises = result.images.map(async (image, index) => {
        if (image.url.startsWith('data:')) {
          const [mimeType, base64Data] = image.url.split(';base64,');
          const buffer = Buffer.from(base64Data, 'base64');

          const stored = await putImage(buffer, {
            contentType: image.mimeType || mimeType.replace('data:', ''),
            filename: `${dbJob.id}/${Date.now()}-${index}.png`,
          });

          // Progressive update: append URL immediately after upload
          await appendJobResultUrl(dbJob.id, stored.url);
          logger.info('Image uploaded and URL appended', { jobId, index, url: stored.url });

          return stored.url;
        } else {
          // If it's already a URL, append it directly
          await appendJobResultUrl(dbJob.id, image.url);
          logger.info('External URL appended', { jobId, index, url: image.url });
          return image.url;
        }
      });

      // Wait for all uploads to complete
      const resultUrls = await Promise.all(uploadPromises);

      logger.info('All images processed successfully', {
        jobId,
        count: resultUrls.length,
        storageType: config.storage.type,
      });

      // ========== SAVE TO CACHE ==========
      await saveToCache(dbJob.prompt, resultUrls, {
        mode: dbJob.mode,
        resolution: dbJob.resolution as '1K' | '2K' | undefined,
        aspectRatio: dbJob.aspectRatio as string | undefined,
        sampleCount: dbJob.sampleCount ?? undefined,
        model: result.model || 'gemini-2.0-flash-exp',
      });

      // ========== MARK JOB AS SUCCEEDED ==========
      await markJobSucceeded(dbJob.id, resultUrls);

      // Mark key as successful
      await markKeySuccess(providerKey.id);

      // ========== QUEUE WEBHOOK ==========
      if (tenant.webhookEnabled && tenant.webhookUrl && tenant.webhookSecret) {
        await webhookQueue.add(
          'send',
          {
            tenantId: tenant.id,
            jobId: dbJob.id,
          },
          {
            attempts: 8,
            backoff: {
              type: 'exponential',
              delay: 2000,
            },
          }
        );
        logger.info('Webhook queued', { jobId, tenantId: tenant.id });
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      const errorCode = getErrorCode(errorMessage);

      // Determine if retryable
      const retryable = isRetryableError(error) || [
        'GLOBAL_RATE_LIMIT',
        'GLOBAL_CONC_LIMIT',
        'KEY_RATE_LIMIT',
        'KEY_CONC_LIMIT',
        'TENANT_RATE_LIMIT',
        'TENANT_CONC_LIMIT',
        'NO_PROVIDER_KEY_AVAILABLE',
      ].includes(errorCode);

      logger.error('Job failed', {
        jobId,
        error: errorMessage,
        errorCode,
        retryable,
        attempt: job.attemptsMade,
      });

      // Mark job as failed
      const nextAttempts = (dbJob.attempts ?? 0) + 1;
      await markJobFailed(
        dbJob.id,
        errorCode,
        errorMessage,
        retryable && nextAttempts < dbJob.maxAttempts
      );

      // Mark key failure if we had one
      if (keyConcKey) {
        await markKeyFailure(keyConcKey.replace('lim:key:', '').replace(':inflight', ''), nextAttempts);
      }

      // Queue webhook for failure if configured
      const tenant = dbJob.tenant;
      if (
        !retryable &&
        tenant.webhookEnabled &&
        tenant.webhookUrl &&
        tenant.webhookSecret
      ) {
        await webhookQueue.add(
          'send',
          {
            tenantId: tenant.id,
            jobId: dbJob.id,
          },
          {
            attempts: 8,
            backoff: {
              type: 'exponential',
              delay: 2000,
            },
          }
        );
      }

      // Re-throw for BullMQ retry
      if (retryable && nextAttempts < dbJob.maxAttempts) {
        throw error;
      }
    } finally {
      // ========== RELEASE CONCURRENCY TOKENS ==========
      if (keyConcKey) {
        await releaseConcurrency(keyConcKey);
      }
      await releaseConcurrency(`lim:tenant:${dbJob.tenantId}:conc`);
      await releaseConcurrency('lim:global:conc');
    }
  },
  {
    connection,
    concurrency: config.worker.concurrency,
  }
);

generateWorker.on('completed', (job) => {
  logger.info('Generate job completed', { jobId: job.data.jobId });
});

generateWorker.on('failed', (job, error) => {
  if (job) {
    logger.error('Generate job failed permanently', {
      jobId: job.data.jobId,
      error: error.message,
    });
  }
});

// ========== 智能退避重试策略 ==========n// 针对503错误使用指数退避，其他错误使用固定延迟nfunction getRetryDelay(attempt: number, errorCode: string): number {n  // 503错误 - 指数退避：2^attempt * 1000毫秒，最多60秒n  if (errorCode === 'GEMINI_ERROR' || errorCode.includes('503')) {n    const delay = Math.min(Math.pow(2, attempt) * 1000, 60000);n    logger.info('Using exponential backoff for 503', { attempt, delay: delay / 1000 });n    return delay;n  }n  n  // 其他错误 - 固定3秒延迟n  return 3000;n}n
function getErrorCode(message: string): string {
  if (message.includes('GLOBAL_RATE_LIMIT')) return 'GLOBAL_RATE_LIMIT';
  if (message.includes('GLOBAL_CONC_LIMIT')) return 'GLOBAL_CONC_LIMIT';
  if (message.includes('KEY_RATE_LIMIT')) return 'KEY_RATE_LIMIT';
  if (message.includes('KEY_CONC_LIMIT')) return 'KEY_CONC_LIMIT';
  if (message.includes('TENANT_RATE_LIMIT')) return 'TENANT_RATE_LIMIT';
  if (message.includes('TENANT_CONC_LIMIT')) return 'TENANT_CONC_LIMIT';
  if (message.includes('NO_PROVIDER_KEY')) return 'NO_PROVIDER_KEY';
  if (message.includes('GEMINI')) return 'PROVIDER_ERROR';
  return 'UNKNOWN_ERROR';
}
