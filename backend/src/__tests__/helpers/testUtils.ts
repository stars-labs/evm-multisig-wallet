// Comprehensive test utilities and helpers
import winston from 'winston';
import { ValidatorService } from '../../services/validatorService';
import { EventProcessor } from '../../services/eventProcessor';
import { ChainService } from '../../services/chainService';
import { SlackNotifier } from '../../services/slackNotifier';
import { Database } from '../../database';
import { TestDatabase, createTestDatabase } from './testDatabase';
import { NetworkType, WalletType, TransactionAction } from '../../types';
import { ethers } from 'ethers';

// Test logger with minimal output
export const createTestLogger = (): winston.Logger => {
  return winston.createLogger({
    level: 'error', // Only log errors during tests
    transports: [
      new winston.transports.Console({
        silent: process.env.NODE_ENV === 'test'
      })
    ]
  });
};

// Mock blockchain provider
export class MockBlockchainProvider {
  private blocks: Map<number, any> = new Map();
  private transactions: Map<string, any> = new Map();
  private contracts: Map<string, any> = new Map();
  
  constructor() {
    this.setupDefaultMocks();
  }

  private setupDefaultMocks(): void {
    // Mock latest block
    this.blocks.set(100, {
      number: 100,
      timestamp: Math.floor(Date.now() / 1000),
      hash: '0x1234567890abcdef',
      transactions: []
    });

    // Mock test contracts
    this.contracts.set('0x1234567890123456789012345678901234567890', {
      getOwners: () => ['0xowner1', '0xowner2', '0xowner3'],
      getRequired: () => 2,
      getBalance: () => BigInt('1000000000000000000'), // 1 ETH
      getDailyLimit: () => BigInt('500000000000000000') // 0.5 ETH
    });
  }

  async getBlockNumber(): Promise<number> {
    return Math.max(...this.blocks.keys());
  }

  async getBlock(blockNumber: number): Promise<any> {
    return this.blocks.get(blockNumber) || null;
  }

  async getTransaction(hash: string): Promise<any> {
    return this.transactions.get(hash) || null;
  }

  async getBalance(address: string): Promise<bigint> {
    const contract = this.contracts.get(address);
    return contract?.getBalance() || BigInt(0);
  }

  // Contract interaction mocks
  getContract(address: string): any {
    return this.contracts.get(address) || {
      getOwners: () => [],
      getRequired: () => 1,
      getBalance: () => BigInt(0)
    };
  }

  // Helper methods for test setup
  setBlock(blockNumber: number, block: any): void {
    this.blocks.set(blockNumber, block);
  }

  setTransaction(hash: string, transaction: any): void {
    this.transactions.set(hash, transaction);
  }

  setContract(address: string, contract: any): void {
    this.contracts.set(address, contract);
  }
}

// Test fixture factory
export class TestFixtures {
  private testDb: TestDatabase;
  private logger: winston.Logger;

  constructor(testDb: TestDatabase, logger: winston.Logger) {
    this.testDb = testDb;
    this.logger = logger;
  }

  // Create test wallet data
  async createWallet(overrides: Partial<any> = {}): Promise<any> {
    const defaultData = {
      address: `0x${Math.random().toString(16).substr(2, 40)}`,
      name: `Test Wallet ${Date.now()}`,
      network: 'localhost' as NetworkType,
      type: 'MultiSigWallet' as WalletType,
      owners: ['0xowner1', '0xowner2'],
      required: 2
    };

    return this.testDb.createTestWallet({ ...defaultData, ...overrides });
  }

  // Create test transaction data
  async createTransaction(walletId: string, overrides: Partial<any> = {}): Promise<any> {
    const defaultData = {
      walletId,
      transactionId: Math.floor(Math.random() * 1000000),
      action: 'transfer' as TransactionAction,
      submitter: '0xowner1',
      destination: '0xrecipient1',
      value: '100000000000000000' // 0.1 ETH
    };

    return this.testDb.createTestTransaction({ ...defaultData, ...overrides });
  }

  // Create test alert data
  async createAlert(walletId: string, overrides: Partial<any> = {}): Promise<any> {
    const defaultData = {
      walletId,
      priority: 'P2',
      type: 'large_transfer',
      title: 'Test Alert',
      message: 'This is a test alert'
    };

    return this.testDb.createTestAlert({ ...defaultData, ...overrides });
  }

  // Create multiple test entities
  async createMultipleWallets(count: number): Promise<any[]> {
    const wallets = [];
    for (let i = 0; i < count; i++) {
      wallets.push(await this.createWallet({ name: `Test Wallet ${i + 1}` }));
    }
    return wallets;
  }

