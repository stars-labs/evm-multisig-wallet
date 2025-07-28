// Shared TypeScript types for MultiSig Validator Service
// Used by both backend and frontend

// ============================================================================
// ENUMS
// ============================================================================

export enum NetworkType {
  MAINNET = 'mainnet',
  SEPOLIA = 'sepolia',
  GOERLI = 'goerli',
  POLYGON = 'polygon',
  ARBITRUM = 'arbitrum',
  LOCALHOST = 'localhost'
}

export enum WalletType {
  MULTISIG_WALLET = 'MultiSigWallet',
  MULTISIG_WALLET_WITH_DAILY_LIMIT = 'MultiSigWalletWithDailyLimit',
  GNOSIS_SAFE = 'GnosisSafe'
}

export enum TransactionAction {
  TRANSFER = 'transfer',
  ADD_OWNER = 'addOwner',
  REMOVE_OWNER = 'removeOwner',
  REPLACE_OWNER = 'replaceOwner',
  CHANGE_REQUIREMENT = 'changeRequirement',
  CHANGE_DAILY_LIMIT = 'changeDailyLimit',
  CONTRACT_CALL = 'contractCall'
}

export enum ValidationStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  FLAGGED = 'flagged',
  REJECTED = 'rejected'
}

export enum AlertPriority {
  P1 = 'P1', // Critical
  P2 = 'P2', // High
  P3 = 'P3'  // Medium
}

export enum AlertStatus {
  ACTIVE = 'active',
  ACKNOWLEDGED = 'acknowledged',
  RESOLVED = 'resolved',
  FALSE_POSITIVE = 'false_positive'
}

export enum RiskLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export enum OwnerStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  FLAGGED = 'flagged',
  REMOVED = 'removed'
}

export enum NotificationChannel {
  EMAIL = 'email',
  SLACK = 'slack',
  DISCORD = 'discord',
  WEBHOOK = 'webhook',
  SMS = 'sms'
}

export enum RecipientCategory {
  EXCHANGE = 'exchange',
  DEFI = 'defi',
  TREASURY = 'treasury',
  PERSONAL = 'personal',
  CONTRACT = 'contract',
  TOKEN = 'token',
  BURN = 'burn'
}

// ============================================================================
// BASE INTERFACES
// ============================================================================

export interface BaseEntity {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TimestampedEntity {
  createdAt: Date;
  updatedAt?: Date;
}

// ============================================================================
// WALLET RELATED TYPES
// ============================================================================

export interface AlertThresholds {
  transferPercentage: number;
  rapidTransactionCount: number;
  rapidTransactionWindow: number; // seconds
  dailyLimitIncreasePercent: number;
  unknownRecipientAlert: boolean;
  ownerChangeAlert: boolean;
  requirementChangeAlert: boolean;
}

export interface WalletContact {
  email: string;
  name?: string;
  role?: string;
}

export interface Wallet extends BaseEntity {
  address: string;
  name: string;
  description?: string;
  network: NetworkType;
  type: WalletType;
  
  // Contract state
  owners: string[];
  required: number;
  dailyLimit?: string; // Wei amount as string
  balance: string; // Wei amount as string
  
  // Monitoring configuration
  monitored: boolean;
  alertThresholds: AlertThresholds;
  
  // Communication settings
  contactList: WalletContact[];
  slackWebhook?: string;
  notificationChannels: NotificationChannel[];
  
  // Metadata
  registeredBy: string;
  registeredAt: Date;
  lastActivity?: Date;
  lastSync?: Date;
}

export interface WalletCreateRequest {
  address: string;
  name: string;
  description?: string;
  network: NetworkType;
  alertThresholds?: Partial<AlertThresholds>;
  contactList?: WalletContact[];
  slackWebhook?: string;
  notificationChannels?: NotificationChannel[];
}

export interface WalletSummary extends Wallet {
  latestActivity: Date;
  transactionCount: number;
  activeAlerts: number;
  criticalAlerts: number;
}

// ============================================================================
// OWNER RELATED TYPES
// ============================================================================

export interface OwnerContractData {
  firstSeen: Date;
  wallets: string[]; // Array of wallet addresses
  transactionCount: number;
  lastActivity?: Date;
}

export interface OwnerManualData {
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

export interface Owner extends BaseEntity {
  address: string;
  network: NetworkType;
  
