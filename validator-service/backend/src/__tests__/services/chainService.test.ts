// Comprehensive test suite for ChainService
import { ChainService } from '../../services/chainService';
import { Database } from '../../database';
import { NetworkType } from '@multisig-validator/shared';
import { ChainModel, ChainCreateRequest, ChainUpdateRequest, ChainSyncUpdate } from '../../models/chainModel';
import winston from 'winston';
import { TestEnvironment, setupTestEnvironment, teardownTestEnvironment } from '../helpers/testUtils';

describe('ChainService', () => {
  let env: TestEnvironment;
  let chainService: ChainService;
  let mockDb: jest.Mocked<Database>;
  let mockLogger: winston.Logger;

  beforeEach(async () => {
    env = await setupTestEnvironment();
    mockLogger = env.getLogger();
    mockDb = {
      query: jest.fn(),
      queryOne: jest.fn(),
      transaction: jest.fn(),
      healthCheck: jest.fn(),
      close: jest.fn()
    } as any;
    
    chainService = new ChainService(mockDb, mockLogger);
  });

  afterEach(async () => {
    await teardownTestEnvironment(env);
    jest.clearAllMocks();
  });

  describe('getAllChains', () => {
    it('should return all chains ordered by network', async () => {
      const mockChains = [
        {
          id: '1',
          network: 'mainnet',
          chain_id: 1,
          name: 'Ethereum Mainnet',
          rpc_url: 'https://mainnet.infura.io',
          rpc_backup_urls: [],
          block_confirmations: 12,
          start_block: 0,
          last_processed_block: 1000000,
          rate_limit_rps: 5,
          rate_limit_rpm: 100,
          sync_interval_ms: 30000,
          max_blocks_per_batch: 1000,
          enabled: true,
          sync_status: 'running',
          last_sync_at: new Date(),
          consecutive_errors: 0,
          total_requests: 1000,
          total_errors: 5,
          created_at: new Date(),
          updated_at: new Date()
        },
        {
          id: '2',
          network: 'sepolia',
          chain_id: 11155111,
          name: 'Sepolia Testnet',
          rpc_url: 'https://sepolia.infura.io',
          rpc_backup_urls: [],
          block_confirmations: 3,
          start_block: 0,
          last_processed_block: 500000,
          rate_limit_rps: 5,
          rate_limit_rpm: 100,
          sync_interval_ms: 30000,
          max_blocks_per_batch: 1000,
          enabled: true,
          sync_status: 'running',
          last_sync_at: new Date(),
          consecutive_errors: 0,
          total_requests: 500,
          total_errors: 2,
          created_at: new Date(),
          updated_at: new Date()
        }
      ];

      mockDb.query.mockResolvedValue(mockChains);

      const result = await chainService.getAllChains();

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM chains'),
        undefined
      );
      expect(result).toHaveLength(2);
      expect(result[0].network).toBe('mainnet');
      expect(result[1].network).toBe('sepolia');
    });

    it('should handle empty result', async () => {
      mockDb.query.mockResolvedValue([]);

      const result = await chainService.getAllChains();

      expect(result).toHaveLength(0);
    });

    it('should handle database errors', async () => {
      mockDb.query.mockRejectedValue(new Error('Database error'));

      await expect(chainService.getAllChains()).rejects.toThrow('Database error');
    });
  });

  describe('getEnabledChains', () => {
    it('should return only enabled chains', async () => {
      const mockEnabledChain = {
        id: '1',
        network: 'mainnet',
        chain_id: 1,
        name: 'Ethereum Mainnet',
        rpc_url: 'https://mainnet.infura.io',
        enabled: true,
        sync_status: 'running'
      };

      mockDb.query.mockResolvedValue([mockEnabledChain]);

      const result = await chainService.getEnabledChains();

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE enabled = true'),
        undefined
      );
      expect(result).toHaveLength(1);
      expect(result[0].enabled).toBe(true);
    });
  });

  describe('getChainByNetwork', () => {
    it('should return chain for given network', async () => {
      const mockChain = {
        id: '1',
        network: NetworkType.MAINNET,
        chain_id: 1,
        name: 'Ethereum Mainnet',
        enabled: true
      };

      mockDb.query.mockResolvedValue([mockChain]);

      const result = await chainService.getChainByNetwork(NetworkType.MAINNET);

      expect(mockDb.query).toHaveBeenCalledWith(
        'SELECT * FROM chains WHERE network = $1',
        [NetworkType.MAINNET]
      );
      expect(result).toBeDefined();
      expect(result?.network).toBe(NetworkType.MAINNET);
    });

    it('should return null if chain not found', async () => {
      mockDb.query.mockResolvedValue([]);

      const result = await chainService.getChainByNetwork(NetworkType.MAINNET);

      expect(result).toBeNull();
    });
  });

  describe('createChain', () => {
    it('should create new chain with all fields', async () => {
      const chainData: ChainCreateRequest = {
        network: NetworkType.LOCALHOST,
        chainId: 31337,
        name: 'Local Test Network',
        rpcUrl: 'http://localhost:8545',
        rpcBackupUrls: ['http://localhost:8546'],
        blockConfirmations: 1,
        startBlock: 0,
        rateLimitRps: 10,
        rateLimitRpm: 200,
        syncIntervalMs: 10000,
        maxBlocksPerBatch: 500,
        enabled: true
      };

      const mockCreatedChain = {
        id: '3',
        ...chainData,
        rpc_backup_urls: JSON.stringify(chainData.rpcBackupUrls),
        last_processed_block: 0,
        sync_status: 'stopped',
        consecutive_errors: 0,
        total_requests: 0,
        total_errors: 0,
        created_at: new Date(),
        updated_at: new Date()
      };

      mockDb.query.mockResolvedValue([mockCreatedChain]);

      const result = await chainService.createChain(chainData);

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO chains'),
        [
          chainData.network,
          chainData.chainId,
          chainData.name,
          chainData.rpcUrl,
          JSON.stringify(chainData.rpcBackupUrls),
          chainData.blockConfirmations,
          chainData.startBlock,
          chainData.rateLimitRps,
          chainData.rateLimitRpm,
          chainData.syncIntervalMs,
          chainData.maxBlocksPerBatch,
          chainData.enabled
        ]
      );
      expect(result.network).toBe(chainData.network);
    });

    it('should use default values for optional fields', async () => {
      const minimalChainData: ChainCreateRequest = {
        network: NetworkType.MAINNET,
        chainId: 1,
        name: 'Ethereum Mainnet',
        rpcUrl: 'https://mainnet.infura.io'
      };

      mockDb.query.mockResolvedValue([{ ...minimalChainData, id: '4' }]);

      await chainService.createChain(minimalChainData);

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO chains'),
        expect.arrayContaining([
          minimalChainData.network,
          minimalChainData.chainId,
          minimalChainData.name,
          minimalChainData.rpcUrl,
          JSON.stringify([]), // default empty backup URLs
          3, // default block confirmations
          0, // default start block
          5, // default rate limit RPS
          100, // default rate limit RPM
          30000, // default sync interval
          1000, // default max blocks per batch
          true // default enabled
        ])
      );
    });
  });

  describe('updateChain', () => {
    it('should update chain with provided fields', async () => {
      const updateData: ChainUpdateRequest = {
        rpcUrl: 'https://new-rpc.infura.io',
        blockConfirmations: 6,
        enabled: false
      };

      const mockUpdatedChain = {
        id: '1',
        network: NetworkType.MAINNET,
        rpc_url: updateData.rpcUrl,
        block_confirmations: updateData.blockConfirmations,
        enabled: updateData.enabled,
        updated_at: new Date()
      };

      mockDb.query.mockResolvedValue([mockUpdatedChain]);

      const result = await chainService.updateChain(NetworkType.MAINNET, updateData);

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE chains'),
        expect.arrayContaining([
          updateData.rpcUrl,
          updateData.blockConfirmations,
          updateData.enabled,
          NetworkType.MAINNET
        ])
      );
      expect(result).toBeDefined();
      expect(result?.enabled).toBe(false);
    });

    it('should handle camelCase to snake_case conversion', async () => {
      const updateData: ChainUpdateRequest = {
        rateLimitRps: 10,
        syncIntervalMs: 60000
      };

      mockDb.query.mockResolvedValue([{ id: '1' }]);

      await chainService.updateChain(NetworkType.MAINNET, updateData);

      const query = mockDb.query.mock.calls[0][0];
      expect(query).toContain('rate_limit_rps');
      expect(query).toContain('sync_interval_ms');
    });

    it('should return existing chain if no updates provided', async () => {
      const existingChain = {
        id: '1',
        network: NetworkType.MAINNET,
        chain_id: 1
      };

      mockDb.query.mockResolvedValue([existingChain]);

      const result = await chainService.updateChain(NetworkType.MAINNET, {});

      expect(result).toBeDefined();
      expect(mockDb.query).toHaveBeenCalledTimes(1);
      expect(mockDb.query).toHaveBeenCalledWith(
        'SELECT * FROM chains WHERE network = $1',
        [NetworkType.MAINNET]
      );
    });

    it('should return null if chain not found', async () => {
      mockDb.query.mockResolvedValue([]);

      const result = await chainService.updateChain(NetworkType.MAINNET, { enabled: false });

      expect(result).toBeNull();
    });
  });

  describe('updateSyncState', () => {
    it('should update sync state successfully', async () => {
      const syncUpdate: ChainSyncUpdate = {
        lastProcessedBlock: 2000000,
        syncStatus: 'running',
        lastSyncAt: new Date(),
        lastError: null,
        consecutiveErrors: 0
      };

      mockDb.query.mockResolvedValue([]);

      const result = await chainService.updateSyncState(NetworkType.MAINNET, syncUpdate);

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE chains'),
        [
          syncUpdate.lastProcessedBlock,
          syncUpdate.syncStatus,
          syncUpdate.lastSyncAt,
          null,
          syncUpdate.consecutiveErrors,
          NetworkType.MAINNET
        ]
      );
      expect(result).toBe(true);
    });

    it('should handle update with error', async () => {
      const syncUpdate: ChainSyncUpdate = {
        lastProcessedBlock: 2000000,
        syncStatus: 'error',
        lastSyncAt: new Date(),
        lastError: 'RPC connection failed',
        consecutiveErrors: 3
      };

      mockDb.query.mockResolvedValue([]);

      const result = await chainService.updateSyncState(NetworkType.MAINNET, syncUpdate);

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE chains'),
        expect.arrayContaining([syncUpdate.lastError])
      );
      expect(result).toBe(true);
    });

    it('should return false on database error', async () => {
      mockDb.query.mockRejectedValue(new Error('Database error'));

      const result = await chainService.updateSyncState(NetworkType.MAINNET, {
        lastProcessedBlock: 2000000,
        syncStatus: 'running',
        lastSyncAt: new Date()
      });

      expect(result).toBe(false);
    });
  });

  describe('incrementErrorCount', () => {
    it('should increment error count and update status when threshold reached', async () => {
      mockDb.query.mockResolvedValue([]);

      await chainService.incrementErrorCount(NetworkType.MAINNET, 'Connection timeout');

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('consecutive_errors = consecutive_errors + 1'),
        ['Connection timeout', NetworkType.MAINNET]
      );
      expect(mockDb.query.mock.calls[0][0]).toContain(
        "WHEN consecutive_errors + 1 >= 5 THEN 'error'"
      );
    });
  });

  describe('resetErrorCount', () => {
    it('should reset error count and clear error status', async () => {
      mockDb.query.mockResolvedValue([]);

      await chainService.resetErrorCount(NetworkType.MAINNET);

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('consecutive_errors = 0'),
        [NetworkType.MAINNET]
      );
      expect(mockDb.query.mock.calls[0][0]).toContain('last_error = NULL');
      expect(mockDb.query.mock.calls[0][0]).toContain(
        "WHEN sync_status = 'error' THEN 'running'"
      );
    });
  });

  describe('setSyncStatus', () => {
    it('should set sync status', async () => {
      mockDb.query.mockResolvedValue([]);

      await chainService.setSyncStatus(NetworkType.MAINNET, 'paused');

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('SET sync_status = $1'),
        ['paused', NetworkType.MAINNET]
      );
    });
  });

  describe('getChainMetrics', () => {
    it('should calculate and return chain metrics', async () => {
      const mockChains = [
        {
          id: '1',
          network: NetworkType.MAINNET,
          enabled: true,
          sync_status: 'running',
          last_processed_block: 1000000,
          consecutive_errors: 0,
          last_sync_at: new Date()
        },
        {
          id: '2',
          network: NetworkType.SEPOLIA,
          enabled: true,
          sync_status: 'error',
          last_processed_block: 500000,
          consecutive_errors: 5,
          last_sync_at: new Date()
        },
        {
          id: '3',
          network: NetworkType.LOCALHOST,
          enabled: false,
          sync_status: 'stopped',
          last_processed_block: 0,
          consecutive_errors: 0,
          last_sync_at: null
        }
      ];

      mockDb.query.mockResolvedValue(mockChains);

      const metrics = await chainService.getChainMetrics();

      expect(metrics).toEqual({
        totalChains: 3,
        enabledChains: 2,
        runningChains: 1,
        errorChains: 1,
        chainSummary: expect.arrayContaining([
          expect.objectContaining({
            network: NetworkType.MAINNET,
            status: 'running',
            lastBlock: 1000000,
            errorCount: 0
          }),
          expect.objectContaining({
            network: NetworkType.SEPOLIA,
            status: 'error',
            lastBlock: 500000,
            errorCount: 5
          })
        ])
      });
    });

    it('should handle empty chains', async () => {
      mockDb.query.mockResolvedValue([]);

      const metrics = await chainService.getChainMetrics();

      expect(metrics).toEqual({
        totalChains: 0,
        enabledChains: 0,
        runningChains: 0,
        errorChains: 0,
        chainSummary: []
      });
    });
  });

  describe('private methods', () => {
    it('should correctly map database row to ChainModel', async () => {
      const dbRow = {
        id: '1',
        network: 'mainnet',
        chain_id: 1,
        name: 'Ethereum Mainnet',
        rpc_url: 'https://mainnet.infura.io',
        rpc_backup_urls: ['https://backup.infura.io'],
        block_confirmations: 12,
        start_block: 0,
        last_processed_block: 1000000,
        rate_limit_rps: 5,
        rate_limit_rpm: 100,
        rate_limit_backoff_multiplier: 2.0,
        rate_limit_max_backoff_ms: 120000,
        sync_interval_ms: 30000,
        max_blocks_per_batch: 1000,
        batch_size: 100,
        enabled: true,
        sync_status: 'running',
        last_sync_at: new Date('2024-01-01'),
        last_error: null,
        last_error_at: null,
        consecutive_errors: 0,
        total_requests: 1000,
        total_errors: 5,
        avg_response_time_ms: 150,
        created_at: new Date('2023-01-01'),
        updated_at: new Date('2024-01-01')
      };

      mockDb.query.mockResolvedValue([dbRow]);

      const result = await chainService.getChainByNetwork(NetworkType.MAINNET);

      expect(result).toMatchObject({
        id: dbRow.id,
        network: dbRow.network,
        chainId: dbRow.chain_id,
        name: dbRow.name,
        rpcUrl: dbRow.rpc_url,
        rpcBackupUrls: dbRow.rpc_backup_urls,
        blockConfirmations: dbRow.block_confirmations,
        enabled: dbRow.enabled,
        syncStatus: dbRow.sync_status
      });
    });

    it('should handle null values in database row', async () => {
      const dbRow = {
        id: '1',
        network: 'mainnet',
        chain_id: 1,
        name: 'Ethereum Mainnet',
        rpc_url: 'https://mainnet.infura.io',
        rpc_backup_urls: null,
        last_error: null,
        last_error_at: null,
        avg_response_time_ms: null
      };

      mockDb.query.mockResolvedValue([dbRow]);

      const result = await chainService.getChainByNetwork(NetworkType.MAINNET);

      expect(result?.rpcBackupUrls).toEqual([]);
      expect(result?.lastError).toBeNull();
      expect(result?.avgResponseTimeMs).toBeNull();
    });
  });

  describe('error handling', () => {
    it('should propagate database errors', async () => {
      const dbError = new Error('Connection lost');
      mockDb.query.mockRejectedValue(dbError);

      await expect(chainService.getAllChains()).rejects.toThrow('Connection lost');
    });

    it('should handle invalid network types', async () => {
      mockDb.query.mockResolvedValue([]);

      const result = await chainService.getChainByNetwork('invalid' as NetworkType);

      expect(result).toBeNull();
    });
  });

  describe('concurrent operations', () => {
    it('should handle concurrent updates correctly', async () => {
      mockDb.query.mockResolvedValue([{ id: '1' }]);

      const updates = [
        chainService.updateSyncState(NetworkType.MAINNET, {
          lastProcessedBlock: 1000,
          syncStatus: 'running',
          lastSyncAt: new Date()
        }),
        chainService.incrementErrorCount(NetworkType.MAINNET, 'Error 1'),
        chainService.setSyncStatus(NetworkType.MAINNET, 'paused')
      ];

      await Promise.all(updates);

      expect(mockDb.query).toHaveBeenCalledTimes(3);
    });
  });
});