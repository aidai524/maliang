import { redis } from '../queue/redis';
import { createLogger } from '../utils/logger';
import { geminiGenerate } from '../providers/gemini/client';

const logger = createLogger('request-cache');

/**
 * Request Cache Service
 * 
 * 功能：
 * 1. 基于prompt哈希的缓存相同请求的缓存结果
 * 2. 自动24小时过期
 * 3. 支持draft/final模式区分
 * 4. 支持resolution、aspectRatio、sampleCount参数
 */

const CACHE_PREFIX = 'rc:gemini:';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24小时
const DEFAULT_EXPIRY_INTERVAL = 30 * 1000; // 30秒重试缓存未命中

export interface CachedResult {
  promptHash: string;
  prompt: string;
  images: string[];
  status: 'SUCCEEDED' | 'FAILED' | 'CACHED';
  createdAt: number;
  cacheKey: string;
  expiresAt: number;
  model?: string;
  resolution?: '1K' | '2K';
  aspectRatio?: string;
  sampleCount?: number;
  failureReason?: string;
}

/**
 * 计算prompt哈希（包含所有影响缓存结果的参数）
 */
function calculatePromptHash(
  prompt: string,
  model?: string,
  resolution?: string,
  aspectRatio?: string,
  sampleCount?: number
): string {
  const parts = [
    prompt,
    model || '',
    resolution || '',
    aspectRatio || '',
    sampleCount?.toString() || ''
  ].filter(Boolean);
  const hashInput = parts.join(':');
  const hash = require('crypto').createHash('sha256').update(hashInput).digest('hex');
  return hash;
}

/**
 * 生成缓存键
 */
function generateCacheKey(
  prompt: string,
  model?: string,
  resolution?: string,
  aspectRatio?: string,
  sampleCount?: number
): string {
  const parts = [
    prompt,
    model || '',
    resolution || '',
    aspectRatio || '',
    sampleCount?.toString() || ''
  ].filter(Boolean);
  const hash = calculatePromptHash(prompt, model, resolution, aspectRatio, sampleCount);
  
  return `${CACHE_PREFIX}${hash}`;
}

/**
 * 从缓存获取结果
 */
async function getCachedResult(
  cacheKey: string
): Promise<CachedResult | null> {
  try {
    const cached = await redis.get(cacheKey);
    
    if (!cached) {
      logger.debug('Cache miss', { cacheKey });
      return null;
    }
    
    const entry = JSON.parse(cached) as any;
    
    if (!entry || !entry.images || entry.images.length === 0) {
      logger.warn('Cached result has no images', { cacheKey });
      return {
        promptHash: '',
        prompt: '',
        images: [],
        status: 'FAILED',
        createdAt: Date.now(),
        cacheKey,
        expiresAt: 0,
        failureReason: 'No images in cached result',
      };
    }
    
    return {
      promptHash: entry.promptHash,
      prompt: entry.prompt,
      images: entry.images,
      status: entry.status,
      createdAt: Date.now(),
      cacheKey,
      expiresAt: entry.expiresAt || 0,
      model: entry.model,
      resolution: entry.resolution,
      aspectRatio: entry.aspectRatio,
      sampleCount: entry.sampleCount,
    };
  } catch (error) {
    logger.error('Failed to get cached result', { cacheKey, error });
    return null;
  }
}

/**
 * 缓存新结果到缓存
 */
async function cacheResult(
  result: CachedResult
): Promise<void> {
  if (!result.images || result.images.length === 0) {
    logger.warn('Cannot cache result without images', { prompt: result.prompt });
    return;
  }
  
  const cacheKey = generateCacheKey(
    result.promptHash,
    result.model,
    result.resolution,
    result.aspectRatio,
    result.sampleCount
  );
  
  const entry = {
    ...result,
    status: result.status,
    createdAt: Date.now(),
    cacheKey,
    expiresAt: Date.now() + CACHE_TTL,
  };

  await redis.set(cacheKey, JSON.stringify(entry));
  await redis.pexpire(cacheKey, CACHE_TTL);
  logger.info('Result cached', { 
    cacheKey,
    prompt: result.promptHash,
    images: result.images.length,
    status: result.status,
    expiresAt: new Date(Date.now() + CACHE_TTL).toISOString(),
  });
}

/**
 * 清理过期缓存
 */
export async function clearExpiredCache(): Promise<void> {
  try {
    const keys = await redis.keys(`${CACHE_PREFIX}*`);
    const now = Date.now();
    let clearedCount = 0;

    for (const key of keys) {
      if (key.includes(CACHE_PREFIX)) {
        const ttl = await redis.pttl(key);

        if (ttl !== -2 && ttl !== -1 && ttl < now - CACHE_TTL) {
          const remainingTime = Math.floor((ttl - now) / 1000).toFixed(0);
          logger.info(`Deleting expired cache entry`, { key, remainingTime: `${remainingTime}s` });
          await redis.del(key);
          clearedCount++;
        }
      }
    }

    logger.info(`Cleared ${clearedCount} expired cache entries`);
  } catch (error) {
    logger.error('Failed to clear expired cache', { error });
  }
}

/**
 * 智能缓存决策：是否使用缓存
 */