  // Automatic discovery data
  contractData: OwnerContractData;
  
  // Manual enhancement data
  manualData: OwnerManualData;
  
  // Computed fields
  riskLevel: RiskLevel;
  confidenceScore: number; // 0-100
  status: OwnerStatus;
}

export interface OwnerCreateRequest {
  address: string;
  network: NetworkType;
  name?: string;
  organization?: string;
  role?: string;
  email?: string;
  phone?: string;
  notes?: string;
}

export interface OwnerVerificationRequest {
  verified: boolean;
  notes?: string;
}

// ============================================================================
// RECIPIENT RELATED TYPES
// ============================================================================

export interface Recipient extends BaseEntity {
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
}

export interface RecipientCreateRequest {
  address: string;
  network: NetworkType;
  name?: string;
  category: RecipientCategory;
  description?: string;
  riskLevel?: RiskLevel;
  source?: string;
}

// ============================================================================
// TRANSACTION RELATED TYPES
// ============================================================================

export interface TransactionConfirmation {
  owner: string;
  confirmedAt: Date;
}

export interface DecodedTransactionData {
  functionName: string;
  parameters: Record<string, any>;
}

export interface Transaction extends BaseEntity {
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
  decodedData?: DecodedTransactionData;
  
  // Context at submission
  walletBalance: string;
  transferPercentage?: number;
  gasPrice?: string;
  gasLimit?: number;
  
  // Validation results
  validationStatus: ValidationStatus;
  riskScore: number; // 0-10
  riskFactors: string[];
  
  // Execution tracking
  confirmations: TransactionConfirmation[];
  requiredConfirmations: number;
  executedAt?: Date;
  executionStatus: 'pending' | 'executed' | 'failed';
  
  // Timeline
  submittedAt: Date;
  validatedAt?: Date;
}

export interface TransactionWithContext extends Transaction {
  walletName: string;
  walletAddress: string;
  submitterName?: string;
  submitterOrganization?: string;
  recipientName?: string;
  recipientRiskLevel?: RiskLevel;
  isUnknownRecipient: boolean;
}

// ============================================================================
// ALERT RELATED TYPES
// ============================================================================

export interface AlertContext {
  [key: string]: any;
}

export interface Alert extends BaseEntity {
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
  context: AlertContext;
  
  // Notification tracking
  notificationChannels: NotificationChannel[];
  notifiedAt?: Date;
  
