// Shared types for multisig wallet validator backend

export enum NetworkType {
  MAINNET = 'mainnet',
  SEPOLIA = 'sepolia',
  GOERLI = 'goerli',
  LOCALHOST = 'localhost'
}

export enum WalletType {
  MULTISIG_WALLET = 'MultiSigWallet',
  MULTISIG_WALLET_WITH_DAILY_LIMIT = 'MultiSigWalletWithDailyLimit',
  SAFE = 'safe',
  DAO = 'dao'
}

export enum TransactionAction {
  SUBMISSION = 'submission',
  CONFIRMATION = 'confirmation',
  REVOCATION = 'revocation',
  EXECUTION = 'execution',
  EXECUTION_FAILURE = 'executionFailure',
  DEPOSIT = 'deposit',
  ADD_OWNER = 'addOwner',
  REMOVE_OWNER = 'removeOwner',
  REPLACE_OWNER = 'replaceOwner',
  CHANGE_REQUIREMENT = 'changeRequirement',
  CHANGE_DAILY_LIMIT = 'changeDailyLimit',
  CONTRACT_CALL = 'contractCall',
  TRANSFER = 'transfer'
}

export enum AlertPriority {
  P1 = 'P1',  // Critical priority
  P2 = 'P2',  // High priority  
  P3 = 'P3'   // Medium priority
}

export enum RiskLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export enum OwnerStatus {
  ADDED = 'added',
  REMOVED = 'removed'
}

export enum ValidationStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  FLAGGED = 'flagged',
  REJECTED = 'rejected'
}

export interface MultisigWallet {
  id: number;
  address: string;
  wallet_type: WalletType;
  name: string;
  required_confirmations: number;
  creation_time: Date;
  network_type: NetworkType;
  is_active: boolean;
}

export interface UserWallet {
  id: number;
  wallet_id: number;
  owner_address: string;
  added_time: Date;
  removed_time?: Date;
  is_active: boolean;
}

export interface TransactionData {
  id?: number;
  wallet_id: number;
  transaction_id: string;
  destination: string;
  value: string;
  data: string;
  executed: boolean;
  submission_time: Date;
  execution_time?: Date;
  submitter: string;
  confirmation_count: number;
  network_type: NetworkType;
  transaction_hash?: string;
}

export interface TransactionConfirmation {
  id?: number;
  transaction_id: number;
  owner_address: string;
  confirmed_time: Date;
  transaction_hash?: string;
}

export interface DecodedTransactionData {
  method: string;
  params: any;
  decodedData?: any;
}

export interface AlertContext {
  walletAddress: string;
  walletName?: string;
  transactionId?: string;
  destination?: string;
  value?: string;
  submitter?: string;
  executor?: string;
  owner?: string;
  oldOwner?: string;
  newOwner?: string;
  oldRequirement?: number;
  newRequirement?: number;
  confirmationCount?: number;
  requiredConfirmations?: number;
  isHighValue?: boolean;
  networkType: NetworkType;
  transactionHash?: string;
  confirmer?: string;
  revoker?: string;
}