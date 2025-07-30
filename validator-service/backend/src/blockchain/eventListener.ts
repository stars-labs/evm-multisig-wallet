// Web3 Event Listener for MultiSig wallet monitoring
import { ethers } from 'ethers';
import { EventEmitter } from 'events';
import winston from 'winston';
import { 
  MultiSigContract, 
  ContractFactory, 
  MultiSigEvent,
  SubmissionEvent,
  ConfirmationEvent,
  ExecutionEvent,
  OwnerAdditionEvent,
  OwnerRemovalEvent
} from './contracts';
import { 
  NetworkType, 
  WalletType,
  TransactionAction 
} from '@multisig-validator/shared';
import config from '../config';
import { RateLimiter } from '../utils/rateLimiter';
import { ChainService } from '../services/chainService';
import { Database } from '../database';

// ============================================================================
// EVENT LISTENER CONFIGURATION
// ============================================================================

export interface EventListenerConfig {
  networks: string[];
  syncInterval: number;
  batchSize: number;
  maxBlocksPerBatch: number;
  startBlock: number;
  confirmationsRequired: Record<string, number>;
}

export interface WalletConfig {
  address: string;
  network: NetworkType;
  type: WalletType;
  startBlock?: number;
  active: boolean;
}

// ============================================================================
// PROCESSED EVENT INTERFACES
// ============================================================================

export interface ProcessedEvent {
  id: string;
  walletAddress: string;
  network: NetworkType;
  eventType: string;
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
  timestamp: Date;
  data: Record<string, any>;
  processed: boolean;
}

export interface TransactionSubmissionData {
  transactionId: number;
  submitter: string;
  destination?: string;
  value: string;
  data: string;
  blockNumber: number;
  transactionHash: string;
  timestamp: Date;
}

export interface TransactionConfirmationData {
  transactionId: number;
  confirmer: string;
  blockNumber: number;
  transactionHash: string;
  timestamp: Date;
}

export interface OwnerChangeData {
  changeType: 'addition' | 'removal' | 'replacement';
  owner: string;
  newOwner?: string;
  blockNumber: number;
  transactionHash: string;
  timestamp: Date;
}

// ============================================================================
// EVENT LISTENER CLASS
// ============================================================================

export class MultiSigEventListener extends EventEmitter {
  private contractFactory: ContractFactory;
  private logger: winston.Logger;
  private chainService: ChainService;
  private wallets: Map<string, WalletConfig> = new Map();
  private isRunning: boolean = false;
  private syncIntervals: Map<string, NodeJS.Timeout> = new Map();
  private processingLock: Map<string, boolean> = new Map();
  private rateLimiters: Map<string, RateLimiter> = new Map();
  
  constructor(logger: winston.Logger, db: Database) {
    super();
    this.logger = logger;
    this.contractFactory = new ContractFactory(config.blockchain.networks);
    this.chainService = new ChainService(db, logger);
  }
  
  // ============================================================================
  // WALLET MANAGEMENT
  // ============================================================================
  
  addWallet(walletConfig: WalletConfig): void {
    const key = this.getWalletKey(walletConfig.address, walletConfig.network);
    this.wallets.set(key, walletConfig);
    
    this.logger.info('Added wallet for monitoring', {
      address: walletConfig.address,
      network: walletConfig.network,
      type: walletConfig.type,
    });
    
    // Start monitoring if listener is running
    if (this.isRunning) {
      this.startNetworkMonitoring(walletConfig.network);
    }
  }
  
  removeWallet(address: string, network: NetworkType): void {
    const key = this.getWalletKey(address, network);
    this.wallets.delete(key);
    
    this.logger.info('Removed wallet from monitoring', { address, network });
    
    // Stop network monitoring if no more wallets on this network
    const hasWalletsOnNetwork = Array.from(this.wallets.values())
      .some(w => w.network === network);
    
    if (!hasWalletsOnNetwork) {
      this.stopNetworkMonitoring(network);
    }
  }
  
