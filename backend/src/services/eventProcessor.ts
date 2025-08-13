// Event Processing Service - Handles blockchain events and stores them in database
import winston from 'winston';
import { Database } from '../database';
import { 
  ProcessedEvent,
  TransactionSubmissionData,
  TransactionConfirmationData,
  OwnerChangeData,
  WalletConfig
} from '../blockchain/eventListener';
import {
  NetworkType,
  WalletType,
  TransactionAction,
  ValidationStatus,
  AlertPriority,
  RiskLevel,
  OwnerStatus
} from '../types';
import { 
  WalletModel,
  OwnerModel,
  TransactionModel,
  AlertModel,
  ModelUtils
} from '../models';
import { SlackNotifier, TransactionAlert, OwnerAlert } from './slackNotifier';

export interface EventProcessorConfig {
  enableValidation: boolean;
  autoProcessAlerts: boolean;
  batchSize: number;
}

export class EventProcessor {
  private db: Database;
  private logger: winston.Logger;
  private config: EventProcessorConfig;
  private slackNotifier: SlackNotifier;
  
  constructor(
    db: Database,
    logger: winston.Logger,
    config: EventProcessorConfig = {
      enableValidation: true,
      autoProcessAlerts: true,
      batchSize: 50
    }
  ) {
    this.db = db;
    this.logger = logger;
    this.config = config;
    this.slackNotifier = new SlackNotifier(logger);
  }
  
  // ============================================================================
  // TRANSACTION DATA DECODING
  // ============================================================================

  private decodeTransactionData(data: string, action: TransactionAction): any {
    try {
      if (!data || data === '0x' || data.length < 10) {
        return null;
      }

      const functionSelector = data.slice(0, 10).toLowerCase();
      
      // Function selector mappings for MultiSig operations
      const functionSelectors: Record<string, string> = {
        '0x7065cb48': 'addOwner',           // addOwner(address)
        '0x173825d9': 'removeOwner',       // removeOwner(address)  
        '0xe20056e6': 'replaceOwner',      // replaceOwner(address,address)
        '0xba51a6df': 'changeRequirement', // changeRequirement(uint)
        '0x659010e7': 'changeDailyLimit',  // changeDailyLimit(uint)
      };

      const functionName = functionSelectors[functionSelector];
      
      if (!functionName) {
        return {
          functionName: 'unknown',
          functionSelector,
          rawData: data,
          parameters: {}
        };
      }

      // Decode parameters based on function
      const parameters = this.decodeFunctionParameters(functionName, data);
      
      return {
        functionName,
        functionSelector,
        rawData: data,
        parameters
      };

    } catch (error) {
      this.logger.error('Failed to decode transaction data:', error);
      return {
        functionName: 'decode_error',
        rawData: data,
        error: error instanceof Error ? error.message : 'Unknown error',
        parameters: {}
      };
    }
  }

