import { redis } from '../queue/redis';
import {
  LUA_SLIDING_WINDOW,
  LUA_CONCURRENCY,
  LUA_CONCURRENCY_RELEASE,
  LUA_KEY_HEALTH,
} from './limiter.lua';

// Cached SHA values for loaded scripts
let shaSliding: string | null = null;
let shaConc: string | null = null;
let shaConcRel: string | null = null;
let shaKeyHealth: string | null = null;

/**
 * Load all Lua scripts into Redis cache
 */
async function ensureLoaded() {
  if (!shaSliding) {
    shaSliding = (await redis.script('LOAD', LUA_SLIDING_WINDOW)) as string | null;
  }
  if (!shaConc) {
    shaConc = (await redis.script('LOAD', LUA_CONCURRENCY)) as string | null;
  }
  if (!shaConcRel) {
    shaConcRel = (await redis.script('LOAD', LUA_CONCURRENCY_RELEASE)) as string | null;
  }
  if (!shaKeyHealth) {
    shaKeyHealth = (await redis.script('LOAD', LUA_KEY_HEALTH)) as string | null;
  }
}

/**
 * Acquire RPM rate limit token using sliding window
 *
 * @param key - Redis key for the limiter
 * @param limit - Max requests allowed
 * @param windowSec - Window size in seconds (default: 60)
 * @returns Object with ok (boolean) and count (current request count)
 */
export async function acquireRpm(
  key: string,
  limit: number,
  windowSec = 60
): Promise<{ ok: boolean; count: number }> {
  await ensureLoaded();

  const now = Date.now();
  const windowMs = windowSec * 1000;

  const [ok, count] = (await redis.evalsha(
    shaSliding!,
    1,
    key,
    now,
    windowMs,
    limit
  )) as [number, number];

  return { ok: ok === 1, count };
}

/**
 * Acquire concurrency token
 *
 * @param key - Redis key for the limiter
 * @param limit - Max concurrent requests
 * @param ttlSec - TTL for the counter in seconds (default: 3600)
 * @returns Object with ok (boolean) and value (current in-flight count)
 */
export async function acquireConcurrency(
  key: string,
  limit: number,
  ttlSec = 3600
): Promise<{ ok: boolean; value: number }> {
  await ensureLoaded();

  const ttlMs = ttlSec * 1000;

  const [ok, value] = (await redis.evalsha(
    shaConc!,
    1,
    key,
    limit,
    ttlMs
  )) as [number, number];

  return { ok: ok === 1, value };
}

/**
 * Release concurrency token
 *
 * @param key - Redis key for the limiter
 * @returns New in-flight count
 */
export async function releaseConcurrency(key: string): Promise<number> {
  await ensureLoaded();

  const value = (await redis.evalsha(shaConcRel!, 1, key)) as number;
  return value;
}

/**
 * Check and update key health status
 *
 * @param keyId - Provider key ID
 * @param options - Configuration options
 * @returns Object with available (boolean) and cooldownUntil (timestamp or 0)
 */
export async function checkKeyHealth(
  keyId: string,
  options: {
    now?: number;
    cooldownMs?: number;
    failureThreshold?: number;
    incrementFailures?: boolean;
    resetOnSuccess?: boolean;
  } = {}
): Promise<{ available: boolean; cooldownUntil: number }> {
  await ensureLoaded();

  const {
    now = Date.now(),
    cooldownMs = 10 * 60 * 1000, // 10 minutes default
    failureThreshold = 5,
    incrementFailures = false,
    resetOnSuccess = false,
  } = options;

  const cooldownKey = `kp:${keyId}:cooldown_until`;
  const failureKey = `kp:${keyId}:failures`;

  const [available, cooldownUntil] = (await redis.evalsha(
    shaKeyHealth!,
    2,
    cooldownKey,
    failureKey,
    now,
    cooldownMs,
    failureThreshold,
    incrementFailures ? 1 : 0,
    resetOnSuccess ? 1 : 0
  )) as [number, number];

  return { available: available === 1, cooldownUntil };
}

/**
 * Get current in-flight count for a key
 */
export async function getInFlight(key: string): Promise<number> {
  const value = await redis.get(key);
  return value ? parseInt(value, 10) : 0;
}

/**
 * Get current RPM count for a key (approximate)
 */
export async function getRpmCount(key: string): Promise<number> {
  const count = await redis.zcard(key);
  return count;
}
