// Test database utilities and helpers
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import winston from 'winston';
import { Database } from '../../database';

export interface TestDatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export class TestDatabase {
  private pool: Pool;
  private database: Database;
  private logger: winston.Logger;
  private config: TestDatabaseConfig;
  
  constructor(config: TestDatabaseConfig, logger: winston.Logger) {
    this.config = config;
    this.logger = logger;
    
    this.pool = new Pool({
      ...config,
      max: 5, // Smaller pool for tests
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000
    });
    
    this.database = new Database(logger);
  }

  async setup(): Promise<void> {
    try {
      // Create test database if it doesn't exist
      await this.createTestDatabase();
      
      // Run migrations
      await this.runMigrations();
      
      // Seed test data
      await this.seedTestData();
      
      this.logger.info('Test database setup completed');
    } catch (error) {
      this.logger.error('Failed to setup test database:', error);
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    try {
      // Clean all test data
      await this.cleanAllTables();
      
      // Close connections
      await this.pool.end();
      await this.database.close();
      
      this.logger.info('Test database cleanup completed');
    } catch (error) {
      this.logger.error('Failed to cleanup test database:', error);
      throw error;
    }
  }

  async transaction<T>(callback: (client: any) => Promise<T>): Promise<T> {
    return this.database.transaction(callback);
  }

  async query<T>(text: string, params?: any[]): Promise<T[]> {
    return this.database.query(text, params);
  }

  async queryOne<T>(text: string, params?: any[]): Promise<T | null> {
    return this.database.queryOne(text, params);
  }

  private async createTestDatabase(): Promise<void> {
    const tempPool = new Pool({
      host: this.config.host,
      port: this.config.port,
      user: this.config.user,
      password: this.config.password,
      database: 'postgres' // Connect to default database to create test db
    });

    try {
      await tempPool.query(`CREATE DATABASE ${this.config.database}`);
      this.logger.info(`Test database '${this.config.database}' created`);
    } catch (error: any) {
      if (error.code === '42P04') {
        // Database already exists
        this.logger.info(`Test database '${this.config.database}' already exists`);
      } else {
        throw error;
      }
    } finally {
      await tempPool.end();
    }
  }

  private async runMigrations(): Promise<void> {
    const schemaPath = path.join(__dirname, '../../..', 'schema.sql');
    
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf8');
      
      // Split schema into individual statements
      const statements = schema
        .split(';')
        .map(stmt => stmt.trim())
        .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

      for (const statement of statements) {
        try {
          await this.pool.query(statement + ';');
        } catch (error: any) {
          // Ignore certain expected errors
          if (
            error.code !== '42P07' && // relation already exists
            error.code !== '42710' && // object already exists
            error.code !== '42P06'    // schema already exists
          ) {
            this.logger.error('Failed to execute migration statement:', {
              statement: statement.substring(0, 100),
              error: error.message
            });
            throw error;
          }
        }
      }
      
      this.logger.info('Database migrations completed');
    } else {
      this.logger.warn('Schema file not found, skipping migrations');
    }
  }

  private async seedTestData(): Promise<void> {
    try {
      // Insert test chains
      await this.pool.query(`
        INSERT INTO chains (network, chain_id, name, rpc_url, enabled)
        VALUES 
          ('localhost', 31337, 'Test Network', 'http://localhost:8545', true),
          ('sepolia', 11155111, 'Sepolia Testnet', 'https://sepolia.infura.io/v3/test', true)
        ON CONFLICT (network) DO NOTHING
      `);

      // Insert test wallets
      await this.pool.query(`
        INSERT INTO wallets (
          address, name, network, type, owners, required, balance, 
          monitored, registered_by
        )
        VALUES 
          (
            '0x1234567890123456789012345678901234567890', 
            'Test Wallet 1', 
            'localhost', 
            'MultiSigWallet',
            '["0xowner1", "0xowner2", "0xowner3"]',
            2,
            '1000000000000000000',
            true,
            'test'
          ),
          (
            '0x2345678901234567890123456789012345678901', 
            'Test Wallet 2', 
            'sepolia', 
            'MultiSigWalletWithDailyLimit',
            '["0xowner4", "0xowner5"]',
            2,
            '500000000000000000',
            true,
            'test'
          )
        ON CONFLICT (address, network) DO NOTHING
      `);

      // Insert test owners
      await this.pool.query(`
        INSERT INTO owners (address, network, wallets, transaction_count, risk_level, status)
        VALUES 
          ('0xowner1', 'localhost', '["0x1234567890123456789012345678901234567890"]', 0, 'low', 'active'),
          ('0xowner2', 'localhost', '["0x1234567890123456789012345678901234567890"]', 0, 'low', 'active'),
          ('0xowner3', 'localhost', '["0x1234567890123456789012345678901234567890"]', 0, 'medium', 'active'),
          ('0xowner4', 'sepolia', '["0x2345678901234567890123456789012345678901"]', 0, 'low', 'active'),
          ('0xowner5', 'sepolia', '["0x2345678901234567890123456789012345678901"]', 0, 'low', 'active')
        ON CONFLICT (address, network) DO NOTHING
      `);

      this.logger.info('Test data seeded successfully');
    } catch (error) {
      this.logger.error('Failed to seed test data:', error);
      throw error;
    }
  }

