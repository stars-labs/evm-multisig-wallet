// Test suite for error utilities and handling
import {
  ErrorCode,
  BaseError,
  DatabaseError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  BlockchainError,
  RpcError,
  ServiceUnavailableError,
  TimeoutError,
  ConfigurationError,
  WalletError,
  TransactionError,
  ErrorFactory,
  isRetryableError,
  getErrorCategory
} from '../../utils/errors';

describe('Error Utilities', () => {
  describe('BaseError', () => {
    it('should create base error with all properties', () => {
      const context = { userId: '123', operation: 'test' };
      const timestamp = new Date();
      
      class TestError extends BaseError {}
      
      const error = new TestError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Test error',
        statusCode: 500,
        context,
        retryable: true,
        timestamp,
        requestId: 'req-123'
      });
      
      expect(error.name).toBe('TestError');
      expect(error.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(error.message).toBe('Test error');
      expect(error.statusCode).toBe(500);
      expect(error.context).toBe(context);
      expect(error.retryable).toBe(true);
      expect(error.timestamp).toBe(timestamp);
      expect(error.requestId).toBe('req-123');
      expect(error.stack).toBeDefined();
    });

    it('should serialize to JSON correctly', () => {
      class TestError extends BaseError {}
      
      const error = new TestError({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Test error',
        statusCode: 400,
        context: { field: 'email' },
        retryable: false,
        timestamp: new Date('2024-01-01T00:00:00Z'),
        requestId: 'req-123'
      });
      
      const json = error.toJSON();
      
      expect(json).toEqual({
        name: 'TestError',
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Test error',
        statusCode: 400,
        context: { field: 'email' },
        retryable: false,
        timestamp: '2024-01-01T00:00:00.000Z',
        requestId: 'req-123'
      });
    });

    it('should handle defaults for optional properties', () => {
      class TestError extends BaseError {}
      
      const error = new TestError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Test error',
        statusCode: 500,
        timestamp: new Date()
      });
      
      expect(error.retryable).toBe(false);
      expect(error.context).toBeUndefined();
      expect(error.cause).toBeUndefined();
      expect(error.requestId).toBeUndefined();
    });
  });

  describe('DatabaseError', () => {
    it('should create database error with cause', () => {
      const cause = new Error('Connection lost');
      const error = new DatabaseError('Connection failed', cause);
      
      expect(error.name).toBe('DatabaseError');
      expect(error.message).toBe('Database error: Connection failed');
      expect(error.code).toBe(ErrorCode.DATABASE_ERROR);
      expect(error.statusCode).toBe(500);
      expect(error.cause).toBe(cause);
      expect(error.retryable).toBe(true);
    });

    it('should create database error without cause', () => {
      const error = new DatabaseError('Query failed');
      
      expect(error.name).toBe('DatabaseError');
      expect(error.message).toBe('Database error: Query failed');
      expect(error.cause).toBeUndefined();
    });

    it('should include context and request ID', () => {
      const context = { query: 'SELECT * FROM users', table: 'users' };
      const error = new DatabaseError('Query failed', undefined, context, 'req-456');
      
      expect(error.context).toEqual(context);
      expect(error.requestId).toBe('req-456');
    });
  });

  describe('ValidationError', () => {
    it('should create validation error with context', () => {
      const context = { field: 'email', value: 'invalid-email' };
      const error = new ValidationError('Invalid email format', context, 'req-123');
      
      expect(error.name).toBe('ValidationError');
      expect(error.message).toBe('Invalid email format');
      expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(error.statusCode).toBe(400);
      expect(error.context).toEqual(context);
      expect(error.requestId).toBe('req-123');
      expect(error.retryable).toBe(false);
    });

    it('should create validation error without context', () => {
      const error = new ValidationError('Validation failed');
      
      expect(error.name).toBe('ValidationError');
      expect(error.message).toBe('Validation failed');
      expect(error.context).toBeUndefined();
    });
  });

  describe('NotFoundError', () => {
    it('should create not found error with identifier', () => {
      const error = new NotFoundError('Wallet', '0x123', { network: 'mainnet' }, 'req-123');
      
      expect(error.name).toBe('NotFoundError');
      expect(error.message).toBe("Wallet with identifier '0x123' not found");
      expect(error.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
      expect(error.statusCode).toBe(404);
      expect(error.context).toEqual({
        resource: 'Wallet',
        identifier: '0x123',
        network: 'mainnet'
      });
    });

    it('should create not found error without identifier', () => {
      const error = new NotFoundError('Transaction');
      
      expect(error.message).toBe('Transaction not found');
      expect(error.context?.resource).toBe('Transaction');
      expect(error.context?.identifier).toBeUndefined();
    });
  });

  describe('RateLimitError', () => {
    it('should create rate limit error with limit details', () => {
      const error = new RateLimitError(100, 60000, { clientId: 'test' }, 'req-789');
      
      expect(error.name).toBe('RateLimitError');
      expect(error.message).toBe('Rate limit exceeded: 100 requests per 60000ms');
      expect(error.code).toBe(ErrorCode.RATE_LIMIT_EXCEEDED);
      expect(error.statusCode).toBe(429);
      expect(error.retryable).toBe(true);
      expect(error.context).toEqual({
        limit: 100,
        windowMs: 60000,
        clientId: 'test'
      });
    });
  });

  describe('BlockchainError', () => {
    it('should create blockchain error with network', () => {
      const cause = new Error('RPC call failed');
      const error = new BlockchainError('Transaction failed', 'mainnet', cause, { txHash: '0x123' });
      
      expect(error.name).toBe('BlockchainError');
      expect(error.message).toBe('Blockchain error on mainnet: Transaction failed');
      expect(error.code).toBe(ErrorCode.BLOCKCHAIN_ERROR);
      expect(error.statusCode).toBe(500);
      expect(error.cause).toBe(cause);
      expect(error.context).toEqual({
        network: 'mainnet',
        txHash: '0x123'
      });
    });

    it('should create blockchain error without network', () => {
      const error = new BlockchainError('General blockchain error');
      
      expect(error.message).toBe('Blockchain error: General blockchain error');
      expect(error.context?.network).toBeUndefined();
    });
  });

  describe('TimeoutError', () => {
    it('should create timeout error with operation details', () => {
      const error = new TimeoutError('database_query', 5000, { query: 'SELECT *' }, 'req-timeout');
      
      expect(error.name).toBe('TimeoutError');
      expect(error.message).toBe("Operation 'database_query' timed out after 5000ms");
      expect(error.code).toBe(ErrorCode.TIMEOUT);
      expect(error.statusCode).toBe(504);
      expect(error.retryable).toBe(true);
      expect(error.context).toEqual({
        operation: 'database_query',
        timeoutMs: 5000,
        query: 'SELECT *'
      });
    });
  });

  describe('WalletError', () => {
    it('should create wallet error with wallet address', () => {
      const error = new WalletError(
        ErrorCode.WALLET_ALREADY_MONITORED,
        'Wallet is already being monitored',
        '0xwallet123',
        { network: 'mainnet' },
        'req-wallet'
      );
      
      expect(error.name).toBe('WalletError');
      expect(error.code).toBe(ErrorCode.WALLET_ALREADY_MONITORED);
      expect(error.statusCode).toBe(400);
      expect(error.context).toEqual({
        walletAddress: '0xwallet123',
        network: 'mainnet'
      });
    });
  });

  describe('TransactionError', () => {
    it('should create transaction error with transaction ID', () => {
      const error = new TransactionError(
        ErrorCode.INSUFFICIENT_CONFIRMATIONS,
        'Not enough confirmations',
        'tx-456',
        { required: 2, current: 1 },
        'req-tx'
      );
      
      expect(error.name).toBe('TransactionError');
      expect(error.code).toBe(ErrorCode.INSUFFICIENT_CONFIRMATIONS);
      expect(error.context).toEqual({
        transactionId: 'tx-456',
        required: 2,
        current: 1
      });
    });
  });

  describe('ErrorFactory', () => {
    describe('fromJoiValidation', () => {
      it('should convert Joi validation error', () => {
        const joiError = {
          details: [
            {
              path: ['email'],
              message: 'Email is required',
              context: { value: undefined }
            },
            {
              path: ['password', 'length'],
              message: 'Password must be at least 8 characters',
              context: { value: 'short' }
            }
          ]
        } as any;
        
        const error = ErrorFactory.fromJoiValidation(joiError, 'req-joi');
        
        expect(error).toBeInstanceOf(ValidationError);
        expect(error.message).toBe('Validation failed');
        expect(error.requestId).toBe('req-joi');
        expect(error.context?.validationErrors).toHaveLength(2);
        expect(error.context?.validationErrors[0]).toEqual({
          field: 'email',
          message: 'Email is required',
          value: undefined
        });
      });
    });

    describe('fromDatabaseError', () => {
      it('should convert PostgreSQL unique violation', () => {
        const pgError = {
          code: '23505',
          detail: 'Key (email)=(test@example.com) already exists.',
          constraint: 'users_email_unique',
          message: 'duplicate key value violates unique constraint'
        } as any;
        
        const error = ErrorFactory.fromDatabaseError(pgError, 'req-db');
        
        expect(error).toBeInstanceOf(ConflictError);
        expect(error.message).toContain('Duplicate entry');
        expect(error.context?.pgCode).toBe('23505');
        expect(error.context?.constraint).toBe('users_email_unique');
      });

      it('should convert PostgreSQL foreign key violation', () => {
        const pgError = {
          code: '23503',
          detail: 'Key (user_id)=(999) is not present in table "users".',
          constraint: 'fk_user_id',
          message: 'foreign key constraint violated'
        } as any;
        
        const error = ErrorFactory.fromDatabaseError(pgError, 'req-fk');
        
        expect(error).toBeInstanceOf(ValidationError);
        expect(error.message).toContain('Foreign key constraint violated');
        expect(error.context?.pgCode).toBe('23503');
      });

      it('should convert PostgreSQL not null violation', () => {
        const pgError = {
          code: '23502',
          column: 'name',
          message: 'null value in column "name" violates not-null constraint'
        } as any;
        
        const error = ErrorFactory.fromDatabaseError(pgError);
        
        expect(error).toBeInstanceOf(ValidationError);
        expect(error.message).toContain('Required field missing: name');
        expect(error.context?.column).toBe('name');
      });

      it('should convert generic database error', () => {
        const dbError = new Error('Connection timeout');
        
        const error = ErrorFactory.fromDatabaseError(dbError, 'req-generic');
        
        expect(error).toBeInstanceOf(DatabaseError);
        expect(error.message).toBe('Database error: Connection timeout');
        expect(error.cause).toBe(dbError);
      });
    });

    describe('fromUnknownError', () => {
      it('should preserve BaseError instances', () => {
        const originalError = new ValidationError('Original error');
        
        const error = ErrorFactory.fromUnknownError(originalError, 'req-preserve');
        
        expect(error).toBe(originalError);
      });

      it('should wrap regular Error instances', () => {
        const originalError = new Error('Regular error');
        
        const error = ErrorFactory.fromUnknownError(originalError, 'req-wrap');
        
        expect(error).toBeInstanceOf(BaseError);
        expect(error.code).toBe(ErrorCode.INTERNAL_ERROR);
        expect(error.message).toBe('Regular error');
        expect(error.cause).toBe(originalError);
      });

      it('should handle non-Error values', () => {
        const error = ErrorFactory.fromUnknownError('string error', 'req-string');
        
        expect(error).toBeInstanceOf(BaseError);
        expect(error.code).toBe(ErrorCode.INTERNAL_ERROR);
        expect(error.message).toBe('An unknown error occurred');
        expect(error.context?.originalError).toBe('string error');
      });

      it('should handle null/undefined values', () => {
        const error = ErrorFactory.fromUnknownError(null, 'req-null');
        
        expect(error).toBeInstanceOf(BaseError);
        expect(error.message).toBe('An unknown error occurred');
        expect(error.context?.originalError).toBe('null');
      });
    });
  });

  describe('Error categorization helpers', () => {
    describe('isRetryableError', () => {
      it('should identify retryable BaseError instances', () => {
        const retryableError = new DatabaseError('Connection failed');
        const nonRetryableError = new ValidationError('Invalid input');
        
        expect(isRetryableError(retryableError)).toBe(true);
        expect(isRetryableError(nonRetryableError)).toBe(false);
      });

      it('should use heuristics for non-BaseError instances', () => {
        const timeoutError = new Error('Request timeout');
        const connectionError = new Error('Connection refused');
        const rateLimitError = new Error('Rate limit exceeded');
        const validationError = new Error('Invalid format');
        
        expect(isRetryableError(timeoutError)).toBe(true);
        expect(isRetryableError(connectionError)).toBe(true);
        expect(isRetryableError(rateLimitError)).toBe(true);
        expect(isRetryableError(validationError)).toBe(false);
      });
    });

    describe('getErrorCategory', () => {
      it('should categorize BaseError instances by status code', () => {
        const clientError = new ValidationError('Invalid input');
        const serverError = new DatabaseError('Connection failed');
        
        expect(getErrorCategory(clientError)).toBe('client');
        expect(getErrorCategory(serverError)).toBe('server');
      });

      it('should categorize non-BaseError instances by message patterns', () => {
        const networkError = new Error('Network timeout');
        const connectionError = new Error('Connection refused');
        const unknownError = new Error('Something went wrong');
        
        expect(getErrorCategory(networkError)).toBe('network');
        expect(getErrorCategory(connectionError)).toBe('network');
        expect(getErrorCategory(unknownError)).toBe('unknown');
      });
    });
  });

  describe('Error inheritance and instanceof', () => {
    it('should maintain proper inheritance chain', () => {
      const errors = [
        new DatabaseError('DB error'),
        new ValidationError('Validation error'),
        new NotFoundError('Resource'),
        new ConflictError('Conflict'),
        new RateLimitError(10, 1000),
        new BlockchainError('Blockchain error'),
        new TimeoutError('operation', 1000),
        new ConfigurationError('Config error')
      ];
      
      errors.forEach(error => {
        expect(error instanceof Error).toBe(true);
        expect(error instanceof BaseError).toBe(true);
        expect(error.name).toBe(error.constructor.name);
      });
    });

    it('should work in try-catch blocks', () => {
      const testError = (errorClass: any, ...args: any[]) => {
        try {
          throw new errorClass(...args);
        } catch (error) {
          expect(error).toBeInstanceOf(errorClass);
          expect(error).toBeInstanceOf(BaseError);
          expect(error).toBeInstanceOf(Error);
          return error;
        }
      };
      
      testError(DatabaseError, 'DB error');
      testError(ValidationError, 'Validation error');
      testError(NotFoundError, 'Resource');
      testError(TimeoutError, 'operation', 1000);
    });
  });

  describe('Error serialization and logging', () => {
    it('should serialize errors for JSON logging', () => {
      const error = new DatabaseError(
        'Connection failed',
        new Error('Socket timeout'),
        { host: 'localhost', port: 5432 },
        'req-log'
      );
      
      const serialized = JSON.stringify(error);
      const parsed = JSON.parse(serialized);
      
      expect(parsed.name).toBe('DatabaseError');
      expect(parsed.code).toBe(ErrorCode.DATABASE_ERROR);
      expect(parsed.message).toBe('Database error: Connection failed');
      expect(parsed.context.host).toBe('localhost');
      expect(parsed.requestId).toBe('req-log');
    });

    it('should preserve stack traces', () => {
      const error = new ValidationError('Test error');
      
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('ValidationError');
      expect(error.stack).toContain('Test error');
      expect(error.stack).toContain(__filename);
    });
  });

  describe('Error context and metadata', () => {
    it('should preserve error context through transformations', () => {
      const originalContext = { userId: '123', operation: 'create_wallet' };
      const error = new WalletError(
        ErrorCode.WALLET_ALREADY_MONITORED,
        'Wallet exists',
        '0xwallet',
        originalContext,
        'req-context'
      );
      
      const json = error.toJSON();
      
      expect(json.context).toEqual({
        walletAddress: '0xwallet',
        ...originalContext
      });
    });

    it('should handle complex context objects', () => {
      const complexContext = {
        user: { id: '123', role: 'admin' },
        metadata: { source: 'api', version: '1.0' },
        nested: { deep: { value: 42 } }
      };
      
      const error = new ValidationError('Complex context', complexContext);
      const json = error.toJSON();
      
      expect(json.context).toEqual(complexContext);
    });
  });
});