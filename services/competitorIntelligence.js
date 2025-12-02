/**
 * Competitive Intelligence Tracking
 * Monitors competitors and market positioning
 */

class CompetitorIntelligence {
  /**
   * Get competitive landscape for a prospect
   * @param {object} db - Database instance
   * @param {string} leadId - Lead ID
   * @returns {Promise<object>} Competitive analysis
   */
  static async getCompetitiveLandscape(db, leadId) {
    try {
      const prospect = await db.get('SELECT * FROM leads WHERE id = ?', [leadId]);
      const competitors = await db.all(`
        SELECT DISTINCT company FROM leads WHERE industry = ? AND id != ?
      `, [prospect.industry, leadId]);

      return {
        prospectId: leadId,
        prospectCompany: prospect.company,
        industry: prospect.industry,
        competitorCount: competitors.length,
        competitors: competitors.map(c => c.company),
        marketPosition: competitors.length > 5 ? 'Fragmented' : 'Consolidating',
        recommendation: competitors.length > 5 ? 
          'Many competitors - differentiate on value' : 
          'Few competitors - focus on market capture'
      };
    } catch (error) {
      console.error('Competitive Landscape Error:', error);
      return { error: error.message };
    }
  }

  /**
   * Find market opportunities
   * @param {object} db - Database instance
   * @returns {Promise<array>} Market opportunities
   */
  static async findMarketOpportunities(db) {
    try {
      const opportunities = await db.all(`
        SELECT 
          industry,
          COUNT(DISTINCT company) as company_count,
          AVG(engagement_score) as avg_engagement,
          COUNT(CASE WHEN engagement_score > 70 THEN 1 END) as hot_leads
        FROM leads
        GROUP BY industry
        ORDER BY avg_engagement DESC
        LIMIT 10
      `);

      return opportunities.map(o => ({
        industry: o.industry,
        companies: o.company_count,
        avgEngagement: o.avg_engagement.toFixed(1),
        hotLeads: o.hot_leads,
        opportunity: o.hot_leads > 3 ? 'High' : o.hot_leads > 1 ? 'Medium' : 'Low',
        recommendation: o.hot_leads > 3 ? 'Focus sales effort here' : 'Secondary opportunity'
      }));
    } catch (error) {
      console.error('Market Opportunities Error:', error);
      return [];
    }
  }
}

export default CompetitorIntelligence;
