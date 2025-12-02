/**
 * System Health Check & Wellness Dashboard
 * Aggregates all system metrics into a comprehensive health report
 */

class HealthCheck {
  /**
   * Get comprehensive system health report
   * @param {object} db - Database instance
   * @param {object} services - System services {telemetry, circuitBreaker, queryCache, deduplicator, retryStrategy, retentionPolicy}
   * @returns {Promise<object>} Complete health report
   */
  static async getSystemWellness(db, services) {
    const {
      telemetry,
      circuitBreaker,
      queryCache,
      deduplicator,
      retryStrategy,
      retentionPolicy
    } = services;

    const now = new Date();
    const health = {
      timestamp: now.toISOString(),
      status: 'healthy',
      components: {}
    };

    // Telemetry health
    const telemetryReport = telemetry.getHealthReport();
    health.components.telemetry = {
      status: telemetryReport.summary.systemHealth,
      metrics: telemetryReport.summary
    };

    // Circuit breaker status
    const cbStatus = circuitBreaker.getStatus();
    const openCircuits = Object.values(cbStatus).filter(s => s.state === 'open').length;
    health.components.circuitBreakers = {
      status: openCircuits === 0 ? 'healthy' : 'degraded',
      openCount: openCircuits,
      circuitBreakers: cbStatus
    };

    // Cache efficiency
    const cacheStats = queryCache.stats();
    health.components.cache = {
      status: cacheStats.size > 0 ? 'active' : 'idle',
      cachedItems: cacheStats.size,
      cacheKeys: cacheStats.keys
    };

    // Deduplication stats
    const dedupStats = deduplicator.stats();
    health.components.deduplication = {
      status: 'active',
      cachedResponses: dedupStats.cached,
      processingRequests: dedupStats.processing
    };

    // Retry configuration
    const retryStats = retryStrategy.stats();
    health.components.retryStrategy = {
      status: 'configured',
      ...retryStats
    };

    // Database health
    try {
      const dbStats = await retentionPolicy.getDatabaseStats(db);
      const totalRecords = Object.values(dbStats).reduce((sum, t) => sum + (t.records || 0), 0);
      health.components.database = {
        status: totalRecords > 0 ? 'healthy' : 'empty',
        totalRecords,
        tables: dbStats
      };
    } catch (error) {
      health.components.database = {
        status: 'error',
        error: error.message
      };
    }

    // Determine overall status
    const statuses = Object.values(health.components).map(c => c.status);
    if (statuses.includes('error')) {
      health.status = 'unhealthy';
    } else if (statuses.includes('degraded')) {
      health.status = 'degraded';
    } else {
      health.status = 'healthy';
    }

    // Add recommendations
    health.recommendations = this.generateRecommendations(health);

    return health;
  }

  /**
   * Generate system recommendations based on health
   * @param {object} health - Health report
   * @returns {array} Recommendations
   */
  static generateRecommendations(health) {
    const recommendations = [];

    // Circuit breaker recommendations
    if (health.components.circuitBreakers?.openCount > 0) {
      recommendations.push({
        priority: 'high',
        component: 'circuitBreakers',
        message: `${health.components.circuitBreakers.openCount} circuit breaker(s) are open. Check service health and monitor recovery.`,
        action: 'Check /api/telemetry/circuit-breakers for details'
      });
    }

    // Cache recommendations
    if (health.components.telemetry?.metrics?.avgLatencyMs > 500) {
      recommendations.push({
        priority: 'medium',
        component: 'performance',
        message: `Average latency is ${health.components.telemetry.metrics.avgLatencyMs}ms. Consider cache optimization.`,
        action: 'Review /api/telemetry/endpoints for slowest endpoints'
      });
    }

    // Error rate recommendations
    if (parseFloat(health.components.telemetry?.metrics?.overallErrorRate) > 5) {
      recommendations.push({
        priority: 'high',
        component: 'errors',
        message: `Error rate is ${health.components.telemetry.metrics.overallErrorRate}%. Investigate error sources.`,
        action: 'Check /api/telemetry/errors for error details'
      });
    }

    // Database size recommendations
    const dbRecords = health.components.database?.totalRecords;
    if (dbRecords > 100000) {
      recommendations.push({
        priority: 'medium',
        component: 'database',
        message: `Database has ${dbRecords} records. Consider running cleanup for archived data.`,
        action: 'Run POST /api/system/cleanup-old-records'
      });
    }

    // Positive feedback
    if (recommendations.length === 0) {
      recommendations.push({
        priority: 'info',
        component: 'system',
        message: 'System is operating optimally. No issues detected.',
        action: 'Monitor system health regularly'
      });
    }

    return recommendations;
  }

  /**
   * Quick health status
   * @param {object} services - System services
   * @returns {object} Quick status
   */
  static quickStatus(services) {
    const { telemetry, circuitBreaker } = services;
    const report = telemetry.getHealthReport();
    const cbStatus = circuitBreaker.getStatus();
    const openCircuits = Object.values(cbStatus).filter(s => s.state === 'open').length;

    return {
      status: report.summary.systemHealth,
      metrics: {
        totalRequests: report.summary.totalCalls,
        errorRate: report.summary.overallErrorRate,
        avgLatency: report.summary.avgLatencyMs,
        circuitsOpen: openCircuits
      }
    };
  }
}

export default HealthCheck;
