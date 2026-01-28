import { prisma } from '../db/prisma';
import { JobNotFoundError } from '../utils/errors';
import { createLogger } from '../utils/logger';

const logger = createLogger('job');

export type CreateJobOptions = {
  tenantId: string;
  idempotencyKey?: string;
  prompt: string;
  /** Base64 encoded image data (format: data:image/<type>;base64,<data>) */
  inputImage?: string;
  mode?: 'draft' | 'final';
  resolution?: '1K' | '2K' | '4K';
  aspectRatio?: 'Auto' | '1:1' | '9:16' | '16:9' | '3:4' | '4:3' | '3:2' | '2:3' | '5:4' | '4:5' | '21:9';
  sampleCount?: number;
  maxAttempts?: number;
};

export type JobStatus = {
  id: string;
  status: string;
  resultUrls: string[] | null;
  error: { code: string | null; message: string | null } | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Create a new job
 */
export async function createJob(options: CreateJobOptions) {
  const {
    tenantId,
    idempotencyKey,
    prompt,
    inputImage,
    mode = 'final',
    resolution,       // Optional - not all models support it
    aspectRatio,      // Optional - not all models support it
    sampleCount,      // Optional
    maxAttempts = 4,
  } = options;

  // Check for idempotency key duplicate
  if (idempotencyKey) {
    const existing = await prisma.job.findUnique({
      where: {
        tenantId_idempotencyKey: {
          tenantId,
          idempotencyKey,
        },
      },
    });

    if (existing) {
      logger.info('Duplicate idempotency key, returning existing job', {
        jobId: existing.id,
        idempotencyKey,
      });
      return existing;
    }
  }

  const job = await prisma.job.create({
    data: {
      tenantId,
      idempotencyKey,
      prompt,
      inputImage,
      mode,
      status: 'QUEUED',
      maxAttempts,
      resolution,
      aspectRatio,
      sampleCount,
    },
  });

  logger.info('Job created', {
    jobId: job.id,
    tenantId,
    mode,
    idempotencyKey,
  });

  return job;
}

/**
 * Get a job by ID (scoped to tenant)
 */
export async function getJob(jobId: string, tenantId: string): Promise<JobStatus | null> {
  const job = await prisma.job.findFirst({
    where: {
      id: jobId,
      tenantId,
    },
  });

  if (!job) {
    return null;
  }

  return {
    id: job.id,
    status: job.status,
    resultUrls: (job.resultUrls as string[]) ?? null,
    error: job.errorCode || job.errorMessage
      ? { code: job.errorCode, message: job.errorMessage }
      : null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

/**
 * Update job status to RUNNING
 */
export async function markJobRunning(
  jobId: string,
  providerKeyId: string
): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: 'RUNNING',
      providerKeyId,
    },
  });

  logger.debug('Job marked as RUNNING', { jobId, providerKeyId });
}

/**
 * Update job as succeeded
 */
export async function markJobSucceeded(
  jobId: string,
  resultUrls: string[]
): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: 'SUCCEEDED',
      resultUrls,
      errorCode: null,
      errorMessage: null,
    },
  });

  logger.info('Job succeeded', { jobId, resultUrls });
}

/**
 * Append a single result URL to job (for progressive results)
 */
export async function appendJobResultUrl(
  jobId: string,
  url: string
): Promise<void> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { resultUrls: true },
  });

  if (!job) {
    throw new JobNotFoundError(jobId);
  }

  const currentUrls = (job.resultUrls as string[]) || [];
  const updatedUrls = [...currentUrls, url];

  await prisma.job.update({
    where: { id: jobId },
    data: {
      resultUrls: updatedUrls,
    },
  });

  logger.debug('Job result URL appended', { jobId, url, total: updatedUrls.length });
}

/**
 * Update job as failed
 */
export async function markJobFailed(
  jobId: string,
  errorCode: string,
  errorMessage: string,
  retryable: boolean
): Promise<void> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
  });

  if (!job) {
    throw new JobNotFoundError(jobId);
  }

  const nextAttempts = job.attempts + 1;
  const shouldRetry = retryable && nextAttempts < job.maxAttempts;

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: shouldRetry ? 'RETRYING' : 'FAILED',
      attempts: nextAttempts,
      errorCode,
      errorMessage,
    },
  });

  logger.info('Job failed', {
    jobId,
    errorCode,
    errorMessage,
    retryable,
    shouldRetry,
    attempts: nextAttempts,
  });
}

/**
 * Record a job event (for audit/debugging)
 */
export async function recordJobEvent(
  jobId: string,
  status: string,
  message?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await prisma.jobEvent.create({
    data: {
      jobId,
      status,
      message,
      metadata: metadata as any,
    },
  });
}

/**
 * List jobs for a tenant
 */
export async function listJobs(options: {
  tenantId: string;
  status?: string;
  limit?: number;
  cursor?: string;
}) {
  const { tenantId, status, limit = 50, cursor } = options;

  const where: any = { tenantId };
  if (status) {
    where.status = status;
  }

  const jobs = await prisma.job.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit + 1, // +1 to check if there's a next page
    cursor: cursor ? { id: cursor } : undefined,
  });

  const hasMore = jobs.length > limit;
  const items = hasMore ? jobs.slice(0, limit) : jobs;
  const nextCursor = hasMore ? items[items.length - 1].id : undefined;

  return {
    items,
    nextCursor,
    hasMore,
  };
}

/**
 * Get job by provider request ID (for webhook handling)
 */
export async function getJobByProviderRequestId(
  providerRequestId: string
) {
  return prisma.job.findFirst({
    where: { providerRequestId },
    include: { tenant: true },
  });
}

/**
 * Update provider request ID for a job
 */
export async function updateProviderRequestId(
  jobId: string,
  providerRequestId: string
): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { providerRequestId },
  });

  logger.debug('Provider request ID updated', { jobId, providerRequestId });
}
