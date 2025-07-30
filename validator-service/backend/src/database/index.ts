// Enhanced database connection and query interface with caching and monitoring
import { Pool, PoolClient, PoolConfig } from 'pg';
import winston from 'winston';
import config from '../config';

export interface QueryOptions {
  timeout?: number;
  cache?: boolean;
  cacheTTL?: number;
  retries?: number;
}

export interface DatabaseMetrics {
  totalQueries: number;
  totalErrors: number;
  cacheHits: number;
  cacheMisses: number;
  avgQueryTime: number;
  activeConnections: number;
}

export class Database {
  private pool: Pool;
  private logger: winston.Logger;
  private queryCache: Map<string, { data: any; timestamp: number; ttl: number }> = new Map();
  private metrics: DatabaseMetrics = {
    totalQueries: 0,
    totalErrors: 0,
    cacheHits: 0,
    cacheMisses: 0,
    avgQueryTime: 0,
    activeConnections: 0
  };
  private readonly DEFAULT_QUERY_TIMEOUT = 30000; // 30 seconds
  private readonly DEFAULT_CACHE_TTL = 300000; // 5 minutes
  private readonly MAX_RETRIES = 3;
  
  constructor(logger: winston.Logger) {
    this.logger = logger;
    
    const poolConfig: PoolConfig = {
      host: config.database.host,
      port: config.database.port,
      database: config.database.name,
      user: config.database.user,
      password: config.database.password,
      ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
      
      // Optimized connection pool settings
      max: 30, // Increased for better concurrency
      min: 5,  // Minimum idle connections
      idleTimeoutMillis: 300000, // 5 minutes - increased for better reuse
      connectionTimeoutMillis: 10000, // 10 seconds - increased for reliability
      
      // Enhanced configuration
      application_name: 'multisig-validator',
      statement_timeout: this.DEFAULT_QUERY_TIMEOUT,
      query_timeout: this.DEFAULT_QUERY_TIMEOUT,
      
      // Performance optimizations
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    };
    
    this.pool = new Pool(poolConfig);
    
    this.setupPoolEventHandlers();
    this.startCacheCleanup();
  }
  
  private setupPoolEventHandlers(): void {
    
    // Enhanced pool event handling
    this.pool.on('connect', (client) => {
      this.metrics.activeConnections++;
      this.logger.debug('New database client connected', {
        totalConnections: this.pool.totalCount,
        idleConnections: this.pool.idleCount,
        waitingClients: this.pool.waitingCount
      });
    });
    
    this.pool.on('remove', (client) => {
      this.metrics.activeConnections--;
      this.logger.debug('Database client removed from pool');
    });
    
    this.pool.on('error', (err, client) => {
      this.logger.error('Database pool error:', {
        error: err.message,
        stack: err.stack,
        totalConnections: this.pool.totalCount,
        idleConnections: this.pool.idleCount
      });
    });
    
    this.pool.on('acquire', (client) => {
      // this.logger.debug('Client acquired from pool'); // Too verbose
    });
  }
  
  private startCacheCleanup(): void {
    // Clean expired cache entries every 5 minutes
    setInterval(() => {
      const now = Date.now();
      let cleaned = 0;
      
      for (const [key, entry] of this.queryCache.entries()) {
        if (now - entry.timestamp > entry.ttl) {
          this.queryCache.delete(key);
          cleaned++;
        }
      }
      
      if (cleaned > 0) {
        this.logger.debug(`Cleaned ${cleaned} expired cache entries`);
      }
    }, 300000); // 5 minutes
  }
  
  private getCacheKey(text: string, params?: any[]): string {
    return `${text}:${JSON.stringify(params || [])}`;
  }
  
  private getFromCache<T>(key: string): T[] | null {
    const entry = this.queryCache.get(key);
    if (!entry) {
      this.metrics.cacheMisses++;
      return null;
    }
    
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.queryCache.delete(key);
      this.metrics.cacheMisses++;
      return null;
    }
    
