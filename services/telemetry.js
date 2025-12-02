/**
 * Request Telemetry & Performance Monitoring Service
 * Tracks request latency, error rates, queue trends, and agent performance
 * Enables real-time observability into system health and bottlenecks
 */

class TelemetryService {
  constructor() {
    this.requests = [];
    this.endpoints = new Map();
    this.errors = new Map();
    this.maxEntries = 1000;
    this.windowMs = 3600000; // 1 hour
  }

  /**
   * Record incoming request
   * @param {string} path - Request path
   * @param {string} method - HTTP method
   */
  recordRequest(path, method) {
    return {
      path,
      method,
      startTime: Date.now(),
      
      complete: (statusCode, duration, error = null) => {
        this.recordMetric(path, method, statusCode, duration, error);
      }
    };
  }

  /**
   * Record request metric
   * @param {string} path - Request path
   * @param {string} method - HTTP method
   * @param {number} statusCode - HTTP status code
   * @param {number} duration - Request duration in ms
   * @param {Error} error - Error if any
   */
  recordMetric(path, method, statusCode, duration, error = null) {
    const key = `${method} ${path}`;
    const now = Date.now();

    // Initialize endpoint stats if needed
    if (!this.endpoints.has(key)) {
      this.endpoints.set(key, {
        calls: 0,
        totalDuration: 0,
        minDuration: Infinity,
        maxDuration: 0,
        errors: 0,
        lastCalled: now
      });
    }

    const stats = this.endpoints.get(key);
    stats.calls++;
    stats.totalDuration += duration;
    stats.minDuration = Math.min(stats.minDuration, duration);
    stats.maxDuration = Math.max(stats.maxDuration, duration);
    stats.lastCalled = now;

    if (statusCode >= 400) {
      stats.errors++;
      
      const errorKey = `${statusCode} ${path}`;
      if (!this.errors.has(errorKey)) {
        this.errors.set(errorKey, { count: 0, lastError: null });
      }
      this.errors.get(errorKey).count++;
      if (error) {
        this.errors.get(errorKey).lastError = error.message;
      }
    }

    // Keep requests history capped
    this.requests.push({
      endpoint: key,
      statusCode,
      duration,
      timestamp: now,
      error: error ? error.message : null
    });

    if (this.requests.length > this.maxEntries) {
      this.requests.shift();
    }
  }

  /**
   * Get aggregate metrics for all endpoints
   * @returns {object} Aggregated metrics
   */
  getAggregateMetrics() {
    const now = Date.now();
    const metrics = {};

    for (const [endpoint, stats] of this.endpoints.entries()) {
      const recentRequests = this.requests.filter(
        r => r.endpoint === endpoint && (now - r.timestamp) < this.windowMs
      );

      metrics[endpoint] = {
        totalCalls: stats.calls,
        recentCalls: recentRequests.length,
        avgDuration: stats.calls > 0 ? Math.round(stats.totalDuration / stats.calls) : 0,
        minDuration: stats.minDuration === Infinity ? 0 : stats.minDuration,
        maxDuration: stats.maxDuration,
        errorCount: stats.errors,
        errorRate: stats.calls > 0 ? Math.round((stats.errors / stats.calls) * 100) : 0,
        lastCalled: new Date(stats.lastCalled).toISOString(),
        health: stats.errors === 0 ? 'healthy' : (stats.errors / stats.calls < 0.1 ? 'degraded' : 'unhealthy')
      };
    }

    return metrics;
  }

  /**
   * Get error summary
   * @returns {object} Error statistics
   */
  getErrorSummary() {
    const errors = {};
    for (const [key, data] of this.errors.entries()) {
      errors[key] = {
        count: data.count,
        lastError: data.lastError
      };
    }
    return errors;
  }

  /**
   * Get slowest endpoints (performance bottlenecks)
   * @param {number} limit - Number of endpoints to return
   * @returns {array} Sorted endpoints by avg duration
   */
  getSlowestEndpoints(limit = 10) {
    return Array.from(this.endpoints.entries())
      .map(([endpoint, stats]) => ({
        endpoint,
        avgDuration: stats.calls > 0 ? Math.round(stats.totalDuration / stats.calls) : 0,
        calls: stats.calls,
        errorRate: stats.calls > 0 ? (stats.errors / stats.calls * 100).toFixed(1) : 0
      }))
      .sort((a, b) => b.avgDuration - a.avgDuration)
      .slice(0, limit);
  }

  /**
   * Get most error-prone endpoints
   * @param {number} limit - Number of endpoints to return
   * @returns {array} Sorted endpoints by error rate
   */
  getMostErrorProne(limit = 10) {
    return Array.from(this.endpoints.entries())
      .filter(([, stats]) => stats.errors > 0)
      .map(([endpoint, stats]) => ({
        endpoint,
        errorCount: stats.errors,
        totalCalls: stats.calls,
        errorRate: ((stats.errors / stats.calls) * 100).toFixed(1)
      }))
      .sort((a, b) => parseFloat(b.errorRate) - parseFloat(a.errorRate))
      .slice(0, limit);
  }

  /**
   * Get recent requests (last N)
   * @param {number} limit - Number of requests to return
   * @returns {array} Recent requests
   */
  getRecentRequests(limit = 50) {
    return this.requests
      .slice(-limit)
      .reverse()
      .map(r => ({
        ...r,
        timestamp: new Date(r.timestamp).toISOString()
      }));
  }

  /**
   * Clear all telemetry data
   */
  clear() {
    this.requests = [];
    this.endpoints.clear();
    this.errors.clear();
  }

  /**
   * Get comprehensive health report
   * @returns {object} Full system health
   */
  getHealthReport() {
    const metrics = this.getAggregateMetrics();
    const slowest = this.getSlowestEndpoints(5);
    const errorProne = this.getMostErrorProne(5);
    
    const totalCalls = Array.from(this.endpoints.values()).reduce((sum, s) => sum + s.calls, 0);
    const totalErrors = Array.from(this.endpoints.values()).reduce((sum, s) => sum + s.errors, 0);
    const avgLatency = Array.from(this.endpoints.values())
      .reduce((sum, s) => sum + (s.calls > 0 ? s.totalDuration / s.calls : 0), 0) / 
      Math.max(this.endpoints.size, 1);

    return {
      summary: {
        totalEndpoints: this.endpoints.size,
        totalCalls,
        totalErrors,
        overallErrorRate: totalCalls > 0 ? ((totalErrors / totalCalls) * 100).toFixed(1) : 0,
        avgLatencyMs: Math.round(avgLatency),
        systemHealth: totalErrors / Math.max(totalCalls, 1) < 0.05 ? 'healthy' : 'degraded'
      },
      slowestEndpoints: slowest,
      mostErrorProne: errorProne,
      endpointMetrics: metrics
    };
  }
}

const telemetry = new TelemetryService();

export default telemetry;
