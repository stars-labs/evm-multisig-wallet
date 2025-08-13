// Main Validator Service - Integrates event listening, processing, and validation
import winston from 'winston';
import { EventEmitter } from 'events';
import { Database } from '../database';
import { MultiSigEventListener, WalletConfig } from '../blockchain/eventListener';
import { EventProcessor } from './eventProcessor';
import { NetworkType, WalletType } from '../types';

export interface ValidatorServiceConfig {
  networks: NetworkType[];
  syncInterval: number;
  enableValidation: boolean;
  autoProcessAlerts: boolean;
}

export class ValidatorService extends EventEmitter {
  private db: Database;
  private logger: winston.Logger;
  private eventListener: MultiSigEventListener;
  private eventProcessor: EventProcessor;
  private config: ValidatorServiceConfig;
  private isRunning: boolean = false;
  
  // Event processing queue to ensure proper ordering
  private eventQueue: Map<string, Array<() => Promise<void>>> = new Map();
  private processingLocks: Map<string, boolean> = new Map();
  
  constructor(
    db: Database,
    logger: winston.Logger,
    config: ValidatorServiceConfig
  ) {
    super();
    this.db = db;
    this.logger = logger;
    this.config = config;
    
    // Initialize components
    this.eventListener = new MultiSigEventListener(logger, db);
    this.eventProcessor = new EventProcessor(db, logger, {
      enableValidation: config.enableValidation,
      autoProcessAlerts: config.autoProcessAlerts,
      batchSize: 50,
    });
    
    this.setupEventHandlers();
  }
  
