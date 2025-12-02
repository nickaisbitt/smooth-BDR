/**
 * Email Template Performance Tracking
 * Analyze and optimize email template effectiveness
 */

class TemplatePerformance {
  /**
   * Get template performance metrics
   * @param {object} db - Database instance
   * @param {string} templateId - Template identifier
   * @returns {Promise<object>} Performance data
   */
  static async getTemplateMetrics(db, templateId) {
    try {
      const sent = await db.get(
        `SELECT COUNT(*) as count FROM email_logs WHERE template_id = ?`,
        [templateId]
      );

      const replied = await db.get(
        `SELECT COUNT(*) as count FROM email_messages em
         INNER JOIN email_logs el ON em.from_email = el.to_email
         WHERE el.template_id = ? AND em.received_at IS NOT NULL`,
        [templateId]
      );

      const avgEngagement = await db.get(
        `SELECT AVG(engagement_score) as avg_score FROM leads l
         INNER JOIN email_logs el ON l.id = el.lead_id
         WHERE el.template_id = ?`,
        [templateId]
      );

      return {
        templateId,
        sent: sent?.count || 0,
        replied: replied?.count || 0,
        replyRate: sent?.count ? ((replied?.count || 0) / sent.count * 100).toFixed(2) : 0,
        avgEngagementScore: avgEngagement?.avg_score || 0
      };
    } catch (error) {
      console.error('Template Metrics Error:', error);
      return { error: error.message };
    }
  }

  /**
   * Rank templates by performance
   * @param {object} db - Database instance
   * @returns {Promise<array>} Ranked templates
   */
  static async rankTemplates(db) {
    try {
      const templates = await db.all(`
        SELECT 
          template_id,
          COUNT(*) as sent,
          SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) as replied,
          AVG(engagement_score) as avg_engagement
        FROM email_logs
        GROUP BY template_id
        ORDER BY (CAST(SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*)) DESC
      `);

      return templates.map((t, idx) => ({
        rank: idx + 1,
        templateId: t.template_id,
        sent: t.sent,
        replied: t.replied,
        replyRate: (t.replied / t.sent * 100).toFixed(2),
        avgEngagement: t.avg_engagement,
        recommendation: idx === 0 ? 'Top performer' : idx < 3 ? 'Strong' : 'Consider optimization'
      }));
    } catch (error) {
      console.error('Template Ranking Error:', error);
      return [];
    }
  }

  /**
   * Get template recommendations
   * @param {object} db - Database instance
   * @returns {Promise<object>} Recommendations
   */
  static async getRecommendations(db) {
    try {
      const topTemplate = await db.get(`
        SELECT 
          template_id,
          COUNT(*) as sent,
          CAST(SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) as reply_rate
        FROM email_logs
        GROUP BY template_id
        ORDER BY reply_rate DESC
        LIMIT 1
      `);

      const worstTemplate = await db.get(`
        SELECT 
          template_id,
          COUNT(*) as sent,
          CAST(SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) as reply_rate
        FROM email_logs
        GROUP BY template_id
        HAVING COUNT(*) > 5
        ORDER BY reply_rate ASC
        LIMIT 1
      `);

      return {
        recommendations: [
          {
            type: 'best_practice',
            message: `Template ${topTemplate?.template_id} has ${(topTemplate?.reply_rate * 100).toFixed(1)}% reply rate`,
            action: 'Use this template as basis for new variations'
          },
          {
            type: 'optimization',
            message: `Template ${worstTemplate?.template_id} underperforming at ${(worstTemplate?.reply_rate * 100).toFixed(1)}% reply rate`,
            action: 'Redesign subject line, opening, or call-to-action'
          }
        ]
      };
    } catch (error) {
      console.error('Recommendations Error:', error);
      return { recommendations: [] };
    }
  }

  /**
   * Analyze template variants
   * @param {object} db - Database instance
   * @returns {Promise<object>} Variant analysis
   */
  static async analyzeVariants(db) {
    try {
      const variants = await db.all(`
        SELECT 
          email_subject,
          COUNT(*) as sent,
          SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) as replied,
          AVG(engagement_score) as avg_engagement
        FROM email_logs
        GROUP BY email_subject
        ORDER BY (CAST(SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*)) DESC
        LIMIT 10
      `);

      return {
        topVariants: variants.map(v => ({
          subject: v.email_subject,
          sent: v.sent,
          replied: v.replied,
          replyRate: (v.replied / v.sent * 100).toFixed(2),
          avgEngagement: v.avg_engagement
        }))
      };
    } catch (error) {
      console.error('Variant Analysis Error:', error);
      return { topVariants: [] };
    }
  }
}

export default TemplatePerformance;
