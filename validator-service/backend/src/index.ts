// Main entry point for MultiSig Validator Service
import dotenv from 'dotenv';
dotenv.config();

import { Database } from './database';
import { ValidatorService } from './services/validatorService';
import { ApiServer } from './api/server';
import { logger } from './utils/logger';
import { NetworkType } from '@multisig-validator/shared';
import config from './config';

// Parse monitored networks from environment
function parseMonitoredNetworks(): NetworkType[] {
  const networksEnv = process.env.MONITORED_NETWORKS || 'sepolia';
  const networkStrings = networksEnv.split(',').map(n => n.trim().toLowerCase());
  
  const validNetworks: NetworkType[] = [];
  
  for (const networkStr of networkStrings) {
    switch (networkStr) {
      case 'mainnet':
        validNetworks.push(NetworkType.MAINNET);
        break;
      case 'sepolia':
        validNetworks.push(NetworkType.SEPOLIA);
        break;
      case 'goerli':
        validNetworks.push(NetworkType.GOERLI);
        break;
      case 'polygon':
        validNetworks.push(NetworkType.POLYGON);
        break;
      case 'arbitrum':
        validNetworks.push(NetworkType.ARBITRUM);
        break;
      case 'localhost':
        validNetworks.push(NetworkType.LOCALHOST);
        break;
      default:
        logger.warn(`Unknown network type: ${networkStr}`);
    }
  }
  
  if (validNetworks.length === 0) {
    logger.warn('No valid networks specified, defaulting to Sepolia');
    validNetworks.push(NetworkType.SEPOLIA);
  }
  
  logger.info(`Configured to monitor networks: ${validNetworks.join(', ')}`);
  return validNetworks;
}

// ============================================================================
// MAIN APPLICATION CLASS
// ============================================================================

class ValidatorApp {
  private db: Database;
  private validatorService: ValidatorService;
  private apiServer?: ApiServer;
  private monitoredNetworks: NetworkType[];
  private shutdownHandlers: (() => Promise<void>)[] = [];
  
  constructor() {
    this.monitoredNetworks = parseMonitoredNetworks();
    this.db = new Database(logger);
    this.validatorService = new ValidatorService(
      this.db,
      logger,
      {
        networks: this.monitoredNetworks,
        syncInterval: config.blockchain.eventSync.syncInterval,
        enableValidation: true,
        autoProcessAlerts: true,
      }
    );
    
    // Initialize API server if enabled
    if (process.env.ENABLE_HEALTH_SERVER === 'true') {
      this.apiServer = new ApiServer(
        this.validatorService,
        logger,
        this.monitoredNetworks,
        {
          port: parseInt(process.env.HEALTH_PORT || '3002'),
          enableCors: process.env.ENABLE_CORS !== 'false',
          enableLogging: process.env.ENABLE_REQUEST_LOGGING !== 'false',
          corsOrigins: process.env.CORS_ORIGINS?.split(',')
        }
      );
    }
    
    this.setupEventHandlers();
    this.setupGracefulShutdown();
  }
  
  async start(): Promise<void> {
    try {
      logger.info('Starting MultiSig Validator Application');
      
      // Test database connection
      logger.info('Testing database connection...');
      const dbHealthy = await this.db.healthCheck();
      if (!dbHealthy) {
        throw new Error('Database connection failed');
      }
      logger.info('Database connection successful');
      
      // Start validator service
      logger.info('Starting validator service...');
      await this.validatorService.start();
      
      // Start API server if enabled
      if (this.apiServer) {
        logger.info('Starting API server...');
        await this.apiServer.start();
      }
      
      logger.info('✅ MultiSig Validator Application started successfully');
      
      // Log status
      const status = await this.validatorService.getStatus();
      logger.info('Service status', status);
      
    } catch (error) {
      logger.error('Failed to start application:', error);
      process.exit(1);
    }
  }
  
  async stop(): Promise<void> {
    logger.info('Stopping MultiSig Validator Application');
    
    try {
      // Stop API server first
      if (this.apiServer) {
        await this.apiServer.stop();
      }
      
      // Stop validator service
      await this.validatorService.stop();
      
      // Execute shutdown handlers
      for (const handler of this.shutdownHandlers) {
        await handler();
      }
      
      // Close database connection
      await this.db.close();
      
      logger.info('✅ Application stopped successfully');
      
    } catch (error) {
      logger.error('Error during shutdown:', error);
    }
  }
  
  
  private setupEventHandlers(): void {
    // Service events
    this.validatorService.on('started', () => {
      logger.info('Validator service started');
    });
    
    this.validatorService.on('stopped', () => {
      logger.info('Validator service stopped');
    });
    
    // Transaction events
    this.validatorService.on('transactionSubmitted', (data) => {
      logger.info('New transaction submitted', {
        wallet: data.wallet.address,
        transactionId: data.submission.transactionId,
        action: data.action,
        submitter: data.submission.submitter,
        value: data.submission.value,
      });
    });
    
    this.validatorService.on('transactionConfirmed', (data) => {
      logger.info('Transaction confirmed', {
        wallet: data.wallet.address,
        transactionId: data.confirmation.transactionId,
        confirmer: data.confirmation.confirmer,
      });
    });
    
    this.validatorService.on('transactionExecuted', (data) => {
      logger.info('Transaction executed', {
        wallet: data.wallet.address,
        transactionId: data.transactionId,
      });
    });
    
    // Owner events
    this.validatorService.on('ownerAdded', (data) => {
      logger.info('Owner added to wallet', {
        wallet: data.wallet.address,
        owner: data.change.owner,
      });
    });
    
    this.validatorService.on('ownerRemoved', (data) => {
      logger.info('Owner removed from wallet', {
        wallet: data.wallet.address,
        owner: data.change.owner,
      });
    });
    
    // Error events
    this.validatorService.on('processingError', (data) => {
      logger.error('Event processing error', {
        type: data.type,
        error: data.error,
      });
    });
    
    this.validatorService.on('eventListenerError', (error) => {
      logger.error('Event listener error:', error);
    });
    
    this.validatorService.on('walletError', (error) => {
      logger.error('Wallet monitoring error:', error);
    });
  }
  
  private setupGracefulShutdown(): void {
    // Handle process termination
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully`);
      await this.stop();
      process.exit(0);
    };
    
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception:', error);
      process.exit(1);
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection at:', promise, 'reason:', reason);
      process.exit(1);
    });
  }
  
  // Expose validator service for API access (backwards compatibility)
  get validator() {
    return this.validatorService;
  }
}

// ============================================================================
// APPLICATION STARTUP
// ============================================================================

async function main() {
  const app = new ValidatorApp();
  
  // Start the application
  await app.start();
  
  // Keep the process running
  process.stdin.resume();
}

// Run the application
if (require.main === module) {
  main().catch((error) => {
    logger.error('Application startup failed:', error);
    process.exit(1);
  });
}

export default ValidatorApp;