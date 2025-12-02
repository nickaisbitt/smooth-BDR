/**
 * Predictive Queue Management
 * Analyzes queue patterns and optimizes processing order
 */

class QueueOptimizer {
  constructor() {
    this.queueMetrics = {};
    this.priorityScores = {};
  }

  /**
   * Analyze queue and suggest optimal processing order
   * @param {array} items - Queue items with priority, retries, age
   * @returns {array} Sorted items by priority
   */
  optimizeQueue(items) {
    return items.sort((a, b) => {
      // Priority 1: High-value items (VIP prospects)
      if (a.tier !== b.tier) {
        const tierScore = { vip: 4, high: 3, medium: 2, low: 1 };
        return (tierScore[b.tier] || 0) - (tierScore[a.tier] || 0);
      }

      // Priority 2: Items with fewer retries first
      if (a.retries !== b.retries) {
        return a.retries - b.retries;
      }

      // Priority 3: Older items first (FIFO for equal priority)
      return a.timestamp - b.timestamp;
    });
  }

  /**
   * Calculate priority score for item
   * @param {object} item - Queue item
   * @returns {number} Priority score (0-100)
   */
  calculatePriorityScore(item) {
    let score = 50;

    // Tier bonus
    const tierBonus = { vip: 30, high: 20, medium: 10, low: 0 };
    score += tierBonus[item.tier] || 0;

    // Age penalty: older items get priority
    const ageMinutes = (Date.now() - item.timestamp) / 60000;
    score += Math.min(20, ageMinutes / 10);

    // Retry penalty: items with retries get boosted
    score -= item.retries * 5;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Get queue performance metrics
   * @param {array} queue - Queue items
   * @returns {object} Performance stats
   */
  getMetrics(queue) {
    const totalItems = queue.length;
    const tierCounts = {
      vip: queue.filter(i => i.tier === 'vip').length,
      high: queue.filter(i => i.tier === 'high').length,
      medium: queue.filter(i => i.tier === 'medium').length,
      low: queue.filter(i => i.tier === 'low').length
    };

    const avgAge = queue.length > 0
      ? queue.reduce((sum, i) => sum + (Date.now() - i.timestamp), 0) / queue.length / 60000
      : 0;

    return {
      totalItems,
      tierBreakdown: tierCounts,
      averageAgeMinutes: Math.round(avgAge),
      estProcessingTimeMinutes: Math.ceil(totalItems * 0.25)
    };
  }

  /**
   * Recommend next item to process
   * @param {array} queue - Queue items
   * @returns {object} Recommended item or null
   */
  getNextOptimal(queue) {
    if (queue.length === 0) return null;
    const optimized = this.optimizeQueue([...queue]);
    return optimized[0];
  }
}

const queueOptimizer = new QueueOptimizer();
export default queueOptimizer;
