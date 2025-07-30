// Circuit breaker pattern implementation for fault tolerance
import winston from 'winston';

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN'
}

export interface CircuitBreakerOptions {
  name: string;
  failureThreshold: number;
  resetTimeout: number;
  timeout: number;
  monitor?: (stats: CircuitBreakerStats) => void;
}

export interface CircuitBreakerStats {
  name: string;
  state: CircuitState;
  failures: number;
  successes: number;
  totalRequests: number;
  failureRate: number;
  lastFailureTime?: Date;
  nextAttemptTime?: Date;
}

export class CircuitBreakerError extends Error {
  constructor(message: string, public readonly circuitName: string) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures = 0;
  private successes = 0;
  private totalRequests = 0;
  private lastFailureTime?: Date;
  private nextAttemptTime?: Date;
  private logger: winston.Logger;

  constructor(
    private options: CircuitBreakerOptions,
    logger: winston.Logger
  ) {
    this.logger = logger;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (this.nextAttemptTime && Date.now() < this.nextAttemptTime.getTime()) {
        throw new CircuitBreakerError(
          `Circuit breaker '${this.options.name}' is OPEN`,
          this.options.name
        );
      }
      // Move to half-open state for testing
      this.state = CircuitState.HALF_OPEN;
      this.logger.info(`Circuit breaker '${this.options.name}' moved to HALF_OPEN`);
    }

    this.totalRequests++;
    
    try {
      const result = await this.executeWithTimeout(operation);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private async executeWithTimeout<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Operation timed out after ${this.options.timeout}ms`));
      }, this.options.timeout);

      operation()
        .then(result => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  private onSuccess(): void {
    this.failures = 0;
    this.successes++;
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.CLOSED;
      this.logger.info(`Circuit breaker '${this.options.name}' moved to CLOSED`);
    }

    this.reportStats();
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = new Date();

    if (this.failures >= this.options.failureThreshold) {
      this.state = CircuitState.OPEN;
      this.nextAttemptTime = new Date(Date.now() + this.options.resetTimeout);
      
      this.logger.error(`Circuit breaker '${this.options.name}' opened due to ${this.failures} failures`, {
        nextAttemptTime: this.nextAttemptTime,
        failureThreshold: this.options.failureThreshold
      });
    }

    this.reportStats();
  }

  private reportStats(): void {
    const stats = this.getStats();
    if (this.options.monitor) {
      this.options.monitor(stats);
    }
  }

  getStats(): CircuitBreakerStats {
    const failureRate = this.totalRequests > 0 
      ? (this.failures / this.totalRequests) * 100 
      : 0;

    return {
      name: this.options.name,
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      totalRequests: this.totalRequests,
      failureRate: Math.round(failureRate * 100) / 100,
      lastFailureTime: this.lastFailureTime,
      nextAttemptTime: this.nextAttemptTime
    };
  }

  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.totalRequests = 0;
    this.lastFailureTime = undefined;
    this.nextAttemptTime = undefined;
    
    this.logger.info(`Circuit breaker '${this.options.name}' reset`);
  }

  forceOpen(): void {
    this.state = CircuitState.OPEN;
    this.nextAttemptTime = new Date(Date.now() + this.options.resetTimeout);
    this.logger.warn(`Circuit breaker '${this.options.name}' forced OPEN`);
  }

  forceClose(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.nextAttemptTime = undefined;
    this.logger.warn(`Circuit breaker '${this.options.name}' forced CLOSED`);
  }
}

// Circuit breaker factory with common configurations
export class CircuitBreakerFactory {
  private static circuitBreakers = new Map<string, CircuitBreaker>();

  static create(
    name: string,
    options: Partial<CircuitBreakerOptions>,
    logger: winston.Logger
  ): CircuitBreaker {
    if (this.circuitBreakers.has(name)) {
      return this.circuitBreakers.get(name)!;
    }

    const defaultOptions: CircuitBreakerOptions = {
      name,
      failureThreshold: 5,
      resetTimeout: 60000, // 1 minute
      timeout: 30000, // 30 seconds
      ...options
    };

    const circuitBreaker = new CircuitBreaker(defaultOptions, logger);
    this.circuitBreakers.set(name, circuitBreaker);
    
    return circuitBreaker;
  }

  static get(name: string): CircuitBreaker | undefined {
    return this.circuitBreakers.get(name);
  }

  static getAll(): Map<string, CircuitBreaker> {
    return new Map(this.circuitBreakers);
  }

  static getAllStats(): CircuitBreakerStats[] {
    return Array.from(this.circuitBreakers.values()).map(cb => cb.getStats());
  }

  static resetAll(): void {
    this.circuitBreakers.forEach(cb => cb.reset());
  }
}