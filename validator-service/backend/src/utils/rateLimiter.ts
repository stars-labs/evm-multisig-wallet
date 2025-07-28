// Rate limiter for blockchain RPC requests
import winston from 'winston';

export interface RateLimiterConfig {
  requestsPerSecond: number;
  requestsPerMinute: number;
  backoffMultiplier: number;
  maxBackoffTime: number;
}

export class RateLimiter {
  private requestTimestamps: number[] = [];
  private backoffTime: number = 0;
  private lastRequestTime: number = 0;
  private consecutiveErrors: number = 0;
  private logger: winston.Logger;
  private config: RateLimiterConfig;

  constructor(config: RateLimiterConfig, logger: winston.Logger) {
    this.config = config;
    this.logger = logger;
  }

  async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    
    // Apply backoff if we have consecutive errors
    if (this.backoffTime > 0) {
      const timeSinceLastRequest = now - this.lastRequestTime;
      if (timeSinceLastRequest < this.backoffTime) {
        const waitTime = this.backoffTime - timeSinceLastRequest;
        this.logger.debug(`Rate limiter: waiting ${waitTime}ms due to backoff`);
        await this.sleep(waitTime);
      }
    }

    // Clean old timestamps (older than 1 minute)
    this.requestTimestamps = this.requestTimestamps.filter(
      timestamp => now - timestamp < 60000
    );

    // Check per-minute limit
    if (this.requestTimestamps.length >= this.config.requestsPerMinute) {
      const oldestRequest = Math.min(...this.requestTimestamps);
      const waitTime = 60000 - (now - oldestRequest) + 100; // Add 100ms buffer
      this.logger.debug(`Rate limiter: waiting ${waitTime}ms for per-minute limit`);
      await this.sleep(waitTime);
    }

    // Check per-second limit
    const recentRequests = this.requestTimestamps.filter(
      timestamp => now - timestamp < 1000
    );
    
    if (recentRequests.length >= this.config.requestsPerSecond) {
      const waitTime = 1000 + 100; // Wait 1 second + buffer
      this.logger.debug(`Rate limiter: waiting ${waitTime}ms for per-second limit`);
      await this.sleep(waitTime);
    }

    // Record this request
    this.requestTimestamps.push(Date.now());
    this.lastRequestTime = Date.now();
  }

  onRequestSuccess(): void {
    // Reset backoff on successful request
    this.consecutiveErrors = 0;
    this.backoffTime = 0;
  }

  onRequestError(error: any): void {
    this.consecutiveErrors++;
    
    // Check if it's a rate limit error
    const isRateLimitError = this.isRateLimitError(error);
    
    if (isRateLimitError || this.consecutiveErrors >= 3) {
      // Exponential backoff
      const baseBackoff = isRateLimitError ? 5000 : 1000; // 5s for rate limit, 1s for other errors
      this.backoffTime = Math.min(
        baseBackoff * Math.pow(this.config.backoffMultiplier, this.consecutiveErrors - 1),
        this.config.maxBackoffTime
      );
      
      this.logger.warn(`Rate limiter: applying ${this.backoffTime}ms backoff after ${this.consecutiveErrors} consecutive errors`, {
        isRateLimitError,
        error: error.message
      });
    }
  }

  private isRateLimitError(error: any): boolean {
    const errorMessage = error.message?.toLowerCase() || '';
    const errorCode = error.code;
    
    // Common rate limit indicators
    return (
      errorCode === 429 ||
      errorMessage.includes('rate limit') ||
      errorMessage.includes('too many requests') ||
      errorMessage.includes('quota') ||
      errorMessage.includes('throttle') ||
      errorCode === -32005 || // Some providers use this for rate limiting
      errorCode === -32000    // Generic error that sometimes indicates rate limiting
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getStats(): {
    requestsInLastMinute: number;
    requestsInLastSecond: number;
    backoffTime: number;
    consecutiveErrors: number;
  } {
    const now = Date.now();
    return {
      requestsInLastMinute: this.requestTimestamps.filter(t => now - t < 60000).length,
      requestsInLastSecond: this.requestTimestamps.filter(t => now - t < 1000).length,
      backoffTime: this.backoffTime,
      consecutiveErrors: this.consecutiveErrors
    };
  }
}