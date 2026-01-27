import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../db/prisma';
import { sha256Hex, timingSafeEqualHex } from '../../utils/crypto';
import { AuthError } from '../../utils/errors';
import { createLogger } from '../../utils/logger';

const logger = createLogger('auth');

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      tenant?: {
        id: string;
        name: string;
        planRpm: number;
        planConcurrency: number;
      };
    }
  }
}

/**
 * Extract API key from request headers
 *
 * Supports:
 * - Authorization: Bearer <key>
 * - X-API-Key: <key>
 */
function extractApiKey(req: Request): string | null {
  const authHeader = (req.headers['authorization'] || '') as string;
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  const xApiKey = req.headers['x-api-key'] as string;
  if (xApiKey) {
    return xApiKey.trim();
  }

  return null;
}

/**
 * Authenticate tenant by API key
 *
 * This middleware validates the API key and attaches tenant info to the request.
 */
export async function authTenant(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const apiKey = extractApiKey(req);

    if (!apiKey) {
      throw new AuthError('Missing API key');
    }

    const apiKeyHash = sha256Hex(apiKey);

    // Look up tenant by API key hash
    const tenant = await prisma.tenant.findFirst({
      where: { apiKeyHash },
      select: {
        id: true,
        name: true,
        planRpm: true,
        planConcurrency: true,
        apiKeyHash: true,  // Include for verification
      },
    });

    if (!tenant) {
      // Use timing-safe comparison to prevent timing attacks
      // even when the key doesn't exist
      timingSafeEqualHex(apiKeyHash, sha256Hex('dummy-key-for-timing'));
      throw new AuthError('Invalid API key');
    }

    // Verify using timing-safe comparison
    if (!timingSafeEqualHex(tenant.apiKeyHash, apiKeyHash)) {
      throw new AuthError('Invalid API key');
    }

    // Attach tenant to request
    req.tenant = tenant;

    logger.debug('Tenant authenticated', {
      tenantId: tenant.id,
      name: tenant.name,
    });

    next();
  } catch (error) {
    if (error instanceof AuthError) {
      res.status(401).json({ error: error.code, message: error.message });
    } else {
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Authentication failed' });
    }
  }
}

/**
 * Optional auth - attaches tenant if key is valid, but doesn't require it
 */
export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const apiKey = extractApiKey(req);

    if (!apiKey) {
      next();
      return;
    }

    const apiKeyHash = sha256Hex(apiKey);
    const tenant = await prisma.tenant.findFirst({
      where: { apiKeyHash },
      select: {
        id: true,
        name: true,
        planRpm: true,
        planConcurrency: true,
      },
    });

    if (tenant) {
      req.tenant = tenant;
    }

    next();
  } catch (error) {
    // For optional auth, don't fail on error
    next();
  }
}
