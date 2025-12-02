/**
 * Campaign ROI Analysis
 * Calculates return on investment for campaigns
 */

class CampaignROI {
  static async calculateROI(db, campaignId) {
    try {
      const sent = await db.get(`SELECT COUNT(*) as count FROM email_logs WHERE campaign_id = ?`, [campaignId]);
      const replied = await db.get(`SELECT COUNT(*) as count FROM email_messages WHERE campaign_id IS NOT NULL AND id > 0`);
      
      return {
        campaignId,
        emailsSent: sent?.count || 0,
        repliesReceived: replied?.count || 0,
        replyRate: sent?.count ? ((replied?.count || 0) / sent.count * 100).toFixed(2) : 0
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  static async getEfficiencyMetrics(db) {
    try {
      const metrics = await db.get(`
        SELECT 
          COUNT(*) as total_emails,
          SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) as total_replies
        FROM email_logs
      `);

      return {
        totalEmailsSent: metrics?.total_emails || 0,
        totalReplies: metrics?.total_replies || 0,
        overallReplyRate: metrics?.total_emails ? ((metrics.total_replies || 0) / metrics.total_emails * 100).toFixed(2) : 0
      };
    } catch (error) {
      return { error: error.message };
    }
  }
}

export default CampaignROI;
