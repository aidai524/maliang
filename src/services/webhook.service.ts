import { hmacSha256Hex } from '../utils/crypto';
import { createLogger } from '../utils/logger';

const logger = createLogger('webhook');

export type WebhookPayload = {
  eventId: string;
  jobId: string;
  tenantId: string;
  status: 'SUCCEEDED' | 'FAILED';
  resultUrls?: string[];
  error?: { code: string; message: string } | null;
  timestamp: number;
};

export type WebhookSendOptions = {
  url: string;
  secret: string;
  payload: WebhookPayload;
  timeout?: number;
};

/**
 * Send a webhook notification
 */
export async function sendWebhook(options: WebhookSendOptions): Promise<void> {
  const { url, secret, payload, timeout = 10000 } = options;

  const body = JSON.stringify(payload);
  const signature = `sha256=${hmacSha256Hex(body, secret)}`;

  logger.info('Sending webhook', {
    url,
    eventId: payload.eventId,
    jobId: payload.jobId,
    status: payload.status,
  });

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': signature,
        'User-Agent': 'ImageSaaS-Webhook/1.0',
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const responseText = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${responseText}`);
    }

    logger.info('Webhook delivered successfully', {
      url,
      eventId: payload.eventId,
      status: response.status,
    });
  } catch (error) {
    logger.error('Webhook delivery failed', {
      url,
      eventId: payload.eventId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Verify a webhook signature
 * Use this when receiving webhooks from your provider
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string
): boolean {
  const expectedSig = `sha256=${hmacSha256Hex(rawBody, secret)}`;

  // Use timing-safe comparison
  const sigBuf = Buffer.from(signature, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');

  if (sigBuf.length !== expectedBuf.length) {
    return false;
  }

  // Constant-time comparison
  let result = 0;
  for (let i = 0; i < sigBuf.length; i++) {
    result |= sigBuf[i] ^ expectedBuf[i];
  }

  return result === 0;
}

/**
 * Check if webhook timestamp is within acceptable time window
 * (protects against replay attacks)
 */
export function isValidWebhookTimestamp(
  timestamp: number,
  windowMs: number = 5 * 60 * 1000 // 5 minutes
): boolean {
  const now = Date.now();
  const age = now - timestamp;
  return Math.abs(age) <= windowMs;
}
