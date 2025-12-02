/**
 * Circuit Breaker Pattern Implementation
 * Prevents cascading failures by stopping requests to failing services
 * Automatically recovers when service health improves
 */

class CircuitBreaker {
  constructor(options = {}) {
    this.circuitBreakers = new Map();
    this.defaultConfig = {
      failureThreshold: options.failureThreshold || 5,
      successThreshold: options.successThreshold || 2,
      timeout: options.timeout || 60000, // 60s timeout to half-open
      resetTimeout: options.resetTimeout || 30000 // 30s to try recovery
    };
  }

  /**
   * Get or create circuit breaker for a key
   * @param {string} key - Circuit breaker identifier
   * @param {object} config - Optional configuration override
   * @returns {object} Circuit breaker instance
   */
  getBreaker(key, config = {}) {
    const fullConfig = { ...this.defaultConfig, ...config };

    if (!this.circuitBreakers.has(key)) {
      this.circuitBreakers.set(key, {
        state: 'closed',
        failureCount: 0,
        successCount: 0,
        lastFailureTime: null,
        lastTrialTime: null,
        config: fullConfig
      });
    }

    return this.circuitBreakers.get(key);
  }

  /**
   * Execute function with circuit breaker protection
   * @param {string} key - Circuit breaker identifier
   * @param {function} fn - Function to execute
   * @param {object} config - Optional configuration
   * @returns {Promise} Function result or error
   */
  async execute(key, fn, config = {}) {
    const breaker = this.getBreaker(key, config);

    // Check if circuit should open
    if (breaker.state === 'open') {
      const timeSinceFailure = Date.now() - (breaker.lastFailureTime || 0);
      if (timeSinceFailure > breaker.config.timeout) {
        // Attempt recovery
        breaker.state = 'half-open';
        breaker.successCount = 0;
      } else {
        throw new Error(`Circuit breaker [${key}] is OPEN. Service unavailable.`);
      }
    }

    try {
      const result = await fn();

      // Record success
      if (breaker.state === 'half-open') {
        breaker.successCount++;
        if (breaker.successCount >= breaker.config.successThreshold) {
          breaker.state = 'closed';
          breaker.failureCount = 0;
          breaker.successCount = 0;
        }
      } else if (breaker.state === 'closed') {
        breaker.failureCount = 0;
      }

      return result;
    } catch (error) {
      breaker.failureCount++;
      breaker.lastFailureTime = Date.now();

      // Open circuit if threshold exceeded
      if (breaker.failureCount >= breaker.config.failureThreshold) {
        breaker.state = 'open';
        console.error(`⚠️ Circuit Breaker [${key}] OPENED after ${breaker.failureCount} failures`);
      }

      throw error;
    }
  }

  /**
   * Get state of all circuit breakers
   * @returns {object} Circuit breaker states
   */
  getStatus() {
    const status = {};
    for (const [key, breaker] of this.circuitBreakers.entries()) {
      status[key] = {
        state: breaker.state,
        failureCount: breaker.failureCount,
        successCount: breaker.successCount,
        lastFailure: breaker.lastFailureTime ? new Date(breaker.lastFailureTime).toISOString() : null
      };
    }
    return status;
  }

  /**
   * Manually reset a circuit breaker
   * @param {string} key - Circuit breaker identifier
   */
  reset(key) {
    if (this.circuitBreakers.has(key)) {
      const breaker = this.circuitBreakers.get(key);
      breaker.state = 'closed';
      breaker.failureCount = 0;
      breaker.successCount = 0;
      breaker.lastFailureTime = null;
    }
  }

  /**
   * Reset all circuit breakers
   */
  resetAll() {
    for (const breaker of this.circuitBreakers.values()) {
      breaker.state = 'closed';
      breaker.failureCount = 0;
      breaker.successCount = 0;
      breaker.lastFailureTime = null;
    }
  }

  /**
   * Clear all circuit breakers
   */
  clear() {
    this.circuitBreakers.clear();
  }
}

const circuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 60000
});

export default circuitBreaker;
