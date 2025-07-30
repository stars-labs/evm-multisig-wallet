// Comprehensive error handling system with custom error classes
import { ValidationError as JoiValidationError } from 'joi';

export enum ErrorCode {
  // Validation Errors (4xx)
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_ADDRESS = 'INVALID_ADDRESS',
  INVALID_NETWORK = 'INVALID_NETWORK',
  INVALID_WALLET_TYPE = 'INVALID_WALLET_TYPE',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  
  // Authentication/Authorization Errors (4xx)
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  INVALID_TOKEN = 'INVALID_TOKEN',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  
  // Resource Errors (4xx)
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  WALLET_NOT_FOUND = 'WALLET_NOT_FOUND',
  TRANSACTION_NOT_FOUND = 'TRANSACTION_NOT_FOUND',
  OWNER_NOT_FOUND = 'OWNER_NOT_FOUND',
  DUPLICATE_RESOURCE = 'DUPLICATE_RESOURCE',
  
  // Business Logic Errors (4xx)
  WALLET_ALREADY_MONITORED = 'WALLET_ALREADY_MONITORED',
  INSUFFICIENT_CONFIRMATIONS = 'INSUFFICIENT_CONFIRMATIONS',
  INVALID_TRANSACTION_STATE = 'INVALID_TRANSACTION_STATE',
  CONTRACT_INTERACTION_FAILED = 'CONTRACT_INTERACTION_FAILED',
  
  // External Service Errors (5xx)
  DATABASE_ERROR = 'DATABASE_ERROR',
  DATABASE_CONNECTION_FAILED = 'DATABASE_CONNECTION_FAILED',
  DATABASE_TRANSACTION_FAILED = 'DATABASE_TRANSACTION_FAILED',
  RPC_ERROR = 'RPC_ERROR',
  RPC_TIMEOUT = 'RPC_TIMEOUT',
  RPC_RATE_LIMITED = 'RPC_RATE_LIMITED',
  BLOCKCHAIN_ERROR = 'BLOCKCHAIN_ERROR',
  
  // System Errors (5xx)
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  TIMEOUT = 'TIMEOUT',
  CIRCUIT_BREAKER_OPEN = 'CIRCUIT_BREAKER_OPEN',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  
  // Configuration Errors (5xx)
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR',
  MISSING_CONFIGURATION = 'MISSING_CONFIGURATION',
  INVALID_CONFIGURATION = 'INVALID_CONFIGURATION',
  
  // Network/Communication Errors (5xx)
  NETWORK_ERROR = 'NETWORK_ERROR',
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  EXTERNAL_API_ERROR = 'EXTERNAL_API_ERROR',
  SLACK_NOTIFICATION_FAILED = 'SLACK_NOTIFICATION_FAILED'
}

export interface ErrorContext {
  [key: string]: any;
}

export interface ErrorDetails {
  code: ErrorCode;
  message: string;
  statusCode: number;
  context?: ErrorContext;
  cause?: Error;
  retryable?: boolean;
  timestamp: Date;
  requestId?: string;
}

export abstract class BaseError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly context?: ErrorContext;
  public readonly cause?: Error;
  public readonly retryable: boolean;
  public readonly timestamp: Date;
  public readonly requestId?: string;

  constructor(details: ErrorDetails) {
    super(details.message);
    this.name = this.constructor.name;
    this.code = details.code;
    this.statusCode = details.statusCode;
    this.context = details.context;
    this.cause = details.cause;
    this.retryable = details.retryable || false;
    this.timestamp = details.timestamp;
    this.requestId = details.requestId;

    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(): object {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      context: this.context,
      retryable: this.retryable,
      timestamp: this.timestamp.toISOString(),
      requestId: this.requestId
    };
  }
}

// 4xx Client Errors
export class ValidationError extends BaseError {
  constructor(message: string, context?: ErrorContext, requestId?: string) {
    super({
      code: ErrorCode.VALIDATION_ERROR,
      message,
      statusCode: 400,
      context,
      retryable: false,
      timestamp: new Date(),
      requestId
    });
  }
}

