import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma';
import { generateQueue } from '../../queue/bull';
import { createJob } from '../../services/job.service';
import { createLogger } from '../../utils/logger';

const logger = createLogger('generate');

// Constants
// 锁脸功能需要高清参考图片，提高限制到 4MB
const MAX_IMAGE_SIZE_MB = 4;
const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;

// Base64 image regex: data:image/(png|jpeg|jpg|gif|webp);base64,xxxxx
const BASE64_IMAGE_REGEX = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/]+=*$/;

// Validation schemas
export const GenerateBodySchema = z.object({
  prompt: z.string().min(1),
  inputImage: z.string()
    .regex(BASE64_IMAGE_REGEX, 'Invalid base64 image format. Expected: data:image/<type>;base64,<data>')
    .refine(
      (val) => {
        // Extract base64 data part and check size
        const base64Data = val.split(',')[1];
        if (!base64Data) return false;
        // Base64 string length * 0.75 ≈ actual bytes
        const estimatedBytes = base64Data.length * 0.75;
        return estimatedBytes <= MAX_IMAGE_SIZE_BYTES;
      },
      { message: `Image size exceeds ${MAX_IMAGE_SIZE_MB}MB limit` }
    )
    .optional(),
  mode: z.enum(['draft', 'final']).optional(),
  resolution: z.enum(['1K', '2K', '4K']).optional(),
  aspectRatio: z.enum(['Auto', '1:1', '9:16', '16:9', '3:4', '4:3', '3:2', '2:3', '5:4', '4:5', '21:9']).optional(),
  sampleCount: z.number().min(1).max(10).int().optional(),
});

export const GenerateParamsSchema = z.object({
  jobId: z.string().cuid(),
});

/**
 * POST /v1/images/generate
 *
 * Submit a new image generation job
 */
export async function generate(req: Request, res: Response): Promise<void> {
  const tenant = req.tenant!;
  const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
  const body = GenerateBodySchema.parse(req.body);

  logger.info('Generate request', {
    tenantId: tenant.id,
    prompt: body.prompt.substring(0, 100),
    mode: body.mode,
    hasInputImage: !!body.inputImage,
    idempotencyKey,
  });

  // Create job (handles idempotency check)
  // Note: resolution and aspectRatio are optional - not all models support them
  const job = await createJob({
    tenantId: tenant.id,
    idempotencyKey,
    prompt: body.prompt,
    inputImage: body.inputImage,
    mode: body.mode || 'final',
    resolution: body.resolution,      // Optional - some models don't support it
    aspectRatio: body.aspectRatio,    // Optional - some models don't support it
    sampleCount: body.sampleCount,    // Optional
  });

  // If job already existed (idempotency), return it
  if (job.status !== 'QUEUED' || job.createdAt.getTime() < Date.now() - 1000) {
    // Job exists and is not just created
    res.status(202).json({
      jobId: job.id,
      status: job.status,
      resultUrls: job.resultUrls,
      error: job.errorCode ? { code: job.errorCode, message: job.errorMessage } : null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    });
    return;
  }

  // Add to queue
  await generateQueue.add(
    'generate',
    { jobId: job.id },
    {
      attempts: 4,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: 100,
      removeOnFail: 500,
    }
  );

  logger.info('Job queued', {
    jobId: job.id,
    tenantId: tenant.id,
  });

  res.status(202).json({
    jobId: job.id,
    status: 'QUEUED',
  });
}

/**
 * GET /v1/jobs/:jobId
 *
 * Get job status and results
 */
export async function getJob(req: Request, res: Response): Promise<void> {
  const tenant = req.tenant!;
  const { jobId } = GenerateParamsSchema.parse(req.params);

  const job = await prisma.job.findFirst({
    where: {
      id: jobId,
      tenantId: tenant.id,
    },
  });

  if (!job) {
    res.status(404).json({
      error: 'NOT_FOUND',
      message: 'Job not found',
    });
    return;
  }

  res.json({
    jobId: job.id,
    status: job.status,
    resultUrls: job.status === 'SUCCEEDED' ? ((job.resultUrls as string[]) ?? []) : [],
    error: job.status === 'FAILED' ? { code: job.errorCode, message: job.errorMessage } : null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
}

/**
 * GET /v1/jobs
 *
 * List jobs for the tenant
 */
export async function listJobs(req: Request, res: Response): Promise<void> {
  const tenant = req.tenant!;
  const status = req.query.status as string | undefined;
  const limit = parseInt(req.query.limit as string) || 50;
  const cursor = req.query.cursor as string | undefined;

  const where: any = { tenantId: tenant.id };
  if (status) {
    where.status = status;
  }

  const jobs = await prisma.job.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    cursor: cursor ? { id: cursor } : undefined,
    select: {
      id: true,
      status: true,
      prompt: true,
      mode: true,
      resultUrls: true,
      errorCode: true,
      errorMessage: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const hasMore = jobs.length > limit;
  const items = hasMore ? jobs.slice(0, limit) : jobs;
  const nextCursor = hasMore ? items[items.length - 1].id : undefined;

  res.json({
    items,
    nextCursor,
    hasMore,
  });
}

/**
 * DELETE /v1/jobs/:jobId
 *
 * Cancel a job (only if not yet running)
 */
export async function cancelJob(req: Request, res: Response): Promise<void> {
  const tenant = req.tenant!;
  const { jobId } = GenerateParamsSchema.parse(req.params);

  const job = await prisma.job.findFirst({
    where: {
      id: jobId,
      tenantId: tenant.id,
    },
  });

  if (!job) {
    res.status(404).json({
      error: 'NOT_FOUND',
      message: 'Job not found',
    });
    return;
  }

  // Only allow canceling queued jobs
  if (job.status !== 'QUEUED' && job.status !== 'RETRYING') {
    res.status(400).json({
      error: 'INVALID_STATE',
      message: `Cannot cancel job in status ${job.status}`,
    });
    return;
  }

  await prisma.job.update({
    where: { id: jobId },
    data: { status: 'CANCELED' },
  });

  // Try to remove from queue
  const jobIdInQueue = await generateQueue.getJob(jobId);
  if (jobIdInQueue) {
    await jobIdInQueue.remove();
  }

  logger.info('Job canceled', { jobId, tenantId: tenant.id });

  res.json({
    jobId: job.id,
    status: 'CANCELED',
  });
}