export function shouldUseCache(
  prompt: string,
  mode: string = 'final'
): boolean {
  // Draft模式不使用缓存（用户可能需要最新结果）
  if (mode === 'draft') {
    logger.debug('Draft mode - skipping cache');
    return false;
  }
  
  // 简单prompt（少于10字符）不使用缓存（快速请求）
  if (prompt.length < 10) {
    logger.debug('Short prompt - skipping cache');
    return false;
  }
  
  // 总是使用缓存
  return true;
}

/**
 * 更新缓存的失败原因
 */
export async function updateCacheFailureReason(
  cacheKey: string,
  reason: string
): Promise<void> {
  try {
    const cached = await redis.get(cacheKey);
    
    if (cached) {
      const entry = JSON.parse(cached) as any;
      entry.failureReason = reason;
      await redis.set(cacheKey, JSON.stringify(entry), 'PX', CACHE_TTL);
      logger.info('Updated cache failure reason', { cacheKey, reason });
    } else {
      logger.warn('Cache key not found', { cacheKey });
    }
  } catch (error) {
    logger.error('Failed to update failure reason', { cacheKey, error });
  }
}

/**
 * 获取缓存统计
 */
export async function getCacheStats(): Promise<{
  totalEntries: number;
  hitCount: number;
  missCount: number;
  expiredCount: number;
}> {
  try {
    const keys = await redis.keys(`${CACHE_PREFIX}*`);
    const now = Date.now();
    
    let totalEntries = 0;
    let hitCount = 0;
    let missCount = 0;
    let expiredCount = 0;
    
    for (const key of keys) {
      if (key.includes(CACHE_PREFIX)) {
        const ttl = await redis.pttl(key);
        const cached = await redis.get(key);
        
        if (cached && ttl && ttl < now - CACHE_TTL) {
          expiredCount++;
        } else {
          totalEntries++;
          if (cached) {
            hitCount++;
          } else {
            missCount++;
          }
        }
      }
    }
    
    const stats = { totalEntries, hitCount, missCount, expiredCount };
    
    logger.info('Cache stats', {
      ...stats,
      hitRate: totalEntries > 0 ? `${(hitCount / totalEntries * 100).toFixed(2)}%` : '0%',
      missRate: totalEntries > 0 ? `${(missCount / totalEntries * 100).toFixed(2)}%` : '0%',
      expiredRate: totalEntries > 0 ? `${(expiredCount / totalEntries * 100).toFixed(2)}%` : '0%',
    });
    
    return stats;
  } catch (error) {
    logger.error('Failed to get cache stats', { error });
    throw error;
  }
}

/**
 * 清理所有缓存
 */
export async function clearAllCache(): Promise<void> {
  try {
    const keys = await redis.keys(`${CACHE_PREFIX}*`);

    if (!keys.length) {
      logger.info('No cache entries to clear');
      return;
    }

    let clearedCount = 0;

    for (const key of keys) {
      if (key.includes(CACHE_PREFIX)) {
        await redis.del(key);
        clearedCount++;
      }
    }

    logger.info(`Cleared ${clearedCount} cache entries`);
  } catch (error) {
    logger.error('Failed to clear all cache', { error });
  }
}

/**
 * 检查缓存中是否有结果
 */
export async function checkCache(
  prompt: string,
  options: {
    mode?: string;
    resolution?: string;
    aspectRatio?: string;
    sampleCount?: number;
  }
): Promise<string[] | null> {
  if (!shouldUseCache(prompt, options?.mode)) {
    return null;
  }

  const cacheKey = generateCacheKey(
    prompt,
    undefined, // model
    options?.resolution,
    options?.aspectRatio,
    options?.sampleCount
  );

  const cached = await getCachedResult(cacheKey);

  if (cached && cached.status === 'SUCCEEDED' && cached.images?.length > 0) {
    // 检查过期
    if (Date.now() > cached.expiresAt) {
      logger.warn('Cache expired', {
        promptHash: cached.promptHash,
        expiresAt: new Date(cached.expiresAt).toISOString(),
      });
      await redis.del(cacheKey);
      return null;
    }

    logger.info('Cache hit!', {
      promptHash: cached.promptHash,
      imagesCount: cached.images.length,
      cacheKey,
    });

    return cached.images;
  }

  return null;
}

/**
 * 保存生成结果到缓存
 */
export async function saveToCache(
  prompt: string,
  images: string[],
  options: {
    mode?: string;
    resolution?: string;
    aspectRatio?: string;
    sampleCount?: number;
    model?: string;
  }
): Promise<void> {
  if (!shouldUseCache(prompt, options?.mode)) {
    return;
  }

  if (!images || images.length === 0) {
    logger.warn('Cannot cache empty images array');
    return;
  }

  const promptHash = calculatePromptHash(
    prompt,
    options?.model,
    options?.resolution,
    options?.aspectRatio,
    options?.sampleCount
  );

  const cacheKey = generateCacheKey(
    prompt,
    undefined, // model
    options?.resolution,
    options?.aspectRatio,
    options?.sampleCount
  );

  const result: CachedResult = {
    promptHash,
    prompt,
    images,
    status: 'SUCCEEDED',
    createdAt: Date.now(),
    cacheKey,
    expiresAt: Date.now() + CACHE_TTL,
    model: options?.model,
    resolution: options?.resolution as '1K' | '2K',
    aspectRatio: options?.aspectRatio,
    sampleCount: options?.sampleCount,
  };

  await cacheResult(result);
}