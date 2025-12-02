/**
 * Segmented Analytics Cache
 * Caches analytics separately by lead tier for faster retrieval
 * Optimized for VIP/High/Medium/Low segmentation
 */

import queryCache from './queryCache.js';

class SegmentedAnalyticsCache {
  constructor() {
    this.tiers = ['vip', 'high', 'medium', 'low'];
    this.cacheTTL = 15000; // 15s for analytics
  }

  /**
   * Get engagement stats by tier
   * @param {object} db - Database instance
   * @param {string} tier - Lead tier (vip/high/medium/low)
   * @returns {Promise<object>} Engagement stats
   */
  async getEngagementByTier(db, tier = 'all') {
    if (tier === 'all') {
      return this.getAllTierStats(db);
    }

    const cacheKey = `analytics:engagement:${tier}`;
    const cached = queryCache.get(cacheKey);
    if (cached) return cached;

    let query = `
      SELECT DISTINCT
        el.to_email as email,
        el.lead_id as id,
        COUNT(DISTINCT eq.id) as emails_sent,
        COUNT(DISTINCT CASE WHEN em.id IS NOT NULL THEN em.id END) as replies_received,
        MAX(em.received_at) as last_activity,
        (COUNT(DISTINCT CASE WHEN em.id IS NOT NULL THEN em.id END) * 40) + 
        (COUNT(DISTINCT eq.id) * 20) as engagement_score
      FROM email_logs el
      LEFT JOIN email_queue eq ON el.lead_id = eq.lead_id
      LEFT JOIN email_messages em ON el.to_email = em.from_email
      WHERE 1=1
    `;

    // Apply tier-specific filters
    if (tier === 'vip') {
      query += ` AND (COUNT(DISTINCT eq.id) >= 5 OR COUNT(DISTINCT CASE WHEN em.id IS NOT NULL THEN em.id END) >= 2)`;
    } else if (tier === 'high') {
      query += ` AND (COUNT(DISTINCT eq.id) >= 3 AND COUNT(DISTINCT eq.id) < 5)`;
    } else if (tier === 'medium') {
      query += ` AND (COUNT(DISTINCT eq.id) >= 1 AND COUNT(DISTINCT eq.id) < 3)`;
    }

    query += ` GROUP BY el.to_email, el.lead_id ORDER BY engagement_score DESC LIMIT 50`;

    const results = await db.all(query);
    const data = { tier, leads: results, count: results.length };
    
    queryCache.set(cacheKey, data, this.cacheTTL);
    return data;
  }

  /**
   * Get all tier statistics in parallel
   * @param {object} db - Database instance
   * @returns {Promise<object>} Stats for all tiers
   */
  async getAllTierStats(db) {
    const cacheKey = 'analytics:engagement:all';
    const cached = queryCache.get(cacheKey);
    if (cached) return cached;

    const [vip, high, medium, low] = await Promise.all([
      this.getEngagementByTier(db, 'vip'),
      this.getEngagementByTier(db, 'high'),
      this.getEngagementByTier(db, 'medium'),
      this.getEngagementByTier(db, 'low')
    ]);

    const data = { vip, high, medium, low };
    queryCache.set(cacheKey, data, this.cacheTTL);
    return data;
  }

  /**
   * Get pipeline metrics by tier
   * @param {object} db - Database instance
   * @returns {Promise<object>} Pipeline breakdown by tier
   */
  async getPipelineByTier(db) {
    const cacheKey = 'analytics:pipeline:byTier';
    const cached = queryCache.get(cacheKey);
    if (cached) return cached;

    const stats = await db.get(`
      SELECT 
        COUNT(CASE WHEN engagement_score >= 70 THEN 1 END) as vip_count,
        COUNT(CASE WHEN engagement_score BETWEEN 40 AND 69 THEN 1 END) as high_count,
        COUNT(CASE WHEN engagement_score BETWEEN 20 AND 39 THEN 1 END) as medium_count,
        COUNT(CASE WHEN engagement_score < 20 THEN 1 END) as low_count
      FROM (
        SELECT 
          (COUNT(DISTINCT CASE WHEN em.id IS NOT NULL THEN em.id END) * 40) + 
          (COUNT(DISTINCT eq.id) * 20) as engagement_score
        FROM email_logs el
        LEFT JOIN email_queue eq ON el.lead_id = eq.lead_id
        LEFT JOIN email_messages em ON el.to_email = em.from_email
        GROUP BY el.lead_id
      )
    `);

    const data = {
      vip: stats?.vip_count || 0,
      high: stats?.high_count || 0,
      medium: stats?.medium_count || 0,
      low: stats?.low_count || 0
    };

    queryCache.set(cacheKey, data, this.cacheTTL);
    return data;
  }

  /**
   * Clear all tier caches
   */
  invalidateAll() {
    for (const tier of this.tiers) {
      queryCache.invalidate(`analytics:engagement:${tier}`);
    }
    queryCache.invalidate('analytics:engagement:all');
    queryCache.invalidate('analytics:pipeline:byTier');
  }
}

const segmentedCache = new SegmentedAnalyticsCache();
export default segmentedCache;
