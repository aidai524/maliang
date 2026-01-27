/**
 * Sleep for a specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Sleep with exponential backoff and jitter
 */
export function backoffSleep(attempt: number, baseMs: number = 2000): Promise<void> {
  // Exponential backoff with full jitter
  const maxMs = baseMs * Math.pow(2, attempt);
  const jitter = Math.random() * maxMs;
  const delay = Math.min(baseMs + jitter, 5 * 60 * 1000); // Cap at 5 minutes

  return sleep(delay);
}
