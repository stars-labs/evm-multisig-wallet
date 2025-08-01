// Enhanced validation middleware with comprehensive schema validation
import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { ValidationError } from '../../utils/errors';
import { NetworkType, WalletType } from '@multisig-validator/shared';

// Custom validation schemas
export const commonSchemas = {
  ethereumAddress: Joi.string()
    .pattern(/^0x[a-fA-F0-9]{40}$/)
    .message('Must be a valid Ethereum address (0x + 40 hex characters)'),
    
  transactionHash: Joi.string()
    .pattern(/^0x[a-fA-F0-9]{64}$/)
    .message('Must be a valid transaction hash (0x + 64 hex characters)'),
    
  network: Joi.string()
    .valid(...Object.values(NetworkType))
    .messages({
      'any.only': `Network must be one of: ${Object.values(NetworkType).join(', ')}`
    }),
    
  walletType: Joi.string()
    .valid(...Object.values(WalletType))
    .messages({
      'any.only': `Wallet type must be one of: ${Object.values(WalletType).join(', ')}`
    }),
    
  uuid: Joi.string()
    .uuid({ version: 'uuidv4' })
    .message('Must be a valid UUID v4'),
    
  positiveInteger: Joi.number()
    .integer()
    .positive()
    .message('Must be a positive integer'),
    
  blockNumber: Joi.number()
    .integer()
    .min(0)
    .message('Must be a non-negative integer'),
    
  pagination: {
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(1000).default(50),
    sortBy: Joi.string().optional(),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc')
  }
};

// Wallet-related schemas
export const walletSchemas = {
  addWallet: Joi.object({
    address: commonSchemas.ethereumAddress.required(),
    network: commonSchemas.network.required(),
    name: Joi.string().min(1).max(255).required(),
    type: commonSchemas.walletType.optional(),
    description: Joi.string().max(1000).optional(),
    contactList: Joi.array().items(Joi.string().email()).optional(),
    slackWebhook: Joi.string().uri().optional(),
    alertThresholds: Joi.object({
      largeTransfer: Joi.number().positive().optional(),
      rapidTransactions: Joi.number().integer().positive().optional(),
      dailyLimitChange: Joi.number().positive().optional()
    }).optional()
  }),
  
  updateWallet: Joi.object({
    name: Joi.string().min(1).max(255).optional(),
    description: Joi.string().max(1000).optional(),
    monitored: Joi.boolean().optional(),
    contactList: Joi.array().items(Joi.string().email()).optional(),
    slackWebhook: Joi.string().uri().allow('').optional(),
    alertThresholds: Joi.object({
      largeTransfer: Joi.number().positive().optional(),
      rapidTransactions: Joi.number().integer().positive().optional(),
      dailyLimitChange: Joi.number().positive().optional()
    }).optional()
  }).min(1)
};

// Transaction-related schemas
export const transactionSchemas = {
  getTransactions: Joi.object({
    page: commonSchemas.pagination.page,
    limit: commonSchemas.pagination.limit,
    sortBy: Joi.string().valid(
      'submitted_at', 'executed_at', 'value', 'risk_score', 'validation_status'
    ).optional(),
    sortOrder: commonSchemas.pagination.sortOrder,
    status: Joi.string().valid('pending', 'executed', 'failed').optional(),
    action: Joi.string().valid(
      'transfer', 'addOwner', 'removeOwner', 'replaceOwner', 
      'changeRequirement', 'changeDailyLimit', 'contractCall'
    ).optional(),
    submitter: commonSchemas.ethereumAddress.optional(),
    dateFrom: Joi.date().iso().optional(),
    dateTo: Joi.date().iso().min(Joi.ref('dateFrom')).optional()
  })
};

// Alert-related schemas
export const alertSchemas = {
  getAlerts: Joi.object({
    page: commonSchemas.pagination.page,
    limit: commonSchemas.pagination.limit,
    sortBy: Joi.string().valid('created_at', 'priority', 'status', 'risk_level').optional(),
    sortOrder: commonSchemas.pagination.sortOrder,
    status: Joi.string().valid('active', 'acknowledged', 'resolved', 'false_positive').optional(),
    priority: Joi.string().valid('P1', 'P2', 'P3').optional(),
    type: Joi.string().optional(),
    dateFrom: Joi.date().iso().optional(),
    dateTo: Joi.date().iso().min(Joi.ref('dateFrom')).optional()
  }),
  
  updateAlert: Joi.object({
    status: Joi.string().valid('acknowledged', 'resolved', 'false_positive').required(),
    notes: Joi.string().max(1000).optional()
  })
};

// Chain-related schemas
export const chainSchemas = {
  updateChain: Joi.object({
    enabled: Joi.boolean().optional(),
    rpcUrl: Joi.string().uri().optional(),
    rpcBackupUrls: Joi.array().items(Joi.string().uri()).optional(),
    blockConfirmations: commonSchemas.positiveInteger.optional(),
    rateLimitRps: commonSchemas.positiveInteger.optional(),
    rateLimitRpm: commonSchemas.positiveInteger.optional(),
    syncIntervalMs: commonSchemas.positiveInteger.optional(),
    maxBlocksPerBatch: commonSchemas.positiveInteger.optional()
  }).min(1)
};

