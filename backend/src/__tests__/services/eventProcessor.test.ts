// Comprehensive test suite for EventProcessor
import { EventProcessor, EventProcessorConfig } from '../../services/eventProcessor';
import { SlackNotifier } from '../../services/slackNotifier';
import { Database } from '../../database';
import {
  ProcessedEvent,
  TransactionSubmissionData,
  TransactionConfirmationData,
  OwnerChangeData,
  WalletConfig
} from '../../blockchain/eventListener';
import {
  NetworkType,
  WalletType,
  TransactionAction,
  ValidationStatus,
  AlertPriority,
  RiskLevel,
  OwnerStatus
} from '../../types';
import winston from 'winston';
import { TestEnvironment, setupTestEnvironment, teardownTestEnvironment, TestDataGenerator } from '../helpers/testUtils';

describe('EventProcessor', () => {
  let env: TestEnvironment;
  let eventProcessor: EventProcessor;
  let mockDb: jest.Mocked<Database>;
  let mockLogger: winston.Logger;
  let mockSlackNotifier: jest.Mocked<SlackNotifier>;
  let mockClient: any;

  const defaultConfig: EventProcessorConfig = {
    enableValidation: true,
    autoProcessAlerts: true,
    batchSize: 50
  };

  beforeEach(async () => {
    env = await setupTestEnvironment();
    mockLogger = env.getLogger();
    
    // Mock database client for transactions
    mockClient = {
      query: jest.fn()
    };

    mockDb = {
      query: jest.fn(),
      queryOne: jest.fn(),
      transaction: jest.fn((callback) => callback(mockClient)),
      healthCheck: jest.fn(),
      close: jest.fn()
    } as any;

    // Mock SlackNotifier
    mockSlackNotifier = {
      notifyTransactionSubmission: jest.fn(),
      notifyTransactionConfirmation: jest.fn(),
      notifyTransactionExecution: jest.fn(),
      notifyLargeTransaction: jest.fn(),
      notifyUnknownRecipient: jest.fn(),
      notifyOwnerChange: jest.fn(),
      testConnection: jest.fn(),
      isEnabled: jest.fn().mockReturnValue(true)
    } as any;

    // Create EventProcessor with mocked dependencies
    eventProcessor = new EventProcessor(mockDb, mockLogger, defaultConfig);
    // Replace the internal SlackNotifier with our mock
    (eventProcessor as any).slackNotifier = mockSlackNotifier;
  });

  afterEach(async () => {
    await teardownTestEnvironment(env);
    jest.clearAllMocks();
  });

  describe('processTransactionSubmission', () => {
    const mockWallet: WalletConfig = {
      address: '0x1234567890123456789012345678901234567890',
      network: NetworkType.LOCALHOST,
      type: WalletType.MULTISIG_WALLET,
      active: true
    };

    const mockEvent: ProcessedEvent = {
      blockNumber: 1000,
      transactionHash: '0xabcd',
      timestamp: new Date(),
      logIndex: 0,
      removed: false,
      address: mockWallet.address,
      eventName: 'Submission',
      args: {}
    };

    const mockSubmission: TransactionSubmissionData = {
      transactionId: 1,
      submitter: '0xsubmitter',
      destination: '0xdestination',
      value: '1000000000000000000', // 1 ETH
      data: '0x',
      blockNumber: 1000,
      transactionHash: '0xabcd',
      timestamp: new Date()
    };

    it('should process transaction submission successfully', async () => {
      // Mock owner query - existing owner
      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: 'owner-1',
          address: mockSubmission.submitter,
          network: mockWallet.network,
          wallets: [],
          transaction_count: 5,
          status: 'active'
        }]
      });

      // Mock wallet query
      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: 'wallet-1',
          address: mockWallet.address,
          network: mockWallet.network,
          balance: '10000000000000000000', // 10 ETH
          required: 2
        }]
      });

      // Mock transaction insert
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'tx-1' }]
      });

      // Mock update queries
      mockClient.query.mockResolvedValue({ rows: [] });

      // Mock recipient check for Slack notification
      mockDb.query.mockResolvedValueOnce([]); // Unknown recipient

      await eventProcessor.processTransactionSubmission(
        mockWallet,
        mockEvent,
        mockSubmission,
        TransactionAction.TRANSFER
      );

      // Verify owner was queried
      expect(mockClient.query).toHaveBeenCalledWith(
        'SELECT * FROM owners WHERE address = $1 AND network = $2',
        [mockSubmission.submitter, mockWallet.network]
      );

      // Verify wallet was queried
      expect(mockClient.query).toHaveBeenCalledWith(
        'SELECT * FROM wallets WHERE address = $1 AND network = $2',
        [mockWallet.address, mockWallet.network]
      );

      // Verify transaction was created
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO transactions'),
        expect.arrayContaining([
          'wallet-1',
          mockSubmission.transactionId,
          mockSubmission.blockNumber,
          mockSubmission.transactionHash,
          TransactionAction.TRANSFER,
          mockSubmission.submitter,
          mockSubmission.destination,
          mockSubmission.value
        ])
      );

      // Verify Slack notifications
      expect(mockSlackNotifier.notifyLargeTransaction).toHaveBeenCalled();
      expect(mockSlackNotifier.notifyUnknownRecipient).toHaveBeenCalled();
    });

    it('should create new owner if not exists', async () => {
      // Mock owner query - not found
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // Mock owner insert
      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: 'owner-new',
          address: mockSubmission.submitter,
          network: mockWallet.network
        }]
      });

      // Mock wallet query
      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: 'wallet-1',
          address: mockWallet.address,
          balance: '10000000000000000000',
          required: 2
        }]
      });

      // Mock transaction insert
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'tx-1' }]
      });

      // Mock update queries
      mockClient.query.mockResolvedValue({ rows: [] });

      await eventProcessor.processTransactionSubmission(
        mockWallet,
        mockEvent,
        mockSubmission,
        TransactionAction.TRANSFER
      );

      // Verify owner was created
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO owners'),
        expect.arrayContaining([mockSubmission.submitter, mockWallet.network])
      );
    });

    it('should handle wallet not found error', async () => {
      // Mock owner query
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'owner-1' }]
      });

      // Mock wallet query - not found
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        eventProcessor.processTransactionSubmission(
          mockWallet,
          mockEvent,
          mockSubmission,
          TransactionAction.TRANSFER
        )
      ).rejects.toThrow(`Wallet not found: ${mockWallet.address}`);
    });

    it('should calculate transfer percentage correctly', async () => {
      const walletBalance = '10000000000000000000'; // 10 ETH
      const transferValue = '2500000000000000000'; // 2.5 ETH (25%)

      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'owner-1' }]
      });

      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: 'wallet-1',
          balance: walletBalance,
          required: 2
        }]
      });

      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'tx-1' }]
      });

      mockClient.query.mockResolvedValue({ rows: [] });

      await eventProcessor.processTransactionSubmission(
        mockWallet,
        mockEvent,
        { ...mockSubmission, value: transferValue },
        TransactionAction.TRANSFER
      );

      // Verify transfer percentage was calculated
      const insertCall = mockClient.query.mock.calls.find(
        call => call[0].includes('INSERT INTO transactions')
      );
      expect(insertCall[1][11]).toBe(25); // Transfer percentage should be 25%
    });

    it('should handle transaction with data', async () => {
      const submissionWithData = {
        ...mockSubmission,
        data: '0x095ea7b3000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec7ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'owner-1' }]
      });

      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: 'wallet-1',
          balance: '10000000000000000000',
          required: 2
        }]
      });

      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'tx-1' }]
      });

      mockClient.query.mockResolvedValue({ rows: [] });

      await eventProcessor.processTransactionSubmission(
        mockWallet,
        mockEvent,
        submissionWithData,
        TransactionAction.CONTRACT_CALL
      );

      // Verify decoded data was included
      const insertCall = mockClient.query.mock.calls.find(
        call => call[0].includes('INSERT INTO transactions')
      );
      const decodedData = JSON.parse(insertCall[1][9]);
      expect(decodedData).toMatchObject({
        functionName: TransactionAction.CONTRACT_CALL,
        parameters: {}
      });
    });

    it('should not send large transaction notification for small amounts', async () => {
      const smallSubmission = {
        ...mockSubmission,
        value: '100000000000000000' // 0.1 ETH
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'owner-1' }]
      });

      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: 'wallet-1',
          balance: '10000000000000000000',
          required: 2
        }]
      });

      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'tx-1' }]
      });

      mockClient.query.mockResolvedValue({ rows: [] });

      // Mock recipient check - known recipient
      mockDb.query.mockResolvedValueOnce([{ id: 'recipient-1' }]);

      await eventProcessor.processTransactionSubmission(
        mockWallet,
        mockEvent,
        smallSubmission,
        TransactionAction.TRANSFER
      );

      expect(mockSlackNotifier.notifyLargeTransaction).not.toHaveBeenCalled();
      expect(mockSlackNotifier.notifyTransactionSubmission).toHaveBeenCalled();
      expect(mockSlackNotifier.notifyUnknownRecipient).not.toHaveBeenCalled();
    });

    it('should handle validation when enabled', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'owner-1' }]
      });

      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: 'wallet-1',
          balance: '10000000000000000000',
          required: 2
        }]
      });

      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'tx-1' }]
      });

      // Mock validation update
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      mockClient.query.mockResolvedValue({ rows: [] });

      await eventProcessor.processTransactionSubmission(
        mockWallet,
        mockEvent,
        mockSubmission,
        TransactionAction.TRANSFER
      );

      // Verify validation was performed
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE transactions'),
        expect.arrayContaining(['tx-1'])
      );
    });

    it('should skip validation when disabled', async () => {
      const processorWithoutValidation = new EventProcessor(mockDb, mockLogger, {
        ...defaultConfig,
        enableValidation: false
      });
      (processorWithoutValidation as any).slackNotifier = mockSlackNotifier;

      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'owner-1' }]
      });

      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: 'wallet-1',
          balance: '10000000000000000000',
          required: 2
        }]
      });

      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'tx-1' }]
      });

      mockClient.query.mockResolvedValue({ rows: [] });

      await processorWithoutValidation.processTransactionSubmission(
        mockWallet,
        mockEvent,
        mockSubmission,
        TransactionAction.TRANSFER
      );

      // Verify validation was not called
      const validationCalls = mockClient.query.mock.calls.filter(
        call => call[0].includes('validation_status')
      );
      expect(validationCalls.length).toBe(0);
    });
  });

  describe('processTransactionConfirmation', () => {
    const mockWallet: WalletConfig = {
      address: '0x1234567890123456789012345678901234567890',
      network: NetworkType.LOCALHOST,
      type: WalletType.MULTISIG_WALLET,
      active: true
    };

    const mockEvent: ProcessedEvent = {
      blockNumber: 1001,
      transactionHash: '0xbcde',
      timestamp: new Date(),
      logIndex: 0,
      removed: false,
      address: mockWallet.address,
      eventName: 'Confirmation',
      args: {}
    };

    const mockConfirmation: TransactionConfirmationData = {
      transactionId: 1,
      confirmer: '0xconfirmer',
      blockNumber: 1001,
      transactionHash: '0xbcde',
      timestamp: new Date()
    };

    it('should process transaction confirmation successfully', async () => {
      // Mock transaction query
      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: 'tx-1',
          transaction_id: 1,
          confirmations: JSON.stringify([
            { owner: '0xowner1', confirmedAt: new Date().toISOString() }
          ]),
          action: TransactionAction.TRANSFER,
          submitter: '0xsubmitter',
          destination: '0xdestination',
          value: '1000000000000000000'
        }]
      });

      // Mock confirmation update
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // Mock confirmer owner query - existing
      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: 'owner-2',
          address: mockConfirmation.confirmer
        }]
      });

      // Mock owner activity update
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // Mock wallet query for notification
      mockDb.query.mockResolvedValueOnce([{
        id: 'wallet-1',
        name: 'Test Wallet',
        required: 2
      }]);

      // Mock transaction query for notification
      mockDb.query.mockResolvedValueOnce([{
        id: 'tx-1',
        action: TransactionAction.TRANSFER,
        submitter: '0xsubmitter',
        destination: '0xdestination',
        value: '1000000000000000000'
      }]);

      await eventProcessor.processTransactionConfirmation(
        mockWallet,
        mockEvent,
        mockConfirmation
      );

      // Verify confirmation was added
      const updateCall = mockClient.query.mock.calls.find(
        call => call[0].includes('UPDATE transactions')
      );
      const confirmations = JSON.parse(updateCall[1][0]);
      expect(confirmations).toHaveLength(2);
      expect(confirmations[1].owner).toBe(mockConfirmation.confirmer);

      // Verify Slack notification
      expect(mockSlackNotifier.notifyTransactionConfirmation).toHaveBeenCalled();
    });

    it('should skip if already confirmed by same owner', async () => {
      // Mock transaction with existing confirmation from same owner
      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: 'tx-1',
          confirmations: JSON.stringify([
            { owner: mockConfirmation.confirmer, confirmedAt: new Date().toISOString() }
          ])
        }]
      });

      await eventProcessor.processTransactionConfirmation(
        mockWallet,
        mockEvent,
        mockConfirmation
      );

      // Verify no update was made
      const updateCalls = mockClient.query.mock.calls.filter(
        call => call[0].includes('UPDATE transactions')
      );
      expect(updateCalls.length).toBe(0);
    });

    it('should handle transaction not found', async () => {
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      await eventProcessor.processTransactionConfirmation(
        mockWallet,
        mockEvent,
        mockConfirmation
      );

      // Should log warning but not throw
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Transaction not found for confirmation',
        expect.any(Object)
      );
    });

    it('should handle case-insensitive owner comparison', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: 'tx-1',
          confirmations: JSON.stringify([
            { owner: '0xCONFIRMER', confirmedAt: new Date().toISOString() }
          ])
        }]
      });

      await eventProcessor.processTransactionConfirmation(
        mockWallet,
        mockEvent,
        { ...mockConfirmation, confirmer: '0xconfirmer' }
      );

      // Should detect as already confirmed
      const updateCalls = mockClient.query.mock.calls.filter(
        call => call[0].includes('UPDATE transactions')
      );
      expect(updateCalls.length).toBe(0);
    });

    it('should create new confirmer owner if not exists', async () => {
      // Mock transaction query
      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: 'tx-1',
          confirmations: JSON.stringify([])
        }]
      });

      // Mock confirmation update
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // Mock confirmer owner query - not found
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // Mock owner insert
      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: 'owner-new',
          address: mockConfirmation.confirmer
        }]
      });

      // Mock owner activity update
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      await eventProcessor.processTransactionConfirmation(
        mockWallet,
        mockEvent,
        mockConfirmation
      );

      // Verify owner was created
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO owners'),
        expect.arrayContaining([mockConfirmation.confirmer])
      );
    });
  });

  describe('processTransactionExecution', () => {
    const mockWallet: WalletConfig = {
      address: '0x1234567890123456789012345678901234567890',
      network: NetworkType.LOCALHOST,
      type: WalletType.MULTISIG_WALLET,
      active: true
    };

    const mockEvent: ProcessedEvent = {
      blockNumber: 1002,
      transactionHash: '0xcdef',
      timestamp: new Date(),
      logIndex: 0,
      removed: false,
      address: mockWallet.address,
      eventName: 'Execution',
      args: {}
    };

    it('should process transaction execution successfully', async () => {
      // Mock execution update
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // Mock sync wallet state (not implemented in test)
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // Mock wallet query for notification
      mockDb.query.mockResolvedValueOnce([{
        id: 'wallet-1',
        name: 'Test Wallet',
        required: 2
      }]);

      // Mock transaction query for notification
      mockDb.query.mockResolvedValueOnce([{
        id: 'tx-1',
        action: TransactionAction.TRANSFER,
        submitter: '0xsubmitter',
        destination: '0xdestination',
        value: '1000000000000000000'
      }]);

      await eventProcessor.processTransactionExecution(
        mockWallet,
        mockEvent,
        1
      );

      // Verify execution was updated
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE transactions'),
        expect.arrayContaining([
          mockEvent.timestamp,
          mockWallet.address,
          mockWallet.network,
          1
        ])
      );

      // Verify Slack notification
      expect(mockSlackNotifier.notifyTransactionExecution).toHaveBeenCalled();
    });

    it('should handle sync wallet state errors gracefully', async () => {
      mockClient.query.mockResolvedValueOnce({ rows: [] });
      mockClient.query.mockRejectedValueOnce(new Error('Sync failed'));

      // Should not throw
      await expect(
        eventProcessor.processTransactionExecution(mockWallet, mockEvent, 1)
      ).resolves.not.toThrow();
    });
  });

  describe('processOwnerChange', () => {
    const mockWallet: WalletConfig = {
      address: '0x1234567890123456789012345678901234567890',
      network: NetworkType.LOCALHOST,
      type: WalletType.MULTISIG_WALLET,
      active: true
    };

    const mockEvent: ProcessedEvent = {
      blockNumber: 1003,
      transactionHash: '0xdefg',
      timestamp: new Date(),
      logIndex: 0,
      removed: false,
      address: mockWallet.address,
      eventName: 'OwnerAddition',
      args: {}
    };

    it('should process owner addition successfully', async () => {
      const ownerChange: OwnerChangeData = {
        changeType: 'addition',
        owner: '0xnewowner',
        blockNumber: 1003,
        transactionHash: '0xdefg'
      };

      // Mock owner query - new owner
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // Mock owner insert
      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: 'owner-new',
          address: ownerChange.owner,
          wallets: []
        }]
      });

      // Mock owner wallet update
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // Mock sync wallet state
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // Mock wallet query for alert
      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: 'wallet-1',
          address: mockWallet.address
        }]
      });

      // Mock alert insert
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // Mock wallet query for notification
      mockDb.query.mockResolvedValueOnce([{
        id: 'wallet-1',
        name: 'Test Wallet'
      }]);

      await eventProcessor.processOwnerChange(
        mockWallet,
        mockEvent,
        ownerChange
      );

      // Verify owner was created/updated
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO owners'),
        expect.arrayContaining([ownerChange.owner])
      );

      // Verify alert was created
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO alerts'),
        expect.arrayContaining([
          'wallet-1',
          AlertPriority.P1,
          'owner_addition'
        ])
      );

      // Verify Slack notification
      expect(mockSlackNotifier.notifyOwnerChange).toHaveBeenCalled();
    });

    it('should process owner removal successfully', async () => {
      const ownerChange: OwnerChangeData = {
        changeType: 'removal',
        owner: '0xremovedowner',
        blockNumber: 1003,
        transactionHash: '0xdefg'
      };

      // Mock owner status update
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // Mock sync wallet state
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // Mock wallet query for alert
      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: 'wallet-1',
          address: mockWallet.address
        }]
      });

      // Mock alert insert
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // Mock wallet query for notification
      mockDb.query.mockResolvedValueOnce([{
        id: 'wallet-1',
        name: 'Test Wallet'
      }]);

      await eventProcessor.processOwnerChange(
        mockWallet,
        mockEvent,
        ownerChange
      );

      // Verify owner status was updated
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE owners'),
        expect.arrayContaining([
          OwnerStatus.REMOVED,
          ownerChange.owner,
          mockWallet.network
        ])
      );

      // Verify alert was created
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO alerts'),
        expect.arrayContaining([
          'wallet-1',
          AlertPriority.P1,
          'owner_removal'
        ])
      );
    });

    it('should update existing owner wallet list on addition', async () => {
      const ownerChange: OwnerChangeData = {
        changeType: 'addition',
        owner: '0xexistingowner',
        blockNumber: 1003,
        transactionHash: '0xdefg'
      };

      // Mock owner query - existing owner with other wallets
      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: 'owner-existing',
          address: ownerChange.owner,
          wallets: ['0xotherwallet'],
          contract_data: { wallets: ['0xotherwallet'] }
        }]
      });

      // Mock owner wallet update
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // Mock sync wallet state
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // Mock wallet query for alert
      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: 'wallet-1'
        }]
      });

      // Mock alert insert
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      await eventProcessor.processOwnerChange(
        mockWallet,
        mockEvent,
        ownerChange
      );

      // Verify wallet was added to owner's list
      const updateCall = mockClient.query.mock.calls.find(
        call => call[0].includes('UPDATE owners') && call[0].includes('wallets')
      );
      const updatedWallets = JSON.parse(updateCall[1][0]);
      expect(updatedWallets).toContain(mockWallet.address);
      expect(updatedWallets).toContain('0xotherwallet');
    });

    it('should skip alert creation when autoProcessAlerts is disabled', async () => {
      const processorWithoutAlerts = new EventProcessor(mockDb, mockLogger, {
        ...defaultConfig,
        autoProcessAlerts: false
      });
      (processorWithoutAlerts as any).slackNotifier = mockSlackNotifier;

      const ownerChange: OwnerChangeData = {
        changeType: 'addition',
        owner: '0xnewowner',
        blockNumber: 1003,
        transactionHash: '0xdefg'
      };

      // Mock owner queries
      mockClient.query.mockResolvedValueOnce({ rows: [] });
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'owner-new', wallets: [] }]
      });
      mockClient.query.mockResolvedValueOnce({ rows: [] });
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      await processorWithoutAlerts.processOwnerChange(
        mockWallet,
        mockEvent,
        ownerChange
      );

      // Verify no alert was created
      const alertCalls = mockClient.query.mock.calls.filter(
        call => call[0].includes('INSERT INTO alerts')
      );
      expect(alertCalls.length).toBe(0);
    });
  });

  describe('helper methods', () => {
    it('should calculate transfer percentage correctly', () => {
      const testCases = [
        { value: '1000000000000000000', balance: '10000000000000000000', expected: 10 },
        { value: '5000000000000000000', balance: '10000000000000000000', expected: 50 },
        { value: '10000000000000000000', balance: '10000000000000000000', expected: 100 },
        { value: '0', balance: '10000000000000000000', expected: 0 },
        { value: '1', balance: '0', expected: 0 }, // Division by zero
        { value: 'invalid', balance: '10000000000000000000', expected: 0 } // Invalid input
      ];

      testCases.forEach(({ value, balance, expected }) => {
        const result = (eventProcessor as any).calculateTransferPercentage(value, balance);
        expect(result).toBe(expected);
      });
    });

    it('should handle database mapping correctly', () => {
      const dbRow = {
        id: 'wallet-1',
        address: '0xwallet',
        name: 'Test Wallet',
        network: 'localhost',
        type: 'MultiSigWallet',
        owners: ['0xowner1', '0xowner2'],
        required: 2,
        balance: '1000000000000000000',
        monitored: true,
        created_at: new Date(),
        updated_at: new Date()
      };

      const mapped = (eventProcessor as any).mapWalletFromDb(dbRow);

      expect(mapped).toMatchObject({
        id: dbRow.id,
        address: dbRow.address,
        name: dbRow.name,
        network: dbRow.network,
        type: dbRow.type,
        owners: dbRow.owners,
        required: dbRow.required,
        balance: dbRow.balance
      });
    });
  });

  describe('error handling', () => {
    it('should handle database transaction errors', async () => {
      const dbError = new Error('Transaction failed');
      mockDb.transaction.mockRejectedValueOnce(dbError);

      const mockWallet: WalletConfig = {
        address: '0xwallet',
        network: NetworkType.LOCALHOST,
        type: WalletType.MULTISIG_WALLET,
        active: true
      };

      await expect(
        eventProcessor.processTransactionSubmission(
          mockWallet,
          {} as ProcessedEvent,
          {} as TransactionSubmissionData,
          TransactionAction.TRANSFER
        )
      ).rejects.toThrow('Transaction failed');
    });

    it('should continue processing owners even if one fails', async () => {
      const ownerChange: OwnerChangeData = {
        changeType: 'addition',
        owner: '0xnewowner',
        blockNumber: 1003,
        transactionHash: '0xdefg'
      };

      // First owner query fails
      mockClient.query.mockRejectedValueOnce(new Error('Query failed'));

      // But transaction should continue
      mockClient.query.mockResolvedValue({ rows: [] });

      // Should not throw
      await expect(
        eventProcessor.processOwnerChange(
          {} as WalletConfig,
          {} as ProcessedEvent,
          ownerChange
        )
      ).resolves.not.toThrow();
    });
  });

  describe('Slack notification error handling', () => {
    it('should continue processing if Slack notification fails', async () => {
      mockSlackNotifier.notifyTransactionSubmission.mockRejectedValueOnce(
        new Error('Slack error')
      );

      const mockWallet: WalletConfig = {
        address: '0xwallet',
        network: NetworkType.LOCALHOST,
        type: WalletType.MULTISIG_WALLET,
        active: true
      };

      // Setup successful database operations
      mockClient.query.mockResolvedValue({ rows: [{ id: 'test-id' }] });

      // Should complete successfully despite Slack error
      await expect(
        eventProcessor.processTransactionSubmission(
          mockWallet,
          {} as ProcessedEvent,
          {
            transactionId: 1,
            submitter: '0xsubmitter',
            value: '1000000000000000000',
            timestamp: new Date()
          } as TransactionSubmissionData,
          TransactionAction.TRANSFER
        )
      ).resolves.not.toThrow();

      // Verify error was logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to send transaction submission notification:',
        expect.any(Error)
      );
    });
  });
});