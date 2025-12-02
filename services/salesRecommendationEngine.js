/**
 * Sales Process Recommendation Engine
 * AI-powered recommendations for sales reps on next actions
 */

class SalesRecommendationEngine {
  /**
   * Get AI-powered recommendations for a prospect
   * @param {object} prospect - Prospect data
   * @param {object} engagement - Engagement data
   * @param {object} research - Research data
   * @returns {object} Recommendations with priority and reasoning
   */
  static getProspectRecommendations(prospect, engagement = {}, research = {}) {
    const recommendations = [];

    // Engagement-based recommendations
    if (engagement.lastReplyDaysAgo < 3) {
      recommendations.push({
        priority: 'high',
        action: 'Send immediate follow-up',
        reasoning: 'Hot lead - high engagement signals',
        timing: 'Within 24 hours',
        template: 'follow_up_warm'
      });
    }

    if (research.isHiring && engagement.engagementScore > 60) {
      recommendations.push({
        priority: 'high',
        action: 'Mention growth & hiring plans',
        reasoning: 'Active hiring signals + good engagement',
        timing: 'Next email',
        template: 'hiring_growth'
      });
    }

    if (engagement.engagementScore > 70) {
      recommendations.push({
        priority: 'high',
        action: 'Schedule discovery call',
        reasoning: 'Very high engagement - qualified prospect',
        timing: 'Propose 2-3 times in next email',
        template: 'discovery_call'
      });
    }

    if (engagement.lastContactDaysAgo > 14 && engagement.engagementScore > 50) {
      recommendations.push({
        priority: 'medium',
        action: 'Re-engage with new value prop',
        reasoning: 'Been quiet for 2+ weeks but showed interest',
        timing: 'This week',
        template: 're_engagement'
      });
    }

    if (engagement.engagementScore < 40) {
      recommendations.push({
        priority: 'low',
        action: 'Move to nurture automation',
        reasoning: 'Low engagement - not ready to buy',
        timing: 'Tomorrow',
        template: 'nurture'
      });
    }

    return {
      prospectId: prospect.id,
      prospectName: prospect.name,
      recommendations: recommendations.slice(0, 3), // Top 3
      nextBestAction: recommendations[0] || null,
      confidenceScore: Math.min(95, Object.keys(engagement).length * 20)
    };
  }

  /**
   * Get team-level recommendations
   * @param {object} db - Database instance
   * @returns {Promise<array>} Top recommended actions for team
   */
  static async getTeamRecommendations(db) {
    try {
      // Get high-engagement prospects needing follow-up
      const hotLeads = await db.all(`
        SELECT 
          l.id, l.name, l.company,
          COUNT(em.id) as reply_count,
          AVG(l.engagement_score) as engagement
        FROM leads l
        LEFT JOIN email_messages em ON l.id = em.lead_id
        WHERE l.engagement_score > 70
        AND l.last_contact < datetime('now', '-2 days')
        GROUP BY l.id
        ORDER BY engagement DESC
        LIMIT 10
      `);

      return {
        topRecommendations: hotLeads.map(l => ({
          prospect: l.name,
          company: l.company,
          action: 'Schedule discovery call',
          priority: 'high',
          engagement: l.engagement
        }))
      };
    } catch (error) {
      console.error('Team Recommendations Error:', error);
      return { recommendations: [] };
    }
  }

  /**
   * Get deal stage recommendations
   * @param {object} deal - Deal data
   * @returns {object} Recommendations for moving deal forward
   */
  static getDealRecommendations(deal) {
    const recommendations = [];

    if (deal.stage === 'initial_contact' && deal.daysInStage > 7) {
      recommendations.push({
        action: 'Move to proposal',
        reason: 'Over 7 days in initial contact',
        suggestedProposal: 'Send executive overview deck'
      });
    }

    if (deal.stage === 'proposal' && deal.daysInStage > 14) {
      recommendations.push({
        action: 'Schedule executive meeting',
        reason: 'Proposal pending 2+ weeks',
        suggestedAction: 'Contact champion to schedule C-level call'
      });
    }

    if (deal.stage === 'negotiation' && deal.probability < 30) {
      recommendations.push({
        action: 'Lower price or add value',
        reason: 'Low win probability in negotiation',
        suggestedAction: 'Propose tiered pricing or additional features'
      });
    }

    return { dealId: deal.id, recommendations };
  }
}

export default SalesRecommendationEngine;
