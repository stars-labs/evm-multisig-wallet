// Database Models for MultiSig Validator Service
// Using Prisma-like model definitions that can be adapted to your ORM of choice

import {
  NetworkType,
  WalletType,
  TransactionAction,
  ValidationStatus,
  AlertPriority,
  AlertStatus,
  RiskLevel,
  OwnerStatus,
  NotificationChannel,
  RecipientCategory,
  AlertThresholds,
  WalletContact,
  TransactionConfirmation,
  DecodedTransactionData,
  AlertContext
} from '../types';

// ============================================================================
// BASE MODEL INTERFACE
// ============================================================================

export interface BaseModel {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// WALLET MODEL
// ============================================================================

export interface WalletModel extends BaseModel {
  // Basic information
  address: string;
  name: string;
  description?: string;
  network: NetworkType;
  type: WalletType;
  
  // Contract state (synced from blockchain)
  owners: string[]; // JSON array of owner addresses
  required: number;
  dailyLimit?: string; // Wei amount as string, null if no daily limit
  balance: string; // Wei amount as string
  
  // Monitoring configuration
  monitored: boolean;
  alertThresholds: AlertThresholds; // JSON object
  
  // Communication settings
  contactList: WalletContact[]; // JSON array
  slackWebhook?: string;
  notificationChannels: NotificationChannel[]; // JSON array
  
  // Metadata
  registeredBy: string;
  registeredAt: Date;
  lastActivity?: Date;
  lastSync?: Date;
  
  // Relations
  transactions?: TransactionModel[];
  alerts?: AlertModel[];
  configurations?: ConfigurationModel[];
}

// Default alert thresholds for new wallets
export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  transferPercentage: 10,
  rapidTransactionCount: 3,
  rapidTransactionWindow: 3600, // 1 hour
  dailyLimitIncreasePercent: 50,
  unknownRecipientAlert: true,
  ownerChangeAlert: true,
  requirementChangeAlert: true
};

// ============================================================================
// OWNER MODEL
// ============================================================================

export interface OwnerContractDataModel {
  firstSeen: Date;
  wallets: string[]; // Array of wallet addresses
  transactionCount: number;
  lastActivity?: Date;
}

export interface OwnerManualDataModel {
  name?: string;
  organization?: string;
  role?: string;
  email?: string;
  phone?: string;
  verified: boolean;
  approvedBy?: string;
  approvedAt?: Date;
  notes?: string;
}

export interface OwnerModel extends BaseModel {
  address: string;
  network: NetworkType;
  
  // Automatic discovery data
  contractData: OwnerContractDataModel; // JSON object
  
  // Manual enhancement data
  manualData: OwnerManualDataModel; // JSON object
  
  // Computed fields
  riskLevel: RiskLevel;
  confidenceScore: number; // 0-100
  status: OwnerStatus;
  
  // Relations
  submittedTransactions?: TransactionModel[];
}

// ============================================================================
// RECIPIENT MODEL
// ============================================================================

export interface RecipientModel extends BaseModel {
  address: string;
  network: NetworkType;
  
  // Classification
  name?: string;
  category: RecipientCategory;
  description?: string;
  
  // Risk assessment
  riskLevel: RiskLevel;
  verified: boolean;
  
  // Source tracking
  source: string; // 'manual', 'etherscan', 'defipulse', etc.
  addedBy: string;
  verifiedBy?: string;
  
  // Relations
  receivedTransactions?: TransactionModel[];
}

// ============================================================================
// TRANSACTION MODEL
// ============================================================================

export interface TransactionModel extends BaseModel {
  walletId: string;
  
  // Blockchain data
  transactionId: number; // MultiSig transaction ID
  blockNumber?: number;
  transactionHash?: string;
  
  // Transaction details
  action: TransactionAction;
  submitter: string;
  destination?: string;
  value: string; // Wei amount as string
  data?: string; // Raw transaction data
  decodedData?: DecodedTransactionData; // JSON object
  
  // Context at submission time
  walletBalance: string;
  transferPercentage?: number;
  gasPrice?: string;
  gasLimit?: number;
  
