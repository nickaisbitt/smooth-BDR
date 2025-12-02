/**
 * Adaptive Request Rate Throttling
 * Dynamically adjusts rate limits based on real-time system load
 */

class AdaptiveThrottling {
  constructor() {
    this.baseLimit = 60; // requests per minute
    this.maxLimit = 120;
    this.minLimit = 10;
    this.loadThresholds = {
      light: 0.3,
      moderate: 0.6,
      heavy: 0.8,
      critical: 0.95
    };
    this.currentLoad = 0;
    this.adjustmentFactor = 0.9;
  }

  /**
   * Update current system load (0-1)
   * @param {number} load - Load percentage (0-1)
   */
  updateLoad(load) {
    this.currentLoad = Math.min(1, Math.max(0, load));
  }

  /**
   * Get adaptive rate limit based on current load
   * @returns {number} Requests per minute
   */
  getAdaptiveLimit() {
    if (this.currentLoad > this.loadThresholds.critical) {
      return Math.floor(this.baseLimit * 0.5);
    } else if (this.currentLoad > this.loadThresholds.heavy) {
      return Math.floor(this.baseLimit * 0.7);
    } else if (this.currentLoad > this.loadThresholds.moderate) {
      return Math.floor(this.baseLimit * 0.85);
    } else if (this.currentLoad > this.loadThresholds.light) {
      return this.baseLimit;
    } else {
      return Math.floor(this.baseLimit * 1.2);
    }
  }

  /**
   * Calculate throttle delay in milliseconds
   * @returns {number} Delay in ms
   */
  getThrottleDelay() {
    const limit = this.getAdaptiveLimit();
    return Math.floor((60 * 1000) / limit);
  }

  /**
   * Get throttling status
   * @returns {object} Current throttling info
   */
  getStatus() {
    return {
      currentLoad: (this.currentLoad * 100).toFixed(1) + '%',
      adaptiveLimit: this.getAdaptiveLimit(),
      throttleDelayMs: this.getThrottleDelay(),
      throttleState: this.currentLoad > this.loadThresholds.heavy ? 'throttled' : 'normal'
    };
  }
}

const adaptiveThrottling = new AdaptiveThrottling();
export default adaptiveThrottling;