    this.metrics.cacheHits++;
    return entry.data;
  }
  
  private setCache<T>(key: string, data: T[], ttl: number): void {
    this.queryCache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    });
  }
  
  async query<T = any>(text: string, params?: any[], options: QueryOptions = {}): Promise<T[]> {
    const {
      timeout = this.DEFAULT_QUERY_TIMEOUT,
      cache = false,
      cacheTTL = this.DEFAULT_CACHE_TTL,
      retries = this.MAX_RETRIES
    } = options;
    
    // Check cache for SELECT queries
    if (cache && text.trim().toUpperCase().startsWith('SELECT')) {
      const cacheKey = this.getCacheKey(text, params);
      const cachedResult = this.getFromCache<T>(cacheKey);
      if (cachedResult) {
        this.logger.debug('Query result served from cache', {
          query: text.substring(0, 100),
          cacheKey: cacheKey.substring(0, 50)
        });
        return cachedResult;
      }
    }
    
    let attempt = 0;
    let lastError: Error;
    
    while (attempt < retries) {
      const start = Date.now();
      try {
        this.metrics.totalQueries++;
        
        const result = await Promise.race([
          this.pool.query(text, params),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Query timeout')), timeout)
          )
        ]) as any;
        
        const duration = Date.now() - start;
        
        // Update average query time
        this.metrics.avgQueryTime = (
          this.metrics.avgQueryTime * (this.metrics.totalQueries - 1) + duration
        ) / this.metrics.totalQueries;
        
        // Only log slow queries (>100ms) or queries with many rows
        if (duration > 100 || result.rowCount > 10) {
          this.logger.debug('Database query executed', {
            query: text.substring(0, 100),
            duration,
            rows: result.rowCount,
            attempt: attempt + 1,
            cached: false
          });
        }
        
        // Cache SELECT results if requested
        if (cache && text.trim().toUpperCase().startsWith('SELECT')) {
          const cacheKey = this.getCacheKey(text, params);
          this.setCache(cacheKey, result.rows, cacheTTL);
        }
        
        return result.rows;
        
      } catch (error) {
        lastError = error as Error;
        attempt++;
        this.metrics.totalErrors++;
        
        const duration = Date.now() - start;
        
        this.logger.error('Database query failed', {
          query: text.substring(0, 100),
          duration,
          attempt,
          maxRetries: retries,
          error: lastError.message,
        });
        
        // Don't retry on certain errors
        if (this.isNonRetryableError(lastError) || attempt >= retries) {
          break;
        }
        
        // Exponential backoff
        const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
    
    throw lastError!;
  }
  
  private isNonRetryableError(error: Error): boolean {
    const nonRetryableErrors = [
      'syntax error',
      'column does not exist',
      'relation does not exist',
      'permission denied',
      'invalid input syntax'
    ];
    
    return nonRetryableErrors.some(errorType => 
      error.message.toLowerCase().includes(errorType)
    );
  }
  
  async queryOne<T = any>(text: string, params?: any[], options: QueryOptions = {}): Promise<T | null> {
    const result = await this.query<T>(text, params, options);
    return result.length > 0 ? result[0] : null;
  }
  
  async queryWithPagination<T = any>(
    baseQuery: string, 
    params: any[] = [],
    page = 1,
    limit = 50,
    options: QueryOptions = {}
  ): Promise<{ data: T[]; total: number; page: number; limit: number; totalPages: number }> {
    // Validate pagination parameters
    page = Math.max(1, page);
    limit = Math.min(Math.max(1, limit), 1000); // Max 1000 items per page
    
    const offset = (page - 1) * limit;
    
    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM (${baseQuery}) as count_query`;
    const countResult = await this.queryOne<{ total: string }>(countQuery, params, options);
    const total = parseInt(countResult?.total || '0', 10);
    
    // Get paginated data
    const dataQuery = `${baseQuery} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const data = await this.query<T>(dataQuery, [...params, limit, offset], options);
    
    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  }
  
  async transaction<T>(callback: (client: PoolClient) => Promise<T>, options: { timeout?: number } = {}): Promise<T> {
    const { timeout = this.DEFAULT_QUERY_TIMEOUT } = options;
    const client = await this.pool.connect();
    
    try {
      // Set transaction timeout
      await client.query(`SET statement_timeout = ${timeout}`);
      await client.query('BEGIN');
      
      this.logger.debug('Transaction started');
      const startTime = Date.now();
      
      const result = await callback(client);
      
      await client.query('COMMIT');
      
      const duration = Date.now() - startTime;
      this.logger.debug('Transaction committed', { duration });
      
      return result;
      
    } catch (error) {
      try {
        await client.query('ROLLBACK');
        this.logger.debug('Transaction rolled back due to error');
      } catch (rollbackError) {
        this.logger.error('Failed to rollback transaction:', rollbackError);
      }
      throw error;
    } finally {
      client.release();
    }
  }
  
  async close(): Promise<void> {
    // Clear cache cleanup interval
    clearInterval;
    
    await this.pool.end();
    this.logger.info('Database connection pool closed', {
      totalQueries: this.metrics.totalQueries,
      totalErrors: this.metrics.totalErrors,
      cacheHitRate: this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses) * 100
    });
  }
  
  async healthCheck(): Promise<{
    healthy: boolean;
    details: {
      connectivity: boolean;
      poolStatus: {
        total: number;
        idle: number;
        waiting: number;
      };
      performance: {
        avgQueryTime: number;
        errorRate: number;
        cacheHitRate: number;
      };
    };
  }> {
    let connectivity = false;
    
    try {
      await this.query('SELECT 1', [], { timeout: 5000 });
      connectivity = true;
    } catch (error) {
      this.logger.error('Database connectivity check failed:', error);
    }
    
    const errorRate = this.metrics.totalQueries > 0 
      ? (this.metrics.totalErrors / this.metrics.totalQueries) * 100 
      : 0;
    
    const cacheHitRate = (this.metrics.cacheHits + this.metrics.cacheMisses) > 0
      ? (this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses)) * 100
      : 0;
    
    const healthy = connectivity && errorRate < 10; // Healthy if error rate < 10%
    
    return {
      healthy,
      details: {
        connectivity,
        poolStatus: {
          total: this.pool.totalCount,
          idle: this.pool.idleCount,
          waiting: this.pool.waitingCount
        },
        performance: {
          avgQueryTime: Math.round(this.metrics.avgQueryTime),
          errorRate: Math.round(errorRate * 100) / 100,
          cacheHitRate: Math.round(cacheHitRate * 100) / 100
        }
      }
    };
  }
  
  clearCache(): void {
    this.queryCache.clear();
    this.logger.info('Query cache cleared');
  }
  
  getMetrics(): DatabaseMetrics {
    return { ...this.metrics };
  }
  
  getPool(): Pool {
    return this.pool;
  }
}