// Comprehensive metrics collection and monitoring system
import winston from 'winston';
import { EventEmitter } from 'events';

export interface MetricPoint {
  timestamp: number;
  value: number;
  labels?: Record<string, string>;
}

export interface HistogramBucket {
  le: number; // Less than or equal to
  count: number;
}

export interface HistogramMetric {
  count: number;
  sum: number;
  buckets: HistogramBucket[];
}

export interface CounterMetric {
  value: number;
  labels?: Record<string, string>;
}

export interface GaugeMetric {
  value: number;
  timestamp: number;
  labels?: Record<string, string>;
}

export interface MetricsSnapshot {
  counters: Record<string, CounterMetric>;
  gauges: Record<string, GaugeMetric>;
  histograms: Record<string, HistogramMetric>;
  timestamp: number;
}

export class MetricsCollector extends EventEmitter {
  private counters: Map<string, CounterMetric> = new Map();
  private gauges: Map<string, GaugeMetric> = new Map();
  private histograms: Map<string, HistogramMetric> = new Map();
  private logger: winston.Logger;
  
  // Default histogram buckets for response times (milliseconds)
  private static readonly DEFAULT_BUCKETS = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
  
  constructor(logger: winston.Logger) {
    super();
    this.logger = logger;
  }

  // Counter methods
  incrementCounter(name: string, value: number = 1, labels?: Record<string, string>): void {
    const key = this.getMetricKey(name, labels);
    const existing = this.counters.get(key);
    
    if (existing) {
      existing.value += value;
    } else {
      this.counters.set(key, { value, labels });
    }
    
    this.emit('metric', { type: 'counter', name, value, labels });
  }

  getCounter(name: string, labels?: Record<string, string>): number {
    const key = this.getMetricKey(name, labels);
    return this.counters.get(key)?.value || 0;
  }

  // Gauge methods
  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.getMetricKey(name, labels);
    const timestamp = Date.now();
    