  getMonitoredWallets(network?: NetworkType): WalletConfig[] {
    const wallets = Array.from(this.wallets.values());
    return network ? wallets.filter(w => w.network === network) : wallets;
  }
  
  // ============================================================================
  // LISTENER CONTROL
  // ============================================================================
  
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Event listener is already running');
      return;
    }
    
    this.logger.info('Starting MultiSig event listener');
    this.isRunning = true;
    
    // Start monitoring for each network that has wallets
    const networks = new Set(
      Array.from(this.wallets.values()).map(w => w.network)
    );
    
    for (const network of networks) {
      await this.startNetworkMonitoring(network);
    }
    
    this.emit('started');
  }
  
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }
    
    this.logger.info('Stopping MultiSig event listener');
    this.isRunning = false;
    
    // Clear all sync intervals
    for (const [network, interval] of this.syncIntervals) {
      clearInterval(interval);
      this.syncIntervals.delete(network);
    }
    
    this.emit('stopped');
  }
  
  // ============================================================================
  // NETWORK MONITORING
  // ============================================================================
  
  private async startNetworkMonitoring(network: NetworkType): Promise<void> {
    if (this.syncIntervals.has(network)) {
      return; // Already monitoring this network
    }
    
    this.logger.info(`Starting monitoring for network: ${network}`);
    
    // Get chain configuration from database
    const chainConfig = await this.chainService.getChainByNetwork(network);
    if (!chainConfig) {
      this.logger.error(`No chain configuration found for ${network}`);
      return;
    }
    
    // Initialize rate limiter with chain-specific settings
    this.rateLimiters.set(network, new RateLimiter(
      {
        requestsPerSecond: chainConfig.rateLimitRps,
        requestsPerMinute: chainConfig.rateLimitRpm,
        backoffMultiplier: chainConfig.rateLimitBackoffMultiplier,
        maxBackoffTime: chainConfig.rateLimitMaxBackoffMs
      },
      this.logger
    ));
    
    // Initialize last processed block if not set
    if (chainConfig.lastProcessedBlock === 0) {
      const startBlock = await this.getStartBlock(network);
      await this.chainService.updateSyncState(network, {
        lastProcessedBlock: startBlock,
        syncStatus: 'running',
        lastSyncAt: new Date()
      });
    }
    
    // For production networks, add initial delay to spread out requests
    const initialDelay = (network === NetworkType.SEPOLIA || network === NetworkType.MAINNET) ? 
      Math.random() * 10000 + 5000 : // 5-15 second random delay
      1000; // 1 second for localhost
    
    this.logger.info(`Initial sync for ${network} will start in ${Math.round(initialDelay/1000)}s`);
    
    // Start periodic sync with initial delay, using chain-specific interval
    setTimeout(async () => {
      const interval = setInterval(async () => {
        await this.syncNetworkEvents(network);
      }, chainConfig.syncIntervalMs);
      
      this.syncIntervals.set(network, interval);
      
      // Do initial sync
      await this.syncNetworkEvents(network);
    }, initialDelay);
  }
  
  private stopNetworkMonitoring(network: NetworkType): void {
    const interval = this.syncIntervals.get(network);
    if (interval) {
      clearInterval(interval);
      this.syncIntervals.delete(network);
      this.logger.info(`Stopped monitoring for network: ${network}`);
    }
  }
  
  // ============================================================================
  // EVENT SYNCHRONIZATION
  // ============================================================================
  
  private async syncNetworkEvents(network: NetworkType): Promise<void> {
    if (this.processingLock.get(network)) {
      return; // Already processing this network
    }
    
    this.processingLock.set(network, true);
    const rateLimiter = this.rateLimiters.get(network);
    
    try {
      const walletsOnNetwork = this.getMonitoredWallets(network).filter(w => w.active);
      if (walletsOnNetwork.length === 0) {
        return;
      }
      
      // Get chain configuration from database
      const chainConfig = await this.chainService.getChainByNetwork(network);
      if (!chainConfig || !chainConfig.enabled) {
        return;
      }
      
      // Apply rate limiting before making RPC requests
      if (rateLimiter) {
        await rateLimiter.waitForRateLimit();
      }
      
      const provider = this.contractFactory.getProvider(network);
      const currentBlock = await provider.getBlockNumber();
      
      if (rateLimiter) {
        rateLimiter.onRequestSuccess();
      }
      
      const lastProcessed = chainConfig.lastProcessedBlock;
      
      if (currentBlock <= lastProcessed) {
        // Update sync status even if no new blocks
        await this.chainService.updateSyncState(network, {
          lastProcessedBlock: lastProcessed,
          syncStatus: 'running',
          lastSyncAt: new Date()
        });
        return; // No new blocks
      }
      
      // Process blocks in smaller batches using chain configuration
      const maxBatch = Math.min(
        currentBlock,
        lastProcessed + chainConfig.maxBlocksPerBatch
      );
      
      this.logger.debug(`Syncing blocks ${lastProcessed + 1} to ${maxBatch} for ${network}`, {
        rateLimiterStats: rateLimiter?.getStats(),
        chainConfig: {
          rps: chainConfig.rateLimitRps,
          batchSize: chainConfig.maxBlocksPerBatch
        }
      });
      
      for (const wallet of walletsOnNetwork) {
        // Apply rate limiting before each wallet's events
        if (rateLimiter) {
          await rateLimiter.waitForRateLimit();
        }
        
        await this.processWalletEvents(wallet, lastProcessed + 1, maxBatch);
        
        if (rateLimiter) {
          rateLimiter.onRequestSuccess();
        }
      }
      
      // Update sync state in database
      await this.chainService.updateSyncState(network, {
        lastProcessedBlock: maxBatch,
        syncStatus: 'running',
        lastSyncAt: new Date()
      });
      
      // Reset error count on successful sync
      if (chainConfig.consecutiveErrors > 0) {
        await this.chainService.resetErrorCount(network);
      }
      
    } catch (error) {
      this.logger.error(`Error syncing events for ${network}:`, error);
      
      if (rateLimiter) {
        rateLimiter.onRequestError(error);
      }
      
      // Update error count in database
      await this.chainService.incrementErrorCount(network, error instanceof Error ? error.message : 'Unknown error');
      
      this.emit('error', { network, error });
    } finally {
      this.processingLock.set(network, false);
    }
  }
  
  // ============================================================================
  // WALLET EVENT PROCESSING
  // ============================================================================
  
  private async processWalletEvents(
    wallet: WalletConfig,
    fromBlock: number,
    toBlock: number
  ): Promise<void> {
    try {
      this.logger.debug(`Processing events for wallet ${wallet.address} blocks ${fromBlock}-${toBlock}`, {
        wallet: wallet.address,
        network: wallet.network,
        type: wallet.type,
        fromBlock,
        toBlock
      });

      console.log(`[DEBUG] processWalletEvents called for wallet ${wallet.address}, blocks ${fromBlock}-${toBlock}`);
      console.log(`[DEBUG] Wallet type: ${wallet.type}, hasDailyLimit: ${wallet.type === WalletType.MULTISIG_WALLET_WITH_DAILY_LIMIT}`);

      const contract = this.contractFactory.getContract(
        wallet.address,
        wallet.network,
        wallet.type === WalletType.MULTISIG_WALLET_WITH_DAILY_LIMIT
      );
      
      console.log(`[DEBUG] Contract created, target: ${contract.getAddress()}`);
      console.log(`[DEBUG] About to call getAllEvents(${fromBlock}, ${toBlock})`);
      
      const events = await contract.getAllEvents(fromBlock, toBlock);
      
      console.log(`[DEBUG] getAllEvents returned ${events.length} events`);
      
      this.logger.debug(`Found ${events.length} events for wallet ${wallet.address}`, {
        wallet: wallet.address,
        eventCount: events.length,
        events: events.map(e => ({ event: e.event, block: e.blockNumber, tx: e.transactionHash }))
      });
      
      for (const event of events) {
        console.log(`[DEBUG] Processing individual event: ${event.event} at block ${event.blockNumber}`);
        this.logger.debug(`Processing event ${event.event} for wallet ${wallet.address}`, {
          event: event.event,
          blockNumber: event.blockNumber,
          transactionHash: event.transactionHash
        });
        await this.processEvent(wallet, event);
      }
      
    } catch (error) {
      console.log(`[DEBUG] processWalletEvents ERROR:`, error);
      this.logger.error(`Error processing events for wallet ${wallet.address}:`, error);
      this.emit('walletError', { wallet, error });
    }
  }
  
  private async processEvent(wallet: WalletConfig, event: MultiSigEvent): Promise<void> {
    try {
      // Get blockchain timestamp for the event
      let eventTimestamp: Date;
      try {
        eventTimestamp = await this.getBlockTimestamp(wallet.network, event.blockNumber);
      } catch (error) {
        this.logger.error(`Failed to get timestamp for event in block ${event.blockNumber}, skipping event processing:`, error);
        return; // Skip this event if we can't get accurate timestamp
      }
      
      const processedEvent: ProcessedEvent = {
        id: this.generateEventId(event),
        walletAddress: wallet.address,
        network: wallet.network,
        eventType: event.event,
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash,
        logIndex: event.logIndex,
        timestamp: eventTimestamp,
        data: event.args,
        processed: false,
      };
      
      // Emit specific event types
      switch (event.event) {
        case 'Submission':
          await this.handleSubmissionEvent(wallet, event as SubmissionEvent, processedEvent);
          break;
        case 'Confirmation':
          await this.handleConfirmationEvent(wallet, event as ConfirmationEvent, processedEvent);
          break;
        case 'Execution':
          await this.handleExecutionEvent(wallet, event as ExecutionEvent, processedEvent);
          break;
        case 'ExecutionFailure':
          await this.handleExecutionFailureEvent(wallet, event, processedEvent);
          break;
        case 'OwnerAddition':
          await this.handleOwnerAdditionEvent(wallet, event as OwnerAdditionEvent, processedEvent);
          break;
        case 'OwnerRemoval':
          await this.handleOwnerRemovalEvent(wallet, event as OwnerRemovalEvent, processedEvent);
          break;
        case 'RequirementChange':
          await this.handleRequirementChangeEvent(wallet, event, processedEvent);
          break;
        case 'DailyLimitChange':
          await this.handleDailyLimitChangeEvent(wallet, event, processedEvent);
          break;
        case 'Deposit':
          await this.handleDepositEvent(wallet, event, processedEvent);
          break;
      }
      
      // Emit generic event
      this.emit('event', processedEvent);
      
    } catch (error) {
      this.logger.error(`Error processing event ${event.event}:`, error);
      this.emit('eventError', { wallet, event, error });
    }
  }
  
  // ============================================================================
  // SPECIFIC EVENT HANDLERS
  // ============================================================================
  
  private async handleSubmissionEvent(
    wallet: WalletConfig,
    event: SubmissionEvent,
    processedEvent: ProcessedEvent
  ): Promise<void> {
    // Add comprehensive logging for debugging
    this.logger.info(`=== SUBMISSION EVENT DEBUG START ===`);
    this.logger.info(`Wallet: ${wallet.address} (${wallet.network})`);
    this.logger.info(`Block: ${event.blockNumber}, TX: ${event.transactionHash}`);
    
    const contract = this.contractFactory.getContract(
      wallet.address,
      wallet.network,
      wallet.type === WalletType.MULTISIG_WALLET_WITH_DAILY_LIMIT
    );
    
    // Debug: Log the entire event structure with more detail
    this.logger.info(`Full event structure:`, {
      event: event.event,
      eventName: (event as any).eventName,
      args: event.args,
      argsType: typeof event.args,
      argsLength: event.args?.length,
      argsKeys: event.args ? Object.keys(event.args) : null,
      argsEntries: event.args ? Object.entries(event.args) : null,
      topics: event.topics,
      topicsLength: event.topics?.length,
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
      address: event.address,
      logIndex: event.logIndex
    });
    
    // Log each argument individually
    if (event.args) {
      this.logger.info(`Event args breakdown:`);
      if (Array.isArray(event.args)) {
        event.args.forEach((arg, index) => {
          this.logger.info(`  args[${index}]: ${arg} (type: ${typeof arg})`);
        });
      }
      for (const [key, value] of Object.entries(event.args)) {
        this.logger.info(`  args.${key}: ${value} (type: ${typeof value})`);
      }
    }
    
    // Parse transaction ID properly - handle different ethers.js event structures
    let transactionId: number;
    try {
      let rawTxId: any;
      
      // Try different ways to access transaction ID based on ethers.js version and event structure
      if (event.args && typeof event.args.transactionId !== 'undefined') {
        rawTxId = event.args.transactionId;
      } else if (event.args && Array.isArray(event.args) && event.args.length > 0) {
        // For Submission events, transactionId is typically the first (and only) argument
        rawTxId = event.args[0];
      } else if (event.args && typeof event.args['0'] !== 'undefined') {
        // Fix: Check for undefined instead of falsy (to handle transaction ID 0)
        rawTxId = event.args['0'];
      } else {
        // Last resort: try to decode from topics if it's an indexed parameter
        if (event.topics && event.topics.length > 1) {
          // For indexed uint parameters, the value is in topics[1]
          rawTxId = BigInt(event.topics[1]);
        }
      }
      
      this.logger.debug(`Raw transaction ID from event: ${rawTxId} (type: ${typeof rawTxId})`);
      
      if (rawTxId === undefined || rawTxId === null) {
        this.logger.error(`Could not extract transaction ID from event:`, {
          args: event.args,
          topics: event.topics
        });
        return;
      }
      
      transactionId = typeof rawTxId === 'bigint' 
        ? Number(rawTxId)
        : Number(rawTxId);
      this.logger.debug(`Parsed transaction ID: ${transactionId}`);
    } catch (error) {
      this.logger.error(`Failed to parse transaction ID from event:`, error);
      return;
    }
    
    // Validate transaction ID
    if (isNaN(transactionId) || transactionId < 0) {
      this.logger.error(`Invalid transaction ID: ${event.args.transactionId} -> ${transactionId}`);
      return;
    }
    
    const transactionData = await contract.getTransaction(transactionId);
    
    // Get transaction details from the blockchain transaction
    const provider = this.contractFactory.getProvider(wallet.network);
    const tx = await provider.getTransaction(event.transactionHash);
    
    const submissionData: TransactionSubmissionData = {
      transactionId,
      submitter: tx?.from || '',
      destination: transactionData.destination,
      value: transactionData.value,
      data: transactionData.data,
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
      timestamp: processedEvent.timestamp,
    };
    
    // Determine transaction action
    const action = this.determineTransactionAction(transactionData.destination, transactionData.data, wallet.address);
    
    this.emit('transactionSubmitted', {
      wallet,
      event: processedEvent,
      submission: submissionData,
      action,
    });
    
    this.logger.info('Transaction submitted', {
      wallet: wallet.address,
      transactionId,
      action,
      submitter: submissionData.submitter,
    });
  }
  
  private async handleConfirmationEvent(
    wallet: WalletConfig,
    event: ConfirmationEvent,
    processedEvent: ProcessedEvent
  ): Promise<void> {
    // Debug confirmation event structure
    this.logger.info(`=== CONFIRMATION EVENT DEBUG ===`);
    this.logger.info(`Event args:`, {
      args: event.args,
      argsKeys: event.args ? Object.keys(event.args) : null,
      argsEntries: event.args ? Object.entries(event.args) : null,
    });
    
    // Parse confirmer address (first parameter)
    let confirmer: string;
    if (event.args && event.args.sender) {
      confirmer = event.args.sender;
    } else if (event.args && event.args['0']) {
      confirmer = event.args['0'];
    } else {
      this.logger.error('Could not extract confirmer address from confirmation event:', event.args);
      return;
    }
    
    // Parse transaction ID (second parameter)
    let transactionId: number;
    try {
      let rawTxId: any;
      if (event.args && typeof event.args.transactionId !== 'undefined') {
        rawTxId = event.args.transactionId;
      } else if (event.args && typeof event.args['1'] !== 'undefined') {
        // Transaction ID is the second parameter in confirmation events
        rawTxId = event.args['1'];
      }
      
      transactionId = typeof rawTxId === 'bigint' 
        ? Number(rawTxId)
        : Number(rawTxId || 0);
    } catch (error) {
      this.logger.error(`Failed to parse transaction ID in confirmation:`, error);
      return;
    }
    
    // Validate transaction ID
    if (isNaN(transactionId) || transactionId < 0) {
      this.logger.error(`Invalid transaction ID in confirmation: ${transactionId}`);
      return;
    }
    
    this.logger.debug(`Parsed confirmation: transactionId=${transactionId}, confirmer=${confirmer}`);
    
    const confirmationData: TransactionConfirmationData = {
      transactionId,
      confirmer,
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
      timestamp: processedEvent.timestamp,
    };
    
    this.emit('transactionConfirmed', {
      wallet,
      event: processedEvent,
      confirmation: confirmationData,
    });
    
    this.logger.info('Transaction confirmed', {
      wallet: wallet.address,
      transactionId: confirmationData.transactionId,
      confirmer: confirmationData.confirmer,
    });
  }
  
  private async handleExecutionEvent(
    wallet: WalletConfig,
    event: ExecutionEvent,
    processedEvent: ProcessedEvent
  ): Promise<void> {
    // Parse transaction ID properly (could be BigInt from ethers.js)
    let transactionId: number;
    try {
      transactionId = typeof event.args.transactionId === 'bigint' 
        ? Number(event.args.transactionId)
        : Number(event.args.transactionId || 0);
    } catch (error) {
      this.logger.error(`Failed to parse transaction ID in execution: ${event.args.transactionId}`, error);
      return;
    }
    
    // Validate transaction ID
    if (isNaN(transactionId) || transactionId < 0) {
      this.logger.error(`Invalid transaction ID in execution: ${event.args.transactionId} -> ${transactionId}`);
      return;
    }
    
    this.emit('transactionExecuted', {
      wallet,
      event: processedEvent,
      transactionId,
    });
    
    this.logger.info('Transaction executed', {
      wallet: wallet.address,
      transactionId,
    });
  }
  
  private async handleExecutionFailureEvent(
    wallet: WalletConfig,
    event: MultiSigEvent,
    processedEvent: ProcessedEvent
  ): Promise<void> {
    // Parse transaction ID properly (could be BigInt from ethers.js)
    let transactionId: number;
    try {
      let rawTxId: any;
      if (event.args && typeof event.args.transactionId !== 'undefined') {
        rawTxId = event.args.transactionId;
      } else if (event.args && typeof event.args['0'] !== 'undefined') {
        rawTxId = event.args['0'];
      }
      
      transactionId = typeof rawTxId === 'bigint' 
        ? Number(rawTxId)
        : Number(rawTxId || 0);
    } catch (error) {
      this.logger.error(`Failed to parse transaction ID in execution failure:`, error);
      return;
    }
    
    // Validate transaction ID
    if (isNaN(transactionId) || transactionId < 0) {
      this.logger.error(`Invalid transaction ID in execution failure: ${transactionId}`);
      return;
    }
    
    this.emit('transactionFailed', {
      wallet,
      event: processedEvent,
      transactionId,
    });
    
    this.logger.warn('Transaction execution failed', {
      wallet: wallet.address,
      transactionId,
    });
  }
  
  private async handleOwnerAdditionEvent(
    wallet: WalletConfig,
    event: OwnerAdditionEvent,
    processedEvent: ProcessedEvent
  ): Promise<void> {
    const ownerChangeData: OwnerChangeData = {
      changeType: 'addition',
      owner: event.args.owner,
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
      timestamp: processedEvent.timestamp,
    };
    
    this.emit('ownerAdded', {
      wallet,
      event: processedEvent,
      change: ownerChangeData,
    });
    
    this.logger.info('Owner added', {
      wallet: wallet.address,
      owner: ownerChangeData.owner,
    });
  }
  
  private async handleOwnerRemovalEvent(
    wallet: WalletConfig,
    event: OwnerRemovalEvent,
    processedEvent: ProcessedEvent
  ): Promise<void> {
    const ownerChangeData: OwnerChangeData = {
      changeType: 'removal',
      owner: event.args.owner,
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
      timestamp: processedEvent.timestamp,
    };
    
    this.emit('ownerRemoved', {
      wallet,
      event: processedEvent,
      change: ownerChangeData,
    });
    
    this.logger.info('Owner removed', {
      wallet: wallet.address,
      owner: ownerChangeData.owner,
    });
  }
  
  private async handleRequirementChangeEvent(
    wallet: WalletConfig,
    event: MultiSigEvent,
    processedEvent: ProcessedEvent
  ): Promise<void> {
    const newRequirement = Number(event.args.required);
    
    this.emit('requirementChanged', {
      wallet,
      event: processedEvent,
      newRequirement,
    });
    
    this.logger.info('Requirement changed', {
      wallet: wallet.address,
      newRequirement,
    });
  }
  
  private async handleDailyLimitChangeEvent(
    wallet: WalletConfig,
    event: MultiSigEvent,
    processedEvent: ProcessedEvent
  ): Promise<void> {
    const newDailyLimit = event.args.dailyLimit.toString();
    
    this.emit('dailyLimitChanged', {
      wallet,
      event: processedEvent,
      newDailyLimit,
    });
    
    this.logger.info('Daily limit changed', {
      wallet: wallet.address,
      newDailyLimit,
    });
  }
  
  private async handleDepositEvent(
    wallet: WalletConfig,
    event: MultiSigEvent,
    processedEvent: ProcessedEvent
  ): Promise<void> {
    // Handle potential missing event arguments
    const sender = event.args?.sender || 'unknown';
    const value = event.args?.value ? event.args.value.toString() : '0';
    
    this.logger.debug(`Deposit event: sender=${sender}, value=${value}`);
    
    const deposit = {
      sender,
      value,
    };
    
    this.emit('deposit', {
      wallet,
      event: processedEvent,
      deposit,
    });
    
    this.logger.info('Deposit received', {
      wallet: wallet.address,
      sender: deposit.sender,
      value: deposit.value,
    });
  }
  
  // ============================================================================
  // UTILITY METHODS
  // ============================================================================
  
  private determineTransactionAction(
    destination: string,
    data: string,
    walletAddress: string
  ): TransactionAction {
    // If destination is the wallet itself, it's a governance action
    if (destination.toLowerCase() === walletAddress.toLowerCase()) {
      if (data.startsWith('0x7065cb48')) { // addOwner
        return TransactionAction.ADD_OWNER;
      } else if (data.startsWith('0x173825d9')) { // removeOwner
        return TransactionAction.REMOVE_OWNER;
      } else if (data.startsWith('0xe20056e6')) { // replaceOwner
        return TransactionAction.REPLACE_OWNER;
      } else if (data.startsWith('0xba51a6df')) { // changeRequirement
        return TransactionAction.CHANGE_REQUIREMENT;
      } else if (data.startsWith('0xcea08621')) { // changeDailyLimit
        return TransactionAction.CHANGE_DAILY_LIMIT;
      }
      return TransactionAction.CONTRACT_CALL;
    }
    
    // If data is empty or 0x, it's a simple transfer
    if (!data || data === '0x') {
      return TransactionAction.TRANSFER;
    }
    
    // Otherwise it's a contract call
    return TransactionAction.CONTRACT_CALL;
  }
  
  private async getBlockTimestamp(network: NetworkType, blockNumber: number): Promise<Date> {
    try {
      const rateLimiter = this.rateLimiters.get(network);
      if (rateLimiter) {
        await rateLimiter.waitForRateLimit();
      }
      
      const provider = this.contractFactory.getProvider(network);
      const block = await provider.getBlock(blockNumber);
      
      if (rateLimiter) {
        rateLimiter.onRequestSuccess();
      }
      
      if (!block || !block.timestamp) {
        throw new Error(`Block ${blockNumber} not found or has no timestamp`);
      }
      
      // Return UTC timestamp from blockchain
      return new Date(block.timestamp * 1000);
    } catch (error) {
      this.logger.error(`Failed to get block timestamp for ${blockNumber}:`, error);
      
      const rateLimiter = this.rateLimiters.get(network);
      if (rateLimiter) {
        rateLimiter.onRequestError(error);
      }
      
      // Don't use current time as fallback - this creates incorrect timestamps
      // Instead, throw the error so the caller can handle it appropriately
      throw new Error(`Unable to get blockchain timestamp for block ${blockNumber}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  private async getStartBlock(network: NetworkType): Promise<number> {
    // For production networks, start from recent blocks to avoid hitting rate limits
    if (network === NetworkType.SEPOLIA || network === NetworkType.MAINNET) {
      try {
        const rateLimiter = this.rateLimiters.get(network);
        if (rateLimiter) {
          await rateLimiter.waitForRateLimit();
        }
        
        const provider = this.contractFactory.getProvider(network);
        const currentBlock = await provider.getBlockNumber();
        
        if (rateLimiter) {
          rateLimiter.onRequestSuccess();
        }
        
        // Start from recent blocks only (last 100 blocks for production networks)
        // get startBlock from config if available
        if (config.blockchain.eventSync.startBlock > 0 && config.blockchain.eventSync.startBlock < currentBlock) {
          this.logger.info(`Starting ${network} sync from configed block ${config.blockchain.eventSync.startBlock} (current: ${currentBlock})`);
          return config.blockchain.eventSync.startBlock;
        }
        const startBlock = Math.max(0, currentBlock - 100);
        this.logger.info(`Starting ${network} sync from block ${startBlock} (current: ${currentBlock})`);
        return startBlock;
      } catch (error) {
        this.logger.warn(`Failed to get current block for ${network}:`, error);
        const rateLimiter = this.rateLimiters.get(network);
        if (rateLimiter) {
          rateLimiter.onRequestError(error);
        }
        // For production networks, start from a reasonable recent block
        return network === NetworkType.SEPOLIA ? 6000000 : 18000000; // Approximate recent blocks
      }
    }
    
    // For localhost/test networks, use configured start block
    if (config.blockchain.eventSync.startBlock > 0) {
      return config.blockchain.eventSync.startBlock;
    }
    
    return 0;
  }
  
  private generateEventId(event: MultiSigEvent): string {
    return `${event.address}-${event.blockNumber}-${event.logIndex}`;
  }
  
  private getWalletKey(address: string, network: NetworkType): string {
    return `${network}:${address.toLowerCase()}`;
  }
  
  // ============================================================================
  // STATUS AND METRICS
  // ============================================================================
  
  async getStatus(): Promise<{
    isRunning: boolean;
    walletsMonitored: number;
    networksActive: string[];
    lastProcessedBlocks: Record<string, number>;
    chainMetrics: any;
  }> {
    const chainMetrics = await this.chainService.getChainMetrics();
    
    return {
      isRunning: this.isRunning,
      walletsMonitored: this.wallets.size,
      networksActive: Array.from(this.syncIntervals.keys()),
      lastProcessedBlocks: chainMetrics.chainSummary.reduce((acc, chain) => {
        acc[chain.network] = chain.lastBlock;
        return acc;
      }, {} as Record<string, number>),
      chainMetrics,
    };
  }
  
  async getCurrentBlocks(): Promise<Record<string, number>> {
    const blocks: Record<string, number> = {};
    
    for (const network of this.syncIntervals.keys()) {
      try {
        const provider = this.contractFactory.getProvider(network);
        blocks[network] = await provider.getBlockNumber();
      } catch (error) {
        this.logger.warn(`Failed to get current block for ${network}:`, error);
        blocks[network] = -1;
      }
    }
    
    return blocks;
  }
}