  // Alert lifecycle
  status: AlertStatus;
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
  resolvedBy?: string;
  resolvedAt?: Date;
  resolutionNotes?: string;
}

export interface AlertCreateRequest {
  walletId: string;
  transactionId?: string;
  priority: AlertPriority;
  type: string;
  title: string;
  message: string;
  riskLevel: RiskLevel;
  severityScore?: number;
  context?: AlertContext;
}

export interface AlertWithContext extends Alert {
  walletName: string;
  walletAddress: string;
  transactionAction?: TransactionAction;
  transactionDestination?: string;
  transactionValue?: string;
}

export interface AlertAcknowledgmentRequest {
  notes?: string;
}

export interface AlertResolutionRequest {
  status: AlertStatus.RESOLVED | AlertStatus.FALSE_POSITIVE;
  notes?: string;
}

// ============================================================================
// CONFIGURATION TYPES
// ============================================================================

export interface RiskScoreThresholds {
  low: number;
  medium: number;
  high: number;
}

export interface GlobalThresholds {
  defaultTransferPercentage: number;
  defaultRapidTransactionCount: number;
  defaultRapidTransactionWindow: number;
  defaultDailyLimitIncreasePercent: number;
  riskScoreThresholds: RiskScoreThresholds;
}

export interface NotificationChannelConfig {
  enabled: boolean;
  rateLimit: number;
}

export interface GlobalNotificationConfig {
  retryAttempts: number;
  retryDelay: number;
  maxNotificationsPerHour: number;
  channels: Record<NotificationChannel, NotificationChannelConfig>;
}

export interface ConfidenceThresholds {
  autoApprove: number;
  requireReview: number;
}

export interface GlobalValidationConfig {
  enableOwnerLearning: boolean;
  autoApproveKnownRecipients: boolean;
  requireManualApprovalForHighRisk: boolean;
  confidenceThresholds: ConfidenceThresholds;
}

export interface Configuration extends BaseEntity {
  walletId?: string; // null for global config
  scope: 'global' | 'wallet' | 'network';
  category: 'thresholds' | 'notifications' | 'validation';
  settings: Record<string, any>;
  createdBy: string;
  updatedBy?: string;
}

// ============================================================================
// NOTIFICATION TYPES
// ============================================================================

export interface Notification extends BaseEntity {
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
  responseData?: Record<string, any>;
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface FilterParams {
  network?: NetworkType;
  status?: string;
  riskLevel?: RiskLevel;
  dateFrom?: string;
  dateTo?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// ============================================================================
// DASHBOARD TYPES
// ============================================================================

export interface DashboardStats {
  totalWallets: number;
  activeWallets: number;
  totalTransactions: number;
  pendingTransactions: number;
  activeAlerts: number;
  criticalAlerts: number;
  totalOwners: number;
  verifiedOwners: number;
}

export interface AlertSummary {
  priority: AlertPriority;
  count: number;
  latestAt?: Date;
}

export interface WalletActivity {
  walletId: string;
  walletName: string;
  walletAddress: string;
  transactionCount: number;
  lastActivity: Date;
  riskScore: number;
}

// ============================================================================
// WEBHOOK TYPES
// ============================================================================

export interface SlackWebhookPayload {
  text: string;
  attachments?: Array<{
    color: 'good' | 'warning' | 'danger';
    title: string;
    text: string;
    fields?: Array<{
      title: string;
      value: string;
      short: boolean;
    }>;
    actions?: Array<{
      type: string;
      text: string;
      url: string;
      style?: 'primary' | 'danger';
    }>;
  }>;
}

// ============================================================================
// BLOCKCHAIN EVENT TYPES
// ============================================================================

export interface MultiSigEvent {
  event: string;
  address: string;
  blockNumber: number;
  transactionHash: string;
  args: Record<string, any>;
}

export interface SubmissionEvent extends MultiSigEvent {
  event: 'Submission';
  args: {
    transactionId: number;
  };
}

export interface ConfirmationEvent extends MultiSigEvent {
  event: 'Confirmation';
  args: {
    sender: string;
    transactionId: number;
  };
}

export interface ExecutionEvent extends MultiSigEvent {
  event: 'Execution';
  args: {
    transactionId: number;
  };
}

export interface OwnerAdditionEvent extends MultiSigEvent {
  event: 'OwnerAddition';
  args: {
    owner: string;
  };
}

export interface OwnerRemovalEvent extends MultiSigEvent {
  event: 'OwnerRemoval';
  args: {
    owner: string;
  };
}

// ============================================================================
// VALIDATION RESULT TYPES
// ============================================================================

export interface ValidationResult {
  status: ValidationStatus;
  riskScore: number;
  riskFactors: string[];
  recommendations: string[];
  autoApprove: boolean;
  requiresManualReview: boolean;
}

export interface OwnerValidationResult {
  isRecognized: boolean;
  confidenceScore: number;
  source: 'contract' | 'manual' | 'learned';
  riskLevel: RiskLevel;
}

export interface RecipientValidationResult {
  isWhitelisted: boolean;
  riskLevel: RiskLevel;
  category?: RecipientCategory;
  isFirstTimeInteraction: boolean;
}

// All types are already exported above with their interface declarations