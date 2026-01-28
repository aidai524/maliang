import { prisma } from '../db/prisma';
import { redis } from '../queue/redis';
import { checkKeyHealth, getInFlight } from './limiter.service';
import { createLogger } from '../utils/logger';
import { getEndpointConfig, getEndpointsForModel } from '../providers/gemini/endpoints';

const logger = createLogger('keypool');

export type PickedKey = {
  id: string;
  provider: string;
  endpoint: string;
  secret: string;
  rpm: number;
  conc: number;
  priority: number;
  failureRate: number;
  successCount: number;
  totalRequests: number;
  healthScore: number;
};

export type PickKeyOptions = {
  // Preferred endpoint (e.g., 'official', 'yunwu')
  preferredEndpoint?: string;
  // Allow fallback to other endpoints if preferred is unavailable
  allowFallback?: boolean;
  // Model being requested (used to find best endpoint)
  model?: string;
  // Exclude specific endpoints (e.g., after 503 error)
  excludeEndpoints?: string[];
};

/**
 * Pick the best available provider key based on:
 * 1. Endpoint priority (lower number = higher priority)
 * 2. Not in cooldown
 * 3. Has capacity (in-flight < concurrency limit)
 * 4. Lowest failure rate
 * 5. Least in-flight requests (load balancing)
 * 
 * Supports cross-endpoint load balancing and fallback
 */
export async function pickProviderKey(
  provider: string,
  options: PickKeyOptions = {}
): Promise<PickedKey | null> {
  const { 
    preferredEndpoint, 
    allowFallback = true, 
    model,
    excludeEndpoints = [],
  } = options;

  // Build query conditions
  const whereConditions: any = {
    provider,
    enabled: true,
  };

  // If preferred endpoint specified and no fallback allowed, restrict to that endpoint
  if (preferredEndpoint && !allowFallback) {
    whereConditions.endpoint = preferredEndpoint;
  }

  // Exclude specific endpoints (e.g., after 503)
  if (excludeEndpoints.length > 0) {
    whereConditions.endpoint = {
      notIn: excludeEndpoints,
    };
  }

  const keys = await prisma.providerKey.findMany({
    where: whereConditions,
    orderBy: [
      { priority: 'asc' },  // Lower priority number first
      { createdAt: 'asc' },
    ],
  });

  if (!keys.length) {
    logger.error('No enabled keys found for provider', { 
      provider, 
      preferredEndpoint,
      excludeEndpoints,
    });
    return null;
  }

  // Check each key's health and capacity
  const candidates = [];
  for (const key of keys) {
    const health = await checkKeyHealth(key.id);
    const inFlight = await getInFlight(`kp:${key.id}:inflight`);

    if (health.available && inFlight < key.concurrencyLimit) {
      // Get endpoint-level stats
      const endpointStats = await getEndpointStats(provider, key.endpoint);
      
      candidates.push({
        key: {
          id: key.id,
          provider: key.provider,
          endpoint: key.endpoint,
          secret: key.encryptedKey, // Note: This should be decrypted in production
          rpm: key.rpmLimit,
          conc: key.concurrencyLimit,
          priority: key.priority,
          failureRate: endpointStats.failureRate,
          successCount: endpointStats.successes,
          totalRequests: endpointStats.total,
          healthScore: endpointStats.healthScore,
        },
        inFlight,
        cooldownUntil: 0,
        isPreferred: key.endpoint === preferredEndpoint,
        // Check if this endpoint is preferred for the requested model
        isModelPreferred: model ? isEndpointPreferredForModel(key.endpoint, model) : false,
      });
    }
  }

  if (!candidates.length) {
    logger.error('No available keys (all in cooldown or at limit)', {
      provider,
      preferredEndpoint,
      totalKeys: keys.length,
    });
    return null;
  }

  // Sort candidates by multiple criteria
  candidates.sort((a, b) => {
    // 1. Prefer endpoint that's preferred for the model
    if (a.isModelPreferred !== b.isModelPreferred) {
      return a.isModelPreferred ? -1 : 1;
    }

    // 2. Prefer specified endpoint if provided
    if (a.isPreferred !== b.isPreferred) {
      return a.isPreferred ? -1 : 1;
    }

    // 3. Sort by priority (lower = better)
    if (a.key.priority !== b.key.priority) {
      return a.key.priority - b.key.priority;
    }

    // 4. Prefer endpoints with better health score
    const healthDiff = b.key.healthScore - a.key.healthScore;
    if (Math.abs(healthDiff) > 10) return healthDiff > 0 ? 1 : -1;

    // 5. Least in-flight requests (load balancing within same priority)
    const inFlightDiff = a.inFlight - b.inFlight;
    if (inFlightDiff !== 0) return inFlightDiff;

    // 6. Lower failure rate
    return a.key.failureRate - b.key.failureRate;
  });

  const chosen = candidates[0].key;
  const chosenInFlight = candidates[0].inFlight;

  logger.info('Picked provider key', {
    keyId: chosen.id,
    endpoint: chosen.endpoint,
    priority: chosen.priority,
    inFlight: chosenInFlight,
    healthScore: chosen.healthScore.toFixed(1),
    isPreferred: candidates[0].isPreferred,
    isModelPreferred: candidates[0].isModelPreferred,
    totalCandidates: candidates.length,
  });

  return chosen;
}

/**
 * Check if an endpoint is preferred for a specific model
 */
function isEndpointPreferredForModel(endpoint: string, model: string): boolean {
  const config = getEndpointConfig(endpoint);
  return config?.preferredModels?.includes(model) ?? false;
}