  // ============================================================================
  // SERVICE LIFECYCLE
  // ============================================================================
  
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Validator service is already running');
      return;
    }
    
    this.logger.info('Starting MultiSig Validator Service');
    
    try {
      // Check database connection
      const dbHealthy = await this.db.healthCheck();
      if (!dbHealthy) {
        throw new Error('Database connection failed');
      }
      
      // Load registered wallets from database
      await this.loadWalletsFromDatabase();
      
      // Start event listener
      await this.eventListener.start();
      
      this.isRunning = true;
      this.emit('started');
      
      this.logger.info('Validator service started successfully');
      
    } catch (error) {
      this.logger.error('Failed to start validator service:', error);
      throw error;
    }
  }
  
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }
    
    this.logger.info('Stopping MultiSig Validator Service');
    
    try {
      // Stop event listener
      await this.eventListener.stop();
      
      this.isRunning = false;
      this.emit('stopped');
      
      this.logger.info('Validator service stopped successfully');
      
    } catch (error) {
      this.logger.error('Error stopping validator service:', error);
      throw error;
    }
  }
  
  // ============================================================================
  // WALLET MANAGEMENT
  // ============================================================================
  
  async addWallet(
    address: string,
    network: NetworkType,
    name: string,
    type?: WalletType
  ): Promise<void> {
    try {
      // Detect wallet type if not provided
      if (!type) {
        const detectedType = await this.eventListener['contractFactory'].detectContractType(address, network);
        if (detectedType === 'unknown') {
          throw new Error(`Unable to detect contract type for ${address}`);
        }
        type = detectedType === 'MultiSigWalletWithDailyLimit' 
          ? WalletType.MULTISIG_WALLET_WITH_DAILY_LIMIT 
          : WalletType.MULTISIG_WALLET;
      }
      
      // Validate contract exists and fetch contract state
      const contract = this.eventListener['contractFactory'].getContract(address, network, type === WalletType.MULTISIG_WALLET_WITH_DAILY_LIMIT);
      const provider = this.eventListener['contractFactory'].getProvider(network);
      
      // Get rate limiter for this network
      const rateLimiter = this.eventListener['rateLimiters']?.get(network);
      
      // Fetch contract state from blockchain with rate limiting
      if (rateLimiter) {
        await rateLimiter.waitForRateLimit();
      }
      
      const [owners, required, balance, dailyLimit] = await Promise.all([
        contract.getOwners(),
        contract.getRequired(),
        provider.getBalance(address),
        type === WalletType.MULTISIG_WALLET_WITH_DAILY_LIMIT 
          ? contract.getDailyLimit().catch(() => null) 
          : Promise.resolve(null)
      ]);
      
      if (rateLimiter) {
        rateLimiter.onRequestSuccess();
      }
      
      this.logger.info('Fetched contract state from blockchain', {
        address,
        network,
        owners: owners.length,
        required: Number(required),
        balance: balance.toString(),
        dailyLimit: dailyLimit?.toString() || null
      });
      
      // Store wallet in database with fetched state
      await this.db.query(`
        INSERT INTO wallets (
          address, name, network, type, owners, required, daily_limit, balance, 
          monitored, alert_thresholds, contact_list, notification_channels, registered_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (address, network) 
        DO UPDATE SET 
          name = EXCLUDED.name,
          owners = EXCLUDED.owners,
          required = EXCLUDED.required,
          daily_limit = EXCLUDED.daily_limit,
          balance = EXCLUDED.balance,
          last_sync = NOW()
      `, [
        address,
        name,
        network,
        type,
        JSON.stringify(owners),
        Number(required),
        dailyLimit ? dailyLimit.toString() : null,
        balance.toString(),
        true, // monitored
        JSON.stringify({}), // default alert thresholds
        JSON.stringify([]), // default contact list
        JSON.stringify(['email']), // default notification channels
        'api' // registered_by
      ]);
      
      // Populate owners table with current contract owners
      for (const ownerAddress of owners) {
        try {
          await this.db.query(`
            INSERT INTO owners (
              address, network, first_seen, wallets, transaction_count,
              risk_level, confidence_score, status
            ) VALUES ($1, $2, NOW(), $3, 0, 'medium', 50, 'active')
            ON CONFLICT (address, network) 
            DO UPDATE SET 
              wallets = CASE 
                WHEN NOT (owners.wallets::jsonb @> $4::jsonb)
                THEN (owners.wallets::jsonb || $4::jsonb)
                ELSE owners.wallets::jsonb 
              END,
              updated_at = NOW()
          `, [
            ownerAddress,
            network,
            JSON.stringify([address]), // Initialize with this wallet for new records
            JSON.stringify([address])  // Add this wallet to existing records if not present
          ]);
          
          this.logger.debug('Owner record updated', { 
            owner: ownerAddress, 
            wallet: address, 
            network 
          });
          
        } catch (error) {
          this.logger.error(`Failed to update owner record for ${ownerAddress}:`, error);
          // Continue processing other owners even if one fails
        }
      }
      
      this.logger.info('Updated owners table with contract owners', {
        wallet: address,
        network,
        ownersProcessed: owners.length
      });
      
      // Create wallet config for event listener
      const walletConfig: WalletConfig = {
        address,
        network,
        type,
        active: true,
      };
      
      // Add to event listener
      this.eventListener.addWallet(walletConfig);
      
      this.logger.info('Wallet added to monitoring and database', {
        address,
        network,
        type,
        owners: owners.length,
        required: Number(required),
        balance: balance.toString()
      });
      
      this.emit('walletAdded', { address, network, type, owners, required, balance });
      
    } catch (error) {
      this.logger.error(`Failed to add wallet ${address}:`, error);
      throw error;
    }
  }
  
  async removeWallet(address: string, network: NetworkType): Promise<void> {
    try {
      this.eventListener.removeWallet(address, network);
      
      this.logger.info('Wallet removed from monitoring', { address, network });
      
      this.emit('walletRemoved', { address, network });
      
    } catch (error) {
      this.logger.error(`Failed to remove wallet ${address}:`, error);
      throw error;
    }
  }
  
  getMonitoredWallets(network?: NetworkType): WalletConfig[] {
    return this.eventListener.getMonitoredWallets(network);
  }
  
  async getWalletsFromDatabase(network?: NetworkType): Promise<any[]> {
    try {
      let query = 'SELECT address, name, network, type, owners, required, balance, daily_limit, monitored, registered_at FROM wallets WHERE monitored = true';
      let params: any[] = [];
      
      if (network) {
        query += ' AND network = $1';
        params.push(network);
      } else {
        // Filter by monitored networks
        if (this.config.networks.length > 0) {
          const networkPlaceholders = this.config.networks.map((_, i) => `$${i + 1}`).join(',');
          query += ` AND network IN (${networkPlaceholders})`;
          params = [...this.config.networks];
        }
      }
      
      query += ' ORDER BY registered_at DESC';
      
      this.logger.debug('Database query:', { query, params });
      const wallets = await this.db.query(query, params);
      this.logger.debug('Wallets found:', wallets.length);
      return wallets;
      
    } catch (error) {
      this.logger.error('Failed to get wallets from database:', error);
      return [];
    }
  }
  
  // ============================================================================
  // STATUS AND METRICS
  // ============================================================================
  
  async getStatus(): Promise<{
    isRunning: boolean;
    eventListener: any;
    database: boolean;
    wallets: {
      total: number;
      byNetwork: Record<string, number>;
    };
  }> {
    const wallets = this.getMonitoredWallets();
    const walletsByNetwork = wallets.reduce((acc, wallet) => {
      acc[wallet.network] = (acc[wallet.network] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    return {
      isRunning: this.isRunning,
      eventListener: await this.eventListener.getStatus(),
      database: true, // TODO: Add proper health check
      wallets: {
        total: wallets.length,
        byNetwork: walletsByNetwork,
      },
    };
  }
  
  async getMetrics(): Promise<{
    events: {
      totalProcessed: number;
      recentEvents: number;
    };
    transactions: {
      pending: number;
      executed: number;
      failed: number;
    };
    alerts: {
      active: number;
      critical: number;
    };
  }> {
    try {
      // Get recent events count (last 24 hours)
      const recentEvents = await this.db.queryOne<{ count: number }>(
        `SELECT COUNT(*) as count 
         FROM transactions 
         WHERE submitted_at > NOW() - INTERVAL '24 hours'`
      );
      
      // Get transaction statistics
      const transactionStats = await this.db.query<{
        execution_status: string;
        count: number;
      }>(
        `SELECT execution_status, COUNT(*) as count 
         FROM transactions 
         GROUP BY execution_status`
      );
      
      // Get alert statistics
      const alertStats = await this.db.query<{
        status: string;
        priority: string;
        count: number;
      }>(
        `SELECT status, priority, COUNT(*) as count 
         FROM alerts 
         WHERE status = 'active'
         GROUP BY status, priority`
      );
      
      const transactions = {
        pending: 0,
        executed: 0,
        failed: 0,
      };
      
      transactionStats.forEach(stat => {
        if (stat.execution_status === 'pending') {
          transactions.pending = Number(stat.count);
        } else if (stat.execution_status === 'executed') {
          transactions.executed = Number(stat.count);
        } else if (stat.execution_status === 'failed') {
          transactions.failed = Number(stat.count);
        }
      });
      
      const alerts = {
        active: alertStats.reduce((sum, stat) => sum + Number(stat.count), 0),
        critical: alertStats
          .filter(stat => stat.priority === 'P1')
          .reduce((sum, stat) => sum + Number(stat.count), 0),
      };
      
      return {
        events: {
          totalProcessed: transactions.pending + transactions.executed + transactions.failed,
          recentEvents: Number(recentEvents?.count || 0),
        },
        transactions,
        alerts,
      };
      
    } catch (error) {
      this.logger.error('Failed to get metrics:', error);
      throw error;
    }
  }
  
  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================
  
  /**
   * Queue event processing to ensure proper ordering per wallet
   * This prevents confirmation events from being processed before submission events
   */
  private async queueEventProcessing(walletKey: string, eventProcessor: () => Promise<void>): Promise<void> {
    if (!this.eventQueue.has(walletKey)) {
      this.eventQueue.set(walletKey, []);
    }
    
    const queue = this.eventQueue.get(walletKey)!;
    queue.push(eventProcessor);
    
    this.logger.debug(`Queued event for wallet ${walletKey}, queue length: ${queue.length}`);
    
    // Process queue if not already processing for this wallet
    if (!this.processingLocks.get(walletKey)) {
      await this.processEventQueue(walletKey);
    }
  }
  
  /**
   * Process all queued events sequentially for a specific wallet
   */
  private async processEventQueue(walletKey: string): Promise<void> {
    if (this.processingLocks.get(walletKey)) {
      return; // Already processing
    }
    
    this.processingLocks.set(walletKey, true);
    
    try {
      const queue = this.eventQueue.get(walletKey);
      if (!queue) return;
      
      this.logger.debug(`Processing event queue for wallet ${walletKey}, ${queue.length} events`);
      
      while (queue.length > 0) {
        const eventProcessor = queue.shift()!;
        try {
          await eventProcessor();
          this.logger.debug(`Processed event for wallet ${walletKey}, remaining: ${queue.length}`);
        } catch (error) {
          this.logger.error(`Error processing queued event for wallet ${walletKey}:`, error);
          // Continue processing other events in the queue
        }
      }
      
      this.logger.debug(`Finished processing event queue for wallet ${walletKey}`);
    } finally {
      this.processingLocks.set(walletKey, false);
    }
  }
  
  /**
   * Generate a unique key for wallet to ensure per-wallet sequential processing
   */
  private getWalletKey(address: string, network: string): string {
    return `${network}:${address.toLowerCase()}`;
  }
  
  private setupEventHandlers(): void {
    // Transaction submission events
    this.eventListener.on('transactionSubmitted', async (data) => {
      this.logger.debug("-------------validatorService data:", data);
      this.logger.debug("-------------validatorService data.submission:", data.submission);
      
      const walletKey = this.getWalletKey(data.wallet.address, data.wallet.network);
      
      await this.queueEventProcessing(walletKey, async () => {
        try {
          await this.eventProcessor.processTransactionSubmission(
            data.wallet,
            data.event,
            data.submission,
            data.action
          );
          
          this.emit('transactionSubmitted', data);
          
        } catch (error) {
          this.logger.error('Failed to process transaction submission:', error);
          this.emit('processingError', { type: 'transactionSubmitted', error, data });
        }
      });
    });
    
    // Transaction confirmation events
    this.eventListener.on('transactionConfirmed', async (data) => {
      const walletKey = this.getWalletKey(data.wallet.address, data.wallet.network);
      
      await this.queueEventProcessing(walletKey, async () => {
        try {
          await this.eventProcessor.processTransactionConfirmation(
            data.wallet,
            data.event,
            data.confirmation
          );
          
          this.emit('transactionConfirmed', data);
          
        } catch (error) {
          this.logger.error('Failed to process transaction confirmation:', error);
          this.emit('processingError', { type: 'transactionConfirmed', error, data });
        }
      });
    });
    
    // Transaction execution events
    this.eventListener.on('transactionExecuted', async (data) => {
      const walletKey = this.getWalletKey(data.wallet.address, data.wallet.network);
      
      await this.queueEventProcessing(walletKey, async () => {
        try {
          await this.eventProcessor.processTransactionExecution(
            data.wallet,
            data.event,
            data.transactionId,
            data.executor
          );
          
          this.emit('transactionExecuted', data);
          
        } catch (error) {
          this.logger.error('Failed to process transaction execution:', error);
          this.emit('processingError', { type: 'transactionExecuted', error, data });
        }
      });
    });
    
    // Owner change events
    this.eventListener.on('ownerAdded', async (data) => {
      const walletKey = this.getWalletKey(data.wallet.address, data.wallet.network);
      
      await this.queueEventProcessing(walletKey, async () => {
        try {
          // Update database with new owner
          await this.eventProcessor.processOwnerAddition(
            data.wallet,
            data.owner,
            data.event.timestamp,
            data.event.transactionHash
          );
          
          // Process for notifications
          await this.eventProcessor.processOwnerChange(
            data.wallet,
            data.event,
            data.change
          );
          
          this.emit('ownerAdded', data);
          
        } catch (error) {
          this.logger.error('Failed to process owner addition:', error);
          this.emit('processingError', { type: 'ownerAdded', error, data });
        }
      });
    });
    
    this.eventListener.on('ownerRemoved', async (data) => {
      const walletKey = this.getWalletKey(data.wallet.address, data.wallet.network);
      
      await this.queueEventProcessing(walletKey, async () => {
        try {
          // Update database by removing owner
          await this.eventProcessor.processOwnerRemoval(
            data.wallet,
            data.owner,
            data.event.timestamp,
            data.event.transactionHash
          );
          
          // Process for notifications
          await this.eventProcessor.processOwnerChange(
            data.wallet,
            data.event,
            data.change
          );
          
          this.emit('ownerRemoved', data);
          
        } catch (error) {
          this.logger.error('Failed to process owner removal:', error);
          this.emit('processingError', { type: 'ownerRemoved', error, data });
        }
      });
    });
    
    // Requirement change events
    this.eventListener.on('requirementChanged', async (data) => {
      const walletKey = this.getWalletKey(data.wallet.address, data.wallet.network);
      
      await this.queueEventProcessing(walletKey, async () => {
        try {
          await this.eventProcessor.processRequirementChange(
            data.wallet,
            data.newRequirement,
            data.event.timestamp,
            data.event.transactionHash
          );
        } catch (error) {
          this.logger.error('Failed to process requirement change:', {
            error: error instanceof Error ? error.message : String(error),
            wallet: data.wallet.address,
            network: data.wallet.network,
            newRequirement: data.newRequirement
          });
        }
      });
    });
    
    // Event listener errors
    this.eventListener.on('error', (error) => {
      this.logger.error('Event listener error:', error);
      this.emit('eventListenerError', error);
    });
    
    this.eventListener.on('walletError', (error) => {
      this.logger.error('Wallet monitoring error:', error);
      this.emit('walletError', error);
    });
  }
  
  private async loadWalletsFromDatabase(): Promise<void> {
    try {
      // Only load wallets from configured networks
      const networkPlaceholders = this.config.networks.map((_, i) => `$${i + 1}`).join(',');
      const result = await this.db.query<{
        address: string;
        network: NetworkType;
        type: WalletType;
        monitored: boolean;
      }>(
        `SELECT address, network, type, monitored FROM wallets WHERE monitored = true AND network IN (${networkPlaceholders})`,
        this.config.networks
      );
      
      for (const wallet of result) {
        const walletConfig: WalletConfig = {
          address: wallet.address,
          network: wallet.network,
          type: wallet.type,
          active: wallet.monitored,
        };
        
        this.eventListener.addWallet(walletConfig);
      }
      
      this.logger.info(`Loaded ${result.length} wallets from database`);
      
    } catch (error) {
      this.logger.error('Failed to load wallets from database:', error);
      throw error;
    }
  }
  
  // ============================================================================
  // HEALTH CHECK
  // ============================================================================
  
  async healthCheck(): Promise<{
    status: 'healthy' | 'unhealthy';
    checks: {
      database: boolean;
      eventListener: boolean;
      service: boolean;
    };
    errors?: string[];
  }> {
    const errors: string[] = [];
    
    // Check database
    const dbHealthy = await this.db.healthCheck();
    if (!dbHealthy) {
      errors.push('Database connection failed');
    }
    
    // Check event listener
    const listenerStatus = await this.eventListener.getStatus();
    const listenerHealthy = listenerStatus.isRunning;
    if (!listenerHealthy) {
      errors.push('Event listener is not running');
    }
    
    // Check service
    const serviceHealthy = this.isRunning;
    if (!serviceHealthy) {
      errors.push('Validator service is not running');
    }
    
    const allHealthy = dbHealthy && listenerHealthy && serviceHealthy;
    
    return {
      status: allHealthy ? 'healthy' : 'unhealthy',
      checks: {
        database: dbHealthy,
        eventListener: listenerHealthy,
        service: serviceHealthy,
      },
      errors: errors.length > 0 ? errors : undefined,
    };
  }
}