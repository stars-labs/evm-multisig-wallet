// Chain service for multi-chain configuration and sync state management
import { Database } from '../database';
import { NetworkType } from '@multisig-validator/shared';
import { ChainModel, ChainSyncUpdate, ChainCreateRequest, ChainUpdateRequest } from '../models/chainModel';
import winston from 'winston';

export class ChainService {
  private db: Database;
  private logger: winston.Logger;

  constructor(db: Database, logger: winston.Logger) {
    this.db = db;
    this.logger = logger;
  }

  // ============================================================================
  // CHAIN CONFIGURATION MANAGEMENT
  // ============================================================================

  async getAllChains(): Promise<ChainModel[]> {
    const result = await this.db.query(`
      SELECT * FROM chains 
      ORDER BY network
    `);
    
    return result.map(this.mapChainFromDb);
  }

  async getEnabledChains(): Promise<ChainModel[]> {
    const result = await this.db.query(`
      SELECT * FROM chains 
      WHERE enabled = true 
      ORDER BY network
    `);
    
    return result.map(this.mapChainFromDb);
  }

  async getChainByNetwork(network: NetworkType): Promise<ChainModel | null> {
    const result = await this.db.query(
      'SELECT * FROM chains WHERE network = $1',
      [network]
    );
    
    if (result.length === 0) {
      return null;
    }
    
    return this.mapChainFromDb(result[0]);
  }

  async createChain(data: ChainCreateRequest): Promise<ChainModel> {
    const result = await this.db.query(`
      INSERT INTO chains (
        network, chain_id, name, rpc_url, rpc_backup_urls,
        block_confirmations, start_block, rate_limit_rps, rate_limit_rpm,
        sync_interval_ms, max_blocks_per_batch, enabled
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [
      data.network,
      data.chainId,
      data.name,
      data.rpcUrl,
      JSON.stringify(data.rpcBackupUrls || []),
      data.blockConfirmations || 3,
      data.startBlock || 0,
      data.rateLimitRps || 5,
      data.rateLimitRpm || 100,
      data.syncIntervalMs || 30000,
      data.maxBlocksPerBatch || 1000,
      data.enabled !== false
    ]);

    return this.mapChainFromDb(result[0]);
  }

  async updateChain(network: NetworkType, data: ChainUpdateRequest): Promise<ChainModel | null> {
    const updateFields: string[] = [];
    const updateValues: any[] = [];
    let paramCount = 1;

    // Build dynamic update query
    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined) {
        const dbColumn = this.camelToSnake(key);
        updateFields.push(`${dbColumn} = $${paramCount}`);
        updateValues.push(key === 'rpcBackupUrls' ? JSON.stringify(value) : value);
        paramCount++;
      }
    });

    if (updateFields.length === 0) {
      return this.getChainByNetwork(network);
    }

    updateFields.push(`updated_at = NOW()`);
    updateValues.push(network);

    const result = await this.db.query(`
      UPDATE chains 
      SET ${updateFields.join(', ')}
      WHERE network = $${paramCount}
      RETURNING *
    `, updateValues);

    if (result.length === 0) {
      return null;
    }

    return this.mapChainFromDb(result[0]);
  }

  // ============================================================================
  // SYNC STATE MANAGEMENT
  // ============================================================================

  async updateSyncState(network: NetworkType, update: ChainSyncUpdate): Promise<boolean> {
    try {
      await this.db.query(`
        UPDATE chains 
        SET 
          last_processed_block = $1,
          sync_status = $2,
          last_sync_at = $3,
          last_error = $4,
          consecutive_errors = COALESCE($5, consecutive_errors),
          total_requests = total_requests + 1,
          updated_at = NOW()
        WHERE network = $6
      `, [
        update.lastProcessedBlock,
        update.syncStatus,
        update.lastSyncAt,
        update.lastError || null,
        update.consecutiveErrors,
        network
      ]);

      return true;
    } catch (error) {
      this.logger.error(`Failed to update sync state for ${network}:`, error);
      return false;
    }
  }

  async incrementErrorCount(network: NetworkType, error: string): Promise<void> {
    await this.db.query(`
      UPDATE chains 
      SET 
        consecutive_errors = consecutive_errors + 1,
        total_errors = total_errors + 1,
        last_error = $1,
        last_error_at = NOW(),
        sync_status = CASE 
          WHEN consecutive_errors + 1 >= 5 THEN 'error'
          ELSE sync_status 
        END,
        updated_at = NOW()
      WHERE network = $2
    `, [error, network]);
  }

  async resetErrorCount(network: NetworkType): Promise<void> {
    await this.db.query(`
      UPDATE chains 
      SET 
        consecutive_errors = 0,
        last_error = NULL,
        last_error_at = NULL,
        sync_status = CASE 
          WHEN sync_status = 'error' THEN 'running'
          ELSE sync_status 
        END,
        updated_at = NOW()
      WHERE network = $2
    `, [network]);
  }

  async setSyncStatus(network: NetworkType, status: 'stopped' | 'running' | 'error' | 'paused'): Promise<void> {
    await this.db.query(`
      UPDATE chains 
      SET sync_status = $1, updated_at = NOW()
      WHERE network = $2
    `, [status, network]);
  }

  // ============================================================================
  // MONITORING AND METRICS
  // ============================================================================

  async getChainMetrics(): Promise<{
    totalChains: number;
    enabledChains: number;
    runningChains: number;
    errorChains: number;
    chainSummary: Array<{
      network: NetworkType;
      status: string;
      lastBlock: number;
      errorCount: number;
      lastSync?: Date;
    }>;
  }> {
    const chains = await this.getAllChains();
    
    return {
      totalChains: chains.length,
      enabledChains: chains.filter(c => c.enabled).length,
      runningChains: chains.filter(c => c.syncStatus === 'running').length,
      errorChains: chains.filter(c => c.syncStatus === 'error').length,
      chainSummary: chains.map(c => ({
        network: c.network,
        status: c.syncStatus,
        lastBlock: c.lastProcessedBlock,
        errorCount: c.consecutiveErrors,
        lastSync: c.lastSyncAt
      }))
    };
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  private mapChainFromDb(row: any): ChainModel {
    return {
      id: row.id,
      network: row.network,
      chainId: row.chain_id,
      name: row.name,
      rpcUrl: row.rpc_url,
      rpcBackupUrls: row.rpc_backup_urls || [],
      blockConfirmations: row.block_confirmations,
      startBlock: row.start_block,
      lastProcessedBlock: row.last_processed_block,
      rateLimitRps: row.rate_limit_rps,
      rateLimitRpm: row.rate_limit_rpm,
      rateLimitBackoffMultiplier: row.rate_limit_backoff_multiplier,
      rateLimitMaxBackoffMs: row.rate_limit_max_backoff_ms,
      syncIntervalMs: row.sync_interval_ms,
      maxBlocksPerBatch: row.max_blocks_per_batch,
      batchSize: row.batch_size,
      enabled: row.enabled,
      syncStatus: row.sync_status,
      lastSyncAt: row.last_sync_at,
      lastError: row.last_error,
      lastErrorAt: row.last_error_at,
      consecutiveErrors: row.consecutive_errors,
      totalRequests: row.total_requests,
      totalErrors: row.total_errors,
      avgResponseTimeMs: row.avg_response_time_ms,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }
}