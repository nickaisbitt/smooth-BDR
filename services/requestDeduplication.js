/**
 * Request Deduplication Service
 * Prevents duplicate concurrent requests from executing multiple times
 * Uses request fingerprinting to detect and cache identical operations
 */

import crypto from 'crypto';

class RequestDeduplicator {
  constructor() {
    this.cache = new Map();
    this.processing = new Map();
  }

  /**
   * Generate fingerprint for request deduplication
   * @param {string} method - HTTP method
   * @param {string} path - Request path
   * @param {object} body - Request body
   * @returns {string} Unique fingerprint
   */
  generateFingerprint(method, path, body = {}) {
    const combined = `${method}:${path}:${JSON.stringify(body)}`;
    return crypto.createHash('sha256').update(combined).digest('hex');
  }

  /**
   * Get cached response for fingerprint
   * @param {string} fingerprint - Request fingerprint
   * @returns {object|null} Cached response or null
   */
  getCachedResponse(fingerprint) {
    if (!this.cache.has(fingerprint)) {
      return null;
    }

    const entry = this.cache.get(fingerprint);
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(fingerprint);
      return null;
    }

    return {
      ...entry.response,
      isPending: this.processing.has(fingerprint)
    };
  }

  /**
   * Cache response from processed request
   * @param {string} fingerprint - Request fingerprint
   * @param {object} response - Response data
   * @param {number} ttlMs - Time-to-live in milliseconds
   */
  cacheResponse(fingerprint, response, ttlMs = 30000) {
    this.cache.set(fingerprint, {
      response,
      expiresAt: Date.now() + ttlMs,
      cachedAt: Date.now()
    });

    // Clean up processing marker
    this.processing.delete(fingerprint);

    // Auto-expire after TTL
    setTimeout(() => {
      this.cache.delete(fingerprint);
    }, ttlMs);
  }

  /**
   * Mark request as currently processing
   * @param {string} fingerprint - Request fingerprint
   */
  markProcessing(fingerprint) {
    this.processing.set(fingerprint, {
      startedAt: Date.now(),
      resolvers: []
    });
  }

  /**
   * Wait for concurrent request to complete
   * @param {string} fingerprint - Request fingerprint
   * @returns {Promise<object>} Response when request completes
   */
  async waitForProcessing(fingerprint) {
    return new Promise((resolve) => {
      const entry = this.processing.get(fingerprint);
      if (entry) {
        entry.resolvers.push(resolve);

        // Timeout after 5 minutes
        setTimeout(() => {
          resolve(null);
        }, 300000);
      } else {
        resolve(null);
      }
    });
  }

  /**
   * Notify all waiters that processing is complete
   * @param {string} fingerprint - Request fingerprint
   * @param {object} response - Response data
   */
  notifyComplete(fingerprint, response) {
    const entry = this.processing.get(fingerprint);
    if (entry && entry.resolvers.length > 0) {
      entry.resolvers.forEach(resolve => resolve(response));
    }
  }

  /**
   * Get deduplication statistics
   * @returns {object} Statistics
   */
  stats() {
    return {
      cached: this.cache.size,
      processing: this.processing.size,
      keys: Array.from(this.cache.keys()).slice(0, 10)
    };
  }
}

const deduplicator = new RequestDeduplicator();

export default deduplicator;
