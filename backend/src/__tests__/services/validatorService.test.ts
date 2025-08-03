// Comprehensive test suite for ValidatorService
import { ValidatorService, ValidatorServiceConfig } from '../../services/validatorService';
import { Database } from '../../database';
import { MultiSigEventListener, WalletConfig } from '../../blockchain/eventListener';
import { EventProcessor } from '../../services/eventProcessor';
import { NetworkType, WalletType } from '../../types';
import winston from 'winston';
import { EventEmitter } from 'events';
// Test utilities for comprehensive service testing

// Mock the dependencies
jest.mock('../../blockchain/eventListener');
jest.mock('../../services/eventProcessor');

describe('ValidatorService', () => {
  let validatorService: ValidatorService;
  let mockDb: jest.Mocked<Database>;
  let mockLogger: winston.Logger;
  let mockEventListener: jest.Mocked<MultiSigEventListener>;
  let mockEventProcessor: jest.Mocked<EventProcessor>;

  const defaultConfig: ValidatorServiceConfig = {
    networks: [NetworkType.LOCALHOST, NetworkType.SEPOLIA],
    syncInterval: 30000,
    enableValidation: true,
    autoProcessAlerts: true
  };

  beforeEach(async () => {
    // Use mock logger instead of setting up test environment
    mockLogger = {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
      silly: jest.fn(),
      log: jest.fn()
    } as any;
    
    mockDb = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      queryOne: jest.fn(),
      transaction: jest.fn(),
      healthCheck: jest.fn().mockResolvedValue(true),
      close: jest.fn()
    } as any;

    // Create mocked event listener with EventEmitter capabilities
    mockEventListener = new EventEmitter() as any;
    Object.assign(mockEventListener, {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      addWallet: jest.fn(),
      removeWallet: jest.fn(),
      getMonitoredWallets: jest.fn().mockReturnValue([]),
      getStatus: jest.fn().mockResolvedValue({ isRunning: true }),
      contractFactory: {
        detectContractType: jest.fn().mockResolvedValue('MultiSigWallet'),
        getContract: jest.fn().mockReturnValue({
          getOwners: jest.fn().mockResolvedValue(['0xowner1', '0xowner2']),
          getRequired: jest.fn().mockResolvedValue(2),
          getDailyLimit: jest.fn().mockResolvedValue(null)
        }),
        getProvider: jest.fn().mockReturnValue({
          getBalance: jest.fn().mockResolvedValue(BigInt('1000000000000000000'))
        })
      },
      rateLimiters: new Map()
    });

    // Mock the constructor to return our mocked instance
    (MultiSigEventListener as jest.Mock).mockImplementation(() => mockEventListener);

    // Create mocked event processor
    mockEventProcessor = {
      processTransactionSubmission: jest.fn().mockResolvedValue(undefined),
      processTransactionConfirmation: jest.fn().mockResolvedValue(undefined),
      processTransactionExecution: jest.fn().mockResolvedValue(undefined),
      processOwnerChange: jest.fn().mockResolvedValue(undefined)
    } as any;

    (EventProcessor as jest.Mock).mockImplementation(() => mockEventProcessor);

    validatorService = new ValidatorService(mockDb, mockLogger, defaultConfig);
  });

  afterEach(async () => {
    if (validatorService) {
      await validatorService.stop();
    }
    jest.clearAllMocks();
  });

  describe('start', () => {
    it('should start the service successfully', async () => {
      mockDb.query.mockResolvedValue({ rows: [] }); // No wallets in database

      await validatorService.start();

      expect(mockDb.healthCheck).toHaveBeenCalled();
      expect(mockEventListener.start).toHaveBeenCalled();
      expect(validatorService).toHaveProperty('isRunning', true);
    });

    it('should load wallets from database on start', async () => {
      const mockWallets = [
        {
          address: '0xwallet1',
          network: NetworkType.LOCALHOST,
          type: WalletType.MULTISIG_WALLET,
          monitored: true
        },
        {
          address: '0xwallet2',
          network: NetworkType.SEPOLIA,
          type: WalletType.MULTISIG_WALLET_WITH_DAILY_LIMIT,
          monitored: true
        }
      ];

      mockDb.query.mockResolvedValue({ rows: mockWallets });

      await validatorService.start();

      expect(mockEventListener.addWallet).toHaveBeenCalledTimes(2);
      expect(mockEventListener.addWallet).toHaveBeenCalledWith({
        address: '0xwallet1',
        network: NetworkType.LOCALHOST,
        type: WalletType.MULTISIG_WALLET,
        active: true
      });
    });

    it('should fail if database is unhealthy', async () => {
      mockDb.healthCheck.mockResolvedValue(false);

      await expect(validatorService.start()).rejects.toThrow('Database connection failed');
      expect(mockEventListener.start).not.toHaveBeenCalled();
    });

    it('should not start if already running', async () => {
      mockDb.query.mockResolvedValue([]);
      
      await validatorService.start();
      await validatorService.start(); // Second call

      expect(mockEventListener.start).toHaveBeenCalledTimes(1);
      expect(mockLogger.warn).toHaveBeenCalledWith('Validator service is already running');
    });

    it('should emit started event', async () => {
      mockDb.query.mockResolvedValue([]);
      const startedListener = jest.fn();
      validatorService.on('started', startedListener);

      await validatorService.start();

      expect(startedListener).toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('should stop the service successfully', async () => {
      mockDb.query.mockResolvedValue([]);
      await validatorService.start();

      await validatorService.stop();

      expect(mockEventListener.stop).toHaveBeenCalled();
      expect(validatorService).toHaveProperty('isRunning', false);
    });

    it('should do nothing if not running', async () => {
      await validatorService.stop();

      expect(mockEventListener.stop).not.toHaveBeenCalled();
    });

    it('should emit stopped event', async () => {
      mockDb.query.mockResolvedValue([]);
      await validatorService.start();
      
      const stoppedListener = jest.fn();
      validatorService.on('stopped', stoppedListener);

      await validatorService.stop();

      expect(stoppedListener).toHaveBeenCalled();
    });

    it('should handle stop errors gracefully', async () => {
      mockDb.query.mockResolvedValue([]);
      await validatorService.start();
      
      mockEventListener.stop.mockRejectedValueOnce(new Error('Stop failed'));

      await expect(validatorService.stop()).rejects.toThrow('Stop failed');
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('addWallet', () => {
    it('should add wallet with auto-detected type', async () => {
      const mockContract = {
        getOwners: jest.fn().mockResolvedValue(['0xowner1', '0xowner2', '0xowner3']),
        getRequired: jest.fn().mockResolvedValue(2),
        getDailyLimit: jest.fn().mockRejectedValue(new Error('Method not found'))
      };

      const mockProvider = {
        getBalance: jest.fn().mockResolvedValue(BigInt('2000000000000000000'))
      };

      mockEventListener.contractFactory.detectContractType.mockResolvedValue('MultiSigWallet');
      mockEventListener.contractFactory.getContract.mockReturnValue(mockContract);
      mockEventListener.contractFactory.getProvider.mockReturnValue(mockProvider);

      // Mock database insert
      mockDb.query.mockResolvedValue([]);

      await validatorService.addWallet(
        '0xnewwallet',
        NetworkType.LOCALHOST,
        'New Test Wallet'
      );

      // Verify contract type detection
      expect(mockEventListener.contractFactory.detectContractType).toHaveBeenCalledWith(
        '0xnewwallet',
        NetworkType.LOCALHOST
      );

      // Verify wallet was added to database
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO wallets'),
        expect.arrayContaining([
          '0xnewwallet',
          'New Test Wallet',
          NetworkType.LOCALHOST,
          WalletType.MULTISIG_WALLET
        ])
      );

      // Verify owners were added
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO owners'),
        expect.any(Array)
      );

      // Verify wallet was added to event listener
      expect(mockEventListener.addWallet).toHaveBeenCalledWith({
        address: '0xnewwallet',
        network: NetworkType.LOCALHOST,
        type: WalletType.MULTISIG_WALLET,
        active: true
      });
    });

    it('should add wallet with specified type', async () => {
      const mockContract = {
        getOwners: jest.fn().mockResolvedValue(['0xowner1', '0xowner2']),
        getRequired: jest.fn().mockResolvedValue(2),
        getDailyLimit: jest.fn().mockResolvedValue(BigInt('500000000000000000'))
      };

      mockEventListener.contractFactory.getContract.mockReturnValue(mockContract);
      mockEventListener.contractFactory.getProvider.mockReturnValue({
        getBalance: jest.fn().mockResolvedValue(BigInt('1000000000000000000'))
      });

      mockDb.query.mockResolvedValue([]);

      await validatorService.addWallet(
        '0xwithDailyLimit',
        NetworkType.SEPOLIA,
        'Wallet with Daily Limit',
        WalletType.MULTISIG_WALLET_WITH_DAILY_LIMIT
      );

      // Should not call detectContractType
      expect(mockEventListener.contractFactory.detectContractType).not.toHaveBeenCalled();

      // Verify daily limit was fetched
      expect(mockContract.getDailyLimit).toHaveBeenCalled();

      // Verify wallet was stored with daily limit
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO wallets'),
        expect.arrayContaining([
          '500000000000000000' // Daily limit
        ])
      );
    });

    it('should handle rate limiting', async () => {
      const mockRateLimiter = {
        waitForRateLimit: jest.fn().mockResolvedValue(undefined),
        onRequestSuccess: jest.fn()
      };

      mockEventListener.rateLimiters = new Map([
        [NetworkType.LOCALHOST, mockRateLimiter]
      ]);

      mockEventListener.contractFactory.getContract.mockReturnValue({
        getOwners: jest.fn().mockResolvedValue(['0xowner1']),
        getRequired: jest.fn().mockResolvedValue(1)
      });

      mockEventListener.contractFactory.getProvider.mockReturnValue({
        getBalance: jest.fn().mockResolvedValue(BigInt('0'))
      });

      mockDb.query.mockResolvedValue([]);

      await validatorService.addWallet(
        '0xratelimited',
        NetworkType.LOCALHOST,
        'Rate Limited Wallet',
        WalletType.MULTISIG_WALLET
      );

      expect(mockRateLimiter.waitForRateLimit).toHaveBeenCalled();
      expect(mockRateLimiter.onRequestSuccess).toHaveBeenCalled();
    });

    it('should fail if contract type cannot be detected', async () => {
      mockEventListener.contractFactory.detectContractType.mockResolvedValue('unknown');

      await expect(
        validatorService.addWallet('0xinvalid', NetworkType.LOCALHOST, 'Invalid Wallet')
      ).rejects.toThrow('Unable to detect contract type');
    });

    it('should update existing wallet', async () => {
      mockEventListener.contractFactory.getContract.mockReturnValue({
        getOwners: jest.fn().mockResolvedValue(['0xowner1', '0xowner2']),
        getRequired: jest.fn().mockResolvedValue(2)
      });

      mockEventListener.contractFactory.getProvider.mockReturnValue({
        getBalance: jest.fn().mockResolvedValue(BigInt('3000000000000000000'))
      });

      mockDb.query.mockResolvedValue([]);

      await validatorService.addWallet(
        '0xexisting',
        NetworkType.LOCALHOST,
        'Updated Name',
        WalletType.MULTISIG_WALLET
      );

      // Check for ON CONFLICT clause
      const insertCall = mockDb.query.mock.calls.find(
        call => call[0].includes('ON CONFLICT')
      );
      expect(insertCall).toBeDefined();
      expect(insertCall[0]).toContain('DO UPDATE SET');
    });

    it('should emit walletAdded event', async () => {
      mockEventListener.contractFactory.getContract.mockReturnValue({
        getOwners: jest.fn().mockResolvedValue(['0xowner1']),
        getRequired: jest.fn().mockResolvedValue(1)
      });

      const mockBalance = BigInt('1000000000000000000');
      mockEventListener.contractFactory.getProvider.mockReturnValue({
        getBalance: jest.fn().mockResolvedValue(mockBalance)
      });

      mockDb.query.mockResolvedValue([]);

      const walletAddedListener = jest.fn();
      validatorService.on('walletAdded', walletAddedListener);

      await validatorService.addWallet(
        '0xnewwallet',
        NetworkType.LOCALHOST,
        'New Wallet',
        WalletType.MULTISIG_WALLET
      );

      expect(walletAddedListener).toHaveBeenCalledWith({
        address: '0xnewwallet',
        network: NetworkType.LOCALHOST,
        type: WalletType.MULTISIG_WALLET,
        owners: ['0xowner1'],
        required: 1,
        balance: mockBalance
      });
    });
  });

  describe('removeWallet', () => {
    it('should remove wallet from monitoring', async () => {
      await validatorService.removeWallet('0xwallet', NetworkType.LOCALHOST);

      expect(mockEventListener.removeWallet).toHaveBeenCalledWith(
        '0xwallet',
        NetworkType.LOCALHOST
      );
    });

    it('should emit walletRemoved event', async () => {
      const walletRemovedListener = jest.fn();
      validatorService.on('walletRemoved', walletRemovedListener);

      await validatorService.removeWallet('0xwallet', NetworkType.LOCALHOST);

      expect(walletRemovedListener).toHaveBeenCalledWith({
        address: '0xwallet',
        network: NetworkType.LOCALHOST
      });
    });

    it('should handle removal errors', async () => {
      mockEventListener.removeWallet.mockImplementation(() => {
        throw new Error('Removal failed');
      });

      await expect(
        validatorService.removeWallet('0xwallet', NetworkType.LOCALHOST)
      ).rejects.toThrow('Removal failed');
    });
  });

  describe('getMonitoredWallets', () => {
    it('should return all monitored wallets', () => {
      const mockWallets: WalletConfig[] = [
        {
          address: '0xwallet1',
          network: NetworkType.LOCALHOST,
          type: WalletType.MULTISIG_WALLET,
          active: true
        },
        {
          address: '0xwallet2',
          network: NetworkType.SEPOLIA,
          type: WalletType.MULTISIG_WALLET,
          active: true
        }
      ];

      mockEventListener.getMonitoredWallets.mockReturnValue(mockWallets);

      const wallets = validatorService.getMonitoredWallets();

      expect(wallets).toEqual(mockWallets);
    });

    it('should return wallets for specific network', () => {
      const mockWallets: WalletConfig[] = [
        {
          address: '0xwallet1',
          network: NetworkType.LOCALHOST,
          type: WalletType.MULTISIG_WALLET,
          active: true
        }
      ];

      mockEventListener.getMonitoredWallets.mockReturnValue(mockWallets);

      const wallets = validatorService.getMonitoredWallets(NetworkType.LOCALHOST);

      expect(mockEventListener.getMonitoredWallets).toHaveBeenCalledWith(NetworkType.LOCALHOST);
      expect(wallets).toEqual(mockWallets);
    });
  });

  describe('getWalletsFromDatabase', () => {
    it('should get wallets from database', async () => {
      const mockDbWallets = [
        {
          address: '0xwallet1',
          name: 'Wallet 1',
          network: NetworkType.LOCALHOST,
          type: WalletType.MULTISIG_WALLET,
          owners: ['0xowner1', '0xowner2'],
          required: 2,
          balance: '1000000000000000000',
          monitored: true,
          registered_at: new Date()
        }
      ];

      mockDb.query.mockResolvedValue(mockDbWallets);

      const wallets = await validatorService.getWalletsFromDatabase();

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        expect.arrayContaining([NetworkType.LOCALHOST, NetworkType.SEPOLIA])
      );
      expect(wallets).toEqual(mockDbWallets);
    });

    it('should filter by network', async () => {
      mockDb.query.mockResolvedValue([]);

      await validatorService.getWalletsFromDatabase(NetworkType.SEPOLIA);

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('network = $1'),
        [NetworkType.SEPOLIA]
      );
    });

    it('should handle database errors gracefully', async () => {
      mockDb.query.mockRejectedValue(new Error('Database error'));

      const wallets = await validatorService.getWalletsFromDatabase();

      expect(wallets).toEqual([]);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('getStatus', () => {
    it('should return service status', async () => {
      const mockDbWallets = [
        {
          address: '0xwallet1',
          network: 'localhost',
          type: 'MultiSigWallet',
          monitored: true
        },
        {
          address: '0xwallet2',
          network: 'localhost', 
          type: 'MultiSigWallet',
          monitored: true
        },
        {
          address: '0xwallet3',
          network: 'sepolia',
          type: 'MultiSigWallet',
          monitored: true
        }
      ];

      // Mock database to return wallets in the expected format
      mockDb.query.mockResolvedValue({ rows: mockDbWallets });

      const mockWallets: WalletConfig[] = [
        {
          address: '0xwallet1',
          network: NetworkType.LOCALHOST,
          type: WalletType.MULTISIG_WALLET,
          active: true
        },
        {
          address: '0xwallet2',
          network: NetworkType.LOCALHOST,
          type: WalletType.MULTISIG_WALLET,
          active: true
        },
        {
          address: '0xwallet3',
          network: NetworkType.SEPOLIA,
          type: WalletType.MULTISIG_WALLET,
          active: true
        }
      ];

      mockEventListener.getMonitoredWallets.mockReturnValue(mockWallets);
      mockEventListener.getStatus.mockResolvedValue({
        isRunning: true,
        networks: ['localhost', 'sepolia']
      });

      await validatorService.start();
      const status = await validatorService.getStatus();

      expect(status).toEqual({
        isRunning: true,
        eventListener: {
          isRunning: true,
          networks: ['localhost', 'sepolia']
        },
        database: true,
        wallets: {
          total: 3,
          byNetwork: {
            localhost: 2,
            sepolia: 1
          }
        }
      });
    });
  });

  describe('getMetrics', () => {
    it('should return service metrics', async () => {
      mockDb.queryOne.mockResolvedValueOnce({ count: 10 }); // Recent events
      mockDb.query.mockResolvedValueOnce([
        { execution_status: 'pending', count: 5 },
        { execution_status: 'executed', count: 3 },
        { execution_status: 'failed', count: 2 }
      ]); // Transaction stats
      mockDb.query.mockResolvedValueOnce([
        { status: 'active', priority: 'P1', count: 2 },
        { status: 'active', priority: 'P2', count: 3 }
      ]); // Alert stats

      const metrics = await validatorService.getMetrics();

      expect(metrics).toEqual({
        events: {
          totalProcessed: 10,
          recentEvents: 10
        },
        transactions: {
          pending: 5,
          executed: 3,
          failed: 2
        },
        alerts: {
          active: 5,
          critical: 2
        }
      });
    });

    it('should handle missing data gracefully', async () => {
      mockDb.queryOne.mockResolvedValueOnce(null);
      mockDb.query.mockResolvedValueOnce([]);
      mockDb.query.mockResolvedValueOnce([]);

      const metrics = await validatorService.getMetrics();

      expect(metrics).toEqual({
        events: {
          totalProcessed: 0,
          recentEvents: 0
        },
        transactions: {
          pending: 0,
          executed: 0,
          failed: 0
        },
        alerts: {
          active: 0,
          critical: 0
        }
      });
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status when all components are running', async () => {
      // Mock database to return empty wallets for start
      mockDb.query.mockResolvedValue({ rows: [] });
      mockDb.healthCheck.mockResolvedValue(true);
      mockEventListener.getStatus.mockResolvedValue({ isRunning: true });
      
      await validatorService.start();
      const health = await validatorService.healthCheck();

      expect(health).toEqual({
        status: 'healthy',
        checks: {
          database: true,
          eventListener: true,
          service: true
        }
      });
    });

    it('should return unhealthy status with errors', async () => {
      mockDb.healthCheck.mockResolvedValue(false);
      mockEventListener.getStatus.mockResolvedValue({ isRunning: false });

      const health = await validatorService.healthCheck();

      expect(health).toEqual({
        status: 'unhealthy',
        checks: {
          database: false,
          eventListener: false,
          service: false
        },
        errors: [
          'Database connection failed',
          'Event listener is not running',
          'Validator service is not running'
        ]
      });
    });
  });

  describe('event handling', () => {
    beforeEach(async () => {
      mockDb.query.mockResolvedValue([]);
      await validatorService.start();
    });

    it('should process transaction submission events', async () => {
      const eventData = {
        wallet: { address: '0xwallet', network: NetworkType.LOCALHOST },
        event: { blockNumber: 1000 },
        submission: { transactionId: 1 },
        action: 'transfer'
      };

      mockEventListener.emit('transactionSubmitted', eventData);
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockEventProcessor.processTransactionSubmission).toHaveBeenCalledWith(
        eventData.wallet,
        eventData.event,
        eventData.submission,
        eventData.action
      );
    });

    it('should handle event processing errors', async () => {
      const processingErrorListener = jest.fn();
      validatorService.on('processingError', processingErrorListener);

      mockEventProcessor.processTransactionSubmission.mockRejectedValueOnce(
        new Error('Processing failed')
      );

      const eventData = {
        wallet: { address: '0xwallet' },
        event: {},
        submission: {},
        action: 'transfer'
      };

      mockEventListener.emit('transactionSubmitted', eventData);
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(processingErrorListener).toHaveBeenCalledWith({
        type: 'transactionSubmitted',
        error: expect.any(Error),
        data: eventData
      });
    });

    it('should handle all event types', async () => {
      // Transaction confirmation
      mockEventListener.emit('transactionConfirmed', {
        wallet: {},
        event: {},
        confirmation: {}
      });

      // Transaction execution
      mockEventListener.emit('transactionExecuted', {
        wallet: {},
        event: {},
        transactionId: 1
      });

      // Owner addition
      mockEventListener.emit('ownerAdded', {
        wallet: {},
        event: {},
        change: { changeType: 'addition' }
      });

      // Owner removal
      mockEventListener.emit('ownerRemoved', {
        wallet: {},
        event: {},
        change: { changeType: 'removal' }
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockEventProcessor.processTransactionConfirmation).toHaveBeenCalled();
      expect(mockEventProcessor.processTransactionExecution).toHaveBeenCalled();
      expect(mockEventProcessor.processOwnerChange).toHaveBeenCalledTimes(2);
    });

    it('should forward event listener errors', async () => {
      const errorListener = jest.fn();
      validatorService.on('eventListenerError', errorListener);

      const error = new Error('Event listener error');
      mockEventListener.emit('error', error);

      expect(errorListener).toHaveBeenCalledWith(error);
    });

    it('should forward wallet errors', async () => {
      const walletErrorListener = jest.fn();
      validatorService.on('walletError', walletErrorListener);

      const error = { wallet: '0xwallet', error: new Error('Wallet error') };
      mockEventListener.emit('walletError', error);

      expect(walletErrorListener).toHaveBeenCalledWith(error);
    });
  });

  describe('loadWalletsFromDatabase', () => {
    it('should only load wallets from configured networks', async () => {
      const mockWallets = [
        {
          address: '0xwallet1',
          network: NetworkType.LOCALHOST,
          type: WalletType.MULTISIG_WALLET,
          monitored: true
        },
        {
          address: '0xwallet2',
          network: NetworkType.MAINNET, // Not in config
          type: WalletType.MULTISIG_WALLET,
          monitored: true
        }
      ];

      // Should filter by configured networks
      mockDb.query.mockImplementation((query) => {
        if (query.includes('network IN')) {
          return Promise.resolve([mockWallets[0]]); // Only localhost wallet
        }
        return Promise.resolve([]);
      });

      await validatorService.start();

      expect(mockEventListener.addWallet).toHaveBeenCalledTimes(1);
      expect(mockEventListener.addWallet).toHaveBeenCalledWith({
        address: '0xwallet1',
        network: NetworkType.LOCALHOST,
        type: WalletType.MULTISIG_WALLET,
        active: true
      });
    });
  });
});