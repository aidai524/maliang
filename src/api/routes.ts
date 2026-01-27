import { Router } from 'express';
import { authTenant } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/errors';
import * as generateController from './controllers/generate.controller';

const router = Router();

// Health check (no auth required)
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Image generation routes
router.post('/v1/images/generate', authTenant, (req, res, next) => {
  generateController.generate(req, res).catch(next);
});

router.get('/v1/jobs/:jobId', authTenant, (req, res, next) => {
  generateController.getJob(req, res).catch(next);
});

router.get('/v1/jobs', authTenant, (req, res, next) => {
  generateController.listJobs(req, res).catch(next);
});

router.delete('/v1/jobs/:jobId', authTenant, (req, res, next) => {
  generateController.cancelJob(req, res).catch(next);
});

// Admin routes (TODO: add admin auth middleware)
// router.get('/admin/keys', adminAuth, ...);
// router.post('/admin/keys', adminAuth, ...);
// router.get('/admin/stats', adminAuth, ...);

// 404 handler
router.use(notFoundHandler);

// Error handler (must be last)
router.use(errorHandler);

export default router;