  // Validation results
  validationStatus: ValidationStatus;
  riskScore: number; // 0-10
  riskFactors: string[]; // JSON array
  
  // Execution tracking
  confirmations: TransactionConfirmation[]; // JSON array
  requiredConfirmations: number;
  executedAt?: Date;
  executionStatus: 'pending' | 'executed' | 'failed';
  
  // Timeline
  submittedAt: Date;
  validatedAt?: Date;
  
  // Relations
  wallet?: WalletModel;
  alerts?: AlertModel[];
}

// ============================================================================
// ALERT MODEL
// ============================================================================

export interface AlertModel extends BaseModel {
  walletId: string;
  transactionId?: string;
  
  // Alert classification
  priority: AlertPriority;
  type: string;
  title: string;
  message: string;
  
  // Risk assessment
  riskLevel: RiskLevel;
  severityScore: number; // 0-100
  
  // Context data
  context: AlertContext; // JSON object
  
  // Notification tracking
  notificationChannels: NotificationChannel[]; // JSON array
  notifiedAt?: Date;
  
  // Alert lifecycle
  status: AlertStatus;
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
  resolvedBy?: string;
  resolvedAt?: Date;
  resolutionNotes?: string;
  
  // Relations
  wallet?: WalletModel;
  transaction?: TransactionModel;
  notifications?: NotificationModel[];
}

// ============================================================================
// CONFIGURATION MODEL
// ============================================================================

export interface ConfigurationModel extends BaseModel {
  walletId?: string; // null for global config
  
  // Configuration scope
  scope: 'global' | 'wallet' | 'network';
  category: 'thresholds' | 'notifications' | 'validation';
  
  // Configuration data
  settings: Record<string, any>; // JSON object
  
  // Metadata
  createdBy: string;
  updatedBy?: string;
  
  // Relations
  wallet?: WalletModel;
}

// ============================================================================
// NOTIFICATION MODEL
// ============================================================================

export interface NotificationModel extends BaseModel {
  alertId: string;
  
  // Notification details
  channel: NotificationChannel;
  recipient: string;
  subject?: string;
  content: string;
  
  // Delivery tracking
  sentAt: Date;
  deliveredAt?: Date;
  deliveryStatus: 'pending' | 'sent' | 'delivered' | 'failed';
  errorMessage?: string;
  
  // Response tracking
  openedAt?: Date;
  clickedAt?: Date;
  responseData?: Record<string, any>; // JSON object
  
  // Relations
  alert?: AlertModel;
}

// ============================================================================
// AUDIT LOG MODEL
// ============================================================================

export interface AuditLogModel {
  id: string;
  
  // Action details
  action: string;
  entityType: 'wallet' | 'owner' | 'transaction' | 'alert' | 'recipient' | 'configuration';
  entityId?: string;
  
  // User context
  userId?: string;
  userAgent?: string;
  ipAddress?: string;
  
  // Change tracking
  oldValues?: Record<string, any>; // JSON object
  newValues?: Record<string, any>; // JSON object
  
  // Metadata
  timestamp: Date;
  success: boolean;
  errorMessage?: string;
}

// ============================================================================
// MODEL VALIDATION SCHEMAS
// ============================================================================

export const ModelValidation = {
  // Ethereum address validation
  isValidAddress: (address: string): boolean => {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  },
  
  // Wei amount validation (must be numeric string)
  isValidWeiAmount: (amount: string): boolean => {
    return /^\d+$/.test(amount);
  },
  
  // Transaction hash validation
  isValidTxHash: (hash: string): boolean => {
    return /^0x[a-fA-F0-9]{64}$/.test(hash);
  },
  
  // Email validation
  isValidEmail: (email: string): boolean => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  },
  
  // URL validation
  isValidUrl: (url: string): boolean => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  },
  
  // Risk score validation (0-10)
  isValidRiskScore: (score: number): boolean => {
    return Number.isInteger(score) && score >= 0 && score <= 10;
  },
  
  // Confidence score validation (0-100)
  isValidConfidenceScore: (score: number): boolean => {
    return Number.isInteger(score) && score >= 0 && score <= 100;
  },
  
  // Severity score validation (0-100)
  isValidSeverityScore: (score: number): boolean => {
    return Number.isInteger(score) && score >= 0 && score <= 100;
  }
};

