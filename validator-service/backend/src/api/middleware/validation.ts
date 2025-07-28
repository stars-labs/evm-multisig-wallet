// Request validation middleware
import { Request, Response, NextFunction } from 'express';
import { NetworkType, WalletType } from '@multisig-validator/shared';
import { createApiError } from './errorHandler';

export const validateAddWallet = (req: Request, res: Response, next: NextFunction) => {
  const { address, network, name, type } = req.body;
  
  // Validate required fields
  if (!address || !network || !name) {
    throw createApiError('Missing required fields: address, network, name', 400);
  }
  
  // Validate address format
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw createApiError('Invalid Ethereum address format', 400);
  }
  
  // Validate network
  if (!Object.values(NetworkType).includes(network)) {
    throw createApiError(`Invalid network. Must be one of: ${Object.values(NetworkType).join(', ')}`, 400);
  }
  
  // Validate wallet type if provided
  if (type && !Object.values(WalletType).includes(type)) {
    throw createApiError(`Invalid wallet type. Must be one of: ${Object.values(WalletType).join(', ')}`, 400);
  }
  
  // Validate name length
  if (name.length < 1 || name.length > 255) {
    throw createApiError('Name must be between 1 and 255 characters', 400);
  }
  
  next();
};

export const validateNetworkSupport = (monitoredNetworks: NetworkType[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const { network } = req.body;
    
    if (network && !monitoredNetworks.includes(network)) {
      throw createApiError(
        `Network '${network}' is not being monitored. Monitored networks: ${monitoredNetworks.join(', ')}`,
        400
      );
    }
    
    next();
  };
};