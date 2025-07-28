// Configuration management for MultiSig Validator Service
import dotenv from 'dotenv';

dotenv.config();

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
      defaultWebhook?: string;
      botToken?: string;
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
    port: parseInt(process.env.PORT || '3001'),
    host: process.env.HOST || '0.0.0.0',
    nodeEnv: process.env.NODE_ENV || 'development',
  },
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    name: process.env.DB_NAME || 'multisig_validator',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl: process.env.DB_SSL === 'true',
  },
  blockchain: {
    networks: {
      mainnet: {
        rpcUrl: process.env.MAINNET_RPC_URL || 'https://mainnet.infura.io/v3/YOUR_PROJECT_ID',
        chainId: 1,
        blockConfirmations: 12,
        retryAttempts: 3,
        retryDelay: 2000,
      },
      sepolia: {
        rpcUrl: process.env.SEPOLIA_RPC_URL || 'https://sepolia.infura.io/v3/76b6da167a1a45ecb381010150ee9d31',
        chainId: 11155111,
        blockConfirmations: 3,
        retryAttempts: 3,
        retryDelay: 1000,
      },
      goerli: {
        rpcUrl: process.env.GOERLI_RPC_URL || 'https://goerli.infura.io/v3/YOUR_PROJECT_ID',
        chainId: 5,
        blockConfirmations: 3,
        retryAttempts: 3,
        retryDelay: 1000,
      },
      localhost: {
        rpcUrl: process.env.LOCALHOST_RPC_URL || 'http://127.0.0.1:8545',
        chainId: 31337,
        blockConfirmations: 1,
        retryAttempts: 3,
        retryDelay: 500,
      },
    },
    eventSync: {
      batchSize: parseInt(process.env.EVENT_BATCH_SIZE || '100'),
      maxBlocksPerBatch: parseInt(process.env.MAX_BLOCKS_PER_BATCH || '1000'),
      syncInterval: parseInt(process.env.SYNC_INTERVAL || '30000'), // 30 seconds (reduced from 10)
      startBlock: parseInt(process.env.START_BLOCK || '1'), // Start from block 1 for localhost testing
      rateLimiting: {
        requestsPerSecond: parseInt(process.env.RPC_REQUESTS_PER_SECOND || '2'), // More conservative for Sepolia
        requestsPerMinute: parseInt(process.env.RPC_REQUESTS_PER_MINUTE || '50'), // Reduced from 100
        backoffMultiplier: parseFloat(process.env.BACKOFF_MULTIPLIER || '2.0'), // More aggressive backoff
        maxBackoffTime: parseInt(process.env.MAX_BACKOFF_TIME || '120000'), // 2 minutes max
      }
    },
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0'),
  },
  notifications: {
    email: {
      service: process.env.EMAIL_SERVICE || 'gmail',
      user: process.env.EMAIL_USER || '',
      password: process.env.EMAIL_PASSWORD || '',
      from: process.env.EMAIL_FROM || 'noreply@validator.com',
    },
    slack: {
      defaultWebhook: process.env.SLACK_WEBHOOK_URL,
      botToken: process.env.SLACK_BOT_TOKEN,
    },
  },
  security: {
    jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12'),
    rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW || '900000'), // 15 minutes
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100'),
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE === 'true',
    console: process.env.LOG_CONSOLE !== 'false',
  },
};

// Validation
const requiredEnvVars = [
  'DB_PASSWORD',
  'JWT_SECRET',
];

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0 && process.env.NODE_ENV === 'production') {
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

export default config;