  private decodeFunctionParameters(functionName: string, data: string): any {
    try {
      // Remove function selector (first 10 characters: 0x + 8 hex chars)
      const paramData = data.slice(10);
      
      switch (functionName) {
        case 'addOwner':
        case 'removeOwner': {
          // Single address parameter (32 bytes, last 20 bytes are the address)
          if (paramData.length >= 64) {
            const addressHex = paramData.slice(-40); // Last 40 chars = 20 bytes = address
            const address = `0x${addressHex}`;
            return {
              owner: address,
              targetOwner: address // For compatibility with Slack formatter
            };
          }
          break;
        }
        
        case 'replaceOwner': {
          // Two address parameters (64 bytes total)
          if (paramData.length >= 128) {
            const oldOwnerHex = paramData.slice(24, 64); // First address (skip padding)
            const newOwnerHex = paramData.slice(88, 128); // Second address (skip padding)
            return {
              oldOwner: `0x${oldOwnerHex}`,
              newOwner: `0x${newOwnerHex}`,
              targetOwner: `0x${newOwnerHex}` // For compatibility
            };
          }
          break;
        }
        
        case 'changeRequirement': {
          // Single uint parameter
          if (paramData.length >= 64) {
            const requirementHex = paramData.slice(-64);
            const requirement = parseInt(requirementHex, 16);
            return {
              newRequirement: requirement
            };
          }
          break;
        }
        
        case 'changeDailyLimit': {
          // Single uint parameter  
          if (paramData.length >= 64) {
            const limitHex = paramData.slice(-64);
            const limit = BigInt('0x' + limitHex).toString();
            return {
              newDailyLimit: limit,
              newDailyLimitEth: (Number(limit) / 1e18).toFixed(6)
            };
          }
          break;
        }
      }
      
      return {};
      
    } catch (error) {
      this.logger.error(`Failed to decode parameters for ${functionName}:`, error);
      return { decodeError: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // ============================================================================
  // TRANSACTION SUBMISSION PROCESSING
  // ============================================================================
  
  async processTransactionSubmission(
    wallet: WalletConfig,
    event: ProcessedEvent,
    submission: TransactionSubmissionData,
    action: TransactionAction
  ): Promise<void> {
    try {
      await this.db.transaction(async (client) => {
        // 1. Sync wallet state from blockchain to get latest requirement
        await this.syncWalletState(wallet.address, wallet.network, client);
        
        // 2. Get or create submitter owner record
        const submitter = await this.getOrCreateOwner(
          submission.submitter,
          wallet.network,
          client
        );
        
        // 3. Get wallet record (now with updated requirement)
        const walletRecord = await this.getWalletByAddress(
          wallet.address,
          wallet.network,
          client
        );
        
        if (!walletRecord) {
          throw new Error(`Wallet not found: ${wallet.address}`);
        }
        
        // 4. Decode transaction data if available
        this.logger.debug("-------------submission raw:", submission);
        let decodedData = null;
        if (submission.data && submission.data !== '0x') {
          decodedData = this.decodeTransactionData(submission.data, action);
          this.logger.debug("-------------decoded data:", decodedData);
        }

        // 5. Create transaction record
        const transactionId = await this.createTransaction({
          walletId: walletRecord.id,
          transactionId: submission.transactionId,
          blockNumber: submission.blockNumber,
          transactionHash: submission.transactionHash,
          action,
          submitter: submission.submitter,
          destination: submission.destination,
          value: submission.value,
          data: submission.data,
          decodedData,
          walletBalance: walletRecord.balance,
          transferPercentage: this.calculateTransferPercentage(
            submission.value,
            walletRecord.balance
          ),
          validationStatus: ValidationStatus.PENDING,
          riskScore: 0,
          riskFactors: [],
          confirmations: [],
          requiredConfirmations: walletRecord.required,
          submittedAt: submission.timestamp, // This is already blockchain timestamp from getBlockTimestamp
        }, client);
        
        // 6. Update owner activity
        await this.updateOwnerActivity(
          submitter.id,
          submission.timestamp,
          client
        );
        
        // 6. Update wallet last activity
        await this.updateWalletActivity(
          walletRecord.id,
          submission.timestamp,
          client
        );
        
        // 7. Process validation if enabled
        if (this.config.enableValidation) {
          await this.validateTransaction(transactionId, client);
        }
      });
      
      this.logger.info('Transaction submission processed', {
        wallet: wallet.address,
        transactionId: submission.transactionId,
        action,
        submitter: submission.submitter,
      });

      // Send Slack notification for transaction submission
      const walletForNotification = await this.getWalletByAddress(wallet.address, wallet.network);
      if (walletForNotification) {
        await this.sendTransactionSubmissionNotification(wallet, submission, action, walletForNotification);
      }
      
    } catch (error) {
      this.logger.error('Failed to process transaction submission:', error);
      throw error;
    }
  }
  
  // ============================================================================
  // TRANSACTION CONFIRMATION PROCESSING
  // ============================================================================
  
  async processTransactionConfirmation(
    wallet: WalletConfig,
    event: ProcessedEvent,
    confirmation: TransactionConfirmationData
  ): Promise<void> {
    try {
      await this.db.transaction(async (client) => {
        // 1. Get transaction record
        const transaction = await this.getTransactionByWalletAndId(
          wallet.address,
          wallet.network,
          confirmation.transactionId,
          client
        );
        
        if (!transaction) {
          this.logger.error('Transaction not found for confirmation - this indicates submission event was not processed first', {
            wallet: wallet.address,
            transactionId: confirmation.transactionId,
            confirmer: confirmation.confirmer,
            blockNumber: confirmation.blockNumber,
            transactionHash: confirmation.transactionHash
          });
          // Create an alert for this inconsistency
          await this.createTransactionNotFoundAlert(wallet, confirmation, client);
          return;
        }
        
        // 2. Add confirmation to transaction
        const confirmations = transaction.confirmations || [];
        
        // Check if already confirmed by this owner
        const alreadyConfirmed = confirmations.some(
          (c: any) => c.owner_address?.toLowerCase() === confirmation.confirmer.toLowerCase()
        );
        
        if (alreadyConfirmed) {
          this.logger.debug('Owner already confirmed this transaction', {
            transactionId: confirmation.transactionId,
            confirmer: confirmation.confirmer,
          });
          return;
        }
        
        // Add new confirmation with consistent timezone (UTC)
        confirmations.push({
          transaction_id: confirmation.transactionId,
          owner_address: confirmation.confirmer,
          confirmed_time: confirmation.timestamp,
          transaction_hash: confirmation.transactionHash
        });
        
        // 3. Update transaction with new confirmation
        await client.query(
          `UPDATE transactions 
           SET confirmations = $1, updated_at = NOW()
           WHERE id = $2`,
          [JSON.stringify(confirmations), transaction.id]
        );
        
        // 4. Update confirmer owner activity
        const confirmer = await this.getOrCreateOwner(
          confirmation.confirmer,
          wallet.network,
          client
        );
        
        await this.updateOwnerActivity(
          confirmer.id,
          confirmation.timestamp,
          client
        );
        
        this.logger.info('Transaction confirmation processed', {
          wallet: wallet.address,
          transactionId: confirmation.transactionId,
          confirmer: confirmation.confirmer,
          totalConfirmations: confirmations.length,
        });
      });

      // Send Slack notification for transaction confirmation  
      const updatedTransaction = await this.getTransactionByWalletAndId(
        wallet.address,
        wallet.network,
        confirmation.transactionId
      );
      if (updatedTransaction) {
        await this.sendTransactionConfirmationNotification(wallet, confirmation, updatedTransaction.confirmations || []);
      }
      
    } catch (error) {
      this.logger.error('Failed to process transaction confirmation:', error);
      throw error;
    }
  }
  
  // ============================================================================
  // TRANSACTION EXECUTION PROCESSING
  // ============================================================================
  
  async processTransactionExecution(
    wallet: WalletConfig,
    event: ProcessedEvent,
    transactionId: number,
    executor?: string
  ): Promise<void> {
    try {
      await this.db.transaction(async (client) => {
        // Update transaction status and executor
        await client.query(
          `UPDATE transactions 
           SET executed_at = $1, execution_status = 'executed', executor = $2, updated_at = NOW()
           WHERE wallet_id = (SELECT id FROM wallets WHERE address = $3 AND network = $4)
           AND transaction_id = $5`,
          [event.timestamp, executor, wallet.address, wallet.network, transactionId]
        );
        
        // Update wallet balance (will be synced later)
        await this.syncWalletState(wallet.address, wallet.network, client);
      });
      
      this.logger.info('Transaction execution processed', {
        wallet: wallet.address,
        transactionId,
      });

      // Send Slack notification for transaction execution
      await this.sendTransactionExecutionNotification(wallet, transactionId, event.timestamp, event.transactionHash, executor);
      
    } catch (error) {
      this.logger.error('Failed to process transaction execution:', error);
      throw error;
    }
  }
  
  // ============================================================================
  // OWNER CHANGE PROCESSING
  // ============================================================================
  
  async processOwnerChange(
    wallet: WalletConfig,
    event: ProcessedEvent,
    change: OwnerChangeData
  ): Promise<void> {
    try {
      await this.db.transaction(async (client) => {
        if (change.changeType === 'addition') {
          // Create or update owner record
          const owner = await this.getOrCreateOwner(
            change.owner,
            wallet.network,
            client
          );
          
          // Add wallet to owner's wallet list
          const wallets = owner.contractData?.wallets || [];
          if (!wallets.includes(wallet.address)) {
            wallets.push(wallet.address);
            
            await client.query(
              `UPDATE owners 
               SET wallets = $1, updated_at = NOW()
               WHERE id = $2`,
              [JSON.stringify(wallets), owner.id]
            );
          }
          
        } else if (change.changeType === 'removal') {
          // Update owner status
          await client.query(
            `UPDATE owners 
             SET status = $1, updated_at = NOW()
             WHERE address = $2 AND network = $3`,
            [OwnerStatus.REMOVED, change.owner, wallet.network]
          );
        }
        
        // Update wallet owners list
        await this.syncWalletState(wallet.address, wallet.network, client);
        
        // Create alert for owner changes
        if (this.config.autoProcessAlerts) {
          await this.createOwnerChangeAlert(
            wallet,
            change,
            event.timestamp,
            client
          );
        }
      });
      
      this.logger.info('Owner change processed', {
        wallet: wallet.address,
        changeType: change.changeType,
        owner: change.owner,
      });

      // Send Slack notification for owner change
      await this.sendOwnerChangeNotification(wallet, change, event.timestamp, event.transactionHash);
      
    } catch (error) {
      this.logger.error('Failed to process owner change:', error);
      throw error;
    }
  }

  async processOwnerAddition(
    wallet: WalletConfig,
    owner: string,
    timestamp: Date,
    transactionHash: string
  ): Promise<void> {
    try {
      await this.db.transaction(async (client) => {
        // Get or create owner record
        const ownerRecord = await this.getOrCreateOwner(
          owner,
          wallet.network,
          client
        );
        
        // Add wallet to owner's wallet list
        const wallets = ownerRecord.contractData?.wallets || [];
        if (!wallets.includes(wallet.address)) {
          wallets.push(wallet.address);
          
          await client.query(
            `UPDATE owners 
             SET wallets = $1, updated_at = NOW()
             WHERE id = $2`,
            [JSON.stringify(wallets), ownerRecord.id]
          );
        }
        
        // Update wallet owners list
        await this.syncWalletState(wallet.address, wallet.network, client);
        
        this.logger.info('Owner addition processed', {
          wallet: wallet.address,
          owner,
          transactionHash
        });
      });
    } catch (error) {
      this.logger.error('Failed to process owner addition:', error);
      throw error;
    }
  }

  async processOwnerRemoval(
    wallet: WalletConfig,
    owner: string,
    timestamp: Date,
    transactionHash: string
  ): Promise<void> {
    try {
      await this.db.transaction(async (client) => {
        // Update owner status to removed
        await client.query(
          `UPDATE owners 
           SET status = $1, updated_at = NOW()
           WHERE address = $2 AND network = $3`,
          [OwnerStatus.REMOVED, owner, wallet.network]
        );
        
        // Update wallet owners list
        await this.syncWalletState(wallet.address, wallet.network, client);
        
        this.logger.info('Owner removal processed', {
          wallet: wallet.address,
          owner,
          transactionHash
        });
      });
    } catch (error) {
      this.logger.error('Failed to process owner removal:', error);
      throw error;
    }
  }

  async processRequirementChange(
    wallet: WalletConfig,
    newRequirement: number,
    timestamp: Date,
    transactionHash: string
  ): Promise<void> {
    try {
      await this.db.transaction(async (client) => {
        // Update wallet requirement in database
        await client.query(
          `UPDATE wallets 
           SET required_confirmations = $1, updated_at = NOW()
           WHERE address = $2 AND network = $3`,
          [newRequirement, wallet.address, wallet.network]
        );
        
        // Log the requirement change
        this.logger.info('Requirement change processed', {
          wallet: wallet.address,
          network: wallet.network,
          newRequirement,
          transactionHash
        });

        // Alert is handled via Slack notification below
      });

      // TODO: Add specific Slack notification method for requirement changes
      this.logger.info('Requirement change completed', {
        wallet: wallet.address,
        network: wallet.network,
        newRequirement,
        transactionHash
      });
      
    } catch (error) {
      this.logger.error('Failed to process requirement change:', error);
      throw error;
    }
  }
  
  // ============================================================================
  // HELPER METHODS
  // ============================================================================
  
  private async getOrCreateOwner(
    address: string,
    network: NetworkType,
    client: any
  ): Promise<OwnerModel> {
    // Try to get existing owner
    let owner = await client.query(
      'SELECT * FROM owners WHERE address = $1 AND network = $2',
      [address, network]
    );
    
    if (owner.rows.length > 0) {
      return this.mapOwnerFromDb(owner.rows[0]);
    }
    
    // Create new owner
    const newOwner = await client.query(
      `INSERT INTO owners (
        address, network, first_seen, wallets, transaction_count,
        risk_level, confidence_score, status
      ) VALUES ($1, $2, NOW(), '[]', 0, 'medium', 50, 'active')
      RETURNING *`,
      [address, network]
    );
    
    return this.mapOwnerFromDb(newOwner.rows[0]);
  }
  
  private async getWalletByAddress(
    address: string,
    network: NetworkType,
    client?: any
  ): Promise<WalletModel | null> {
    const dbInstance = client || this.db;
    const result = await dbInstance.query(
      'SELECT * FROM wallets WHERE address = $1 AND network = $2',
      [address, network]
    );
    
    const rows = result.rows || result; // Handle both client.query and db.query response formats
    if (rows.length === 0) {
      return null;
    }
    
    return this.mapWalletFromDb(rows[0]);
  }
  
  private async createTransaction(
    data: Partial<TransactionModel>,
    client: any
  ): Promise<string> {
    const result = await client.query(
      `INSERT INTO transactions (
        wallet_id, transaction_id, block_number, transaction_hash,
        action, submitter, destination, value, data, decoded_data,
        wallet_balance, transfer_percentage, validation_status,
        risk_score, risk_factors, confirmations, required_confirmations,
        submitted_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING id`,
      [
        data.walletId,
        data.transactionId,
        data.blockNumber,
        data.transactionHash,
        data.action,
        data.submitter,
        data.destination,
        data.value,
        data.data,
        JSON.stringify(data.decodedData),
        data.walletBalance,
        data.transferPercentage,
        data.validationStatus,
        data.riskScore,
        JSON.stringify(data.riskFactors),
        JSON.stringify(data.confirmations),
        data.requiredConfirmations,
        data.submittedAt,
      ]
    );
    
    return result.rows[0].id;
  }
  
  private async getTransactionByWalletAndId(
    walletAddress: string,
    network: NetworkType,
    transactionId: number,
    client?: any
  ): Promise<TransactionModel | null> {
    const dbInstance = client || this.db;
    const result = await dbInstance.query(
      `SELECT t.* FROM transactions t
       JOIN wallets w ON t.wallet_id = w.id
       WHERE w.address = $1 AND w.network = $2 AND t.transaction_id = $3`,
      [walletAddress, network, transactionId]
    );
    
    const rows = result.rows || result; // Handle both client.query and db.query response formats
    if (rows.length === 0) {
      return null;
    }
    
    return this.mapTransactionFromDb(rows[0]);
  }
  
  private async updateOwnerActivity(
    ownerId: string,
    timestamp: Date,
    client: any
  ): Promise<void> {
    await client.query(
      `UPDATE owners 
       SET last_activity = $1, transaction_count = transaction_count + 1, updated_at = NOW()
       WHERE id = $2`,
      [timestamp, ownerId]
    );
  }
  
  private async updateWalletActivity(
    walletId: string,
    timestamp: Date,
    client: any
  ): Promise<void> {
    await client.query(
      `UPDATE wallets 
       SET last_activity = $1, updated_at = NOW()
       WHERE id = $2`,
      [timestamp, walletId]
    );
  }
  
  private async validateTransaction(
    transactionId: string,
    client: any
  ): Promise<void> {
    // TODO: Implement comprehensive transaction validation
    // This would include risk scoring, recipient checking, etc.
    
    await client.query(
      `UPDATE transactions 
       SET validation_status = 'approved', validated_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [transactionId]
    );
  }
  
  private async syncWalletState(
    address: string,
    network: NetworkType,
    client: any
  ): Promise<void> {
    try {
      // Get contract instance from blockchain
      const { ContractFactory } = require('../blockchain/contracts');
      const config = require('../config').default;
      const contractFactory = new ContractFactory(config.blockchain.networks, this.logger);
      
      // Determine if wallet has daily limit (could be fetched from DB)
      const hasDailyLimit = false; // Default to false, could check wallet.type from DB
      const contract = contractFactory.getContract(address, network, hasDailyLimit);
      
      if (!contract) {
        this.logger.error('Failed to get contract for wallet sync', { address, network });
        return;
      }
      
      // Get provider from contractFactory
      const provider = contractFactory.getProvider(network);
      if (!provider) {
        this.logger.error('Failed to get provider for network', { network });
        return;
      }
      
      // Fetch current state from blockchain using MultiSigContract methods
      const [owners, required, balance] = await Promise.all([
        contract.getOwners(),
        contract.getRequired(),
        provider.getBalance(address)
      ]);
      
      // Update wallet state in database
      await client.query(
        `UPDATE wallets 
         SET owners = $1, 
             required = $2,
             balance = $3,
             last_sync = NOW(),
             updated_at = NOW()
         WHERE address = $4 AND network = $5`,
        [
          JSON.stringify(owners),
          Number(required),
          balance.toString(),
          address,
          network
        ]
      );
      
      this.logger.debug('Wallet state synced', {
        address,
        network,
        owners: owners.length,
        required: Number(required),
        balance: balance.toString()
      });
      
    } catch (error) {
      this.logger.error('Failed to sync wallet state:', error);
      // Don't throw - this is a best-effort sync
    }
  }
  
  private async createOwnerChangeAlert(
    wallet: WalletConfig,
    change: OwnerChangeData,
    timestamp: Date,
    client: any
  ): Promise<void> {
    const walletRecord = await this.getWalletByAddress(
      wallet.address,
      wallet.network,
      client
    );
    
    if (!walletRecord) return;
    
    const alertType = change.changeType === 'addition' ? 'owner_addition' : 'owner_removal';
    const priority = AlertPriority.P1; // Owner changes are critical (P1 = highest priority)
    
    await client.query(
      `INSERT INTO alerts (
        wallet_id, priority, type, title, message, risk_level,
        severity_score, context, notification_channels
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        walletRecord.id,
        priority,
        alertType,
        `Owner ${change.changeType}`,
        `Owner ${change.owner} was ${change.changeType === 'addition' ? 'added to' : 'removed from'} wallet ${wallet.address}`,
        RiskLevel.HIGH,
        85,
        JSON.stringify({
          changeType: change.changeType,
          owner: change.owner,
          blockNumber: change.blockNumber,
          transactionHash: change.transactionHash,
        }),
        JSON.stringify(['email', 'slack']),
      ]
    );
  }

  private async createTransactionNotFoundAlert(
    wallet: WalletConfig,
    confirmation: TransactionConfirmationData,
    client: any
  ): Promise<void> {
    const walletRecord = await this.getWalletByAddress(
      wallet.address,
      wallet.network,
      client
    );
    
    if (!walletRecord) return;
    
    await client.query(
      `INSERT INTO alerts (
        wallet_id, priority, type, title, message, risk_level,
        severity_score, context, notification_channels
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        walletRecord.id,
        AlertPriority.P1, // Critical system issue (P1 = highest priority)
        'event_processing_error',
        'Transaction not found for confirmation',
        `Confirmation event received for transaction ID ${confirmation.transactionId} but no submission event was processed. This may indicate event processing order issues.`,
        RiskLevel.HIGH,
        95,
        JSON.stringify({
          transactionId: confirmation.transactionId,
          confirmer: confirmation.confirmer,
          blockNumber: confirmation.blockNumber,
          transactionHash: confirmation.transactionHash,
        }),
        JSON.stringify(['email', 'slack']),
      ]
    );
  }
  
  private calculateTransferPercentage(value: string, balance: string): number {
    return ModelUtils.calculateTransferPercentage(value, balance);
  }
  
  // ============================================================================
  // DATABASE MAPPING HELPERS
  // ============================================================================
  
  private mapWalletFromDb(row: any): WalletModel {
    return {
      id: row.id,
      address: row.address,
      name: row.name,
      description: row.description,
      network: row.network,
      type: row.type,
      owners: row.owners,
      required: row.required,
      dailyLimit: row.daily_limit,
      balance: row.balance,
      monitored: row.monitored,
      alertThresholds: row.alert_thresholds,
      contactList: row.contact_list,
      slackWebhook: row.slack_webhook,
      notificationChannels: row.notification_channels,
      registeredBy: row.registered_by,
      registeredAt: row.registered_at,
      lastActivity: row.last_activity,
      lastSync: row.last_sync,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
  
  private mapOwnerFromDb(row: any): OwnerModel {
    return {
      id: row.id,
      address: row.address,
      network: row.network,
      contractData: {
        firstSeen: row.first_seen,
        wallets: row.wallets,
        transactionCount: row.transaction_count,
        lastActivity: row.last_activity,
      },
      manualData: {
        name: row.name,
        organization: row.organization,
        role: row.role,
        email: row.email,
        phone: row.phone,
        verified: row.verified,
        approvedBy: row.approved_by,
        approvedAt: row.approved_at,
        notes: row.notes,
      },
      riskLevel: row.risk_level,
      confidenceScore: row.confidence_score,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
  
  private mapTransactionFromDb(row: any): TransactionModel {
    return {
      id: row.id,
      walletId: row.wallet_id,
      transactionId: row.transaction_id,
      blockNumber: row.block_number,
      transactionHash: row.transaction_hash,
      action: row.action,
      submitter: row.submitter,
      destination: row.destination,
      value: row.value,
      data: row.data,
      decodedData: row.decoded_data,
      walletBalance: row.wallet_balance,
      transferPercentage: row.transfer_percentage,
      validationStatus: row.validation_status,
      riskScore: row.risk_score,
      riskFactors: row.risk_factors,
      confirmations: row.confirmations,
      requiredConfirmations: row.required_confirmations,
      executedAt: row.executed_at,
      executionStatus: row.execution_status,
      submittedAt: row.submitted_at,
      validatedAt: row.validated_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ============================================================================
  // SLACK NOTIFICATION HELPERS
  // ============================================================================

  private async sendTransactionSubmissionNotification(
    wallet: WalletConfig,
    submission: TransactionSubmissionData,
    action: TransactionAction,
    walletRecord: WalletModel
  ): Promise<void> {
    this.logger.debug('Starting sendTransactionSubmissionNotification', {
      wallet: wallet.address,
      network: wallet.network,
      transactionId: submission.transactionId,
      submitter: submission.submitter,
      action
    });

    try {
      const alert: TransactionAlert = {
        wallet: {
          address: wallet.address,
          name: walletRecord.name,
          network: wallet.network
        },
        transaction: {
          id: submission.transactionId,
          action,
          submitter: submission.submitter,
          destination: submission.destination,
          value: submission.value,
          required: walletRecord.required,
          confirmations: 0,
          hash: submission.transactionHash
        },
        alertType: 'submission',
        timestamp: submission.timestamp
      };

      // Check if it's a large transaction (> 1 ETH)
      const valueInEth = parseFloat(submission.value) / 1e18;
      
      this.logger.info('Sending transaction submission notification', {
        wallet: wallet.address,
        transactionId: submission.transactionId,
        action,
        value: submission.value,
        valueInEth,
        isLargeTransaction: valueInEth > 1,
        destination: submission.destination
      });

      if (valueInEth > 1) {
        await this.slackNotifier.notifyLargeTransaction(alert);
        this.logger.info('Large transaction notification sent', {
          transactionId: submission.transactionId,
          valueInEth
        });
      } else {
        await this.slackNotifier.notifyTransactionSubmission(alert);
        this.logger.info('Transaction submission notification sent', {
          transactionId: submission.transactionId
        });
      }

      // Check if destination is unknown
      if (submission.destination && await this.isUnknownRecipient(submission.destination, wallet.network)) {
        await this.slackNotifier.notifyUnknownRecipient(alert);
        this.logger.info('Unknown recipient notification sent', {
          transactionId: submission.transactionId,
          destination: submission.destination
        });
      }

    } catch (error) {
      this.logger.error('Failed to send transaction submission notification:', {
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
        wallet: wallet.address,
        transactionId: submission.transactionId
      });
    }
  }

  private async sendTransactionConfirmationNotification(
    wallet: WalletConfig,
    confirmation: TransactionConfirmationData,
    confirmations: any[]
  ): Promise<void> {
    this.logger.debug('Starting sendTransactionConfirmationNotification', {
      wallet: wallet.address,
      network: wallet.network,
      transactionId: confirmation.transactionId,
      confirmer: confirmation.confirmer,
      confirmationCount: confirmations.length
    });

    try {
      // Get wallet and transaction details
      const walletRecord = await this.getWalletByAddress(wallet.address, wallet.network);
      const transaction = await this.getTransactionByWalletAndId(
        wallet.address,
        wallet.network,
        confirmation.transactionId
      );

      this.logger.debug('Retrieved wallet and transaction records', {
        walletFound: !!walletRecord,
        transactionFound: !!transaction,
        walletId: walletRecord?.id,
        transactionAction: transaction?.action
      });

      if (!walletRecord || !transaction) {
        this.logger.warn('Cannot send confirmation notification - missing data', {
          wallet: wallet.address,
          transactionId: confirmation.transactionId,
          walletFound: !!walletRecord,
          transactionFound: !!transaction
        });
        return;
      }

      const alert: TransactionAlert = {
        wallet: {
          address: wallet.address,
          name: walletRecord.name,
          network: wallet.network
        },
        transaction: {
          id: confirmation.transactionId,
          action: transaction.action,
          submitter: transaction.submitter,
          destination: transaction.destination,
          value: transaction.value,
          required: walletRecord.required,
          confirmations: confirmations.length,
          hash: confirmation.transactionHash
        },
        alertType: 'confirmation',
        timestamp: confirmation.timestamp,
        confirmer: confirmation.confirmer
      };

      this.logger.info('Sending transaction confirmation notification', {
        wallet: wallet.address,
        transactionId: confirmation.transactionId,
        confirmer: confirmation.confirmer,
        confirmations: `${confirmations.length}/${walletRecord.required}`,
        action: transaction.action,
        value: transaction.value
      });

      await this.slackNotifier.notifyTransactionConfirmation(alert);

      this.logger.info('Transaction confirmation notification sent successfully', {
        wallet: wallet.address,
        transactionId: confirmation.transactionId
      });

    } catch (error) {
      this.logger.error('Failed to send transaction confirmation notification:', {
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
        wallet: wallet.address,
        transactionId: confirmation.transactionId,
        confirmer: confirmation.confirmer
      });
    }
  }

  private async sendTransactionExecutionNotification(
    wallet: WalletConfig,
    transactionId: number,
    timestamp: Date,
    transactionHash?: string,
    executor?: string
  ): Promise<void> {
    try {
      // Get wallet and transaction details
      const walletRecord = await this.getWalletByAddress(wallet.address, wallet.network);
      const transaction = await this.getTransactionByWalletAndId(
        wallet.address,
        wallet.network,
        transactionId
      );

      if (!walletRecord || !transaction) return;

      const alert: TransactionAlert = {
        wallet: {
          address: wallet.address,
          name: walletRecord.name,
          network: wallet.network
        },
        transaction: {
          id: transactionId,
          action: transaction.action,
          submitter: transaction.submitter,
          destination: transaction.destination,
          value: transaction.value,
          required: walletRecord.required,
          confirmations: walletRecord.required, // Fully confirmed if executed
          hash: transactionHash
        },
        alertType: 'execution',
        timestamp,
        executor: executor || 'Unknown'
      };

      await this.slackNotifier.notifyTransactionExecution(alert);

    } catch (error) {
      this.logger.error('Failed to send transaction execution notification:', error);
    }
  }

  private async sendOwnerChangeNotification(
    wallet: WalletConfig,
    change: OwnerChangeData,
    timestamp: Date,
    transactionHash?: string
  ): Promise<void> {
    try {
      const walletRecord = await this.getWalletByAddress(wallet.address, wallet.network);
      if (!walletRecord) return;

      const alert: OwnerAlert = {
        wallet: {
          address: wallet.address,
          name: walletRecord.name,
          network: wallet.network
        },
        change: {
          type: change.changeType,
          owner: change.owner,
          newOwner: change.newOwner
        },
        timestamp,
        transactionHash
      };

      await this.slackNotifier.notifyOwnerChange(alert);

    } catch (error) {
      this.logger.error('Failed to send owner change notification:', error);
    }
  }

  private async isUnknownRecipient(address: string, network: NetworkType): Promise<boolean> {
    try {
      const result = await this.db.query(
        'SELECT id FROM recipients WHERE address = $1 AND network = $2',
        [address, network]
      );
      return result.length === 0;
    } catch (error) {
      this.logger.error('Failed to check recipient status:', error);
      return true; // Assume unknown if check fails
    }
  }

}