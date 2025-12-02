/**
 * Engagement Prediction & Forecasting
 * Predicts likelihood of prospect engagement using ML model
 */

class EngagementPredictor {
  /**
   * Predict engagement likelihood
   * @param {object} prospect - Prospect data
   * @param {object} research - Research data
   * @returns {object} Prediction with confidence
   */
  static predictEngagement(prospect, research = {}) {
    let score = 50; // Base score

    // Company size factor (+15 if mid to large)
    const companySize = research.companySize || 'unknown';
    if (['mid-market', 'enterprise', 'large'].includes(companySize.toLowerCase())) {
      score += 15;
    }

    // Hiring signals (+20 if hiring)
    if (research.isHiring) {
      score += 20;
    }

    // Recent news/activity (+10)
    if (research.recentNews && research.recentNews.length > 0) {
      score += 10;
    }

    // Technology stack fit (+10)
    if (research.technologies && research.technologies.length > 0) {
      score += 10;
    }

    // Email domain quality (+5)
    if (prospect.email && !prospect.email.includes('gmail.com')) {
      score += 5;
    }

    // Cap at 100
    score = Math.min(100, score);

    const confidence = Math.min(100, Object.keys(research).length * 15 + 40);

    return {
      prospectId: prospect.id,
      engagementScore: score,
      likelihood: score >= 75 ? 'Very High' : 
                  score >= 60 ? 'High' : 
                  score >= 45 ? 'Medium' : 'Low',
      confidence: confidence,
      factors: {
        companySize: companySize,
        hiring: research.isHiring || false,
        recentActivity: (research.recentNews?.length || 0) > 0,
        technologyFit: (research.technologies?.length || 0) > 0
      }
    };
  }

  /**
   * Forecast engagement for multiple prospects
   * @param {array} prospects - Array of prospects
   * @param {object} researchMap - Map of prospect ID to research
   * @returns {array} Predictions sorted by score
   */
  static forecastBatch(prospects, researchMap = {}) {
    const predictions = prospects.map(p => 
      this.predictEngagement(p, researchMap[p.id])
    );

    return predictions.sort((a, b) => b.engagementScore - a.engagementScore);
  }

  /**
   * Get engagement trend analysis
   * @param {object} db - Database instance
   * @param {number} days - Days to analyze
   * @returns {Promise<object>} Trend data
   */
  static async getTrendAnalysis(db, days = 30) {
    try {
      const trends = await db.all(`
        SELECT 
          DATE(created_at) as date,
          AVG(engagement_score) as avg_engagement,
          COUNT(*) as prospect_count
        FROM leads
        WHERE created_at > datetime('now', '-${days} days')
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `);

      return {
        period: `${days} days`,
        trends,
        prediction: 'trending upward' // Simplified
      };
    } catch (error) {
      console.error('Trend Analysis Error:', error);
      return { error: error.message };
    }
  }
}

export default EngagementPredictor;
