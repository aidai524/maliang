// Lua scripts for precise distributed rate limiting
// These scripts are loaded into Redis once and executed by SHA for atomicity

/**
 * Sliding Window Rate Limiter
 *
 * Uses a sorted set (ZSET) to track request timestamps within a window.
 * Removes expired entries and checks if the count exceeds the limit.
 *
 * KEYS[1] = zset key (e.g., "lim:global:rpm")
 * ARGV[1] = current timestamp in milliseconds
 * ARGV[2] = window size in milliseconds
 * ARGV[3] = limit (max requests allowed)
 *
 * Returns: [allowed: 0/1, current_count: number]
 */
export const LUA_SLIDING_WINDOW = `
-- KEYS[1] = zset key
-- ARGV[1] = now_ms
-- ARGV[2] = window_ms
-- ARGV[3] = limit
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])

-- Remove entries outside the window
redis.call("ZREMRANGEBYSCORE", key, 0, now - window)

-- Get current count
local count = redis.call("ZCARD", key)

-- Check if limit exceeded
if count >= limit then
  return {0, count}
end

-- Add current request (use now + random to avoid collisions)
local member = tostring(now) .. "-" .. tostring(math.random(1, 1000000000))
redis.call("ZADD", key, now, member)
redis.call("PEXPIRE", key, window + 1000)

return {1, count + 1}
`;

/**
 * Concurrency Limiter (Acquire)
 *
 * Uses a simple counter to track in-flight requests.
 * Atomically increments and checks against limit.
 *
 * KEYS[1] = inflight key (e.g., "lim:global:inflight")
 * ARGV[1] = limit (max concurrent requests)
 * ARGV[2] = TTL in milliseconds (to prevent key leaks)
 *
 * Returns: [acquired: 0/1, current_value: number]
 */
export const LUA_CONCURRENCY = `
-- KEYS[1] = inflight key
-- ARGV[1] = limit
-- ARGV[2] = ttl_ms
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])

local v = redis.call("INCR", key)

-- Set expiration on first increment to prevent leaks
if v == 1 then
  redis.call("PEXPIRE", key, ttl)
end

-- Check if limit exceeded
if v > limit then
  redis.call("DECR", key)
  return {0, v}
end

return {1, v}
`;

/**
 * Concurrency Limiter (Release)
 *
 * Decrements the in-flight counter.
 * Ensures the value never goes below 0.
 *
 * KEYS[1] = inflight key
 *
 * Returns: new value (number)
 */
export const LUA_CONCURRENCY_RELEASE = `
-- KEYS[1] = inflight key
local key = KEYS[1]
local v = redis.call("DECR", key)

-- Prevent negative values (shouldn't happen in normal operation)
if v < 0 then
  redis.call("SET", key, 0)
  return 0
end

return v
`;

/**
 * Key Health Check with Cooldown
 *
 * Checks if a key is in cooldown period and updates its error stats.
 *
 * KEYS[1] = cooldown key (e.g., "kp:{keyId}:cooldown_until")
 * KEYS[2] = failure count key (e.g., "kp:{keyId}:failures")
 * ARGV[1] = current timestamp in milliseconds
 * ARGV[2] = cooldown duration in milliseconds
 * ARGV[3] = consecutive failures threshold
 * ARGV[4] = whether to increment failure count (1/0)
 * ARGV[5] = whether to reset on success (1/0)
 *
 * Returns: [available: 0/1, cooldown_until: 0 or timestamp]
 */
export const LUA_KEY_HEALTH = `
-- KEYS[1] = cooldown key
-- KEYS[2] = failure count key
-- ARGV[1] = now_ms
-- ARGV[2] = cooldown_ms
-- ARGV[3] = failure_threshold
-- ARGV[4] = increment_failures (1 or 0)
-- ARGV[5] = reset_on_success (1 or 0)
local cooldown_key = KEYS[1]
local failure_key = KEYS[2]
local now = tonumber(ARGV[1])
local cooldown_ms = tonumber(ARGV[2])
local threshold = tonumber(ARGV[3])
local should_inc = tonumber(ARGV[4]) == 1
local should_reset = tonumber(ARGV[5]) == 1

-- Get current cooldown time
local cooldown_until = tonumber(redis.call("GET", cooldown_key) or "0")

-- Check if still in cooldown
if cooldown_until > now then
  return {0, cooldown_until}
end

-- Handle failure counting
if should_inc then
  local failures = tonumber(redis.call("INCR", failure_key))
  redis.call("PEXPIRE", failure_key, 3600000) -- 1 hour

  -- Check if we should enter cooldown
  if failures >= threshold then
    local new_cooldown = now + cooldown_ms
    redis.call("SET", cooldown_key, tostring(new_cooldown), "PX", cooldown_ms)
    redis.call("DEL", failure_key)
    return {0, new_cooldown}
  end
  return {1, 0}
end

-- Handle success reset
if should_reset then
  redis.call("DEL", failure_key)
end

return {1, 0}
`;
