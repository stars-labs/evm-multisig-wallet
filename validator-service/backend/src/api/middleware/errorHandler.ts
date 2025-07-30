// Enhanced error handling middleware with comprehensive error mapping
import { Request, Response, NextFunction } from 'express';
import winston from 'winston';
import { BaseError, ErrorFactory, ErrorCode } from '../../utils/errors';
import { ValidationError } from 'joi';

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
    timestamp: string;
    requestId?: string;
    retryable?: boolean;
    context?: any;
  };
}

export const errorHandler = (logger: winston.Logger) => {
  return (error: any, req: Request, res: Response, next: NextFunction) => {
    const requestId = (req as any).requestId;
    let processedError: BaseError;

    // Convert various error types to BaseError
    if (error instanceof BaseError) {
      processedError = error;
    } else if (error instanceof ValidationError) {
      processedError = ErrorFactory.fromJoiValidation(error, requestId);
    } else if (error.code && typeof error.code === 'string' && error.code.startsWith('23')) {
      // PostgreSQL errors
      processedError = ErrorFactory.fromDatabaseError(error, requestId);
    } else if (error.name === 'MongoError' || error.name === 'MongoServerError') {
      // MongoDB errors
      if (error.code === 11000) {
        processedError = new BaseError({
          code: ErrorCode.DUPLICATE_RESOURCE,
          message: 'Resource already exists',
          statusCode: 409,
          context: { duplicateKey: error.keyValue },
          retryable: false,
          timestamp: new Date(),
          requestId
        });
      } else {
        processedError = ErrorFactory.fromDatabaseError(error, requestId);
      }
    } else if (error.name === 'CastError') {
      processedError = new BaseError({
        code: ErrorCode.VALIDATION_ERROR,
        message: `Invalid ${error.kind}: ${error.value}`,
        statusCode: 400,
        context: { field: error.path, value: error.value, kind: error.kind },
        retryable: false,
        timestamp: new Date(),
        requestId
      });
    } else if (error.name === 'JsonWebTokenError') {
      processedError = new BaseError({
        code: ErrorCode.INVALID_TOKEN,
        message: 'Invalid authentication token',
        statusCode: 401,
        retryable: false,
        timestamp: new Date(),
        requestId
      });
    } else if (error.name === 'TokenExpiredError') {
      processedError = new BaseError({
        code: ErrorCode.TOKEN_EXPIRED,
        message: 'Authentication token has expired',
        statusCode: 401,
        retryable: false,
        timestamp: new Date(),
        requestId
      });
    } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
      processedError = new BaseError({
        code: ErrorCode.NETWORK_ERROR,
        message: `Network error: ${error.message}`,
        statusCode: 502,
        context: { networkCode: error.code, host: error.hostname, port: error.port },
        retryable: true,
        timestamp: new Date(),
        requestId
      });
    } else {
      // Fallback for unknown errors
      processedError = ErrorFactory.fromUnknownError(error, requestId);
    }

    // Enhanced logging with structured data
    const logContext = {
      error: {
        name: processedError.name,
        code: processedError.code,
        message: processedError.message,
        statusCode: processedError.statusCode,
        retryable: processedError.retryable,
        context: processedError.context
      },
      request: {
        id: requestId,
        method: req.method,
        path: req.path,
        originalUrl: req.originalUrl,
        userAgent: req.get('User-Agent'),
        ip: req.ip || req.connection.remoteAddress,
        headers: {
          'content-type': req.get('Content-Type'),
          'accept': req.get('Accept'),
          'authorization': req.get('Authorization') ? '[REDACTED]' : undefined
        },
        body: req.method !== 'GET' ? sanitizeRequestBody(req.body) : undefined,
        query: Object.keys(req.query).length > 0 ? req.query : undefined
      },
      timing: {
        requestTime: (req as any).startTime ? Date.now() - (req as any).startTime : undefined
      }
    };

    // Log based on error severity
    if (processedError.statusCode >= 500) {
      logger.error('Server error occurred', logContext);
    } else if (processedError.statusCode >= 400) {
      logger.warn('Client error occurred', logContext);
    } else {
      logger.info('Request completed with error', logContext);
    }

    // Prepare error response
    const errorResponse: ErrorResponse = {
      success: false,
      error: {
        code: processedError.code,
        message: processedError.message,
        timestamp: processedError.timestamp.toISOString(),
        requestId: processedError.requestId,
        retryable: processedError.retryable
      }
    };

    // Include additional context in non-production environments
    if (process.env.NODE_ENV !== 'production') {
      if (processedError.context) {
        errorResponse.error.context = processedError.context;
      }
      
      // Include stack trace for server errors in development
      if (processedError.statusCode >= 500 && error.stack) {
        (errorResponse.error as any).stack = error.stack;
      }
    }

    // Set security headers
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block'
    });

    // Send error response
    res.status(processedError.statusCode).json(errorResponse);
  };
};

// Helper function to sanitize sensitive data from request body
function sanitizeRequestBody(body: any): any {
  if (!body || typeof body !== 'object') {
    return body;
  }

  const sensitiveFields = [
    'password',
    'token',
    'secret',
    'privateKey',
    'apiKey',
    'authorization',
    'auth',
    'credentials'
  ];

  const sanitized = { ...body };
  
  for (const field of sensitiveFields) {
    if (field in sanitized) {
      sanitized[field] = '[REDACTED]';
    }
  }

  return sanitized;
}

// Async error wrapper for route handlers
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Not found handler
export const notFoundHandler = (req: Request, res: Response) => {
  const error = new BaseError({
    code: ErrorCode.RESOURCE_NOT_FOUND,
    message: `Route ${req.method} ${req.originalUrl} not found`,
    statusCode: 404,
    context: {
      method: req.method,
      path: req.originalUrl,
      availableEndpoints: ['/api/health', '/api/wallets', '/api/metrics']
    },
    retryable: false,
    timestamp: new Date(),
    requestId: (req as any).requestId
  });

  const errorResponse: ErrorResponse = {
    success: false,
    error: {
      code: error.code,
      message: error.message,
      timestamp: error.timestamp.toISOString(),
      requestId: error.requestId,
      context: error.context
    }
  };

  res.status(404).json(errorResponse);
};

// Legacy API error for backward compatibility
export interface ApiError extends Error {
  statusCode?: number;
  code?: string;
}

export const createApiError = (message: string, statusCode: number = 500): ApiError => {
  const error = new Error(message) as ApiError;
  error.statusCode = statusCode;
  return error;
};