// Enhanced configuration management for MultiSig Validator Service
import dotenv from 'dotenv';
import joi from 'joi';

// Load environment variables
if (process.env.NODE_ENV === 'test') {
  dotenv.config({ path: '.env.test' });
} else {
  dotenv.config();
}

// Configuration validation schema
const configSchema = joi.object({
  NODE_ENV: joi.string().valid('development', 'production', 'test').default('development'),
  PORT: joi.number().port().default(3001),
  HOST: joi.string().hostname().default('0.0.0.0'),
  
  // Database
  DB_HOST: joi.string().hostname().required(),
  DB_PORT: joi.number().port().default(5432),
  DB_NAME: joi.string().required(),
  DB_USER: joi.string().required(),
  DB_PASSWORD: joi.string().required(),
  DB_SSL: joi.boolean().default(false),
  
  // Security
  JWT_SECRET: joi.string().min(32).required(),
  BCRYPT_ROUNDS: joi.number().min(8).max(15).default(12),
  
  // Rate Limiting
  RATE_LIMIT_WINDOW: joi.number().positive().default(900000), // 15 minutes
  RATE_LIMIT_MAX: joi.number().positive().default(100),
  
  // Blockchain
  MAINNET_RPC_URL: joi.string().uri().optional(),
  SEPOLIA_RPC_URL: joi.string().uri().optional(),
  GOERLI_RPC_URL: joi.string().uri().optional(),
  LOCALHOST_RPC_URL: joi.string().uri().optional(),
  
  // Redis
  REDIS_HOST: joi.string().hostname().default('localhost'),
  REDIS_PORT: joi.number().port().default(6379),
  REDIS_PASSWORD: joi.string().optional(),
  REDIS_DB: joi.number().min(0).max(15).default(0),
  
  // Notifications
  SLACK_WEBHOOK_URL: joi.string().uri().optional(),
  SLACK_DEFAULT_CHANNEL: joi.string().allow('').default('#multisig-alerts'),
  SLACK_ENABLED: joi.boolean().default(false),
  
  EMAIL_SERVICE: joi.string().default('gmail'),
  EMAIL_USER: joi.string().email().optional(),
  EMAIL_PASSWORD: joi.string().optional(),
  EMAIL_FROM: joi.string().email().optional(),
  
  // Logging
  LOG_LEVEL: joi.string().valid('error', 'warn', 'info', 'debug').default('info'),
  LOG_FILE: joi.boolean().default(false),
  LOG_CONSOLE: joi.boolean().default(true),
  
  // Event Processing
  EVENT_BATCH_SIZE: joi.number().positive().default(100),
  MAX_BLOCKS_PER_BATCH: joi.number().positive().default(1000),
  SYNC_INTERVAL: joi.number().positive().default(30000),
  START_BLOCK: joi.number().min(0).default(1),
  
  // Rate Limiting for RPC
  RPC_REQUESTS_PER_SECOND: joi.number().positive().default(2),
  RPC_REQUESTS_PER_MINUTE: joi.number().positive().default(50),
  BACKOFF_MULTIPLIER: joi.number().positive().default(2.0),
  MAX_BACKOFF_TIME: joi.number().positive().default(120000)
});

// Validate environment variables
const { error, value: validatedEnv } = configSchema.validate(process.env, {
  allowUnknown: true,
  stripUnknown: true
});

if (error) {
  throw new Error(`Configuration validation error: ${error.details.map(d => d.message).join(', ')}`);
}

export interface Config {
  server: {
    port: number;
    host: string;
    nodeEnv: string;
  };
  database: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
    ssl: boolean;
  };
  blockchain: {
    networks: {
      [key: string]: {
        rpcUrl: string;
        chainId: number;
        blockConfirmations: number;
        retryAttempts: number;
        retryDelay: number;
      };
    };
    eventSync: {
      batchSize: number;
      maxBlocksPerBatch: number;
      syncInterval: number;
      startBlock: number;
      rateLimiting: {
        requestsPerSecond: number;
        requestsPerMinute: number;
        backoffMultiplier: number;
        maxBackoffTime: number;
      };
    };
  };
  redis: {
    host: string;
    port: number;
    password?: string;
    db: number;
  };
  notifications: {
    email: {
      service: string;
      user: string;
      password: string;
      from: string;
    };
    slack: {
      webhookUrl: string;
      defaultChannel: string;
      enabled: boolean;
    };
  };
  security: {
    jwtSecret: string;
    bcryptRounds: number;
    rateLimitWindow: number;
    rateLimitMax: number;
  };
  logging: {
    level: string;
    file: boolean;
    console: boolean;
  };
}