    this.gauges.set(key, { value, timestamp, labels });
    this.emit('metric', { type: 'gauge', name, value, labels, timestamp });
  }

  incrementGauge(name: string, value: number = 1, labels?: Record<string, string>): void {
    const key = this.getMetricKey(name, labels);
    const existing = this.gauges.get(key);
    const newValue = (existing?.value || 0) + value;
    
    this.setGauge(name, newValue, labels);
  }

  decrementGauge(name: string, value: number = 1, labels?: Record<string, string>): void {
    this.incrementGauge(name, -value, labels);
  }

  getGauge(name: string, labels?: Record<string, string>): number {
    const key = this.getMetricKey(name, labels);
    return this.gauges.get(key)?.value || 0;
  }

  // Histogram methods
  observeHistogram(name: string, value: number, labels?: Record<string, string>, buckets?: number[]): void {
    const key = this.getMetricKey(name, labels);
    const bucketsToUse = buckets || MetricsCollector.DEFAULT_BUCKETS;
    
    let histogram = this.histograms.get(key);
    if (!histogram) {
      histogram = {
        count: 0,
        sum: 0,
        buckets: bucketsToUse.map(le => ({ le, count: 0 }))
      };
      this.histograms.set(key, histogram);
    }
    
    histogram.count++;
    histogram.sum += value;
    
    // Update bucket counts
    for (const bucket of histogram.buckets) {
      if (value <= bucket.le) {
        bucket.count++;
      }
    }
    
    this.emit('metric', { type: 'histogram', name, value, labels });
  }

  getHistogram(name: string, labels?: Record<string, string>): HistogramMetric | undefined {
    const key = this.getMetricKey(name, labels);
    return this.histograms.get(key);
  }

  // Timing utility
  time<T>(name: string, fn: () => T, labels?: Record<string, string>): T;
  time<T>(name: string, fn: () => Promise<T>, labels?: Record<string, string>): Promise<T>;
  time<T>(name: string, fn: () => T | Promise<T>, labels?: Record<string, string>): T | Promise<T> {
    const start = Date.now();
    
    try {
      const result = fn();
      
      if (result instanceof Promise) {
        return result
          .then(res => {
            this.observeHistogram(name, Date.now() - start, labels);
            return res;
          })
          .catch(err => {
            this.observeHistogram(name, Date.now() - start, { ...labels, error: 'true' });
            throw err;
          });
      } else {
        this.observeHistogram(name, Date.now() - start, labels);
        return result;
      }
    } catch (error) {
      this.observeHistogram(name, Date.now() - start, { ...labels, error: 'true' });
      throw error;
    }
  }

  // Timer helper class
  startTimer(name: string, labels?: Record<string, string>): Timer {
    return new Timer(this, name, labels);
  }

  // Reset all metrics
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.logger.info('Metrics reset');
  }

  // Get snapshot of all metrics
  getSnapshot(): MetricsSnapshot {
    const counters: Record<string, CounterMetric> = {};
    const gauges: Record<string, GaugeMetric> = {};
    const histograms: Record<string, HistogramMetric> = {};

    for (const [key, value] of this.counters.entries()) {
      counters[key] = { ...value };
    }

    for (const [key, value] of this.gauges.entries()) {
      gauges[key] = { ...value };
    }

    for (const [key, value] of this.histograms.entries()) {
      histograms[key] = {
        count: value.count,
        sum: value.sum,
        buckets: value.buckets.map(b => ({ ...b }))
      };
    }

    return {
      counters,
      gauges,
      histograms,
      timestamp: Date.now()
    };
  }

  // Export metrics in Prometheus format
  toPrometheusFormat(): string {
    const lines: string[] = [];
    const timestamp = Date.now();

    // Export counters
    for (const [key, metric] of this.counters.entries()) {
      const name = this.extractMetricName(key);
      const labelsStr = this.formatLabels(metric.labels);
      lines.push(`# TYPE ${name} counter`);
      lines.push(`${name}${labelsStr} ${metric.value} ${timestamp}`);
    }

    // Export gauges
    for (const [key, metric] of this.gauges.entries()) {
      const name = this.extractMetricName(key);
      const labelsStr = this.formatLabels(metric.labels);
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${name}${labelsStr} ${metric.value} ${metric.timestamp}`);
    }

    // Export histograms
    for (const [key, histogram] of this.histograms.entries()) {
      const name = this.extractMetricName(key);
      const labels = this.extractLabels(key);
      
      lines.push(`# TYPE ${name} histogram`);
      
      // Export buckets
      for (const bucket of histogram.buckets) {
        const bucketLabels = { ...labels, le: bucket.le.toString() };
        const labelsStr = this.formatLabels(bucketLabels);
        lines.push(`${name}_bucket${labelsStr} ${bucket.count} ${timestamp}`);
      }
      
      // Export sum and count
      const labelsStr = this.formatLabels(labels);
      lines.push(`${name}_sum${labelsStr} ${histogram.sum} ${timestamp}`);
      lines.push(`${name}_count${labelsStr} ${histogram.count} ${timestamp}`);
    }

    return lines.join('\n');
  }

  private getMetricKey(name: string, labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) {
      return name;
    }
    
    const sortedLabels = Object.keys(labels)
      .sort()
      .map(key => `${key}="${labels[key]}"`)
      .join(',');
    
    return `${name}{${sortedLabels}}`;
  }

  private extractMetricName(key: string): string {
    const bracketIndex = key.indexOf('{');
    return bracketIndex === -1 ? key : key.substring(0, bracketIndex);
  }

  private extractLabels(key: string): Record<string, string> {
    const bracketIndex = key.indexOf('{');
    if (bracketIndex === -1) {
      return {};
    }
    
    const labelsStr = key.substring(bracketIndex + 1, key.length - 1);
    const labels: Record<string, string> = {};
    
    if (labelsStr) {
      const pairs = labelsStr.split(',');
      for (const pair of pairs) {
        const [key, value] = pair.split('=');
        labels[key] = value.replace(/"/g, '');
      }
    }
    
    return labels;
  }

  private formatLabels(labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) {
      return '';
    }
    
    const labelPairs = Object.keys(labels)
      .sort()
      .map(key => `${key}="${labels[key]}"`)
      .join(',');
    
    return `{${labelPairs}}`;
  }
}

export class Timer {
  private startTime: number;
  private metrics: MetricsCollector;
  private name: string;
  private labels?: Record<string, string>;

  constructor(metrics: MetricsCollector, name: string, labels?: Record<string, string>) {
    this.startTime = Date.now();
    this.metrics = metrics;
    this.name = name;
    this.labels = labels;
  }

  end(additionalLabels?: Record<string, string>): number {
    const duration = Date.now() - this.startTime;
    const finalLabels = { ...this.labels, ...additionalLabels };
    this.metrics.observeHistogram(this.name, duration, finalLabels);
    return duration;
  }
}

// Pre-configured metrics collector for the validator service
export class ValidatorMetrics {
  private collector: MetricsCollector;
  private logger: winston.Logger;

  constructor(logger: winston.Logger) {
    this.logger = logger;
    this.collector = new MetricsCollector(logger);
    this.setupDefaultMetrics();
  }