// Enhanced validation middleware functions
export const validateBody = (schema: Joi.ObjectSchema, options?: Joi.ValidationOptions) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const validationOptions: Joi.ValidationOptions = {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
      ...options
    };
    
    const { error, value } = schema.validate(req.body, validationOptions);
    
    if (error) {
      const requestId = (req as any).requestId;
      const validationError = new ValidationError(
        'Request body validation failed',
        {
          validationErrors: error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message,
            value: detail.context?.value,
            type: detail.type
          }))
        },
        requestId
      );
      return next(validationError);
    }
    
    // Replace req.body with validated and transformed value
    req.body = value;
    next();
  };
};

export const validateQuery = (schema: Joi.ObjectSchema, options?: Joi.ValidationOptions) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const validationOptions: Joi.ValidationOptions = {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
      ...options
    };
    
    const { error, value } = schema.validate(req.query, validationOptions);
    
    if (error) {
      const requestId = (req as any).requestId;
      const validationError = new ValidationError(
        'Query parameters validation failed',
        {
          validationErrors: error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message,
            value: detail.context?.value,
            type: detail.type
          }))
        },
        requestId
      );
      return next(validationError);
    }
    
    // Replace req.query with validated and transformed value
    req.query = value;
    next();
  };
};

export const validateParams = (schema: Joi.ObjectSchema, options?: Joi.ValidationOptions) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const validationOptions: Joi.ValidationOptions = {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
      ...options
    };
    
    const { error, value } = schema.validate(req.params, validationOptions);
    
    if (error) {
      const requestId = (req as any).requestId;
      const validationError = new ValidationError(
        'URL parameters validation failed',
        {
          validationErrors: error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message,
            value: detail.context?.value,
            type: detail.type
          }))
        },
        requestId
      );
      return next(validationError);
    }
    
    // Replace req.params with validated and transformed value
    req.params = value;
    next();
  };
};

// Comprehensive validation for all request parts
export const validate = (schemas: {
  body?: Joi.ObjectSchema;
  query?: Joi.ObjectSchema;
  params?: Joi.ObjectSchema;
  options?: Joi.ValidationOptions;
}) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const errors: Array<{ location: string; details: any[] }> = [];
    const requestId = (req as any).requestId;
    
    // Validate params first (they're often used for further validations)
    if (schemas.params) {
      const { error, value } = schemas.params.validate(req.params, {
        abortEarly: false,
        stripUnknown: true,
        convert: true,
        ...schemas.options
      });
      
      if (error) {
        errors.push({
          location: 'params',
          details: error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message,
            value: detail.context?.value,
            type: detail.type
          }))
        });
      } else {
        req.params = value;
      }
    }
    
    // Validate query
    if (schemas.query) {
      const { error, value } = schemas.query.validate(req.query, {
        abortEarly: false,
        stripUnknown: true,
        convert: true,
        ...schemas.options
      });
      
      if (error) {
        errors.push({
          location: 'query',
          details: error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message,
            value: detail.context?.value,
            type: detail.type
          }))
        });
      } else {
        req.query = value;
      }
    }
    
    // Validate body
    if (schemas.body) {
      const { error, value } = schemas.body.validate(req.body, {
        abortEarly: false,
        stripUnknown: true,
        convert: true,
        ...schemas.options
      });
      
      if (error) {
        errors.push({
          location: 'body',
          details: error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message,
            value: detail.context?.value,
            type: detail.type
          }))
        });
      } else {
        req.body = value;
      }
    }
    
    // If there are validation errors, create a comprehensive error
    if (errors.length > 0) {
      const validationError = new ValidationError(
        'Request validation failed',
        { validationErrors: errors },
        requestId
      );
      return next(validationError);
    }
    
    next();
  };
};

// Request sanitization middleware
export const sanitizeInput = (req: Request, res: Response, next: NextFunction) => {
  // Remove null bytes and control characters
  const sanitizeString = (str: string): string => {
    return str.replace(/[\x00-\x1f\x7f-\x9f]/g, '');
  };
  
  const sanitizeObject = (obj: any): any => {
    if (typeof obj === 'string') {
      return sanitizeString(obj);
    }
    
    if (Array.isArray(obj)) {
      return obj.map(sanitizeObject);
    }
    
    if (obj && typeof obj === 'object') {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(obj)) {
        sanitized[key] = sanitizeObject(value);
      }
      return sanitized;
    }
    
    return obj;
  };
  
  // Sanitize request data
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }
  
  if (req.query) {
    req.query = sanitizeObject(req.query);
  }
  
  if (req.params) {
    req.params = sanitizeObject(req.params);
  }
  
  next();
};

// Legacy validation functions for backward compatibility
export const validateAddWallet = validateBody(walletSchemas.addWallet);

export const validateNetworkSupport = (monitoredNetworks: NetworkType[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const { network } = req.body;
    
    if (network && !monitoredNetworks.includes(network)) {
      const validationError = new ValidationError(
        `Network '${network}' is not being monitored`,
        {
          network,
          monitoredNetworks,
          availableNetworks: Object.values(NetworkType)
        },
        (req as any).requestId
      );
      return next(validationError);
    }
    
    next();
  };
};