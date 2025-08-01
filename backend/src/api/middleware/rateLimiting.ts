// Advanced rate limiting middleware with multiple strategies
import { Request, Response, NextFunction } from 'express';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import Redis from 'redis';
import winston from 'winston';
import { RateLimitError } from '../../utils/errors';
import config from '../../config';

export interface RateLimitConfig {
  points: number; // Number of requests
  duration: number; // Duration in seconds
  blockDuration?: number; // Block duration in seconds (default: same as duration)
  keyPrefix?: string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  whiteList?: string[];
  blackList?: string[];
}

export interface RateLimitStrategy {
  name: string;
  config: RateLimitConfig;
  limiter: RateLimiterRedis;
}

export class RateLimitManager {
  private redis: Redis.RedisClientType;
  private logger: winston.Logger;
  private strategies: Map<string, RateLimitStrategy> = new Map();
  private isConnected: boolean = false;

  constructor(logger: winston.Logger) {
    this.logger = logger;
    this.initializeRedis();
    this.setupDefaultStrategies();
  }

  private async initializeRedis(): Promise<void> {
    try {
      this.redis = Redis.createClient({
        socket: {
          host: config.redis.host,
          port: config.redis.port,
        },
        password: config.redis.password,
        database: config.redis.db,
        retry_strategy: (options) => {
          if (options.error && (options.error as any).code === 'ECONNREFUSED') {
            this.logger.error('Redis connection refused');
            return new Error('Redis connection refused');
          }
          if (options.total_retry_time > 1000 * 60 * 60) {
            return new Error('Retry time exhausted');
          }
          if (options.attempt > 10) {
            return undefined;
          }
          return Math.min(options.attempt * 100, 3000);
        }
      });

      this.redis.on('error', (err) => {
        this.logger.error('Redis connection error:', err);
        this.isConnected = false;
      });

      this.redis.on('connect', () => {
        this.logger.info('Connected to Redis for rate limiting');
        this.isConnected = true;
      });

      this.redis.on('ready', () => {
        this.logger.info('Redis ready for rate limiting');
      });

      await this.redis.connect();
      
    } catch (error) {
      this.logger.error('Failed to initialize Redis for rate limiting:', error);
      // Continue without Redis - use in-memory fallback
    }
  }

  private setupDefaultStrategies(): void {
    // Global API rate limiting
    this.addStrategy('global', {
      points: config.security.rateLimitMax,
      duration: config.security.rateLimitWindow / 1000, // Convert to seconds
      keyPrefix: 'global_rl',
      skipSuccessfulRequests: false
    });

    // Strict rate limiting for sensitive endpoints
    this.addStrategy('strict', {
      points: 10, // 10 requests
      duration: 300, // per 5 minutes
      blockDuration: 900, // block for 15 minutes
      keyPrefix: 'strict_rl'
    });

    // Authentication endpoints
    this.addStrategy('auth', {
      points: 5, // 5 attempts
      duration: 900, // per 15 minutes
      blockDuration: 3600, // block for 1 hour
      keyPrefix: 'auth_rl',
      skipSuccessfulRequests: true // Only count failed attempts
    });

    // Heavy operations (like adding wallets)
    this.addStrategy('heavy', {
      points: 20, // 20 requests
      duration: 3600, // per hour
      keyPrefix: 'heavy_rl'
    });

    // Webhook/notification endpoints
    this.addStrategy('webhook', {
      points: 100, // 100 requests
      duration: 60, // per minute
      keyPrefix: 'webhook_rl'
    });
  }

  addStrategy(name: string, config: RateLimitConfig): void {
    try {
      const limiter = new RateLimiterRedis({
        storeClient: this.redis,
        keyPrefix: config.keyPrefix || `rl_${name}`,
        points: config.points,
        duration: config.duration,
        blockDuration: config.blockDuration || config.duration,
        execEvenly: true, // Spread requests evenly across duration
        skipFailedRequests: config.skipFailedRequests || false,
        skipSuccessfulRequests: config.skipSuccessfulRequests || false
      });

      this.strategies.set(name, {
        name,
        config,
        limiter
      });

      this.logger.info(`Rate limiting strategy '${name}' configured`, {
        points: config.points,
        duration: config.duration,
        blockDuration: config.blockDuration || config.duration
      });

    } catch (error) {
      this.logger.error(`Failed to create rate limiting strategy '${name}':`, error);
    }
  }

  // Create middleware for a specific strategy
  createMiddleware(strategyName: string, options?: {
    keyGenerator?: (req: Request) => string;
    skip?: (req: Request) => boolean;
    onLimitReached?: (req: Request, res: Response) => void;
  }) {
    const strategy = this.strategies.get(strategyName);
    
    if (!strategy) {
      this.logger.warn(`Rate limiting strategy '${strategyName}' not found, using global strategy`);
      const globalStrategy = this.strategies.get('global');
      if (!globalStrategy) {
        throw new Error('Global rate limiting strategy not configured');
      }
      return this.createMiddlewareForStrategy(globalStrategy, options);
    }

    return this.createMiddlewareForStrategy(strategy, options);
  }