  private setupDefaultMetrics(): void {
    // Initialize common metrics
    this.collector.setGauge('validator_service_start_time', Date.now());
    this.collector.setGauge('validator_service_version', 1, { version: process.env.npm_package_version || '1.0.0' });
  }

  // Database metrics
  recordDatabaseQuery(duration: number, operation: string, success: boolean): void {
    this.collector.observeHistogram('database_query_duration_ms', duration, {
      operation,
      success: success.toString()
    });
    this.collector.incrementCounter('database_queries_total', 1, {
      operation,
      success: success.toString()
    });
  }

  recordDatabaseConnection(active: number, idle: number, waiting: number): void {
    this.collector.setGauge('database_connections_active', active);
    this.collector.setGauge('database_connections_idle', idle);
    this.collector.setGauge('database_connections_waiting', waiting);
  }

  // Blockchain metrics
  recordRpcRequest(network: string, duration: number, success: boolean): void {
    this.collector.observeHistogram('rpc_request_duration_ms', duration, {
      network,
      success: success.toString()
    });
    this.collector.incrementCounter('rpc_requests_total', 1, {
      network,
      success: success.toString()
    });
  }

  recordBlockProcessing(network: string, blockNumber: number, transactionCount: number): void {
    this.collector.setGauge('latest_processed_block', blockNumber, { network });
    this.collector.incrementCounter('transactions_processed_total', transactionCount, { network });
  }

  // Service metrics
  recordWalletCount(network: string, count: number): void {
    this.collector.setGauge('monitored_wallets', count, { network });
  }

  recordEventProcessing(eventType: string, duration: number, success: boolean): void {
    this.collector.observeHistogram('event_processing_duration_ms', duration, {
      event_type: eventType,
      success: success.toString()
    });
    this.collector.incrementCounter('events_processed_total', 1, {
      event_type: eventType,
      success: success.toString()
    });
  }

  recordAlert(priority: string, type: string): void {
    this.collector.incrementCounter('alerts_generated_total', 1, {
      priority,
      type
    });
  }

  recordNotification(channel: string, success: boolean): void {
    this.collector.incrementCounter('notifications_sent_total', 1, {
      channel,
      success: success.toString()
    });
  }

  // HTTP metrics
  recordHttpRequest(method: string, path: string, statusCode: number, duration: number): void {
    this.collector.observeHistogram('http_request_duration_ms', duration, {
      method,
      path,
      status_code: statusCode.toString()
    });
    this.collector.incrementCounter('http_requests_total', 1, {
      method,
      path,
      status_code: statusCode.toString()
    });
  }

  // Rate limiting metrics
  recordRateLimit(network: string, limited: boolean): void {
    this.collector.incrementCounter('rate_limit_events_total', 1, {
      network,
      limited: limited.toString()
    });
  }

  // Circuit breaker metrics
  recordCircuitBreakerState(name: string, state: string): void {
    this.collector.setGauge('circuit_breaker_state', state === 'closed' ? 0 : state === 'half_open' ? 1 : 2, {
      circuit_breaker: name,
      state
    });
  }

  // System metrics
  recordMemoryUsage(): void {
    const usage = process.memoryUsage();
    this.collector.setGauge('nodejs_memory_heap_used_bytes', usage.heapUsed);
    this.collector.setGauge('nodejs_memory_heap_total_bytes', usage.heapTotal);
    this.collector.setGauge('nodejs_memory_external_bytes', usage.external);
    this.collector.setGauge('nodejs_memory_rss_bytes', usage.rss);
  }

  recordCpuUsage(): void {
    const usage = process.cpuUsage();
    this.collector.setGauge('nodejs_cpu_user_microseconds', usage.user);
    this.collector.setGauge('nodejs_cpu_system_microseconds', usage.system);
  }

  // Exposed collector methods
  getCollector(): MetricsCollector {
    return this.collector;
  }

  getSnapshot(): MetricsSnapshot {
    return this.collector.getSnapshot();
  }

  toPrometheusFormat(): string {
    return this.collector.toPrometheusFormat();
  }

  reset(): void {
    this.collector.reset();
    this.setupDefaultMetrics();
  }
}

// Singleton instance
let validatorMetrics: ValidatorMetrics | null = null;

export const getValidatorMetrics = (logger?: winston.Logger): ValidatorMetrics => {
  if (!validatorMetrics) {
    if (!logger) {
      throw new Error('Logger is required for the first call to getValidatorMetrics');
    }
    validatorMetrics = new ValidatorMetrics(logger);
  }
  return validatorMetrics;
};