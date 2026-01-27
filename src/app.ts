import express from 'express';
import routes from './api/routes';
import { createLogger } from './utils/logger';
import path from 'path';

const logger = createLogger('app');

export const app = express();

// CORS middleware - Allow all origins for development
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Idempotency-Key, X-API-Key');
  res.header('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  next();
});

// Body parser with raw body support for webhooks
app.use(express.json({
  verify: (req: any, _res, buf) => {
    req.rawBody = buf.toString('utf8');
  },
}));

// Request logging middleware
app.use((req, _res, next) => {
  logger.debug('Incoming request', {
    method: req.method,
    path: req.path,
    ip: req.ip,
  });
  next();
});

// Serve static files from public directory
app.use(express.static(path.join(process.cwd(), 'public')));

// Routes
app.use(routes);

// Root endpoint
app.get('/', (_req, res) => {
  res.json({
    name: 'Image SaaS API',
    version: '0.1.0',
    endpoints: {
      health: '/health',
      generate: '/v1/images/generate',
      jobs: '/v1/jobs',
      job: '/v1/jobs/:jobId',
    },
  });
});