/**
 * Mark a provider key as failed (triggers cooldown after threshold)
 */
export async function markKeyFailure(
  keyId: string,
  consecutiveFailures: number
): Promise<void> {
  const threshold = 5; // Enter cooldown after 5 consecutive failures

  if (consecutiveFailures >= threshold) {
    const cooldownMs = 10 * 60 * 1000; // 10 minutes

    const health = await checkKeyHealth(keyId, {
      incrementFailures: true,
      cooldownMs,
      failureThreshold: threshold,
    });

    if (!health.available) {
      logger.warn('Key entered cooldown', {
        keyId,
        cooldownUntil: new Date(health.cooldownUntil).toISOString(),
      });
    }
  } else {
    await checkKeyHealth(keyId, { incrementFailures: true });
  }
}

/**
 * Mark a provider key as successful (resets failure counter)
 */
export async function markKeySuccess(keyId: string): Promise<void> {
  await checkKeyHealth(keyId, { resetOnSuccess: true });
}

/**
 * Get all provider keys (for admin/debugging)
 */
export async function getAllProviderKeys() {
  return prisma.providerKey.findMany({
    select: {
      id: true,
      provider: true,
      rpmLimit: true,
      concurrencyLimit: true,
      enabled: true,
      createdAt: true,
      updatedAt: true,
      // Don't return the encrypted key
    },
  });
}

/**
 * Get runtime stats for a key (success/failure rates, health score)
 */
export async function getKeyStats(keyId: string) {
  const inFlight = await getInFlight(`kp:${keyId}:inflight`);

  const cooldownData = await redis.get(`kp:${keyId}:cooldown_until`);
  const cooldownUntil = cooldownData ? parseInt(cooldownData, 10) : 0;

  const failureData = await redis.get(`kp:${keyId}:failures`);
  const failures = failureData ? parseInt(failureData, 10) : 0;

  const successData = await redis.get(`kp:${keyId}:successes`);
  const successes = successData ? parseInt(successData, 10) : 0;

  const total = failures + successes;
  const failureRate = total > 0 ? (failures / total) : 0;
  const successRate = total > 0 ? (successes / total) : 0;

  const healthScore = successRate * 100; // Health score 0-100

  return {
    inFlight,
    cooldownUntil,
    failures,
    successes,
    total,
    failureRate,
    successRate,
    healthScore,
    isInCooldown: cooldownUntil > Date.now(),
  };
}

/**
 * Get endpoint-level statistics (aggregated across all keys for that endpoint)
 */
export async function getEndpointStats(provider: string, endpoint: string) {
  const cacheKey = `ep:${provider}:${endpoint}`;
  
  const failureData = await redis.get(`${cacheKey}:failures`);
  const failures = failureData ? parseInt(failureData, 10) : 0;

  const successData = await redis.get(`${cacheKey}:successes`);
  const successes = successData ? parseInt(successData, 10) : 0;

  const total = failures + successes;
  const failureRate = total > 0 ? (failures / total) : 0;
  const successRate = total > 0 ? (successes / total) : 0;
  const healthScore = total > 0 ? successRate * 100 : 100; // Default to healthy if no data

  return {
    failures,
    successes,
    total,
    failureRate,
    successRate,
    healthScore,
  };
}

/**
 * Record endpoint-level success
 */
export async function markEndpointSuccess(provider: string, endpoint: string): Promise<void> {
  const cacheKey = `ep:${provider}:${endpoint}`;
  await redis.incr(`${cacheKey}:successes`);
  // Expire after 1 hour to keep stats fresh
  await redis.expire(`${cacheKey}:successes`, 3600);
  
  logger.debug('Endpoint success recorded', { provider, endpoint });
}

/**
 * Record endpoint-level failure
 */
export async function markEndpointFailure(
  provider: string, 
  endpoint: string,
  errorCode?: string
): Promise<void> {
  const cacheKey = `ep:${provider}:${endpoint}`;
  await redis.incr(`${cacheKey}:failures`);
  await redis.expire(`${cacheKey}:failures`, 3600);
  
  // Track 503 errors specifically for fallback logic
  if (errorCode === 'SERVICE_OVERLOAD') {
    await redis.incr(`${cacheKey}:503_count`);
    await redis.expire(`${cacheKey}:503_count`, 300); // 5 min window for 503 tracking
  }
  
  logger.debug('Endpoint failure recorded', { provider, endpoint, errorCode });
}

/**
 * Check if endpoint should be avoided due to high 503 rate
 */
export async function shouldAvoidEndpoint(provider: string, endpoint: string): Promise<boolean> {
  const cacheKey = `ep:${provider}:${endpoint}`;
  const count503 = await redis.get(`${cacheKey}:503_count`);
  const threshold = 3; // Avoid after 3 consecutive 503s in 5 min window
  
  return count503 ? parseInt(count503, 10) >= threshold : false;
}

/**
 * Get all endpoints with their current health status
 */
export async function getAllEndpointStats(provider: string) {
  const keys = await prisma.providerKey.findMany({
    where: { provider, enabled: true },
    select: { endpoint: true },
    distinct: ['endpoint'],
  });
  
  const stats = [];
  for (const { endpoint } of keys) {
    const endpointStats = await getEndpointStats(provider, endpoint);
    const shouldAvoid = await shouldAvoidEndpoint(provider, endpoint);
    
    stats.push({
      endpoint,
      ...endpointStats,
      shouldAvoid,
    });
  }
  
  return stats;
}

/**
 * Provider Key Error class
 */
export class ProviderKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderKeyError';
  }
}