export class UnauthorizedError extends BaseError {
  constructor(message = 'Unauthorized', context?: ErrorContext, requestId?: string) {
    super({
      code: ErrorCode.UNAUTHORIZED,
      message,
      statusCode: 401,
      context,
      retryable: false,
      timestamp: new Date(),
      requestId
    });
  }
}

export class ForbiddenError extends BaseError {
  constructor(message = 'Forbidden', context?: ErrorContext, requestId?: string) {
    super({
      code: ErrorCode.FORBIDDEN,
      message,
      statusCode: 403,
      context,
      retryable: false,
      timestamp: new Date(),
      requestId
    });
  }
}

export class NotFoundError extends BaseError {
  constructor(resource: string, identifier?: string, context?: ErrorContext, requestId?: string) {
    const message = identifier 
      ? `${resource} with identifier '${identifier}' not found`
      : `${resource} not found`;
      
    super({
      code: ErrorCode.RESOURCE_NOT_FOUND,
      message,
      statusCode: 404,
      context: { resource, identifier, ...context },
      retryable: false,
      timestamp: new Date(),
      requestId
    });
  }
}

export class ConflictError extends BaseError {
  constructor(message: string, context?: ErrorContext, requestId?: string) {
    super({
      code: ErrorCode.DUPLICATE_RESOURCE,
      message,
      statusCode: 409,
      context,
      retryable: false,
      timestamp: new Date(),
      requestId
    });
  }
}

export class RateLimitError extends BaseError {
  constructor(limit: number, windowMs: number, context?: ErrorContext, requestId?: string) {
    super({
      code: ErrorCode.RATE_LIMIT_EXCEEDED,
      message: `Rate limit exceeded: ${limit} requests per ${windowMs}ms`,
      statusCode: 429,
      context: { limit, windowMs, ...context },
      retryable: true,
      timestamp: new Date(),
      requestId
    });
  }
}

// 5xx Server Errors
export class DatabaseError extends BaseError {
  constructor(message: string, cause?: Error, context?: ErrorContext, requestId?: string) {
    super({
      code: ErrorCode.DATABASE_ERROR,
      message: `Database error: ${message}`,
      statusCode: 500,
      context,
      cause,
      retryable: true,
      timestamp: new Date(),
      requestId
    });
  }
}

export class BlockchainError extends BaseError {
  constructor(message: string, network?: string, cause?: Error, context?: ErrorContext, requestId?: string) {
    super({
      code: ErrorCode.BLOCKCHAIN_ERROR,
      message: `Blockchain error${network ? ` on ${network}` : ''}: ${message}`,
      statusCode: 500,
      context: { network, ...context },
      cause,
      retryable: true,
      timestamp: new Date(),
      requestId
    });
  }
}

export class RpcError extends BaseError {
  constructor(message: string, network?: string, cause?: Error, context?: ErrorContext, requestId?: string) {
    super({
      code: ErrorCode.RPC_ERROR,
      message: `RPC error${network ? ` on ${network}` : ''}: ${message}`,
      statusCode: 502,
      context: { network, ...context },
      cause,
      retryable: true,
      timestamp: new Date(),
      requestId
    });
  }
}

export class ServiceUnavailableError extends BaseError {
  constructor(service: string, context?: ErrorContext, requestId?: string) {
    super({
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message: `Service unavailable: ${service}`,
      statusCode: 503,
      context: { service, ...context },
      retryable: true,
      timestamp: new Date(),
      requestId
    });
  }
}

export class TimeoutError extends BaseError {
  constructor(operation: string, timeoutMs: number, context?: ErrorContext, requestId?: string) {
    super({
      code: ErrorCode.TIMEOUT,
      message: `Operation '${operation}' timed out after ${timeoutMs}ms`,
      statusCode: 504,
      context: { operation, timeoutMs, ...context },
      retryable: true,
      timestamp: new Date(),
      requestId
    });
  }
}

