/**
 * Smart Retry Strategy with Exponential Backoff
 * Intelligently retries failed operations with adaptive backoff
 */

class SmartRetryStrategy {
  constructor() {
    this.maxRetries = 5;
    this.baseDelay = 1000; // 1s base delay
    this.maxDelay = 60000; // 60s max delay
    this.jitter = true;
  }

  /**
   * Calculate exponential backoff delay
   * @param {number} attempt - Attempt number (0-based)
   * @returns {number} Delay in milliseconds
   */
  calculateDelay(attempt) {
    let delay = this.baseDelay * Math.pow(2, attempt);
    
    // Apply jitter to prevent thundering herd
    if (this.jitter) {
      delay = delay * (0.5 + Math.random() * 0.5);
    }
    
    return Math.min(delay, this.maxDelay);
  }

  /**
   * Determine if error is retryable
   * @param {Error} error - Error to check
   * @returns {boolean} True if retryable
   */
  isRetryable(error) {
    if (!error) return false;
    
    const retryableErrors = [
      'ECONNREFUSED',
      'ECONNRESET',
      'ETIMEDOUT',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'EMFILE',
      'ENFILE',
      '429', // Too Many Requests
      '503', // Service Unavailable
      '504'  // Gateway Timeout
    ];

    const errorStr = error.toString().toUpperCase();
    return retryableErrors.some(err => errorStr.includes(err));
  }

  /**
   * Execute function with smart retry
   * @param {function} fn - Async function to execute
   * @param {object} options - Retry options
   * @returns {Promise} Function result
   */
  async executeWithRetry(fn, options = {}) {
    const maxRetries = options.maxRetries || this.maxRetries;
    const onRetry = options.onRetry || (() => {});
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if (attempt === maxRetries || !this.isRetryable(error)) {
          throw error;
        }

        const delay = this.calculateDelay(attempt);
        onRetry({ attempt, delay, error: error.message });
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Batch retry operations
   * @param {array} operations - Array of {id, fn} operations
   * @returns {Promise<object>} Results with successful/failed
   */
  async batchRetry(operations) {
    const results = {
      successful: [],
      failed: []
    };

    for (const { id, fn } of operations) {
      try {
        const result = await this.executeWithRetry(fn);
        results.successful.push({ id, result });
      } catch (error) {
        results.failed.push({ id, error: error.message });
      }
    }

    return results;
  }

  /**
   * Get retry statistics
   * @returns {object} Current configuration
   */
  stats() {
    return {
      maxRetries: this.maxRetries,
      baseDelay: this.baseDelay,
      maxDelay: this.maxDelay,
      jitterEnabled: this.jitter
    };
  }
}

const retryStrategy = new SmartRetryStrategy();
export default retryStrategy;
