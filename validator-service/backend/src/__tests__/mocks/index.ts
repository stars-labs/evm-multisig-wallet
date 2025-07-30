// Centralized mock factory for all test dependencies
import { EventEmitter } from 'events';
import { NetworkType, WalletType, TransactionAction } from '@multisig-validator/shared';
import winston from 'winston';

export class MockFactory {
  // Database Mocks
  static createMockDatabase() {
    return {
      query: jest.fn(),
      queryOne: jest.fn(),
      transaction: jest.fn((callback) => callback(MockFactory.createMockClient())),
      healthCheck: jest.fn().mockResolvedValue(true),
      close: jest.fn().mockResolvedValue(undefined)
    };
  }

  static createMockClient() {
    return {
      query: jest.fn().mockResolvedValue({ rows: [] })
    };
  }

  // Logger Mock
  static createMockLogger(): winston.Logger {
    return {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
      silly: jest.fn(),
      log: jest.fn()
    } as any;
  }

  // Blockchain Mocks
  static createMockProvider() {
    return {
      getBlockNumber: jest.fn().mockResolvedValue(1000000),
      getBlock: jest.fn().mockResolvedValue({
        number: 1000000,
        timestamp: Math.floor(Date.now() / 1000),
        hash: '0xmockhash'
      }),
      getBalance: jest.fn().mockResolvedValue(BigInt('1000000000000000000')),
      getLogs: jest.fn().mockResolvedValue([])
    };
  }

  static createMockContract() {
    return {
      getOwners: jest.fn().mockResolvedValue(['0xowner1', '0xowner2']),
      getRequired: jest.fn().mockResolvedValue(2),
      getDailyLimit: jest.fn().mockResolvedValue(BigInt('1000000000000000000')),
      interface: {
        parseLog: jest.fn()
      },
      filters: {
        Submission: jest.fn(),
        Confirmation: jest.fn(),
        Execution: jest.fn(),
        OwnerAddition: jest.fn(),
        OwnerRemoval: jest.fn()
      }
    };
  }

  static createMockEventListener() {
    const mockListener = new EventEmitter() as any;
    
    Object.assign(mockListener, {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      addWallet: jest.fn(),
      removeWallet: jest.fn(),
      getMonitoredWallets: jest.fn().mockReturnValue([]),
      getStatus: jest.fn().mockResolvedValue({
        isRunning: true,
        networks: [],
        wallets: 0,
        lastSync: new Date()
      }),
      contractFactory: {
        detectContractType: jest.fn().mockResolvedValue('MultiSigWallet'),
        getContract: jest.fn().mockReturnValue(MockFactory.createMockContract()),
        getProvider: jest.fn().mockReturnValue(MockFactory.createMockProvider())
      },
      rateLimiters: new Map()
    });

    return mockListener;
  }