export class ConfigurationError extends BaseError {
  constructor(message: string, context?: ErrorContext) {
    super({
      code: ErrorCode.CONFIGURATION_ERROR,
      message: `Configuration error: ${message}`,
      statusCode: 500,
      context,
      retryable: false,
      timestamp: new Date()
    });
  }
}

// Business Logic Errors
export class WalletError extends BaseError {
  constructor(code: ErrorCode, message: string, walletAddress?: string, context?: ErrorContext, requestId?: string) {
    super({
      code,
      message,
      statusCode: 400,
      context: { walletAddress, ...context },
      retryable: false,
      timestamp: new Date(),
      requestId
    });
  }
}

export class TransactionError extends BaseError {
  constructor(code: ErrorCode, message: string, transactionId?: string, context?: ErrorContext, requestId?: string) {
    super({
      code,
      message,
      statusCode: 400,
      context: { transactionId, ...context },
      retryable: false,
      timestamp: new Date(),
      requestId
    });
  }
}

// Error Factory and Utilities
export class ErrorFactory {
  static fromJoiValidation(error: JoiValidationError, requestId?: string): ValidationError {
    const details = error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message,
      value: detail.context?.value
    }));

    return new ValidationError(
      'Validation failed',
      { validationErrors: details },
      requestId
    );
  }

  static fromDatabaseError(error: Error, requestId?: string): DatabaseError {
    // Parse PostgreSQL error codes
    const pgError = error as any;
    if (pgError.code) {
      switch (pgError.code) {
        case '23505': // unique_violation
          return new ConflictError(
            `Duplicate entry: ${pgError.detail || error.message}`,
            { pgCode: pgError.code, constraint: pgError.constraint },
            requestId
          );
        case '23503': // foreign_key_violation
          return new ValidationError(
            `Foreign key constraint violated: ${pgError.detail || error.message}`,
            { pgCode: pgError.code, constraint: pgError.constraint },
            requestId
          );
        case '23502': // not_null_violation
          return new ValidationError(
            `Required field missing: ${pgError.column}`,
            { pgCode: pgError.code, column: pgError.column },
            requestId
          );
        case '28P01': // invalid_password
        case '28000': // invalid_authorization_specification
          return new DatabaseError(
            'Database authentication failed',
            error,
            { pgCode: pgError.code },
            requestId
          );
        default:
          return new DatabaseError(
            error.message,
            error,
            { pgCode: pgError.code },
            requestId
          );
      }
    }

    return new DatabaseError(error.message, error, undefined, requestId);
  }

  static fromUnknownError(error: unknown, requestId?: string): BaseError {
    if (error instanceof BaseError) {
      return error;
    }
    
    if (error instanceof Error) {
      return new BaseError({
        code: ErrorCode.INTERNAL_ERROR,
        message: error.message,
        statusCode: 500,
        cause: error,
        retryable: false,
        timestamp: new Date(),
        requestId
      });
    }

    return new BaseError({
      code: ErrorCode.INTERNAL_ERROR,
      message: 'An unknown error occurred',
      statusCode: 500,
      context: { originalError: String(error) },
      retryable: false,
      timestamp: new Date(),
      requestId
    });
  }
}

// Error categorization helpers
export const isRetryableError = (error: Error): boolean => {
  if (error instanceof BaseError) {
    return error.retryable;
  }
  
  // Default heuristics for non-BaseError instances
  const retryablePatterns = [
    /timeout/i,
    /connection/i,
    /network/i,
    /temporary/i,
    /rate limit/i,
    /service unavailable/i
  ];
  
  return retryablePatterns.some(pattern => pattern.test(error.message));
};

export const getErrorCategory = (error: Error): 'client' | 'server' | 'network' | 'unknown' => {
  if (error instanceof BaseError) {
    if (error.statusCode >= 400 && error.statusCode < 500) return 'client';
    if (error.statusCode >= 500) return 'server';
  }
  
  const message = error.message.toLowerCase();
  if (message.includes('network') || message.includes('connection')) {
    return 'network';
  }
  
  return 'unknown';
};