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
const MAX_REFERENCE_IMAGES = 5;

// Base64 image regex: data:image/(png|jpeg|jpg|gif|webp);base64,xxxxx
const BASE64_IMAGE_REGEX = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/]+=*$/;

// Supported providers
const SUPPORTED_PROVIDERS = ['gemini', 'jimeng'] as const;
type Provider = typeof SUPPORTED_PROVIDERS[number];

// Generation modes
const GENERATION_MODES = ['text_to_image', 'image_to_image'] as const;
type GenerationMode = typeof GENERATION_MODES[number];

// Image size validator
const base64ImageSchema = z.string()
  .regex(BASE64_IMAGE_REGEX, 'Invalid base64 image format. Expected: data:image/<type>;base64,<data>')
  .refine(
    (val) => {
      const base64Data = val.split(',')[1];
      if (!base64Data) return false;
      const estimatedBytes = base64Data.length * 0.75;
      return estimatedBytes <= MAX_IMAGE_SIZE_BYTES;
    },
    { message: `Image size exceeds ${MAX_IMAGE_SIZE_MB}MB limit` }
  );

// Validation schemas
export const GenerateBodySchema = z.object({
  prompt: z.string().min(1),
  
  /** @deprecated Use referenceImages instead */
  inputImage: base64ImageSchema.optional(),
  
  /** 参考图片数组 (最多5张) - 用于图生图模式 */
  referenceImages: z.array(base64ImageSchema)
    .max(MAX_REFERENCE_IMAGES, `Maximum ${MAX_REFERENCE_IMAGES} reference images allowed`)
    .optional(),
  
  /** 生成模式: text_to_image (文生图) | image_to_image (图生图/产品融合) */
  generationMode: z.enum(GENERATION_MODES).optional(),
  
  /** @deprecated 质量模式，建议使用 resolution 控制 */
  mode: z.enum(['draft', 'final']).optional(),
  
  resolution: z.enum(['0.5K', '1K', '2K', '4K']).optional(),
  aspectRatio: z.enum(['Auto', '1:1', '9:16', '16:9', '3:4', '4:3', '3:2', '2:3', '5:4', '4:5', '21:9', '9:21']).optional(),
  sampleCount: z.number().min(1).max(15).int().optional(),
  
  model: z.enum(['gemini-2.0-flash-exp-image-generation', 'gemini-2.5-flash-image-preview', 'gemini-3-pro-image-preview', 'gemini-3.1-flash-image-preview']).optional(),
  enableWebSearch: z.boolean().optional(),
  
  provider: z.enum(SUPPORTED_PROVIDERS).optional(),
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

  const provider = body.provider || 'gemini';
  
  // 合并 inputImage 和 referenceImages (兼容旧 API)
  let referenceImages = body.referenceImages || [];
  if (body.inputImage && referenceImages.length === 0) {
    referenceImages = [body.inputImage];
  }
  
  // 自动推断生成模式
  const generationMode = body.generationMode || (referenceImages.length > 0 ? 'image_to_image' : 'text_to_image');

  logger.info('Generate request', {
    tenantId: tenant.id,
    prompt: body.prompt.substring(0, 100),
    generationMode,
    provider,
    referenceImageCount: referenceImages.length,
    idempotencyKey,
  });

  // Create job (handles idempotency check)
  const job = await createJob({
    tenantId: tenant.id,
    idempotencyKey,
    prompt: body.prompt,
    inputImage: referenceImages[0],
    referenceImages,
    generationMode,
    mode: body.mode || 'final',
    resolution: body.resolution,
    aspectRatio: body.aspectRatio,
    sampleCount: body.sampleCount,
    provider,
    model: body.model,
    enableWebSearch: body.enableWebSearch,
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
