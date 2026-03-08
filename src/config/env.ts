import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3000'),

  DATABASE_URL: z.string(),

  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Cloudflare R2 (optional)
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_PUBLIC_BASE_URL: z.string().optional(),

  // Alibaba Cloud OSS (optional)
  OSS_REGION: z.string().optional(),
  OSS_ENDPOINT: z.string().optional(),
  OSS_ACCESS_KEY_ID: z.string().optional(),
  OSS_ACCESS_KEY_SECRET: z.string().optional(),
  OSS_BUCKET_NAME: z.string().optional(),
  OSS_PUBLIC_BASE_URL: z.string().optional(),

  // Storage backend
  STORAGE_TYPE: z.enum(['local', 'r2', 'oss']).default('local'),
  STORAGE_PUBLIC_BASE_URL: z.string().optional(),
  PUBLIC_BASE_URL: z.string().default('http://localhost:3000'),

  // Webhook
  WEBHOOK_SIGNING_SECRET: z.string().default(''),

  // Gemini API (fallback keys, primary should be in DB)
  GEMINI_API_KEY_1: z.string().optional(),
  GEMINI_API_KEY_2: z.string().optional(),
  GEMINI_API_BASE: z.string().default('https://generativelanguage.googleapis.com'),
  GEMINI_MODEL: z.string().default('gemini-3-pro-image-preview'),
  GEMINI_FALLBACK_MODEL: z.string().default('gemini-2.5-flash-image-preview'),
  GEMINI_ENABLE_FALLBACK: z.string().default('true'),

  // Jimeng/Seedream API (火山方舟)
  JIMENG_API_KEY: z.string().optional(),
  JIMENG_MODEL: z.string().default('doubao-seedream-4-0-250828'),

  // Rate limits
  GLOBAL_RPM_LIMIT: z.string().default('1000'),
  GLOBAL_CONCURRENCY_LIMIT: z.string().default('200'),

  // Worker
  WORKER_CONCURRENCY: z.string().default('50'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.format());
  throw new Error('Invalid environment variables');
}

export const env = parsed.data;

export const config = {
  port: parseInt(env.PORT, 10),
  nodeEnv: env.NODE_ENV,
  redisUrl: env.REDIS_URL,

  storage: {
    type: env.STORAGE_TYPE,
    // Unified public URL for all storage backends.
    // Backward compatibility:
    // 1) STORAGE_PUBLIC_BASE_URL (new, preferred)
    // 2) PUBLIC_BASE_URL (legacy local/public URL)
    publicBaseUrl: env.STORAGE_PUBLIC_BASE_URL || env.PUBLIC_BASE_URL,
  },

  r2: env.R2_ACCOUNT_ID ? {
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    bucket: env.R2_BUCKET_NAME || 'images',
    // Backward compatibility:
    // 1) STORAGE_PUBLIC_BASE_URL (new, unified)
    // 2) R2_PUBLIC_BASE_URL (legacy)
    // 3) PUBLIC_BASE_URL (legacy fallback)
    publicBaseUrl: env.STORAGE_PUBLIC_BASE_URL || env.R2_PUBLIC_BASE_URL || env.PUBLIC_BASE_URL || '',
  } : null,

  oss: env.OSS_ENDPOINT ? {
    region: env.OSS_REGION || 'oss-cn-hangzhou',
    endpoint: env.OSS_ENDPOINT,
    accessKeyId: env.OSS_ACCESS_KEY_ID!,
    accessKeySecret: env.OSS_ACCESS_KEY_SECRET!,
    bucket: env.OSS_BUCKET_NAME || 'images',
    // Backward compatibility:
    // 1) STORAGE_PUBLIC_BASE_URL (new, unified)
    // 2) OSS_PUBLIC_BASE_URL (legacy)
    // 3) PUBLIC_BASE_URL (legacy fallback)
    publicBaseUrl: env.STORAGE_PUBLIC_BASE_URL || env.OSS_PUBLIC_BASE_URL || env.PUBLIC_BASE_URL || '',
  } : null,

  webhook: {
    signingSecret: env.WEBHOOK_SIGNING_SECRET,
  },

  gemini: {
    apiKey1: env.GEMINI_API_KEY_1,
    apiKey2: env.GEMINI_API_KEY_2,
    apiBase: env.GEMINI_API_BASE,
    model: env.GEMINI_MODEL,
  },

  jimeng: {
    apiKey: env.JIMENG_API_KEY,
    model: env.JIMENG_MODEL,
  },

  rateLimits: {
    globalRpm: parseInt(env.GLOBAL_RPM_LIMIT, 10),
    globalConcurrency: parseInt(env.GLOBAL_CONCURRENCY_LIMIT, 10),
  },

  worker: {
    concurrency: parseInt(env.WORKER_CONCURRENCY, 10),
  },
};
