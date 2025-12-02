/**
 * Lead Scoring History Tracker
 * Tracks lead score changes over time for trend analysis
 */

class LeadScoringHistory {
  static async getScoreTrend(db, leadId, days = 30) {
    try {
      const trend = await db.all(`
        SELECT DATE(created_at) as date, engagement_score FROM leads 
        WHERE id = ? AND created_at > datetime('now', '-${days} days')
        ORDER BY created_at DESC
      `, [leadId]);

      return { leadId, days, trend };
    } catch (error) {
      return { error: error.message };
    }
  }

  static async getTopImprovingLeads(db, limit = 10) {
    try {
      const leads = await db.all(`
        SELECT id, name, company, engagement_score FROM leads 
        ORDER BY engagement_score DESC LIMIT ?
      `, [limit]);

      return leads;
    } catch (error) {
      return [];
    }
  }
}

export default LeadScoringHistory;
