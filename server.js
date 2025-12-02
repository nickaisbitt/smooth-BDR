/**
 * Deal Forecast & Probability Model
 * Predicts deal closure and revenue forecasting
 */

class DealForecast {
  /**
   * Calculate deal probability
   * @param {object} deal - Deal data
   * @param {object} prospect - Prospect data
   * @param {object} engagement - Engagement data
   * @returns {number} Probability percentage (0-100)
   */
  static calculateProbability(deal, prospect = {}, engagement = {}) {
    let probability = 50;

    const stageFactors = {
      'initial_contact': 10,
      'qualified_lead': 25,
      'proposal': 50,
      'negotiation': 75,
      'closing': 90
    };
    probability = stageFactors[deal.stage] || 50;

    if (engagement.engagementScore > 70) {
      probability += 15;
    } else if (engagement.engagementScore > 50) {
      probability += 10;
    } else if (engagement.engagementScore < 30) {
      probability -= 10;
    }

    const daysInStage = deal.daysInStage || 0;
    if (daysInStage > 30 && deal.stage === 'negotiation') {
      probability -= 5;
    }

    if (prospect.tier === 'VIP') {
      probability += 10;
    } else if (prospect.tier === 'Low') {
      probability -= 5;
    }

    return Math.min(100, Math.max(0, probability));
  }

  /**
   * Forecast revenue
   * @param {array} deals - Array of deals
   * @returns {object} Revenue forecast
   */
  static forecastRevenue(deals) {
    const totalPipeline = deals.reduce((sum, d) => sum + (d.value || 0), 0);
    
    const probabilities = deals.map(d => ({
      dealId: d.id,
      value: d.value || 0,
      probability: d.probability || 50,
      expectedValue: (d.value || 0) * (d.probability || 50) / 100
    }));

    const expectedRevenue = probabilities.reduce((sum, p) => sum + p.expectedValue, 0);
    const bestCase = deals.reduce((sum, d) => sum + (d.value || 0), 0);
    const worstCase = deals.reduce((sum, d) => sum + (d.value || 0) * 0.1, 0);

    return {
      pipeline: totalPipeline.toFixed(2),
      expectedRevenue: expectedRevenue.toFixed(2),
      bestCaseRevenue: bestCase.toFixed(2),
      worstCaseRevenue: worstCase.toFixed(2),
      probabilityWeightedAvg: deals.length > 0 ? (expectedRevenue / deals.length).toFixed(2) : 0,
      deals: probabilities.slice(0, 10)
    };
  }

  /**
   * Identify at-risk deals
   * @param {object} db - Database instance
   * @returns {Promise<array>} At-risk deals
   */
  static async getAtRiskDeals(db) {
    try {
      const atRisk = await db.all(`
        SELECT 
          id,
          company_name,
          deal_value,
          stage,
          days_in_stage,
          probability
        FROM deals
        WHERE (probability < 50 OR days_in_stage > 60)
        ORDER BY probability ASC
        LIMIT 10
      `);

      return atRisk.map(d => ({
        dealId: d.id,
        company: d.company_name,
        value: d.deal_value,
        stage: d.stage,
        daysInStage: d.days_in_stage,
        probability: d.probability,
        riskLevel: d.probability < 30 ? 'high' : 'medium',
        recommendation: d.probability < 30 ? 'Urgent: schedule check-in call' : 'Follow up with prospect'
      }));
    } catch (error) {
      console.error('At-Risk Deals Error:', error);
      return [];
    }
  }

  /**
   * Get monthly forecast
   * @param {object} db - Database instance
   * @param {number} months - Forecast months ahead
   * @returns {Promise<object>} Monthly forecast
   */
  static async getMonthlyForecast(db, months = 3) {
    try {
      const forecast = [];
      for (let i = 0; i < months; i++) {
        const date = new Date();
        date.setMonth(date.getMonth() + i);
        const monthStr = date.toISOString().slice(0, 7);

        const deals = await db.all(
          `SELECT SUM(CAST((deal_value * (probability / 100)) AS FLOAT)) as expected_revenue
           FROM deals WHERE DATE(expected_close_date) LIKE ?`,
          [monthStr + '%']
        );

        forecast.push({
          month: monthStr,
          expectedRevenue: deals[0]?.expected_revenue || 0
        });
      }

      return { forecast };
    } catch (error) {
      console.error('Monthly Forecast Error:', error);
      return { forecast: [] };
    }
  }
}

export default DealForecast;
