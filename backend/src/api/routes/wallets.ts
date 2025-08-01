// Wallet management routes
import { Router, Request, Response } from 'express';
import { ValidatorService } from '../../services/validatorService';
import { NetworkType } from '@multisig-validator/shared';
import { asyncHandler, createApiError } from '../middleware/errorHandler';
import { validateAddWallet, validateNetworkSupport } from '../middleware/validation';

export const createWalletRoutes = (validatorService: ValidatorService, monitoredNetworks: NetworkType[]) => {
  const router = Router();
  
  // Add wallet endpoint
  router.post('/', 
    validateAddWallet,
    validateNetworkSupport(monitoredNetworks),
    asyncHandler(async (req: Request, res: Response) => {
      const { address, network, name, type } = req.body;
      
      try {
        await validatorService.addWallet(address, network, name, type);
        
        res.status(201).json({
          success: true,
          message: 'Wallet added successfully',
          data: { address, network, name, type }
        });
        
      } catch (error) {
        if (error instanceof Error) {
          if (error.message.includes('duplicate key')) {
            throw createApiError('Wallet already exists for this network', 409);
          }
          if (error.message.includes('Contract not found')) {
            throw createApiError('No contract found at the specified address', 404);
          }
          if (error.message.includes('Unable to detect contract type')) {
            throw createApiError('Could not detect MultiSig contract type at address', 400);
          }
        }
        throw error;
      }
    })
  );
  
  // List wallets endpoint
  router.get('/', asyncHandler(async (req: Request, res: Response) => {
    const { network } = req.query;
    
    // Validate network parameter if provided
    if (network && !Object.values(NetworkType).includes(network as NetworkType)) {
      throw createApiError(`Invalid network parameter. Must be one of: ${Object.values(NetworkType).join(', ')}`, 400);
    }
    
    // Get wallets from both in-memory (event listener) and database for comparison
    const inMemoryWallets = validatorService.getMonitoredWallets(network as NetworkType);
    const dbWallets = await validatorService.getWalletsFromDatabase(network as NetworkType);
    const status = await validatorService.getStatus();
    
    res.json({
      success: true,
      data: {
        wallets: dbWallets, // Use database as source of truth
        inMemoryWallets: inMemoryWallets.length, // For debugging
        monitoring: status.eventListener,
        totalWallets: dbWallets.length,
        byNetwork: dbWallets.reduce((acc, wallet) => {
          acc[wallet.network] = (acc[wallet.network] || 0) + 1;
          return acc;
        }, {} as Record<string, number>)
      }
    });
  }));
  
  // Remove wallet endpoint
  router.delete('/:address', asyncHandler(async (req: Request, res: Response) => {
    const { address } = req.params;
    const { network } = req.query;
    
    if (!network) {
      throw createApiError('Network query parameter is required', 400);
    }
    
    if (!Object.values(NetworkType).includes(network as NetworkType)) {
      throw createApiError(`Invalid network. Must be one of: ${Object.values(NetworkType).join(', ')}`, 400);
    }
    
    await validatorService.removeWallet(address, network as NetworkType);
    
    res.json({
      success: true,
      message: 'Wallet removed successfully',
      data: { address, network }
    });
  }));
  
  // Get wallet details endpoint
  router.get('/:address', asyncHandler(async (req: Request, res: Response) => {
    const { address } = req.params;
    const { network } = req.query;
    
    if (!network) {
      throw createApiError('Network query parameter is required', 400);
    }
    
    if (!Object.values(NetworkType).includes(network as NetworkType)) {
      throw createApiError(`Invalid network. Must be one of: ${Object.values(NetworkType).join(', ')}`, 400);
    }
    
    const wallets = validatorService.getMonitoredWallets(network as NetworkType);
    const wallet = wallets.find(w => w.address.toLowerCase() === address.toLowerCase());
    
    if (!wallet) {
      throw createApiError('Wallet not found in monitoring list', 404);
    }
    
    res.json({
      success: true,
      data: wallet
    });
  }));
  
  return router;
};