const config: Config = {
  server: {
    port: validatedEnv.PORT,
    host: validatedEnv.HOST,
    nodeEnv: validatedEnv.NODE_ENV,
  },
  database: {
    host: validatedEnv.DB_HOST,
    port: validatedEnv.DB_PORT,
    name: validatedEnv.DB_NAME,
    user: validatedEnv.DB_USER,
    password: validatedEnv.DB_PASSWORD,
    ssl: validatedEnv.DB_SSL,
  },
  blockchain: {
    networks: {
      mainnet: {
        rpcUrl: validatedEnv.MAINNET_RPC_URL || 'https://mainnet.infura.io/v3/YOUR_PROJECT_ID',
        chainId: 1,
        blockConfirmations: 12,
        retryAttempts: 3,
        retryDelay: 2000,
      },
      sepolia: {
        rpcUrl: validatedEnv.SEPOLIA_RPC_URL || 'https://sepolia.infura.io/v3/76b6da167a1a45ecb381010150ee9d31',
        chainId: 11155111,
        blockConfirmations: 3,
        retryAttempts: 3,
        retryDelay: 1000,
      },
      goerli: {
        rpcUrl: validatedEnv.GOERLI_RPC_URL || 'https://goerli.infura.io/v3/YOUR_PROJECT_ID',
        chainId: 5,
        blockConfirmations: 3,
        retryAttempts: 3,
        retryDelay: 1000,
      },
      localhost: {
        rpcUrl: validatedEnv.LOCALHOST_RPC_URL || 'http://127.0.0.1:8545',
        chainId: 31337,
        blockConfirmations: 1,
        retryAttempts: 3,
        retryDelay: 500,
      },
    },
    eventSync: {
      batchSize: validatedEnv.EVENT_BATCH_SIZE,
      maxBlocksPerBatch: validatedEnv.MAX_BLOCKS_PER_BATCH,
      syncInterval: validatedEnv.SYNC_INTERVAL,
      startBlock: validatedEnv.START_BLOCK,
      rateLimiting: {
        requestsPerSecond: validatedEnv.RPC_REQUESTS_PER_SECOND,
        requestsPerMinute: validatedEnv.RPC_REQUESTS_PER_MINUTE,
        backoffMultiplier: validatedEnv.BACKOFF_MULTIPLIER,
        maxBackoffTime: validatedEnv.MAX_BACKOFF_TIME,
      }
    },
  },
  redis: {
    host: validatedEnv.REDIS_HOST,
    port: validatedEnv.REDIS_PORT,
    password: validatedEnv.REDIS_PASSWORD,
    db: validatedEnv.REDIS_DB,
  },
  notifications: {
    email: {
      service: validatedEnv.EMAIL_SERVICE,
      user: validatedEnv.EMAIL_USER || '',
      password: validatedEnv.EMAIL_PASSWORD || '',
      from: validatedEnv.EMAIL_FROM || 'noreply@validator.com',
    },
    slack: {
      webhookUrl: validatedEnv.SLACK_WEBHOOK_URL || '',
      defaultChannel: validatedEnv.SLACK_DEFAULT_CHANNEL,
      enabled: validatedEnv.SLACK_ENABLED,
    },
  },
  security: {
    jwtSecret: validatedEnv.JWT_SECRET,
    bcryptRounds: validatedEnv.BCRYPT_ROUNDS,
    rateLimitWindow: validatedEnv.RATE_LIMIT_WINDOW,
    rateLimitMax: validatedEnv.RATE_LIMIT_MAX,
  },
  logging: {
    level: validatedEnv.LOG_LEVEL,
    file: validatedEnv.LOG_FILE,
    console: validatedEnv.LOG_CONSOLE,
  },
};

// Production-specific validation
if (validatedEnv.NODE_ENV === 'production') {
  const productionSchema = joi.object({
    JWT_SECRET: joi.string().min(64).required(), // Stronger requirement in production
    DB_PASSWORD: joi.string().min(8).required(),
    SLACK_WEBHOOK_URL: joi.string().uri().when('SLACK_ENABLED', {
      is: true,
      then: joi.required(),
      otherwise: joi.optional()
    })
  });
  
  const { error: prodError } = productionSchema.validate(validatedEnv);
  if (prodError) {
    throw new Error(`Production configuration error: ${prodError.details.map(d => d.message).join(', ')}`);
  }
  
  // Warn about development defaults in production
  if (validatedEnv.JWT_SECRET.includes('dev-secret')) {
    console.warn('WARNING: Using development JWT secret in production!');
  }
}

export default config;