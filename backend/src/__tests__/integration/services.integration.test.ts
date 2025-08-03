// Integration tests for service interactions
import { ValidatorService } from '../../services/validatorService';
import { EventProcessor } from '../../services/eventProcessor';
import { ChainService } from '../../services/chainService';
import { SlackNotifier } from '../../services/slackNotifier';
import { Database } from '../../database';
import { NetworkType, WalletType, TransactionAction } from '../../types';
import winston from 'winston';
import {
  TestEnvironment,
  setupTestEnvironment,
  teardownTestEnvironment,
  TestDataGenerator,
  DatabaseTestHelpers
} from '../helpers/testUtils';

describe('Services Integration', () => {
  let env: TestEnvironment;
  let database: Database;
  let chainService: ChainService;
  let eventProcessor: EventProcessor;
  let slackNotifier: SlackNotifier;
  let validatorService: ValidatorService;
  let dbHelpers: DatabaseTestHelpers;
  let logger: winston.Logger;

  beforeEach(async () => {
    env = await setupTestEnvironment();
    database = env.getDatabase() as any; // Cast to Database for integration test
    logger = env.getLogger();
    dbHelpers = new DatabaseTestHelpers(database);

    // Create real service instances with test database
    chainService = new ChainService(database, logger);
    
    // Mock SlackNotifier for integration tests
    slackNotifier = {
      notifyTransactionSubmission: jest.fn(),
      notifyTransactionConfirmation: jest.fn(),
      notifyTransactionExecution: jest.fn(),
      notifyLargeTransaction: jest.fn(),
      notifyUnknownRecipient: jest.fn(),
      notifyOwnerChange: jest.fn(),
      testConnection: jest.fn().mockResolvedValue(true),
      isEnabled: jest.fn().mockReturnValue(false) // Disable for tests
    } as any;

    eventProcessor = new EventProcessor(database, logger, {
      enableValidation: true,
      autoProcessAlerts: true,
      batchSize: 10
    });

    // Replace internal SlackNotifier with mock
    (eventProcessor as any).slackNotifier = slackNotifier;

    validatorService = new ValidatorService(database, logger, {
      networks: [NetworkType.LOCALHOST, NetworkType.SEPOLIA],
      syncInterval: 30000,
      enableValidation: true,
      autoProcessAlerts: true
    });
  });

  afterEach(async () => {
    if (validatorService) {
      try {
        await validatorService.stop();
      } catch (error) {
        // Ignore stop errors in tests
      }
    }
    await teardownTestEnvironment(env);
  });

  describe('ChainService and Database Integration', () => {
    it('should create and retrieve chains from database', async () => {
      // Create a chain
      const chainData = {
        network: NetworkType.LOCALHOST,
        chainId: 31337,
        name: 'Test Local Network',
        rpcUrl: 'http://localhost:8545',
        blockConfirmations: 1,
        enabled: true
      };

      const createdChain = await chainService.createChain(chainData);
      expect(createdChain.network).toBe(NetworkType.LOCALHOST);
      expect(createdChain.chainId).toBe(31337);

      // Retrieve all chains
      const allChains = await chainService.getAllChains();
      expect(allChains).toHaveLength(1);
      expect(allChains[0].network).toBe(NetworkType.LOCALHOST);

      // Retrieve enabled chains
      const enabledChains = await chainService.getEnabledChains();
      expect(enabledChains).toHaveLength(1);

      // Get specific chain by network
      const specificChain = await chainService.getChainByNetwork(NetworkType.LOCALHOST);
      expect(specificChain).toBeTruthy();
      expect(specificChain?.chainId).toBe(31337);
    });

    it('should update chain sync state', async () => {
      // Create a chain first
      await chainService.createChain({
        network: NetworkType.SEPOLIA,
        chainId: 11155111,
        name: 'Sepolia Testnet',
        rpcUrl: 'https://sepolia.infura.io',
        enabled: true
      });

      // Update sync state
      const success = await chainService.updateSyncState(NetworkType.SEPOLIA, {
        lastProcessedBlock: 5000000,
        syncStatus: 'running',
        lastSyncAt: new Date(),
        consecutiveErrors: 0
      });

      expect(success).toBe(true);

      // Verify update
      const chain = await chainService.getChainByNetwork(NetworkType.SEPOLIA);
      expect(chain?.lastProcessedBlock).toBe(5000000);
      expect(chain?.syncStatus).toBe('running');
    });

    it('should handle error count increments and resets', async () => {
      // Create a chain
      await chainService.createChain({
        network: NetworkType.LOCALHOST,
        chainId: 31337,
        name: 'Test Network',
        rpcUrl: 'http://localhost:8545',
        enabled: true
      });

      // Increment error count multiple times
      await chainService.incrementErrorCount(NetworkType.LOCALHOST, 'RPC timeout');
      await chainService.incrementErrorCount(NetworkType.LOCALHOST, 'Connection failed');
      await chainService.incrementErrorCount(NetworkType.LOCALHOST, 'Rate limited');

      let chain = await chainService.getChainByNetwork(NetworkType.LOCALHOST);
      expect(chain?.consecutiveErrors).toBe(3);
      expect(chain?.lastError).toBe('Rate limited');

      // Reset error count
      await chainService.resetErrorCount(NetworkType.LOCALHOST);

      chain = await chainService.getChainByNetwork(NetworkType.LOCALHOST);
      expect(chain?.consecutiveErrors).toBe(0);
      expect(chain?.lastError).toBeNull();
    });

    it('should calculate chain metrics correctly', async () => {
      // Create multiple chains with different states
      await chainService.createChain({
        network: NetworkType.LOCALHOST,
        chainId: 31337,
        name: 'Local Network',
        rpcUrl: 'http://localhost:8545',
        enabled: true
      });

      await chainService.createChain({
        network: NetworkType.SEPOLIA,
        chainId: 11155111,
        name: 'Sepolia Network',
        rpcUrl: 'https://sepolia.infura.io',
        enabled: true
      });

      await chainService.createChain({
        network: NetworkType.MAINNET,
        chainId: 1,
        name: 'Mainnet',
        rpcUrl: 'https://mainnet.infura.io',
        enabled: false
      });

      // Set different statuses
      await chainService.setSyncStatus(NetworkType.LOCALHOST, 'running');
      await chainService.setSyncStatus(NetworkType.SEPOLIA, 'error');
      await chainService.setSyncStatus(NetworkType.MAINNET, 'stopped');

      // Simulate some errors
      await chainService.incrementErrorCount(NetworkType.SEPOLIA, 'Connection error');

      const metrics = await chainService.getChainMetrics();

      expect(metrics.totalChains).toBe(3);
      expect(metrics.enabledChains).toBe(2);
      expect(metrics.runningChains).toBe(1);
      expect(metrics.errorChains).toBe(1);
    });
  });

  describe('EventProcessor and Database Integration', () => {
    let testWalletId: string;

    beforeEach(async () => {
      // Create test wallet
      const testWallet = TestDataGenerator.generateTestWallet();
      testWalletId = await dbHelpers.insertTestWallet(testWallet);
    });

    it('should process complete transaction lifecycle', async () => {
      const walletConfig = {
        address: '0x1234567890123456789012345678901234567890',
        network: NetworkType.LOCALHOST,
        type: WalletType.MULTISIG_WALLET,
        active: true
      };

      const processedEvent = {
        blockNumber: 1000,
        transactionHash: '0xabcd1234',
        timestamp: new Date(),
        logIndex: 0,
        removed: false,
        address: walletConfig.address,
        eventName: 'Submission',
        args: {}
      };

      // 1. Transaction Submission
      const submissionData = {
        transactionId: 1,
        submitter: '0xsubmitter123',
        destination: '0xdestination456',
        value: '1000000000000000000', // 1 ETH
        data: '0x',
        blockNumber: 1000,
        transactionHash: '0xabcd1234',
        timestamp: new Date()
      };

      await eventProcessor.processTransactionSubmission(
        walletConfig,
        processedEvent,
        submissionData,
        TransactionAction.TRANSFER
      );

      // Verify transaction was created
      const transactionCount = await dbHelpers.countTransactions(testWalletId);
      expect(transactionCount).toBe(1);

      // 2. Transaction Confirmations
      const confirmationData1 = {
        transactionId: 1,
        confirmer: '0xowner1',
        blockNumber: 1001,
        transactionHash: '0xconf1',
        timestamp: new Date()
      };

      const confirmationData2 = {
        transactionId: 1,
        confirmer: '0xowner2',
        blockNumber: 1002,
        transactionHash: '0xconf2',
        timestamp: new Date()
      };

      await eventProcessor.processTransactionConfirmation(
        walletConfig,
        { ...processedEvent, blockNumber: 1001 },
        confirmationData1
      );

      await eventProcessor.processTransactionConfirmation(
        walletConfig,
        { ...processedEvent, blockNumber: 1002 },
        confirmationData2
      );

      // 3. Transaction Execution
      await eventProcessor.processTransactionExecution(
        walletConfig,
        { ...processedEvent, blockNumber: 1003 },
        1
      );

      // Verify final state
      const transactions = await database.query(
        'SELECT * FROM transactions WHERE wallet_id = $1',
        [testWalletId]
      );

      expect(transactions).toHaveLength(1);
      const transaction = transactions[0];
      expect(transaction.execution_status).toBe('executed');
      expect(JSON.parse(transaction.confirmations)).toHaveLength(2);
    });

    it('should create alerts for owner changes', async () => {
      const walletConfig = {
        address: '0x2345678901234567890123456789012345678901',
        network: NetworkType.LOCALHOST,
        type: WalletType.MULTISIG_WALLET,
        active: true
      };

      const ownerChangeEvent = {
        blockNumber: 2000,
        transactionHash: '0xowner1234',
        timestamp: new Date(),
        logIndex: 0,
        removed: false,
        address: walletConfig.address,
        eventName: 'OwnerAddition',
        args: {}
      };

      const ownerChange = {
        changeType: 'addition' as const,
        owner: '0xnewowner123',
        blockNumber: 2000,
        transactionHash: '0xowner1234'
      };

      await eventProcessor.processOwnerChange(
        walletConfig,
        ownerChangeEvent,
        ownerChange
      );

      // Verify alert was created
      const alertCount = await dbHelpers.countAlerts(testWalletId);
      expect(alertCount).toBe(1);

      // Verify owner was created/updated
      const owners = await database.query(
        'SELECT * FROM owners WHERE address = $1 AND network = $2',
        [ownerChange.owner, walletConfig.network]
      );

      expect(owners).toHaveLength(1);
      expect(owners[0].status).toBe('active');
    });

    it('should handle concurrent transaction processing', async () => {
      const walletConfig = {
        address: '0x3456789012345678901234567890123456789012',
        network: NetworkType.LOCALHOST,
        type: WalletType.MULTISIG_WALLET,
        active: true
      };

      const baseEvent = {
        blockNumber: 3000,
        transactionHash: '0xconcurrent',
        timestamp: new Date(),
        logIndex: 0,
        removed: false,
        address: walletConfig.address,
        eventName: 'Submission',
        args: {}
      };

      // Process multiple transactions concurrently
      const promises = [];
      for (let i = 1; i <= 5; i++) {
        const submissionData = {
          transactionId: i,
          submitter: `0xsubmitter${i}`,
          destination: `0xdestination${i}`,
          value: `${i}000000000000000000`, // i ETH
          data: '0x',
          blockNumber: 3000 + i,
          transactionHash: `0xhash${i}`,
          timestamp: new Date()
        };

        promises.push(
          eventProcessor.processTransactionSubmission(
            walletConfig,
            { ...baseEvent, blockNumber: 3000 + i },
            submissionData,
            TransactionAction.TRANSFER
          )
        );
      }

      await Promise.all(promises);

      // Verify all transactions were processed
      const transactionCount = await dbHelpers.countTransactions(testWalletId);
      expect(transactionCount).toBe(5);

      // Verify owners were created for all submitters
      const ownerCount = await database.query(
        'SELECT COUNT(*) as count FROM owners WHERE network = $1',
        [walletConfig.network]
      );
      expect(parseInt(ownerCount[0].count)).toBeGreaterThanOrEqual(5);
    });
  });

  describe('ValidatorService Integration', () => {
    it('should start and stop service with database interaction', async () => {
      // Mock the event listener and other components
      const mockEventListener = {
        start: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
        addWallet: jest.fn(),
        getStatus: jest.fn().mockResolvedValue({ isRunning: true })
      };

      (validatorService as any).eventListener = mockEventListener;

      // Start service
      await validatorService.start();

      const status = await validatorService.getStatus();
      expect(status.isRunning).toBe(true);
      expect(status.database).toBe(true);

      // Stop service
      await validatorService.stop();

      expect(mockEventListener.stop).toHaveBeenCalled();
    });

    it('should load wallets from database on start', async () => {
      // Insert test wallets into database
      const testWallet1 = TestDataGenerator.generateTestWallet({
        network: NetworkType.LOCALHOST
      });
      const testWallet2 = TestDataGenerator.generateTestWallet({
        network: NetworkType.SEPOLIA
      });

      await dbHelpers.insertTestWallet(testWallet1);
      await dbHelpers.insertTestWallet(testWallet2);

      const mockEventListener = {
        start: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
        addWallet: jest.fn(),
        getStatus: jest.fn().mockResolvedValue({ isRunning: true })
      };

      (validatorService as any).eventListener = mockEventListener;

      await validatorService.start();

      // Verify wallets were loaded and added to event listener
      expect(mockEventListener.addWallet).toHaveBeenCalledTimes(2);
      expect(mockEventListener.addWallet).toHaveBeenCalledWith(
        expect.objectContaining({
          address: testWallet1.address,
          network: testWallet1.network
        })
      );
    });

    it('should retrieve service metrics from database', async () => {
      // Create test data
      const testWallet = TestDataGenerator.generateTestWallet();
      const walletId = await dbHelpers.insertTestWallet(testWallet);

      // Add transactions
      const transaction1 = TestDataGenerator.generateTestTransaction(walletId, {
        executionStatus: 'pending'
      });
      const transaction2 = TestDataGenerator.generateTestTransaction(walletId, {
        executionStatus: 'executed'
      });
      const transaction3 = TestDataGenerator.generateTestTransaction(walletId, {
        executionStatus: 'failed'
      });

      await dbHelpers.insertTestTransaction(transaction1);
      await dbHelpers.insertTestTransaction(transaction2);
      await dbHelpers.insertTestTransaction(transaction3);

      // Add alerts
      const alert1 = TestDataGenerator.generateTestAlert(walletId, undefined, {
        priority: 'P1',
        status: 'active'
      });
      const alert2 = TestDataGenerator.generateTestAlert(walletId, undefined, {
        priority: 'P2',
        status: 'active'
      });

      await dbHelpers.insertTestAlert(alert1);
      await dbHelpers.insertTestAlert(alert2);

      const metrics = await validatorService.getMetrics();

      expect(metrics.transactions.pending).toBe(1);
      expect(metrics.transactions.executed).toBe(1);
      expect(metrics.transactions.failed).toBe(1);
      expect(metrics.alerts.active).toBe(2);
      expect(metrics.alerts.critical).toBe(1); // P1 alerts
    });

    it('should perform comprehensive health check', async () => {
      const mockEventListener = {
        getStatus: jest.fn().mockResolvedValue({ isRunning: true })
      };

      (validatorService as any).eventListener = mockEventListener;

      await validatorService.start();

      const health = await validatorService.healthCheck();

      expect(health.status).toBe('healthy');
      expect(health.checks.database).toBe(true);
      expect(health.checks.eventListener).toBe(true);
      expect(health.checks.service).toBe(true);
      expect(health.errors).toBeUndefined();
    });
  });

  describe('Cross-Service Data Flow', () => {
    it('should maintain data consistency across services', async () => {
      // Create chain configuration
      const chainData = {
        network: NetworkType.LOCALHOST,
        chainId: 31337,
        name: 'Test Network',
        rpcUrl: 'http://localhost:8545',
        enabled: true,
        syncStatus: 'running' as const
      };

      await chainService.createChain(chainData);

      // Create wallet
      const testWallet = TestDataGenerator.generateTestWallet({
        network: NetworkType.LOCALHOST
      });
      const walletId = await dbHelpers.insertTestWallet(testWallet);

      // Process transaction through EventProcessor
      const walletConfig = {
        address: testWallet.address,
        network: testWallet.network,
        type: testWallet.type,
        active: true
      };

      const submissionData = {
        transactionId: 1,
        submitter: testWallet.owners[0],
        destination: testWallet.owners[1],
        value: '1000000000000000000',
        data: '0x',
        blockNumber: 1000,
        transactionHash: '0xtest123',
        timestamp: new Date()
      };

      await eventProcessor.processTransactionSubmission(
        walletConfig,
        {
          blockNumber: 1000,
          transactionHash: '0xtest123',
          timestamp: new Date(),
          logIndex: 0,
          removed: false,
          address: testWallet.address,
          eventName: 'Submission',
          args: {}
        },
        submissionData,
        TransactionAction.TRANSFER
      );

      // Update chain sync state
      await chainService.updateSyncState(NetworkType.LOCALHOST, {
        lastProcessedBlock: 1000,
        syncStatus: 'running',
        lastSyncAt: new Date()
      });

      // Verify data consistency
      const chain = await chainService.getChainByNetwork(NetworkType.LOCALHOST);
      expect(chain?.lastProcessedBlock).toBe(1000);

      const transactions = await database.query(
        'SELECT * FROM transactions WHERE wallet_id = $1',
        [walletId]
      );
      expect(transactions).toHaveLength(1);
      expect(transactions[0].block_number).toBe(1000);

      const owners = await database.query(
        'SELECT * FROM owners WHERE network = $1',
        [NetworkType.LOCALHOST]
      );
      expect(owners.length).toBeGreaterThan(0);
    });

    it('should handle service interactions under error conditions', async () => {
      // Create a chain
      await chainService.createChain({
        network: NetworkType.LOCALHOST,
        chainId: 31337,
        name: 'Error Test Network',
        rpcUrl: 'http://localhost:8545',
        enabled: true
      });

      // Simulate multiple errors
      for (let i = 0; i < 6; i++) {
        await chainService.incrementErrorCount(
          NetworkType.LOCALHOST,
          `Error ${i + 1}: Connection timeout`
        );
      }

      // Verify chain status changed to error
      const chain = await chainService.getChainByNetwork(NetworkType.LOCALHOST);
      expect(chain?.syncStatus).toBe('error');
      expect(chain?.consecutiveErrors).toBe(6);

      // Reset and verify recovery
      await chainService.resetErrorCount(NetworkType.LOCALHOST);
      await chainService.setSyncStatus(NetworkType.LOCALHOST, 'running');

      const recoveredChain = await chainService.getChainByNetwork(NetworkType.LOCALHOST);
      expect(recoveredChain?.syncStatus).toBe('running');
      expect(recoveredChain?.consecutiveErrors).toBe(0);
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle large transaction volumes efficiently', async () => {
      const testWallet = TestDataGenerator.generateTestWallet();
      const walletId = await dbHelpers.insertTestWallet(testWallet);

      const startTime = Date.now();
      const transactionCount = 100;

      // Generate and insert many transactions
      const promises = [];
      for (let i = 0; i < transactionCount; i++) {
        const transaction = TestDataGenerator.generateTestTransaction(walletId, {
          transactionId: i + 1
        });
        promises.push(dbHelpers.insertTestTransaction(transaction));
      }

      await Promise.all(promises);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Verify all transactions were inserted
      const finalCount = await dbHelpers.countTransactions(walletId);
      expect(finalCount).toBe(transactionCount);

      // Performance assertion (should complete within reasonable time)
      expect(duration).toBeLessThan(10000); // 10 seconds

      console.log(`Processed ${transactionCount} transactions in ${duration}ms`);
    });

    it('should handle concurrent service operations', async () => {
      const operations = [];

      // Concurrent chain operations
      for (let i = 0; i < 5; i++) {
        operations.push(
          chainService.createChain({
            network: `network${i}` as NetworkType,
            chainId: 1000 + i,
            name: `Network ${i}`,
            rpcUrl: `http://network${i}.example.com`,
            enabled: true
          })
        );
      }

      // Concurrent wallet operations
      for (let i = 0; i < 10; i++) {
        const wallet = TestDataGenerator.generateTestWallet({
          name: `Concurrent Wallet ${i}`
        });
        operations.push(dbHelpers.insertTestWallet(wallet));
      }

      const results = await Promise.allSettled(operations);

      // Verify most operations succeeded
      const successful = results.filter(r => r.status === 'fulfilled').length;
      expect(successful).toBeGreaterThan(10); // At least most should succeed
    });
  });
});