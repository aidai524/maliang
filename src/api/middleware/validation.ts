import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../utils/errors';
import { createLogger } from '../../utils/logger';

const logger = createLogger('validation');

/**
 * Validate request body against a Zod schema
 */
export function validateBody<T extends z.ZodType>(schema: T) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = schema.safeParse(req.body);

      if (!result.success) {
        const errors = result.error.errors;
        logger.debug('Validation failed', { errors });

        throw new ValidationError(
          `Validation failed: ${errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        );
      }

      // Attach validated data to request
      (req as any).validatedBody = result.data;
      next();
    } catch (error) {
      if (error instanceof ValidationError) {
        res.status(400).json({
          error: error.code,
          message: error.message,
        });
      } else {
        res.status(500).json({
          error: 'VALIDATION_ERROR',
          message: 'Validation failed',
        });
      }
    }
  };
}

/**
 * Validate request params against a Zod schema
 */
export function validateParams<T extends z.ZodType>(schema: T) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = schema.safeParse(req.params);

      if (!result.success) {
        throw new ValidationError('Invalid path parameters');
      }

      (req as any).validatedParams = result.data;
      next();
    } catch (error) {
      if (error instanceof ValidationError) {
        res.status(400).json({
          error: error.code,
          message: error.message,
        });
      } else {
        res.status(500).json({
          error: 'VALIDATION_ERROR',
          message: 'Parameter validation failed',
        });
      }
    }
  };
}

/**
 * Validate request query against a Zod schema
 */
export function validateQuery<T extends z.ZodType>(schema: T) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = schema.safeParse(req.query);

      if (!result.success) {
        throw new ValidationError('Invalid query parameters');
      }

      (req as any).validatedQuery = result.data;
      next();
    } catch (error) {
      if (error instanceof ValidationError) {
        res.status(400).json({
          error: error.code,
          message: error.message,
        });
      } else {
        res.status(500).json({
          error: 'VALIDATION_ERROR',
          message: 'Query validation failed',
        });
      }
    }
  };
}
