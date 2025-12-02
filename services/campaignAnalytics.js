/**
 * Campaign Performance Analytics
 * Detailed tracking and analysis of email campaign performance
 */

class CampaignAnalytics {
  /**
   * Calculate campaign performance metrics
   * @param {object} db - Database instance
   * @param {string} campaignId - Campaign identifier
   * @returns {Promise<object>} Performance metrics
   */
  static async getCampaignMetrics(db, campaignId) {
    try {
      const sent = await db.get(
        `SELECT COUNT(*) as count FROM email_logs WHERE campaign_id = ?`,
        [campaignId]
      );

      const replied = await db.get(
        `SELECT COUNT(*) as count FROM email_messages em
         INNER JOIN email_logs el ON em.from_email = el.to_email
         WHERE el.campaign_id = ? AND em.received_at IS NOT NULL`,
        [campaignId]
      );

      const metrics = {
        campaignId,
        sent: sent?.count || 0,
        replied: replied?.count || 0,
        replyRate: sent?.count ? ((replied?.count || 0) / sent.count * 100).toFixed(2) : 0,
        avgResponseTimeHours: 0
      };

      return metrics;
    } catch (error) {
      console.error('Campaign Metrics Error:', error);
      return { error: error.message };
    }
  }

  /**
   * Get A/B test results
   * @param {object} db - Database instance
   * @param {string} variantA - Email subject A
   * @param {string} variantB - Email subject B
   * @returns {Promise<object>} A/B test comparison
   */
  static async getABTestResults(db, variantA, variantB) {
    try {
      const statsA = await db.get(`
        SELECT 
          COUNT(*) as sent,
          SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as delivered
        FROM email_logs 
        WHERE email_subject LIKE ?
      `, [`%${variantA}%`]);

      const statsB = await db.get(`
        SELECT 
          COUNT(*) as sent,
          SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as delivered
        FROM email_logs 
        WHERE email_subject LIKE ?
      `, [`%${variantB}%`]);

      return {
        variantA: {
          subject: variantA,
          sent: statsA?.sent || 0,
          delivered: statsA?.delivered || 0,
          deliveryRate: (statsA?.sent ? (statsA.delivered / statsA.sent * 100).toFixed(2) : 0)
        },
        variantB: {
          subject: variantB,
          sent: statsB?.sent || 0,
          delivered: statsB?.delivered || 0,
          deliveryRate: (statsB?.sent ? (statsB.delivered / statsB.sent * 100).toFixed(2) : 0)
        },
        winner: (statsA?.delivered || 0) > (statsB?.delivered || 0) ? 'A' : 'B'
      };
    } catch (error) {
      console.error('A/B Test Error:', error);
      return { error: error.message };
    }
  }

  /**
   * Get campaign timeline
   * @param {object} db - Database instance
   * @param {string} campaignId - Campaign identifier
   * @returns {Promise<array>} Timeline events
   */
  static async getCampaignTimeline(db, campaignId) {
    try {
      const events = await db.all(`
        SELECT 
          'email_sent' as event_type,
          sent_at as timestamp,
          COUNT(*) as count
        FROM email_logs
        WHERE campaign_id = ? AND status = 'sent'
        GROUP BY DATE(sent_at)
        ORDER BY sent_at DESC
        LIMIT 30
      `, [campaignId]);

      return events;
    } catch (error) {
      console.error('Timeline Error:', error);
      return [];
    }
  }

  /**
   * Analyze industry performance
   * @param {object} db - Database instance
   * @param {string} industry - Industry name
   * @returns {Promise<object>} Industry stats
   */
  static async getIndustryPerformance(db, industry) {
    try {
      const stats = await db.get(`
        SELECT
          COUNT(*) as total_prospects,
          COUNT(CASE WHEN last_reply IS NOT NULL THEN 1 END) as engaged,
          AVG(engagement_score) as avg_engagement
        FROM leads
        WHERE industry = ?
      `, [industry]);

      return {
        industry,
        totalProspects: stats?.total_prospects || 0,
        engaged: stats?.engaged || 0,
        engagementRate: (stats?.total_prospects 
          ? (stats.engaged / stats.total_prospects * 100).toFixed(2) 
          : 0),
        avgEngagementScore: stats?.avg_engagement || 0
      };
    } catch (error) {
      console.error('Industry Performance Error:', error);
      return { error: error.message };
    }
  }
}

export default CampaignAnalytics;
