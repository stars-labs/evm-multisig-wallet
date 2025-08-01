// Route aggregation and setup
import { Router } from 'express';
import { ValidatorService } from '../../services/validatorService';
import { NetworkType } from '@multisig-validator/shared';
import { createWalletRoutes } from './wallets';
import { createHealthRoutes } from './health';

export const createApiRoutes = (validatorService: ValidatorService, monitoredNetworks: NetworkType[]) => {
  const router = Router();
  
  // Mount route modules
  router.use('/wallets', createWalletRoutes(validatorService, monitoredNetworks));
  router.use('/', createHealthRoutes(validatorService));
  
  // API info endpoint
  router.get('/', (req, res) => {
    res.json({
      success: true,
      message: 'MultiSig Validator Service API',
      version: '1.0.0',
      endpoints: {
        health: 'GET /health',
        metrics: 'GET /metrics',
        status: 'GET /status',
        wallets: {
          list: 'GET /api/wallets',
          add: 'POST /api/wallets',
          get: 'GET /api/wallets/:address?network=<network>',
          remove: 'DELETE /api/wallets/:address?network=<network>'
        }
      },
      monitoredNetworks
    });
  });
  
  return router;
};