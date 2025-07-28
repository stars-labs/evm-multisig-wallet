// Database connection and query interface
import { Pool, PoolClient } from 'pg';
import winston from 'winston';
import config from '../config';

export class Database {
  private pool: Pool;
  private logger: winston.Logger;
  
  constructor(logger: winston.Logger) {
    this.logger = logger;
    this.pool = new Pool({
      host: config.database.host,
      port: config.database.port,
      database: config.database.name,
      user: config.database.user,
      password: config.database.password,
      ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
      max: 20, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
      connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
    });
    
    // Handle pool events
    this.pool.on('connect', (client) => {
      this.logger.debug('New database client connected');
    });
    
    this.pool.on('error', (err, client) => {
      this.logger.error('Database pool error:', err);
    });
  }
  
  async query<T = any>(text: string, params?: any[]): Promise<T[]> {
    const start = Date.now();
    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;
      
      this.logger.debug('Database query executed', {
        query: text.substring(0, 100),
        duration,
        rows: result.rowCount,
      });
      
      return result.rows;
    } catch (error) {
      const duration = Date.now() - start;
      this.logger.error('Database query failed', {
        query: text.substring(0, 100),
        duration,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }
  
  async queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
    const result = await this.query<T>(text, params);
    return result.length > 0 ? result[0] : null;
  }
  
  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  
  async close(): Promise<void> {
    await this.pool.end();
    this.logger.info('Database connection pool closed');
  }
  
  async healthCheck(): Promise<boolean> {
    try {
      await this.query('SELECT 1');
      return true;
    } catch (error) {
      this.logger.error('Database health check failed:', error);
      return false;
    }
  }
  
  getPool(): Pool {
    return this.pool;
  }
}