  async createMultipleTransactions(walletId: string, count: number): Promise<any[]> {
    const transactions = [];
    for (let i = 0; i < count; i++) {
      transactions.push(await this.createTransaction(walletId, { 
        transactionId: i + 1 
      }));
    }
    return transactions;
  }
}

// Mock services factory
export class MockServicesFactory {
  private logger: winston.Logger;
  private testDb: TestDatabase;
  private mockProvider: MockBlockchainProvider;

  constructor(logger: winston.Logger, testDb: TestDatabase) {
    this.logger = logger;
    this.testDb = testDb;
    this.mockProvider = new MockBlockchainProvider();
  }

  createMockValidatorService(config: any = {}): ValidatorService {
    const defaultConfig = {
      networks: ['localhost' as NetworkType],
      syncInterval: 1000, // 1 second for tests
      enableValidation: true,
      autoProcessAlerts: true
    };

    // Mock the ValidatorService with simplified behavior
    return {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      addWallet: jest.fn().mockResolvedValue(undefined),
      removeWallet: jest.fn().mockResolvedValue(undefined),
      getMonitoredWallets: jest.fn().mockReturnValue([]),
      getWalletsFromDatabase: jest.fn().mockResolvedValue([]),
      getStatus: jest.fn().mockResolvedValue({
        isRunning: true,
        eventListener: { isRunning: true },
        database: true,
        wallets: { total: 0, byNetwork: {} }
      }),
      getMetrics: jest.fn().mockResolvedValue({
        events: { totalProcessed: 0, recentEvents: 0 },
        transactions: { pending: 0, executed: 0, failed: 0 },
        alerts: { active: 0, critical: 0 }
      }),
      healthCheck: jest.fn().mockResolvedValue({
        status: 'healthy',
        checks: { database: true, eventListener: true, service: true }
      })
    } as any;
  }

  createMockEventProcessor(config: any = {}): EventProcessor {
    const defaultConfig = {
      enableValidation: true,
      autoProcessAlerts: true,
      batchSize: 10
    };

    return {
      processTransactionSubmission: jest.fn().mockResolvedValue(undefined),
      processTransactionConfirmation: jest.fn().mockResolvedValue(undefined),
      processTransactionExecution: jest.fn().mockResolvedValue(undefined),
      processOwnerChange: jest.fn().mockResolvedValue(undefined)
    } as any;
  }

  createMockChainService(): ChainService {
    return {
      getAllChains: jest.fn().mockResolvedValue([]),
      getEnabledChains: jest.fn().mockResolvedValue([]),
      getChainByNetwork: jest.fn().mockResolvedValue(null),
      createChain: jest.fn().mockResolvedValue({}),
      updateChain: jest.fn().mockResolvedValue({}),
      updateSyncState: jest.fn().mockResolvedValue(true),
      incrementErrorCount: jest.fn().mockResolvedValue(undefined),
      resetErrorCount: jest.fn().mockResolvedValue(undefined),
      setSyncStatus: jest.fn().mockResolvedValue(undefined),
      getChainMetrics: jest.fn().mockResolvedValue({
        totalChains: 0,
        enabledChains: 0,
        runningChains: 0,
        errorChains: 0,
        chainSummary: []
      })
    } as any;
  }

  createMockSlackNotifier(): SlackNotifier {
    return {
      notifyTransactionSubmission: jest.fn().mockResolvedValue(undefined),
      notifyTransactionConfirmation: jest.fn().mockResolvedValue(undefined),
      notifyTransactionExecution: jest.fn().mockResolvedValue(undefined),
      notifyLargeTransaction: jest.fn().mockResolvedValue(undefined),
      notifyUnknownRecipient: jest.fn().mockResolvedValue(undefined),
      notifyOwnerChange: jest.fn().mockResolvedValue(undefined),
      testConnection: jest.fn().mockResolvedValue(true),
      isEnabled: jest.fn().mockReturnValue(false)
    } as any;
  }

  getProvider(): MockBlockchainProvider {
    return this.mockProvider;
  }
}

// Test environment setup
export class TestEnvironment {
  private testDb: TestDatabase;
  private logger: winston.Logger;
  private fixtures: TestFixtures;
  private mockServices: MockServicesFactory;

  constructor() {
    this.logger = createTestLogger();
    this.testDb = createTestDatabase(this.logger);
    this.fixtures = new TestFixtures(this.testDb, this.logger);
    this.mockServices = new MockServicesFactory(this.logger, this.testDb);
  }