// ============================================================================
// MODEL UTILITIES
// ============================================================================

export const ModelUtils = {
  // Generate unique wallet identifier
  generateWalletKey: (address: string, network: NetworkType): string => {
    return `${network}:${address.toLowerCase()}`;
  },
  
  // Generate unique owner identifier
  generateOwnerKey: (address: string, network: NetworkType): string => {
    return `${network}:${address.toLowerCase()}`;
  },
  
  // Generate unique recipient identifier
  generateRecipientKey: (address: string, network: NetworkType): string => {
    return `${network}:${address.toLowerCase()}`;
  },
  
  // Calculate transfer percentage
  calculateTransferPercentage: (transferValue: string, walletBalance: string): number => {
    const transfer = BigInt(transferValue);
    const balance = BigInt(walletBalance);
    
    if (balance === 0n) return 0;
    
    // Calculate percentage with 2 decimal places
    const percentage = (Number(transfer) / Number(balance)) * 100;
    return Math.round(percentage * 100) / 100;
  },
  
  // Format wei to ETH for display
  formatWeiToEth: (weiAmount: string): string => {
    const wei = BigInt(weiAmount);
    const eth = Number(wei) / 1e18;
    return eth.toFixed(6);
  },
  
  // Parse ETH to wei
  parseEthToWei: (ethAmount: string): string => {
    const eth = parseFloat(ethAmount);
    const wei = BigInt(Math.floor(eth * 1e18));
    return wei.toString();
  },
  
  // Check if transaction is high value
  isHighValueTransaction: (value: string, balance: string, thresholdPercent: number): boolean => {
    const transferPercentage = ModelUtils.calculateTransferPercentage(value, balance);
    return transferPercentage > thresholdPercent;
  },
  
  // Generate alert ID from transaction
  generateAlertId: (walletId: string, transactionId: string, alertType: string): string => {
    return `${walletId}-${transactionId}-${alertType}`;
  },
  
  // Check if owner is recognized
  isRecognizedOwner: (ownerAddress: string, owners: OwnerModel[]): boolean => {
    return owners.some(owner => 
      owner.address.toLowerCase() === ownerAddress.toLowerCase() && 
      owner.status === OwnerStatus.ACTIVE
    );
  },
  
  // Check if recipient is whitelisted
  isWhitelistedRecipient: (recipientAddress: string, recipients: RecipientModel[]): boolean => {
    return recipients.some(recipient => 
      recipient.address.toLowerCase() === recipientAddress.toLowerCase() && 
      recipient.verified
    );
  },
  
  // Get risk level color for UI
  getRiskLevelColor: (riskLevel: RiskLevel): string => {
    switch (riskLevel) {
      case RiskLevel.LOW: return '#4CAF50';
      case RiskLevel.MEDIUM: return '#FF9800';
      case RiskLevel.HIGH: return '#F44336';
      case RiskLevel.CRITICAL: return '#9C27B0';
      default: return '#757575';
    }
  },
  
  // Get alert priority color for UI
  getAlertPriorityColor: (priority: AlertPriority): string => {
    switch (priority) {
      case AlertPriority.P1: return '#F44336'; // Red - Critical
      case AlertPriority.P2: return '#FF9800'; // Orange - High  
      case AlertPriority.P3: return '#2196F3'; // Blue - Medium
      default: return '#757575';
    }
  }
};

// ============================================================================
// EXPORT ALL MODELS
// ============================================================================

export type {
  BaseModel,
  WalletModel,
  OwnerModel,
  OwnerContractDataModel,
  OwnerManualDataModel,
  RecipientModel,
  TransactionModel,
  AlertModel,
  ConfigurationModel,
  NotificationModel,
  AuditLogModel
};

export {
  DEFAULT_ALERT_THRESHOLDS,
  ModelValidation,
  ModelUtils
};