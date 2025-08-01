// Chain model for multi-chain configuration and sync state
import { NetworkType } from '@multisig-validator/shared';

export interface ChainModel {
  id: string;
  
  // Chain identification
  network: NetworkType;
  chainId: number;
  name: string;
  
  // Chain configuration
  rpcUrl: string;
  rpcBackupUrls: string[];
  
  // Block and sync configuration
  blockConfirmations: number;
  startBlock: number;
  lastProcessedBlock: number;
  
  // Rate limiting configuration
  rateLimitRps: number;
  rateLimitRpm: number;
  rateLimitBackoffMultiplier: number;
  rateLimitMaxBackoffMs: number;
  
  // Sync configuration
  syncIntervalMs: number;
  maxBlocksPerBatch: number;
  batchSize: number;
  
  // Chain status
  enabled: boolean;
  syncStatus: 'stopped' | 'running' | 'error' | 'paused';
  lastSyncAt?: Date;
  lastError?: string;
  lastErrorAt?: Date;
  
  // Health metrics
  consecutiveErrors: number;
  totalRequests: number;
  totalErrors: number;
  avgResponseTimeMs?: number;
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

export interface ChainSyncUpdate {
  lastProcessedBlock: number;
  syncStatus: 'stopped' | 'running' | 'error' | 'paused';
  lastSyncAt: Date;
  lastError?: string;
  consecutiveErrors?: number;
}

export interface ChainCreateRequest {
  network: NetworkType;
  chainId: number;
  name: string;
  rpcUrl: string;
  rpcBackupUrls?: string[];
  blockConfirmations?: number;
  startBlock?: number;
  rateLimitRps?: number;
  rateLimitRpm?: number;
  syncIntervalMs?: number;
  maxBlocksPerBatch?: number;
  enabled?: boolean;
}

export interface ChainUpdateRequest {
  rpcUrl?: string;
  rpcBackupUrls?: string[];
  blockConfirmations?: number;
  rateLimitRps?: number;
  rateLimitRpm?: number;
  syncIntervalMs?: number;
  maxBlocksPerBatch?: number;
  enabled?: boolean;
}