  async setup(): Promise<void> {
    await this.testDb.setup();
  }

  async cleanup(): Promise<void> {
    await this.testDb.cleanup();
  }

  getDatabase(): TestDatabase {
    return this.testDb;
  }

  getLogger(): winston.Logger {
    return this.logger;
  }

  getFixtures(): TestFixtures {
    return this.fixtures;
  }

  getMockServices(): MockServicesFactory {
    return this.mockServices;
  }

  // Assertion helpers
  async expectDatabaseCount(table: string, expectedCount: number): Promise<void> {
    const result = await this.testDb.query(`SELECT COUNT(*) as count FROM ${table}`);
    const actualCount = parseInt(result[0].count);
    expect(actualCount).toBe(expectedCount);
  }

  async expectWalletExists(address: string, network: string): Promise<any> {
    const wallet = await this.testDb.queryOne(
      'SELECT * FROM wallets WHERE address = $1 AND network = $2',
      [address, network]
    );
    expect(wallet).toBeTruthy();
    return wallet;
  }

  async expectTransactionExists(walletId: string, transactionId: number): Promise<any> {
    const transaction = await this.testDb.queryOne(
      'SELECT * FROM transactions WHERE wallet_id = $1 AND transaction_id = $2',
      [walletId, transactionId]
    );
    expect(transaction).toBeTruthy();
    return transaction;
  }

  async expectAlertExists(walletId: string, type: string): Promise<any> {
    const alert = await this.testDb.queryOne(
      'SELECT * FROM alerts WHERE wallet_id = $1 AND type = $2',
      [walletId, type]
    );
    expect(alert).toBeTruthy();
    return alert;
  }

  // Time manipulation helpers
  async waitForAsyncOperations(timeout: number = 1000): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, timeout));
  }

  // Mock time for consistent testing
  mockTime(timestamp: number): jest.SpyInstance {
    return jest.spyOn(Date, 'now').mockReturnValue(timestamp);
  }

  restoreTime(spy: jest.SpyInstance): void {
    spy.mockRestore();
  }
}

// Global test setup helpers
export const setupTestEnvironment = async (): Promise<TestEnvironment> => {
  const env = new TestEnvironment();
  await env.setup();
  return env;
};

export const teardownTestEnvironment = async (env: TestEnvironment): Promise<void> => {
  await env.cleanup();
};

// Custom Jest matchers
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidEthereumAddress(): R;
      toBeValidTransactionHash(): R;
      toBeValidUUID(): R;
    }
  }
}

