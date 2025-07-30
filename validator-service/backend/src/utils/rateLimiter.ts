// Enhanced rate limiting implementation with multiple strategies
import winston from 'winston';

export interface RateLimiterConfig {
  requestsPerSecond: number;
  requestsPerMinute: number;
  requestsPerHour?: number;
  burstSize?: number;
  backoffMultiplier: number;
  maxBackoffTime: number;
  strategy?: 'sliding_window' | 'token_bucket' | 'fixed_window';
}

export interface RateLimiterStats {
  requestsLastSecond: number;
  requestsLastMinute: number;
  requestsLastHour: number;
  consecutiveErrors: number;
  backoffUntil: number;
  tokensRemaining?: number;
  nextRefillTime?: number;
  totalRequests: number;
  totalRateLimited: number;
}

export class RateLimiter {
  private config: RateLimiterConfig;
  private logger: winston.Logger;
  private requestTimes: number[] = [];
  private backoffUntil: number = 0;
  private consecutiveErrors: number = 0;
  private totalRequests: number = 0;
  private totalRateLimited: number = 0;
  
  // Token bucket specific properties
  private tokens: number;
  private lastRefillTime: number;
  
  constructor(config: RateLimiterConfig, logger: winston.Logger) {
    this.config = {
      strategy: 'sliding_window',
      burstSize: config.requestsPerSecond * 10, // Allow burst of 10x per-second rate
      requestsPerHour: config.requestsPerMinute * 60,
      ...config
    };
    this.logger = logger;
    
    // Initialize token bucket
    this.tokens = this.config.burstSize!;
    this.lastRefillTime = Date.now();
  }

  async waitForRateLimit(): Promise<void> {
    this.totalRequests++;
    
    const now = Date.now();
    
    // Check if we're in backoff period due to errors
    if (now < this.backoffUntil) {
      const waitTime = this.backoffUntil - now;
      this.logger.debug(`Rate limiter: backing off for ${waitTime}ms due to consecutive errors`);
      this.totalRateLimited++;
      await this.sleep(waitTime);
      return this.waitForRateLimit();
    }
    
    // Apply rate limiting strategy
    switch (this.config.strategy) {
      case 'token_bucket':
        await this.tokenBucketLimit();
        break;
      case 'fixed_window':
        await this.fixedWindowLimit();
        break;
      case 'sliding_window':
      default:
        await this.slidingWindowLimit();
        break;
    }
  }
  
  private async slidingWindowLimit(): Promise<void> {
    const now = Date.now();
    
    // Clean old request times
    this.cleanOldRequests();
    
    // Check per-second limit
    const recentRequests = this.requestTimes.filter(time => now - time < 1000).length;
    if (recentRequests >= this.config.requestsPerSecond) {
      const oldestInSecond = this.requestTimes.find(time => now - time < 1000)!;
      const waitTime = 1000 - (now - oldestInSecond) + 10; // Add 10ms buffer
      
      this.logger.debug(`Rate limiter: waiting ${waitTime}ms for per-second limit (${recentRequests}/${this.config.requestsPerSecond})`);
      this.totalRateLimited++;
      await this.sleep(waitTime);
      return this.slidingWindowLimit();
    }
    
    // Check per-minute limit
    const minuteRequests = this.requestTimes.filter(time => now - time < 60000).length;
    if (minuteRequests >= this.config.requestsPerMinute) {
      const oldestInMinute = this.requestTimes.find(time => now - time < 60000)!;
      const waitTime = 60000 - (now - oldestInMinute) + 100; // Add 100ms buffer
      
      this.logger.debug(`Rate limiter: waiting ${waitTime}ms for per-minute limit (${minuteRequests}/${this.config.requestsPerMinute})`);
      this.totalRateLimited++;
      await this.sleep(waitTime);
      return this.slidingWindowLimit();
    }
    
    // Check per-hour limit if configured
    if (this.config.requestsPerHour) {
      const hourRequests = this.requestTimes.filter(time => now - time < 3600000).length;
      if (hourRequests >= this.config.requestsPerHour) {
        const oldestInHour = this.requestTimes.find(time => now - time < 3600000)!;
        const waitTime = 3600000 - (now - oldestInHour) + 1000; // Add 1s buffer
        
        this.logger.debug(`Rate limiter: waiting ${waitTime}ms for per-hour limit (${hourRequests}/${this.config.requestsPerHour})`);
        this.totalRateLimited++;
        await this.sleep(waitTime);
        return this.slidingWindowLimit();
      }
    }
    
    // Record this request
    this.requestTimes.push(now);
  }
  
  private async tokenBucketLimit(): Promise<void> {
    const now = Date.now();
    
    // Refill tokens based on time passed
    this.refillTokens(now);
    
    // If no tokens available, wait
    if (this.tokens < 1) {
      const timeToNextToken = 1000 / this.config.requestsPerSecond;
      this.logger.debug(`Rate limiter: waiting ${timeToNextToken}ms for token refill`);
      this.totalRateLimited++;
      await this.sleep(timeToNextToken);
      return this.tokenBucketLimit();
    }
    
    // Consume a token
    this.tokens--;
    this.requestTimes.push(now);
  }
  