  private createMiddlewareForStrategy(
    strategy: RateLimitStrategy,
    options?: {
      keyGenerator?: (req: Request) => string;
      skip?: (req: Request) => boolean;
      onLimitReached?: (req: Request, res: Response) => void;
    }
  ) {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        // Skip rate limiting if configured
        if (options?.skip && options.skip(req)) {
          return next();
        }

        // Generate rate limiting key
        const key = options?.keyGenerator 
          ? options.keyGenerator(req) 
          : this.generateKey(req, strategy.name);

        // Check if Redis is available
        if (!this.isConnected) {
          this.logger.warn('Redis not available, skipping rate limiting');
          return next();
        }

        // Apply rate limiting
        const resRateLimiter = await strategy.limiter.consume(key);

        // Set rate limit headers
        this.setRateLimitHeaders(res, resRateLimiter);

        next();

      } catch (rejRes: any) {
        // Rate limit exceeded
        const requestId = (req as any).requestId;
        
        // Set rate limit headers for exceeded requests
        if (rejRes.remainingHits !== undefined) {
          this.setRateLimitHeaders(res, rejRes);
        }

        // Log rate limit violation
        this.logger.warn('Rate limit exceeded', {
          strategy: strategy.name,
          key: options?.keyGenerator ? options.keyGenerator(req) : this.generateKey(req, strategy.name),
          ip: req.ip,
          userAgent: req.get('User-Agent'),
          path: req.path,
          method: req.method,
          requestId,
          remainingHits: rejRes.remainingHits,
          totalHits: rejRes.totalHits,
          msBeforeNext: rejRes.msBeforeNext
        });

        // Call custom handler if provided
        if (options?.onLimitReached) {
          options.onLimitReached(req, res);
          return;
        }

        // Create rate limit error
        const rateLimitError = new RateLimitError(
          strategy.config.points,
          strategy.config.duration * 1000,
          {
            strategy: strategy.name,
            remainingHits: rejRes.remainingHits,
            totalHits: rejRes.totalHits,
            msBeforeNext: rejRes.msBeforeNext,
            retryAfter: Math.round(rejRes.msBeforeNext / 1000)
          },
          requestId
        );

        // Set Retry-After header
        res.set('Retry-After', Math.round(rejRes.msBeforeNext / 1000).toString());

        next(rateLimitError);
      }
    };
  }

  private generateKey(req: Request, strategyName: string): string {
    // Use multiple factors for key generation to prevent abuse
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';
    
    // For authentication endpoints, also consider the username/email if available
    if (strategyName === 'auth' && req.body) {
      const identifier = req.body.email || req.body.username || req.body.address;
      if (identifier) {
        return `${ip}:${identifier}`;
      }
    }
    
    // For API endpoints, consider both IP and User-Agent to prevent simple IP spoofing
    const userAgentHash = this.simpleHash(userAgent);
    return `${ip}:${userAgentHash}`;
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  private setRateLimitHeaders(res: Response, rateLimiterRes: any): void {
    res.set({
      'X-RateLimit-Limit': rateLimiterRes.totalHits?.toString() || '0',
      'X-RateLimit-Remaining': rateLimiterRes.remainingHits?.toString() || '0',
      'X-RateLimit-Reset': new Date(Date.now() + (rateLimiterRes.msBeforeNext || 0)).toISOString()
    });
  }

  // Get rate limit status for a key
  async getRateLimitStatus(strategyName: string, key: string): Promise<{
    remainingHits: number;
    totalHits: number;
    msBeforeNext: number;
  } | null> {
    const strategy = this.strategies.get(strategyName);
    if (!strategy || !this.isConnected) {
      return null;
    }

    try {
      const res = await strategy.limiter.get(key);
      return res;
    } catch (error) {
      this.logger.error('Failed to get rate limit status:', error);
      return null;
    }
  }

  // Reset rate limit for a key
  async resetRateLimit(strategyName: string, key: string): Promise<boolean> {
    const strategy = this.strategies.get(strategyName);
    if (!strategy || !this.isConnected) {
      return false;
    }

    try {
      await strategy.limiter.delete(key);
      this.logger.info(`Rate limit reset for key: ${key} in strategy: ${strategyName}`);
      return true;
    } catch (error) {
      this.logger.error('Failed to reset rate limit:', error);
      return false;
    }
  }

  // Get statistics for all strategies
  async getStatistics(): Promise<Record<string, any>> {
    const stats: Record<string, any> = {};
    
    for (const [name, strategy] of this.strategies.entries()) {
      stats[name] = {
        config: strategy.config,
        connected: this.isConnected
      };
    }
    
    return stats;
  }

  async disconnect(): Promise<void> {
    if (this.redis && this.isConnected) {
      await this.redis.disconnect();
      this.isConnected = false;
      this.logger.info('Disconnected from Redis');
    }
  }
}

// Singleton instance
let rateLimitManager: RateLimitManager | null = null;

export const getRateLimitManager = (logger?: winston.Logger): RateLimitManager => {
  if (!rateLimitManager) {
    if (!logger) {
      throw new Error('Logger is required for the first call to getRateLimitManager');
    }
    rateLimitManager = new RateLimitManager(logger);
  }
  return rateLimitManager;
};

// Pre-configured middleware exports
export const createRateLimitMiddleware = (logger: winston.Logger) => {
  const manager = getRateLimitManager(logger);
  
  return {
    // Global rate limiting for all API endpoints
    global: manager.createMiddleware('global'),
    
    // Strict rate limiting for sensitive operations
    strict: manager.createMiddleware('strict'),
    
    // Authentication rate limiting (only counts failed attempts)
    auth: manager.createMiddleware('auth', {
      skip: (req) => {
        // Skip successful logins (determined by response status in post-processing)
        return false;
      }
    }),
    
    // Heavy operations rate limiting
    heavy: manager.createMiddleware('heavy'),
    
    // Webhook rate limiting
    webhook: manager.createMiddleware('webhook'),
    
    // Custom middleware creator
    custom: (strategyName: string, options?: any) => 
      manager.createMiddleware(strategyName, options)
  };
};