// Ethereum address matcher
expect.extend({
  toBeValidEthereumAddress(received: string) {
    const pass = /^0x[a-fA-F0-9]{40}$/.test(received);
    if (pass) {
      return {
        message: () => `expected ${received} not to be a valid Ethereum address`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be a valid Ethereum address`,
        pass: false,
      };
    }
  },

  toBeValidTransactionHash(received: string) {
    const pass = /^0x[a-fA-F0-9]{64}$/.test(received);
    if (pass) {
      return {
        message: () => `expected ${received} not to be a valid transaction hash`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be a valid transaction hash`,
        pass: false,
      };
    }
  },

  toBeValidUUID(received: string) {
    const pass = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(received);
    if (pass) {
      return {
        message: () => `expected ${received} not to be a valid UUID`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be a valid UUID`,
        pass: false,
      };
    }
  },
});

export default TestEnvironment;

// Test data generators
export class TestDataGenerator {
  static generateTestWalletAddress(): string {
    return `0xtest${Math.random().toString(16).substring(2, 8).padStart(6, '0')}${'0'.repeat(30)}`;
  }
  
  static generateTestOwnerAddress(): string {
    return `0xTEST${Math.random().toString(16).substring(2, 8).padStart(6, '0')}${'0'.repeat(30)}`;
  }
  
  static generateTestTransactionHash(): string {
    return `0x${Math.random().toString(16).substring(2).padStart(64, '0')}`;
  }
  
  static generateTestWallet(overrides: Partial<TestWallet> = {}): TestWallet {
    const defaultOwners = [
      this.generateTestOwnerAddress(),
      this.generateTestOwnerAddress(),
      this.generateTestOwnerAddress()
    ];
    
    return {
      address: this.generateTestWalletAddress(),
      name: `Test Wallet ${Math.random().toString(36).substring(7)}`,
      description: 'Test wallet for automated testing',
      network: NetworkType.LOCALHOST,
      type: WalletType.MULTISIG_WALLET,
      owners: defaultOwners,
      required: 2,
      dailyLimit: null,
      balance: ethers.parseEther('10'),
      monitored: true,
      alertThresholds: {},
      contactList: ['test@example.com'],
      notificationChannels: ['email'],
      registeredBy: 'test',
      ...overrides
    };
  }
  
  static generateTestTransaction(walletId: string, overrides: Partial<TestTransaction> = {}): TestTransaction {
    return {
      walletId,
      transactionId: Math.floor(Math.random() * 1000),
      blockNumber: Math.floor(Math.random() * 1000000),
      transactionHash: null,
      action: 'transfer',
      submitter: this.generateTestOwnerAddress(),
      destination: this.generateTestOwnerAddress(),
      value: ethers.parseEther('1'),
      data: '0x',
      decodedData: null,
      walletBalance: ethers.parseEther('10'),
      transferPercentage: 10.0,
      gasPrice: ethers.parseUnits('20', 'gwei'),
      gasLimit: 21000n,
      validationStatus: 'pending',
      riskScore: 3,
      riskFactors: [],
      confirmations: [],
      requiredConfirmations: 2,
      executedAt: null,
      executionStatus: 'pending',
      submittedAt: new Date(),
      validatedAt: null,
      ...overrides
    };
  }
  
  static generateTestAlert(walletId: string, transactionId?: string, overrides: Partial<TestAlert> = {}): TestAlert {
    return {
      walletId,
      transactionId: transactionId || null,
      priority: 'P2',
      type: 'unknown_recipient',
      title: 'Unknown Recipient Detected',
      message: 'Transaction sent to unknown recipient address',
      riskLevel: 'medium',
      severityScore: 50,
      context: {},
      notificationChannels: ['email'],
      notifiedAt: null,
      status: 'active',
      acknowledgedBy: null,
      acknowledgedAt: null,
      resolvedBy: null,
      resolvedAt: null,
      resolutionNotes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides
    };
  }
}

// Database test helpers
export class DatabaseTestHelpers {
  constructor(private db: Database) {}
  
  async insertTestWallet(wallet: TestWallet): Promise<string> {
    const result = await this.db.query(`
      INSERT INTO wallets (
        address, name, description, network, type, owners, required, daily_limit, balance,
        monitored, alert_thresholds, contact_list, notification_channels, registered_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING id
    `, [
      wallet.address,
      wallet.name,
      wallet.description,
      wallet.network,
      wallet.type,
      JSON.stringify(wallet.owners),
      wallet.required,
      wallet.dailyLimit?.toString() || null,
      wallet.balance.toString(),
      wallet.monitored,
      JSON.stringify(wallet.alertThresholds),
      JSON.stringify(wallet.contactList),
      JSON.stringify(wallet.notificationChannels),
      wallet.registeredBy
    ]);
    
    return result[0].id;
  }
  
  async insertTestTransaction(transaction: TestTransaction): Promise<string> {
    const result = await this.db.query(`
      INSERT INTO transactions (
        wallet_id, transaction_id, block_number, transaction_hash, action, submitter,
        destination, value, data, decoded_data, wallet_balance, transfer_percentage,
        gas_price, gas_limit, validation_status, risk_score, risk_factors,
        confirmations, required_confirmations, executed_at, execution_status,
        submitted_at, validated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
      RETURNING id
    `, [
      transaction.walletId,
      transaction.transactionId,
      transaction.blockNumber,
      transaction.transactionHash,
      transaction.action,
      transaction.submitter,
      transaction.destination,
      transaction.value.toString(),
      transaction.data,
      transaction.decodedData ? JSON.stringify(transaction.decodedData) : null,
      transaction.walletBalance.toString(),
      transaction.transferPercentage,
      transaction.gasPrice.toString(),
      transaction.gasLimit.toString(),
      transaction.validationStatus,
      transaction.riskScore,
      JSON.stringify(transaction.riskFactors),
      JSON.stringify(transaction.confirmations),
      transaction.requiredConfirmations,
      transaction.executedAt,
      transaction.executionStatus,
      transaction.submittedAt,
      transaction.validatedAt
    ]);
    
    return result[0].id;
  }
  
  async insertTestAlert(alert: TestAlert): Promise<string> {
    const result = await this.db.query(`
      INSERT INTO alerts (
        wallet_id, transaction_id, priority, type, title, message, risk_level,
        severity_score, context, notification_channels, notified_at, status,
        acknowledged_by, acknowledged_at, resolved_by, resolved_at, resolution_notes,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      RETURNING id
    `, [
      alert.walletId,
      alert.transactionId,
      alert.priority,
      alert.type,
      alert.title,
      alert.message,
      alert.riskLevel,
      alert.severityScore,
      JSON.stringify(alert.context),
      JSON.stringify(alert.notificationChannels),
      alert.notifiedAt,
      alert.status,
      alert.acknowledgedBy,
      alert.acknowledgedAt,
      alert.resolvedBy,
      alert.resolvedAt,
      alert.resolutionNotes,
      alert.createdAt,
      alert.updatedAt
    ]);
    
    return result[0].id;
  }
  
  async getTransactionById(id: string): Promise<any> {
    return this.db.queryOne('SELECT * FROM transactions WHERE id = $1', [id]);
  }
  
  async getWalletById(id: string): Promise<any> {
    return this.db.queryOne('SELECT * FROM wallets WHERE id = $1', [id]);
  }
  
  async getAlertById(id: string): Promise<any> {
    return this.db.queryOne('SELECT * FROM alerts WHERE id = $1', [id]);
  }
  
  async countTransactions(walletId?: string): Promise<number> {
    let query = 'SELECT COUNT(*) as count FROM transactions';
    let params: any[] = [];
    
    if (walletId) {
      query += ' WHERE wallet_id = $1';
      params = [walletId];
    }
    
    const result = await this.db.queryOne<{ count: string }>(query, params);
    return parseInt(result?.count || '0');
  }
  
  async countAlerts(walletId?: string): Promise<number> {
    let query = 'SELECT COUNT(*) as count FROM alerts';
    let params: any[] = [];
    
    if (walletId) {
      query += ' WHERE wallet_id = $1';
      params = [walletId];
    }
    
    const result = await this.db.queryOne<{ count: string }>(query, params);
    return parseInt(result?.count || '0');
  }
  
  async waitForCondition(
    conditionFn: () => Promise<boolean>,
    timeoutMs: number = 5000,
    intervalMs: number = 100
  ): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      if (await conditionFn()) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    
    throw new Error(`Condition not met within ${timeoutMs}ms`);
  }
}

// Mock Ethereum provider for testing
export class MockEthereumProvider {
  private logs: any[] = [];
  private blockNumber: number = 1000000;
  private contracts: Map<string, any> = new Map();
  
  async getLogs(filter: any): Promise<any[]> {
    return this.logs.filter(log => {
      if (filter.address && log.address !== filter.address) return false;
      if (filter.fromBlock && log.blockNumber < filter.fromBlock) return false;
      if (filter.toBlock && log.blockNumber > filter.toBlock) return false;
      return true;
    });
  }
  
  async getBlockNumber(): Promise<number> {
    return this.blockNumber;
  }
  
  async getBalance(address: string): Promise<bigint> {
    return ethers.parseEther('10'); // Default balance
  }
  
  addLog(log: any): void {
    this.logs.push(log);
  }
  
  setBlockNumber(blockNumber: number): void {
    this.blockNumber = blockNumber;
  }
  
  addContract(address: string, contract: any): void {
    this.contracts.set(address, contract);
  }
  
  getContract(address: string): any {
    return this.contracts.get(address);
  }
  
  reset(): void {
    this.logs = [];
    this.blockNumber = 1000000;
    this.contracts.clear();
  }
}

// Type definitions for test data
export interface TestWallet {
  address: string;
  name: string;
  description: string;
  network: NetworkType;
  type: WalletType;
  owners: string[];
  required: number;
  dailyLimit: bigint | null;
  balance: bigint;
  monitored: boolean;
  alertThresholds: Record<string, any>;
  contactList: string[];
  notificationChannels: string[];
  registeredBy: string;
}

export interface TestTransaction {
  walletId: string;
  transactionId: number;
  blockNumber: number;
  transactionHash: string | null;
  action: string;
  submitter: string;
  destination: string;
  value: bigint;
  data: string;
  decodedData: any;
  walletBalance: bigint;
  transferPercentage: number;
  gasPrice: bigint;
  gasLimit: bigint;
  validationStatus: string;
  riskScore: number;
  riskFactors: string[];
  confirmations: any[];
  requiredConfirmations: number;
  executedAt: Date | null;
  executionStatus: string;
  submittedAt: Date;
  validatedAt: Date | null;
}

export interface TestAlert {
  walletId: string;
  transactionId: string | null;
  priority: string;
  type: string;
  title: string;
  message: string;
  riskLevel: string;
  severityScore: number;
  context: Record<string, any>;
  notificationChannels: string[];
  notifiedAt: Date | null;
  status: string;
  acknowledgedBy: string | null;
  acknowledgedAt: Date | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  resolutionNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
}