type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = LOG_LEVEL[process.env.LOG_LEVEL || 'info'] ?? 1;

function formatMessage(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}`;
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => {
    if (currentLevel <= 0) {
      console.log(formatMessage('debug', message, meta));
    }
  },
  info: (message: string, meta?: Record<string, unknown>) => {
    if (currentLevel <= 1) {
      console.info(formatMessage('info', message, meta));
    }
  },
  warn: (message: string, meta?: Record<string, unknown>) => {
    if (currentLevel <= 2) {
      console.warn(formatMessage('warn', message, meta));
    }
  },
  error: (message: string, meta?: Record<string, unknown>) => {
    if (currentLevel <= 3) {
      console.error(formatMessage('error', message, meta));
    }
  },
};

// Create child logger with context
export function createLogger(context: string) {
  return {
    debug: (message: string, meta?: Record<string, unknown>) => {
      logger.debug(message, { ...meta, context });
    },
    info: (message: string, meta?: Record<string, unknown>) => {
      logger.info(message, { ...meta, context });
    },
    warn: (message: string, meta?: Record<string, unknown>) => {
      logger.warn(message, { ...meta, context });
    },
    error: (message: string, meta?: Record<string, unknown>) => {
      logger.error(message, { ...meta, context });
    },
  };
}