  // Service Mocks
  static createMockChainService() {
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
    };
  }

  static createMockEventProcessor() {
    return {
      processTransactionSubmission: jest.fn().mockResolvedValue(undefined),
      processTransactionConfirmation: jest.fn().mockResolvedValue(undefined),
      processTransactionExecution: jest.fn().mockResolvedValue(undefined),
      processOwnerChange: jest.fn().mockResolvedValue(undefined)
    };
  }

  static createMockSlackNotifier() {
    return {
      notifyTransactionSubmission: jest.fn().mockResolvedValue(undefined),
      notifyTransactionConfirmation: jest.fn().mockResolvedValue(undefined),
      notifyTransactionExecution: jest.fn().mockResolvedValue(undefined),
      notifyLargeTransaction: jest.fn().mockResolvedValue(undefined),
      notifyUnknownRecipient: jest.fn().mockResolvedValue(undefined),
      notifyOwnerChange: jest.fn().mockResolvedValue(undefined),
      testConnection: jest.fn().mockResolvedValue(true),
      isEnabled: jest.fn().mockReturnValue(false)
    };
  }

  static createMockValidatorService() {
    const mockService = new EventEmitter() as any;
    
    Object.assign(mockService, {
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
    });

    return mockService;
  }

  // Rate Limiter Mock
  static createMockRateLimiter() {
    return {
      waitForRateLimit: jest.fn().mockResolvedValue(undefined),
      onRequestSuccess: jest.fn(),
      onRequestError: jest.fn(),
      getStats: jest.fn().mockReturnValue({
        requestsThisSecond: 0,
        requestsThisMinute: 0,
        lastRequestTime: Date.now()
      })
    };
  }

  // Circuit Breaker Mock
  static createMockCircuitBreaker() {
    return {
      execute: jest.fn().mockImplementation((fn) => fn()),
      getState: jest.fn().mockReturnValue('CLOSED'),
      onOpen: jest.fn(),
      onHalfOpen: jest.fn(),
      onClose: jest.fn()
    };
  }

  // Test Data Generators
  static generateWalletConfig(overrides: Partial<any> = {}) {
    return {
      address: '0x1234567890123456789012345678901234567890',
      network: NetworkType.LOCALHOST,
      type: WalletType.MULTISIG_WALLET,
      active: true,
      ...overrides
    };
  }

  static generateProcessedEvent(overrides: Partial<any> = {}) {
    return {
      blockNumber: 1000,
      transactionHash: '0xevent123',
      timestamp: new Date(),
      logIndex: 0,
      removed: false,
      address: '0x1234567890123456789012345678901234567890',
      eventName: 'Submission',
      args: {},
      ...overrides
    };
  }

  static generateTransactionSubmissionData(overrides: Partial<any> = {}) {
    return {
      transactionId: 1,
      submitter: '0xsubmitter123',
      destination: '0xdestination456',
      value: '1000000000000000000',
      data: '0x',
      blockNumber: 1000,
      transactionHash: '0xsubmission123',
      timestamp: new Date(),
      ...overrides
    };
  }

  static generateTransactionConfirmationData(overrides: Partial<any> = {}) {
    return {
      transactionId: 1,
      confirmer: '0xconfirmer123',
      blockNumber: 1001,
      transactionHash: '0xconfirmation123',
      timestamp: new Date(),
      ...overrides
    };
  }

  static generateOwnerChangeData(overrides: Partial<any> = {}) {
    return {
      changeType: 'addition' as const,
      owner: '0xnewowner123',
      blockNumber: 1002,
      transactionHash: '0xownerchange123',
      ...overrides
    };
  }

  static generateTransactionAlert(overrides: Partial<any> = {}) {
    return {
      wallet: {
        address: '0x1234567890123456789012345678901234567890',
        name: 'Test Wallet',
        network: NetworkType.LOCALHOST
      },
      transaction: {
        id: 123,
        action: TransactionAction.TRANSFER,
        submitter: '0xsubmitter123',
        destination: '0xdestination456',
        value: '1000000000000000000',
        required: 2,
        confirmations: 0
      },
      alertType: 'submission' as const,
      timestamp: new Date(),
      ...overrides
    };
  }

  static generateOwnerAlert(overrides: Partial<any> = {}) {
    return {
      wallet: {
        address: '0x1234567890123456789012345678901234567890',
        name: 'Test Wallet',
        network: NetworkType.LOCALHOST
      },
      change: {
        type: 'addition' as const,
        owner: '0xnewowner123'
      },
      timestamp: new Date(),
      ...overrides
    };
  }

  // Database Row Generators
  static generateChainRow(overrides: Partial<any> = {}) {
    return {
      id: '1',
      network: 'localhost',
      chain_id: 31337,
      name: 'Test Network',
      rpc_url: 'http://localhost:8545',
      rpc_backup_urls: [],
      block_confirmations: 1,
      start_block: 0,
      last_processed_block: 1000,
      rate_limit_rps: 5,
      rate_limit_rpm: 100,
      rate_limit_backoff_multiplier: 2.0,
      rate_limit_max_backoff_ms: 120000,
      sync_interval_ms: 30000,
      max_blocks_per_batch: 1000,
      batch_size: 100,
      enabled: true,
      sync_status: 'running',
      last_sync_at: new Date(),
      last_error: null,
      last_error_at: null,
      consecutive_errors: 0,
      total_requests: 1000,
      total_errors: 5,
      avg_response_time_ms: 150,
      created_at: new Date(),
      updated_at: new Date(),
      ...overrides
    };
  }

  static generateWalletRow(overrides: Partial<any> = {}) {
    return {
      id: '1',
      address: '0x1234567890123456789012345678901234567890',
      name: 'Test Wallet',
      description: 'Test wallet description',
      network: 'localhost',
      type: 'MultiSigWallet',
      owners: ['0xowner1', '0xowner2'],
      required: 2,
      daily_limit: null,
      balance: '1000000000000000000',
      monitored: true,
      alert_thresholds: {},
      contact_list: [],
      slack_webhook: null,
      notification_channels: ['email'],
      registered_by: 'test',
      registered_at: new Date(),
      last_activity: null,
      last_sync: null,
      created_at: new Date(),
      updated_at: new Date(),
      ...overrides
    };
  }

  static generateOwnerRow(overrides: Partial<any> = {}) {
    return {
      id: '1',
      address: '0xowner123',
      network: 'localhost',
      first_seen: new Date(),
      wallets: ['0x1234567890123456789012345678901234567890'],
      transaction_count: 5,
      last_activity: new Date(),
      name: null,
      organization: null,
      role: null,
      email: null,
      phone: null,
      verified: false,
      approved_by: null,
      approved_at: null,
      notes: null,
      risk_level: 'medium',
      confidence_score: 50,
      status: 'active',
      created_at: new Date(),
      updated_at: new Date(),
      ...overrides
    };
  }

  static generateTransactionRow(overrides: Partial<any> = {}) {
    return {
      id: '1',
      wallet_id: '1',
      transaction_id: 1,
      block_number: 1000,
      transaction_hash: '0xhash123',
      action: 'transfer',
      submitter: '0xsubmitter123',
      destination: '0xdestination456',
      value: '1000000000000000000',
      data: '0x',
      decoded_data: null,
      wallet_balance: '10000000000000000000',
      transfer_percentage: 10.0,
      gas_price: '20000000000',
      gas_limit: '21000',
      validation_status: 'pending',
      risk_score: 3,
      risk_factors: [],
      confirmations: [],
      required_confirmations: 2,
      executed_at: null,
      execution_status: 'pending',
      submitted_at: new Date(),
      validated_at: null,
      created_at: new Date(),
      updated_at: new Date(),
      ...overrides
    };
  }

  static generateAlertRow(overrides: Partial<any> = {}) {
    return {
      id: '1',
      wallet_id: '1',
      transaction_id: null,
      priority: 'P2',
      type: 'unknown_recipient',
      title: 'Unknown Recipient',
      message: 'Transaction to unknown recipient',
      risk_level: 'medium',
      severity_score: 50,
      context: {},
      notification_channels: ['email'],
      notified_at: null,
      status: 'active',
      acknowledged_by: null,
      acknowledged_at: null,
      resolved_by: null,
      resolved_at: null,
      resolution_notes: null,
      created_at: new Date(),
      updated_at: new Date(),
      ...overrides
    };
  }

  // Error Generators
  static generateDatabaseError(message = 'Database connection failed') {
    const error = new Error(message);
    (error as any).code = '08006'; // PostgreSQL connection failure
    return error;
  }

  static generateNetworkError(message = 'Network timeout') {
    const error = new Error(message);
    (error as any).code = 'ECONNRESET';
    return error;
  }

  static generateValidationError(message = 'Validation failed') {
    const error = new Error(message);
    (error as any).name = 'ValidationError';
    return error;
  }

  // Async Helpers
  static async delay(ms = 10) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static createPromiseWithResolvers<T>() {
    let resolve: (value: T) => void;
    let reject: (reason?: any) => void;
    
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    
    return { promise, resolve: resolve!, reject: reject! };
  }

  // Mock cleanup
  static resetAllMocks() {
    jest.clearAllMocks();
    jest.resetAllMocks();
  }
}