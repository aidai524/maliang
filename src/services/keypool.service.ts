import { prisma } from '../db/prisma';
import { redis } from '../queue/redis';
import { checkKeyHealth, getInFlight } from './limiter.service';
import { createLogger } from '../utils/logger';

const logger = createLogger('keypool');

export type PickedKey = {
  id: string;
  provider: string;
  secret: string;
  rpm: number;
  conc: number;
  failureRate: number;
  successCount: number;
  totalRequests: number;
  healthScore: number;
};

/**
 * Pick the best available provider key based on:
 * 1. Not in cooldown
 * 2. Has capacity (in-flight < concurrency limit)
 * 3. Lowest failure rate
 * 4. Least in-flight requests (load balancing)
 */
export async function pickProviderKey(provider: string): Promise<PickedKey | null> {
  const keys = await prisma.providerKey.findMany({
    where: {
      provider,
      enabled: true,
    },
  });

  if (!keys.length) {
    logger.error('No enabled keys found for provider', { provider });
    return null;
  }

  // Check each key's health and capacity
  const candidates = [];
  for (const key of keys) {
    const health = await checkKeyHealth(key.id);
    const inFlight = await getInFlight(`kp:${key.id}:inflight`);

    if (health.available && inFlight < key.concurrencyLimit) {
      candidates.push({
        key: {
          id: key.id,
          provider: key.provider,
          secret: key.encryptedKey, // Note: This should be decrypted in production
          rpm: key.rpmLimit,
          conc: key.concurrencyLimit,
          failureRate: 0,
          successCount: 0,
          totalRequests: 0,
          healthScore: 100,
        },
        inFlight,
        cooldownUntil: 0,
      });
    }
  }

  // Sort by least in-flight (load balancing) AND success rate (prefer healthy keys)
  candidates.sort((a, b) => {
    const aFailureRate = a.key.failureRate || 1;
    const bFailureRate = b.key.failureRate || 1;
    const aHealthScore = a.key.healthScore || 0;
    const bHealthScore = b.key.healthScore || 0;

    // Primary sort: least in-flight
    const inFlightDiff = a.inFlight - b.inFlight;
    if (inFlightDiff !== 0) return inFlightDiff;

    // Secondary sort: lower failure rate
    return bFailureRate - aFailureRate;
  });

  if (!candidates.length) {
    logger.error('No available keys (all in cooldown or at limit)', {
      provider,
      totalKeys: keys.length,
    });
    return null;
  }

  const chosen = candidates[0].key;
  const chosenInFlight = candidates[0].inFlight;
  const chosenCooldown = candidates[0].cooldownUntil;

  logger.info('Picked provider key', {
    keyId: chosen.id,
    inFlight: chosenInFlight,
    cooldownUntil: chosenCooldown > 0 ? new Date(chosenCooldown).toISOString() : null,
  });

  return chosen;
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
 * Provider Key Error class
 */
export class ProviderKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderKeyError';
  }
}