  private async fixedWindowLimit(): Promise<void> {
    const now = Date.now();
    const windowStart = Math.floor(now / 1000) * 1000; // Current second window
    const minuteWindowStart = Math.floor(now / 60000) * 60000; // Current minute window
    
    // Count requests in current windows
    const secondRequests = this.requestTimes.filter(time => time >= windowStart).length;
    const minuteRequests = this.requestTimes.filter(time => time >= minuteWindowStart).length;
    
    if (secondRequests >= this.config.requestsPerSecond) {
      const waitTime = 1000 - (now - windowStart) + 10;
      this.logger.debug(`Rate limiter: waiting ${waitTime}ms for next second window`);
      this.totalRateLimited++;
      await this.sleep(waitTime);
      return this.fixedWindowLimit();
    }
    
    if (minuteRequests >= this.config.requestsPerMinute) {
      const waitTime = 60000 - (now - minuteWindowStart) + 100;
      this.logger.debug(`Rate limiter: waiting ${waitTime}ms for next minute window`);
      this.totalRateLimited++;
      await this.sleep(waitTime);
      return this.fixedWindowLimit();
    }
    
    this.requestTimes.push(now);
  }
  
  private refillTokens(now: number): void {
    const timePassed = now - this.lastRefillTime;
    const tokensToAdd = (timePassed / 1000) * this.config.requestsPerSecond;
    
    this.tokens = Math.min(this.config.burstSize!, this.tokens + tokensToAdd);
    this.lastRefillTime = now;
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
  }

  onRequestSuccess(): void {
    this.consecutiveErrors = 0;
    this.backoffUntil = 0;
    
    // this.logger.debug('Rate limiter: request succeeded, resetting error count'); // Too verbose
  }
  
  onRequestError(error?: Error): void {
    this.consecutiveErrors++;
    
    // Calculate exponential backoff with jitter
    const baseBackoffTime = 1000 * Math.pow(this.config.backoffMultiplier, this.consecutiveErrors - 1);
    const jitter = Math.random() * 0.2 * baseBackoffTime; // 20% jitter
    const backoffTime = Math.min(baseBackoffTime + jitter, this.config.maxBackoffTime);
    
    this.backoffUntil = Date.now() + backoffTime;
    
    this.logger.warn(`Rate limiter: backing off for ${backoffTime.toFixed(0)}ms after ${this.consecutiveErrors} consecutive errors`, {
      error: error?.message,
      consecutiveErrors: this.consecutiveErrors,
      backoffTime: backoffTime.toFixed(0)
    });
  }
  
  reset(): void {
    this.requestTimes = [];
    this.consecutiveErrors = 0;
    this.backoffUntil = 0;
    this.tokens = this.config.burstSize!;
    this.lastRefillTime = Date.now();
    this.totalRequests = 0;
    this.totalRateLimited = 0;
    
    this.logger.info('Rate limiter reset');
  }
  
  private cleanOldRequests(): void {
    const cutoff = Date.now() - 3600000; // Keep last hour
    const oldLength = this.requestTimes.length;
    this.requestTimes = this.requestTimes.filter(time => time > cutoff);
    
    if (this.requestTimes.length < oldLength) {
      this.logger.debug(`Cleaned ${oldLength - this.requestTimes.length} old request timestamps`);
    }
  }

  getStats(): RateLimiterStats {
    const now = Date.now();
    this.cleanOldRequests();
    
    const stats: RateLimiterStats = {
      requestsLastSecond: this.requestTimes.filter(time => now - time < 1000).length,
      requestsLastMinute: this.requestTimes.filter(time => now - time < 60000).length,
      requestsLastHour: this.requestTimes.filter(time => now - time < 3600000).length,
      consecutiveErrors: this.consecutiveErrors,
      backoffUntil: this.backoffUntil,
      totalRequests: this.totalRequests,
      totalRateLimited: this.totalRateLimited
    };
    
    // Add token bucket specific stats
    if (this.config.strategy === 'token_bucket') {
      this.refillTokens(now);
      stats.tokensRemaining = Math.floor(this.tokens);
      stats.nextRefillTime = this.lastRefillTime + (1000 / this.config.requestsPerSecond);
    }
    
    return stats;
  }
  
  updateConfig(newConfig: Partial<RateLimiterConfig>): void {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...newConfig };
    
    // Reset token bucket if burst size changed
    if (newConfig.burstSize && newConfig.burstSize !== oldConfig.burstSize) {
      this.tokens = this.config.burstSize;
    }
    
    this.logger.info('Rate limiter configuration updated', {
      oldConfig,
      newConfig: this.config
    });
  }
  
  // Get current rate limiting status
  canMakeRequest(): boolean {
    const now = Date.now();
    
    // Check backoff
    if (now < this.backoffUntil) {
      return false;
    }
    
    // Check rate limits based on strategy
    switch (this.config.strategy) {
      case 'token_bucket':
        this.refillTokens(now);
        return this.tokens >= 1;
        
      case 'sliding_window':
      default:
        this.cleanOldRequests();
        const recentRequests = this.requestTimes.filter(time => now - time < 1000).length;
        return recentRequests < this.config.requestsPerSecond;
    }
  }
  
  // Get time until next request can be made
  getTimeUntilNextRequest(): number {
    const now = Date.now();
    
    // If in backoff, return backoff time
    if (now < this.backoffUntil) {
      return this.backoffUntil - now;
    }
    
    if (this.canMakeRequest()) {
      return 0;
    }
    
    // Calculate based on strategy
    switch (this.config.strategy) {
      case 'token_bucket':
        return 1000 / this.config.requestsPerSecond;
        
      case 'sliding_window':
      default:
        const oldestRecent = this.requestTimes.find(time => now - time < 1000);
        return oldestRecent ? 1000 - (now - oldestRecent) + 10 : 0;
    }
  }
}