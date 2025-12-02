/**
 * Query Result Caching Layer
 * Reduces database load by caching frequently-accessed query results
 * with configurable TTL (time-to-live) per cache key
 */

class QueryCache {
  constructor() {
    this.cache = new Map();
    this.timers = new Map();
  }

  /**
   * Get cached value if exists and not expired
   * @param {string} key - Cache key
   * @returns {any|null} Cached value or null if not found/expired
   */
  get(key) {
    if (!this.cache.has(key)) {
      return null;
    }
    const entry = this.cache.get(key);
    if (Date.now() > entry.expiresAt) {
      this.invalidate(key);
      return null;
    }
    return entry.value;
  }

  /**
   * Set cache value with TTL
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} ttlMs - Time-to-live in milliseconds
   */
  set(key, value, ttlMs = 5000) {
    // Clear existing timer if any
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
    }

    // Store value with expiration time
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs
    });

    // Auto-invalidate after TTL
    const timer = setTimeout(() => this.invalidate(key), ttlMs);
    this.timers.set(key, timer);
  }

  /**
   * Invalidate a specific cache entry
   * @param {string} key - Cache key to invalidate
   */
  invalidate(key) {
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }
    this.cache.delete(key);
  }

  /**
   * Invalidate all cache entries matching a pattern
   * @param {string|RegExp} pattern - Pattern to match keys
   */
  invalidatePattern(pattern) {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.invalidate(key);
      }
    }
  }

  /**
   * Clear all cache entries
   */
  clear() {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.cache.clear();
    this.timers.clear();
  }

  /**
   * Get cache statistics
   * @returns {object} Cache stats (size, keys)
   */
  stats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
      memory: this.cache.size > 0 ? 'active' : 'empty'
    };
  }
}

// Singleton instance
const queryCache = new QueryCache();

export default queryCache;
