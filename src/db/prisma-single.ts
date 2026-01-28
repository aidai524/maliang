import { PrismaClient } from '@prisma/client';

const logger = {
  log: (msg: string, meta?: any) => console.log(`[prisma] ${msg}`, meta ?? ''),
  error: (msg: string, error?: any) => console.error(`[prisma] ${msg}`, error),
  warn: (msg: string) => console.warn(`[prisma] ${msg}`),
};

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
  logger.log('Using development prisma client (non-global)');
}

export default prisma;
export { PrismaClient };
