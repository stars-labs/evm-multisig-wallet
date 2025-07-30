// Comprehensive test suite for configuration module
import { config } from 'dotenv';
import joi from 'joi';

// Mock dotenv
jest.mock('dotenv', () => ({
  config: jest.fn()
}));

describe('Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset modules to re-import config
    jest.resetModules();
    
    // Clear environment
    process.env = {};
    
    // Mock dotenv.config to do nothing (we'll set env vars manually)
    (config as jest.Mock).mockImplementation(() => ({}));
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  describe('validation', () => {
    it('should load valid configuration', () => {
      process.env = {
        NODE_ENV: 'development',
        PORT: '3001',
        HOST: '0.0.0.0',
        DB_HOST: 'localhost',
        DB_PORT: '5432',
        DB_NAME: 'multisig_validator',
        DB_USER: 'postgres',
        DB_PASSWORD: 'password',
        JWT_SECRET: 'test-secret-key-that-is-long-enough-for-validation',
        SLACK_WEBHOOK_URL: 'https://hooks.slack.com/test',
        SLACK_ENABLED: 'true'
      };

      const configModule = require('../../config');
      const loadedConfig = configModule.default;

      expect(loadedConfig.server.port).toBe(3001);
      expect(loadedConfig.server.nodeEnv).toBe('development');
      expect(loadedConfig.database.host).toBe('localhost');
      expect(loadedConfig.notifications.slack.enabled).toBe(true);
    });

    it('should use default values for optional fields', () => {
      process.env = {
        // Required fields only
        DB_HOST: 'localhost',
        DB_NAME: 'test_db',
        DB_USER: 'postgres',
        DB_PASSWORD: 'password',
        JWT_SECRET: 'test-secret-key-that-is-long-enough-for-validation'
      };

      const configModule = require('../../config');
      const loadedConfig = configModule.default;

      // Check defaults
      expect(loadedConfig.server.port).toBe(3001);
      expect(loadedConfig.server.host).toBe('0.0.0.0');
      expect(loadedConfig.database.port).toBe(5432);
      expect(loadedConfig.database.ssl).toBe(false);
      expect(loadedConfig.security.bcryptRounds).toBe(12);
      expect(loadedConfig.logging.level).toBe('info');
      expect(loadedConfig.blockchain.eventSync.batchSize).toBe(100);
      expect(loadedConfig.notifications.slack.enabled).toBe(false);
    });

    it('should throw error for missing required fields', () => {
      process.env = {
        // Missing DB_HOST, DB_NAME, DB_USER, DB_PASSWORD, JWT_SECRET
      };

      expect(() => require('../../config')).toThrow(/Configuration validation error/);
    });

    it('should validate environment values', () => {
      process.env = {
        NODE_ENV: 'invalid', // Should be development/production/test
        DB_HOST: 'localhost',
        DB_NAME: 'test_db',
        DB_USER: 'postgres',
        DB_PASSWORD: 'password',
        JWT_SECRET: 'test-secret-key-that-is-long-enough-for-validation'
      };

      expect(() => require('../../config')).toThrow(/Configuration validation error/);
    });

    it('should validate port numbers', () => {
      process.env = {
        PORT: 'not-a-number',
        DB_HOST: 'localhost',
        DB_NAME: 'test_db',
        DB_USER: 'postgres',
        DB_PASSWORD: 'password',
        JWT_SECRET: 'test-secret-key-that-is-long-enough-for-validation'
      };

      expect(() => require('../../config')).toThrow(/Configuration validation error/);
    });

    it('should validate JWT secret length', () => {
      process.env = {
        DB_HOST: 'localhost',
        DB_NAME: 'test_db',
        DB_USER: 'postgres',
        DB_PASSWORD: 'password',
        JWT_SECRET: 'too-short' // Less than 32 characters
      };

      expect(() => require('../../config')).toThrow(/Configuration validation error/);
    });

    it('should validate URL formats', () => {
      process.env = {
        DB_HOST: 'localhost',
        DB_NAME: 'test_db',
        DB_USER: 'postgres',
        DB_PASSWORD: 'password',
        JWT_SECRET: 'test-secret-key-that-is-long-enough-for-validation',
        SLACK_WEBHOOK_URL: 'not-a-valid-url'
      };

      expect(() => require('../../config')).toThrow(/Configuration validation error/);
    });

    it('should validate email format', () => {
      process.env = {
        DB_HOST: 'localhost',
        DB_NAME: 'test_db',
        DB_USER: 'postgres',
        DB_PASSWORD: 'password',
        JWT_SECRET: 'test-secret-key-that-is-long-enough-for-validation',
        EMAIL_USER: 'not-an-email'
      };

      expect(() => require('../../config')).toThrow(/Configuration validation error/);
    });
  });

  describe('production validation', () => {
    it('should enforce stricter requirements in production', () => {
      process.env = {
        NODE_ENV: 'production',
        DB_HOST: 'localhost',
        DB_NAME: 'test_db',
        DB_USER: 'postgres',
        DB_PASSWORD: 'short', // Too short for production (< 8 chars)
        JWT_SECRET: 'test-secret-key-that-is-32-chars' // Too short for production (< 64 chars)
      };

      expect(() => require('../../config')).toThrow(/Production configuration error/);
    });

    it('should require webhook URL when Slack is enabled in production', () => {
      process.env = {
        NODE_ENV: 'production',
        DB_HOST: 'localhost',
        DB_NAME: 'test_db',
        DB_USER: 'postgres',
        DB_PASSWORD: 'production-password',
        JWT_SECRET: 'production-secret-key-that-is-definitely-long-enough-for-validation-requirements',
        SLACK_ENABLED: 'true'
        // Missing SLACK_WEBHOOK_URL
      };

      expect(() => require('../../config')).toThrow(/Production configuration error/);
    });

    it('should warn about development secrets in production', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      process.env = {
        NODE_ENV: 'production',
        DB_HOST: 'localhost',
        DB_NAME: 'test_db',
        DB_USER: 'postgres',
        DB_PASSWORD: 'production-password',
        JWT_SECRET: 'production-dev-secret-key-that-is-definitely-long-enough-for-validation'
      };

      require('../../config');

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'WARNING: Using development JWT secret in production!'
      );

      consoleWarnSpy.mockRestore();
    });

    it('should pass production validation with proper config', () => {
      process.env = {
        NODE_ENV: 'production',
        DB_HOST: 'prod.database.com',
        DB_NAME: 'multisig_prod',
        DB_USER: 'postgres',
        DB_PASSWORD: 'secure-production-password',
        JWT_SECRET: 'super-secure-production-jwt-secret-that-is-definitely-long-enough-64-chars',
        SLACK_ENABLED: 'true',
        SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/production-webhook'
      };

      const configModule = require('../../config');
      const loadedConfig = configModule.default;

      expect(loadedConfig.server.nodeEnv).toBe('production');
      expect(loadedConfig.database.host).toBe('prod.database.com');
    });
  });

  describe('blockchain configuration', () => {
    it('should configure blockchain networks with defaults', () => {
      process.env = {
        DB_HOST: 'localhost',
        DB_NAME: 'test_db',
        DB_USER: 'postgres',
        DB_PASSWORD: 'password',
        JWT_SECRET: 'test-secret-key-that-is-long-enough-for-validation'
      };

      const configModule = require('../../config');
      const loadedConfig = configModule.default;

      expect(loadedConfig.blockchain.networks.mainnet).toMatchObject({
        chainId: 1,
        blockConfirmations: 12,
        retryAttempts: 3
      });

      expect(loadedConfig.blockchain.networks.sepolia).toMatchObject({
        chainId: 11155111,
        blockConfirmations: 3
      });

      expect(loadedConfig.blockchain.networks.localhost).toMatchObject({
        rpcUrl: 'http://127.0.0.1:8545',
        chainId: 31337,
        blockConfirmations: 1
      });
    });

    it('should allow custom RPC URLs', () => {
      process.env = {
        DB_HOST: 'localhost',
        DB_NAME: 'test_db',
        DB_USER: 'postgres',
        DB_PASSWORD: 'password',
        JWT_SECRET: 'test-secret-key-that-is-long-enough-for-validation',
        MAINNET_RPC_URL: 'https://custom-mainnet.infura.io/v3/key',
        SEPOLIA_RPC_URL: 'https://custom-sepolia.infura.io/v3/key',
        LOCALHOST_RPC_URL: 'http://localhost:7545'
      };

      const configModule = require('../../config');
      const loadedConfig = configModule.default;

      expect(loadedConfig.blockchain.networks.mainnet.rpcUrl).toBe(
        'https://custom-mainnet.infura.io/v3/key'
      );
      expect(loadedConfig.blockchain.networks.sepolia.rpcUrl).toBe(
        'https://custom-sepolia.infura.io/v3/key'
      );
      expect(loadedConfig.blockchain.networks.localhost.rpcUrl).toBe(
        'http://localhost:7545'
      );
    });

    it('should configure rate limiting', () => {
      process.env = {
        DB_HOST: 'localhost',
        DB_NAME: 'test_db',
        DB_USER: 'postgres',
        DB_PASSWORD: 'password',
        JWT_SECRET: 'test-secret-key-that-is-long-enough-for-validation',
        RPC_REQUESTS_PER_SECOND: '5',
        RPC_REQUESTS_PER_MINUTE: '200',
        BACKOFF_MULTIPLIER: '3.0',
        MAX_BACKOFF_TIME: '300000'
      };

      const configModule = require('../../config');
      const loadedConfig = configModule.default;

      expect(loadedConfig.blockchain.eventSync.rateLimiting).toEqual({
        requestsPerSecond: 5,
        requestsPerMinute: 200,
        backoffMultiplier: 3.0,
        maxBackoffTime: 300000
      });
    });
  });

  describe('redis configuration', () => {
    it('should configure Redis with password', () => {
      process.env = {
        DB_HOST: 'localhost',
        DB_NAME: 'test_db',
        DB_USER: 'postgres',
        DB_PASSWORD: 'password',
        JWT_SECRET: 'test-secret-key-that-is-long-enough-for-validation',
        REDIS_HOST: 'redis.example.com',
        REDIS_PORT: '6380',
        REDIS_PASSWORD: 'redis-password',
        REDIS_DB: '1'
      };

      const configModule = require('../../config');
      const loadedConfig = configModule.default;

      expect(loadedConfig.redis).toEqual({
        host: 'redis.example.com',
        port: 6380,
        password: 'redis-password',
        db: 1
      });
    });

    it('should configure Redis without password', () => {
      process.env = {
        DB_HOST: 'localhost',
        DB_NAME: 'test_db',
        DB_USER: 'postgres',
        DB_PASSWORD: 'password',
        JWT_SECRET: 'test-secret-key-that-is-long-enough-for-validation'
        // No REDIS_PASSWORD
      };

      const configModule = require('../../config');
      const loadedConfig = configModule.default;

      expect(loadedConfig.redis.password).toBeUndefined();
    });
  });

  describe('notification configuration', () => {
    it('should configure email notifications', () => {
      process.env = {
        DB_HOST: 'localhost',
        DB_NAME: 'test_db',
        DB_USER: 'postgres',
        DB_PASSWORD: 'password',
        JWT_SECRET: 'test-secret-key-that-is-long-enough-for-validation',
        EMAIL_SERVICE: 'sendgrid',
        EMAIL_USER: 'test@example.com',
        EMAIL_PASSWORD: 'email-password',
        EMAIL_FROM: 'noreply@example.com'
      };

      const configModule = require('../../config');
      const loadedConfig = configModule.default;

      expect(loadedConfig.notifications.email).toEqual({
        service: 'sendgrid',
        user: 'test@example.com',
        password: 'email-password',
        from: 'noreply@example.com'
      });
    });

    it('should configure Slack notifications', () => {
      process.env = {
        DB_HOST: 'localhost',
        DB_NAME: 'test_db',
        DB_USER: 'postgres',
        DB_PASSWORD: 'password',
        JWT_SECRET: 'test-secret-key-that-is-long-enough-for-validation',
        SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/test',
        SLACK_DEFAULT_CHANNEL: '#alerts',
        SLACK_ENABLED: 'true'
      };

      const configModule = require('../../config');
      const loadedConfig = configModule.default;

      expect(loadedConfig.notifications.slack).toEqual({
        webhookUrl: 'https://hooks.slack.com/services/test',
        defaultChannel: '#alerts',
        enabled: true
      });
    });
  });

  describe('logging configuration', () => {
    it('should configure logging levels', () => {
      process.env = {
        DB_HOST: 'localhost',
        DB_NAME: 'test_db',
        DB_USER: 'postgres',
        DB_PASSWORD: 'password',
        JWT_SECRET: 'test-secret-key-that-is-long-enough-for-validation',
        LOG_LEVEL: 'debug',
        LOG_FILE: 'true',
        LOG_CONSOLE: 'false'
      };

      const configModule = require('../../config');
      const loadedConfig = configModule.default;

      expect(loadedConfig.logging).toEqual({
        level: 'debug',
        file: true,
        console: false
      });
    });

    it('should validate log levels', () => {
      process.env = {
        DB_HOST: 'localhost',
        DB_NAME: 'test_db',
        DB_USER: 'postgres',
        DB_PASSWORD: 'password',
        JWT_SECRET: 'test-secret-key-that-is-long-enough-for-validation',
        LOG_LEVEL: 'invalid-level'
      };

      expect(() => require('../../config')).toThrow(/Configuration validation error/);
    });
  });

  describe('security configuration', () => {
    it('should configure security settings', () => {
      process.env = {
        DB_HOST: 'localhost',
        DB_NAME: 'test_db',
        DB_USER: 'postgres',
        DB_PASSWORD: 'password',
        JWT_SECRET: 'test-secret-key-that-is-long-enough-for-validation',
        BCRYPT_ROUNDS: '14',
        RATE_LIMIT_WINDOW: '600000',
        RATE_LIMIT_MAX: '50'
      };

      const configModule = require('../../config');
      const loadedConfig = configModule.default;

      expect(loadedConfig.security).toMatchObject({
        bcryptRounds: 14,
        rateLimitWindow: 600000,
        rateLimitMax: 50
      });
    });

    it('should validate bcrypt rounds range', () => {
      process.env = {
        DB_HOST: 'localhost',
        DB_NAME: 'test_db',
        DB_USER: 'postgres',
        DB_PASSWORD: 'password',
        JWT_SECRET: 'test-secret-key-that-is-long-enough-for-validation',
        BCRYPT_ROUNDS: '20' // Too high (max is 15)
      };

      expect(() => require('../../config')).toThrow(/Configuration validation error/);
    });
  });

  describe('event sync configuration', () => {
    it('should configure event sync settings', () => {
      process.env = {
        DB_HOST: 'localhost',
        DB_NAME: 'test_db',
        DB_USER: 'postgres',
        DB_PASSWORD: 'password',
        JWT_SECRET: 'test-secret-key-that-is-long-enough-for-validation',
        EVENT_BATCH_SIZE: '200',
        MAX_BLOCKS_PER_BATCH: '5000',
        SYNC_INTERVAL: '60000',
        START_BLOCK: '1000000'
      };

      const configModule = require('../../config');
      const loadedConfig = configModule.default;

      expect(loadedConfig.blockchain.eventSync).toMatchObject({
        batchSize: 200,
        maxBlocksPerBatch: 5000,
        syncInterval: 60000,
        startBlock: 1000000
      });
    });

    it('should validate positive numbers', () => {
      process.env = {
        DB_HOST: 'localhost',
        DB_NAME: 'test_db',
        DB_USER: 'postgres',
        DB_PASSWORD: 'password',
        JWT_SECRET: 'test-secret-key-that-is-long-enough-for-validation',
        EVENT_BATCH_SIZE: '-10' // Negative number
      };

      expect(() => require('../../config')).toThrow(/Configuration validation error/);
    });
  });

  describe('config structure', () => {
    it('should export Config interface type', () => {
      process.env = {
        DB_HOST: 'localhost',
        DB_NAME: 'test_db',
        DB_USER: 'postgres',
        DB_PASSWORD: 'password',
        JWT_SECRET: 'test-secret-key-that-is-long-enough-for-validation'
      };

      const configModule = require('../../config');
      const loadedConfig = configModule.default;

      // Verify structure matches Config interface
      expect(loadedConfig).toHaveProperty('server');
      expect(loadedConfig).toHaveProperty('database');
      expect(loadedConfig).toHaveProperty('blockchain');
      expect(loadedConfig).toHaveProperty('redis');
      expect(loadedConfig).toHaveProperty('notifications');
      expect(loadedConfig).toHaveProperty('security');
      expect(loadedConfig).toHaveProperty('logging');
    });
  });
});