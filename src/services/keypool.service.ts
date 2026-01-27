import { prisma } from '../db/prisma';
import { redis } from '../queue/redis';
import { checkKeyHealth, getInFlight } from './limiter.service';
import { ProviderKeyCooldownError, ProviderKeyError } from '../utils/errors';
import { createLogger } from '../utils/logger';

const logger = createLogger('keypool');

export type PickedKey = {
  id: string;
  provider: string;
  secret: string; // Note: Should be decrypted in production
  rpm: number;
  conc: number;
};

/**
 * Pick the best available provider key
 *
 * Strategy:
 * 1. Filter out keys that are:
 *    - Disabled in DB
 *    - In cooldown period
 *    - At or over their concurrency limit
 * 2. Sort candidates by: least in-flight count
 * 3. Return the first available key
 */
export async function pickProviderKey(provider: string): Promise<PickedKey | null> {
  const keys = await prisma.providerKey.findMany({
    where: { provider, enabled: true },
  });

  if (!keys.length) {
    logger.warn('No enabled keys found', { provider });
    return null;
  }

  const now = Date.now();
  const candidates: Array<{
    key: PickedKey;
    inFlight: number;
    cooldownUntil: number;
  }> = [];

  // Filter and collect candidates
  for (const k of keys) {
    // Check cooldown status
    const health = await checkKeyHealth(k.id, { now });

    if (!health.available) {
      logger.debug('Key in cooldown', {
        keyId: k.id,
        cooldownUntil: new Date(health.cooldownUntil).toISOString(),
      });
      continue;
    }

    // Check current in-flight count
    const inFlightKey = `kp:${k.id}:inflight`;
    const inFlight = await getInFlight(inFlightKey);

    // Check if at concurrency limit
    if (inFlight >= k.concurrencyLimit) {
      logger.debug('Key at concurrency limit', {
        keyId: k.id,
        inFlight,
        limit: k.concurrencyLimit,
      });
      continue;
    }

    candidates.push({
      key: {
        id: k.id,
        provider: k.provider,
        secret: k.encryptedKey, // TODO: Decrypt using KMS
        rpm: k.rpmLimit,
        conc: k.concurrencyLimit,
      },
      inFlight,
      cooldownUntil: health.cooldownUntil,
    });
  }

  if (!candidates.length) {
    logger.warn('No available keys (all in cooldown or at limit)', { provider });
    return null;
  }

  // Sort by least in-flight (load balancing)
  candidates.sort((a, b) => a.inFlight - b.inFlight);

  const chosen = candidates[0].key;
  logger.info('Picked provider key', {
    keyId: chosen.id,
    inFlight: candidates[0].inFlight,
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
 * Get runtime stats for a key
 */
export async function getKeyStats(keyId: string) {
  const inFlight = await getInFlight(`kp:${keyId}:inflight`);

  // Get cooldown info
  const cooldownData = await redis.get(`kp:${keyId}:cooldown_until`);
  const cooldownUntil = cooldownData ? parseInt(cooldownData, 10) : 0;

  // Get failure count
  const failureData = await redis.get(`kp:${keyId}:failures`);
  const failures = failureData ? parseInt(failureData, 10) : 0;

  return {
    inFlight,
    cooldownUntil: cooldownUntil > 0 ? new Date(cooldownUntil).toISOString() : null,
    failures,
    isInCooldown: cooldownUntil > Date.now(),
  };
}
