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
} from '@multisig-validator/shared';
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
        // 1. Get or create submitter owner record
        const submitter = await this.getOrCreateOwner(
          submission.submitter,
          wallet.network,
          client
        );
        
        // 2. Get wallet record
        const walletRecord = await this.getWalletByAddress(
          wallet.address,
          wallet.network,
          client
        );
        
        if (!walletRecord) {
          throw new Error(`Wallet not found: ${wallet.address}`);
        }
        
        // 3. Decode transaction data if available
        let decodedData = null;
        if (submission.data && submission.data !== '0x') {
          // TODO: Implement transaction data decoding
          decodedData = {
            functionName: action,
            parameters: {}
          };
        }
        
        // 4. Create transaction record
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
        
        // 5. Update owner activity
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
          (c: any) => c.owner.toLowerCase() === confirmation.confirmer.toLowerCase()
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
          owner: confirmation.confirmer,
          confirmedAt: confirmation.timestamp.toISOString(),
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
    transactionId: number
  ): Promise<void> {
    try {
      await this.db.transaction(async (client) => {
        // Update transaction status
        await client.query(
          `UPDATE transactions 
           SET executed_at = $1, execution_status = 'executed', updated_at = NOW()
           WHERE wallet_id = (SELECT id FROM wallets WHERE address = $2 AND network = $3)
           AND transaction_id = $4`,
          [event.timestamp, wallet.address, wallet.network, transactionId]
        );
        
        // Update wallet balance (will be synced later)
        await this.syncWalletState(wallet.address, wallet.network, client);
      });
      
      this.logger.info('Transaction execution processed', {
        wallet: wallet.address,
        transactionId,
      });

      // Send Slack notification for transaction execution
      await this.sendTransactionExecutionNotification(wallet, transactionId, event.timestamp);
      
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
      await this.sendOwnerChangeNotification(wallet, change, event.timestamp);
      
    } catch (error) {
      this.logger.error('Failed to process owner change:', error);
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
    client: any
  ): Promise<WalletModel | null> {
    const result = await client.query(
      'SELECT * FROM wallets WHERE address = $1 AND network = $2',
      [address, network]
    );
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return this.mapWalletFromDb(result.rows[0]);
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
    client: any
  ): Promise<TransactionModel | null> {
    const result = await client.query(
      `SELECT t.* FROM transactions t
       JOIN wallets w ON t.wallet_id = w.id
       WHERE w.address = $1 AND w.network = $2 AND t.transaction_id = $3`,
      [walletAddress, network, transactionId]
    );
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return this.mapTransactionFromDb(result.rows[0]);
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
    // TODO: Sync wallet state from blockchain
    // This would update owners, balance, requirements, etc.
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
    const priority = AlertPriority.P1; // Owner changes are critical
    
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
        AlertPriority.P1, // Critical system issue
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
          confirmations: 0
        },
        alertType: 'submission',
        timestamp: submission.timestamp
      };

      // Check if it's a large transaction (> 1 ETH)
      const valueInEth = parseFloat(submission.value) / 1e18;
      if (valueInEth > 1) {
        await this.slackNotifier.notifyLargeTransaction(alert);
      } else {
        await this.slackNotifier.notifyTransactionSubmission(alert);
      }

      // Check if destination is unknown
      if (submission.destination && await this.isUnknownRecipient(submission.destination, wallet.network)) {
        await this.slackNotifier.notifyUnknownRecipient(alert);
      }

    } catch (error) {
      this.logger.error('Failed to send transaction submission notification:', error);
    }
  }

  private async sendTransactionConfirmationNotification(
    wallet: WalletConfig,
    confirmation: TransactionConfirmationData,
    confirmations: any[]
  ): Promise<void> {
    try {
      // Get wallet and transaction details
      const walletRecord = await this.getWalletByAddress(wallet.address, wallet.network);
      const transaction = await this.getTransactionByWalletAndId(
        wallet.address,
        wallet.network,
        confirmation.transactionId
      );

      if (!walletRecord || !transaction) return;

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
          confirmations: confirmations.length
        },
        alertType: 'confirmation',
        timestamp: confirmation.timestamp
      };

      await this.slackNotifier.notifyTransactionConfirmation(alert);

    } catch (error) {
      this.logger.error('Failed to send transaction confirmation notification:', error);
    }
  }

  private async sendTransactionExecutionNotification(
    wallet: WalletConfig,
    transactionId: number,
    timestamp: Date
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
          confirmations: walletRecord.required // Fully confirmed if executed
        },
        alertType: 'execution',
        timestamp
      };

      await this.slackNotifier.notifyTransactionExecution(alert);

    } catch (error) {
      this.logger.error('Failed to send transaction execution notification:', error);
    }
  }

  private async sendOwnerChangeNotification(
    wallet: WalletConfig,
    change: OwnerChangeData,
    timestamp: Date
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
        timestamp
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

  private async getWalletByAddress(address: string, network: NetworkType): Promise<WalletModel | null> {
    try {
      const result = await this.db.query(
        'SELECT * FROM wallets WHERE address = $1 AND network = $2',
        [address, network]
      );
      
      if (result.length === 0) return null;
      return this.mapWalletFromDb(result[0]);
    } catch (error) {
      this.logger.error('Failed to get wallet:', error);
      return null;
    }
  }

  private async getTransactionByWalletAndId(
    walletAddress: string,
    network: NetworkType,
    transactionId: number
  ): Promise<TransactionModel | null> {
    try {
      const result = await this.db.query(
        `SELECT t.* FROM transactions t
         JOIN wallets w ON t.wallet_id = w.id
         WHERE w.address = $1 AND w.network = $2 AND t.transaction_id = $3`,
        [walletAddress, network, transactionId]
      );
      
      if (result.length === 0) return null;
      return this.mapTransactionFromDb(result[0]);
    } catch (error) {
      this.logger.error('Failed to get transaction:', error);
      return null;
    }
  }
}