  private async cleanAllTables(): Promise<void> {
    const tables = [
      'notifications',
      'alerts',
      'transactions', 
      'recipients',
      'owners',
      'wallets',
      'configurations',
      'audit_logs',
      'chains'
    ];

    for (const table of tables) {
      try {
        await this.pool.query(`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE`);
      } catch (error: any) {
        if (error.code !== '42P01') { // table does not exist
          this.logger.error(`Failed to truncate table ${table}:`, error);
        }
      }
    }
  }

  // Helper methods for test data creation
  async createTestWallet(data: {
    address: string;
    name: string;
    network: string;
    type?: string;
    owners?: string[];
    required?: number;
  }): Promise<any> {
    const result = await this.pool.query(`
      INSERT INTO wallets (
        address, name, network, type, owners, required, balance, 
        monitored, registered_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      data.address,
      data.name,
      data.network,
      data.type || 'MultiSigWallet',
      JSON.stringify(data.owners || []),
      data.required || 1,
      '0',
      true,
      'test'
    ]);

    return result.rows[0];
  }

  async createTestTransaction(data: {
    walletId: string;
    transactionId: number;
    action: string;
    submitter: string;
    destination?: string;
    value?: string;
  }): Promise<any> {
    const result = await this.pool.query(`
      INSERT INTO transactions (
        wallet_id, transaction_id, action, submitter, destination, 
        value, validation_status, risk_score, confirmations, 
        required_confirmations, submitted_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      RETURNING *
    `, [
      data.walletId,
      data.transactionId,
      data.action,
      data.submitter,
      data.destination || '',
      data.value || '0',
      'pending',
      0,
      JSON.stringify([]),
      2
    ]);

    return result.rows[0];
  }

  async createTestAlert(data: {
    walletId: string;
    transactionId?: string;
    priority: string;
    type: string;
    title: string;
    message: string;
  }): Promise<any> {
    const result = await this.pool.query(`
      INSERT INTO alerts (
        wallet_id, transaction_id, priority, type, title, message, 
        risk_level, severity_score, context, notification_channels
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [
      data.walletId,
      data.transactionId || null,
      data.priority,
      data.type,
      data.title,
      data.message,
      'medium',
      50,
      JSON.stringify({}),
      JSON.stringify(['email'])
    ]);

    return result.rows[0];
  }

  // Wait for async operations to complete
  async waitForAsyncOperations(timeout: number = 5000): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, timeout));
  }

  // Get test statistics
  async getTestStats(): Promise<{
    wallets: number;
    transactions: number;
    alerts: number;
    owners: number;
  }> {
    const [wallets, transactions, alerts, owners] = await Promise.all([
      this.pool.query('SELECT COUNT(*) as count FROM wallets'),
      this.pool.query('SELECT COUNT(*) as count FROM transactions'),
      this.pool.query('SELECT COUNT(*) as count FROM alerts'),
      this.pool.query('SELECT COUNT(*) as count FROM owners')
    ]);

    return {
      wallets: parseInt(wallets.rows[0].count),
      transactions: parseInt(transactions.rows[0].count),
      alerts: parseInt(alerts.rows[0].count),
      owners: parseInt(owners.rows[0].count)
    };
  }
}

// Test database factory
export const createTestDatabase = (logger: winston.Logger): TestDatabase => {
  const config: TestDatabaseConfig = {
    host: process.env.TEST_DB_HOST || 'localhost',
    port: parseInt(process.env.TEST_DB_PORT || '5432'),
    user: process.env.TEST_DB_USER || 'postgres',
    password: process.env.TEST_DB_PASSWORD || 'test',
    database: process.env.TEST_DB_NAME || 'multisig_validator_test'
  };

  return new TestDatabase(config, logger);
};