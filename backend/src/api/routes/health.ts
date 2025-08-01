// Health check and metrics routes
import { Router, Request, Response } from 'express';
import { ValidatorService } from '../../services/validatorService';
import { asyncHandler } from '../middleware/errorHandler';

export const createHealthRoutes = (validatorService: ValidatorService) => {
  const router = Router();
  
  // Health check endpoint
  router.get('/health', asyncHandler(async (req: Request, res: Response) => {
    const health = await validatorService.healthCheck();
    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
  }));
  
  // Metrics endpoint
  router.get('/metrics', asyncHandler(async (req: Request, res: Response) => {
    const metrics = await validatorService.getMetrics();
    res.json(metrics);
  }));
  
  // Status endpoint with detailed information
  router.get('/status', asyncHandler(async (req: Request, res: Response) => {
    const status = await validatorService.getStatus();
    res.json({
      success: true,
      data: status
    });
  }));
  
  return router;
};