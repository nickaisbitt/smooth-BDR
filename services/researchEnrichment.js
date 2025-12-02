/**
 * Advanced Research Enrichment
 * Enhanced data gathering for prospects with multiple strategies
 */

class ResearchEnrichment {
  constructor() {
    this.enrichmentStrategies = [
      'technology_stack',
      'funding_info',
      'hiring_signals',
      'executive_team',
      'recent_achievements',
      'customer_base',
      'partnerships',
      'product_info'
    ];
  }

  /**
   * Enrich prospect with multiple data sources
   * @param {object} prospect - Prospect data
   * @param {object} existingResearch - Existing research data
   * @returns {object} Enriched prospect data
   */
  enrichProspect(prospect, existingResearch = {}) {
    const enriched = {
      ...prospect,
      enrichment: {
        timestamp: new Date().toISOString(),
        sources: [],
        data: {}
      }
    };

    // Technology stack enrichment
    if (existingResearch.technologies) {
      enriched.enrichment.data.technologies = existingResearch.technologies;
      enriched.enrichment.sources.push('technology_stack');
    }

    // Funding information
    if (existingResearch.fundingStage) {
      enriched.enrichment.data.fundingStage = existingResearch.fundingStage;
      enriched.enrichment.data.fundedAmount = existingResearch.fundedAmount;
      enriched.enrichment.sources.push('funding_info');
    }

    // Hiring signals
    if (existingResearch.isHiring !== undefined) {
      enriched.enrichment.data.isHiring = existingResearch.isHiring;
      enriched.enrichment.data.openPositions = existingResearch.openPositions || [];
      enriched.enrichment.sources.push('hiring_signals');
    }

    // Executive team
    if (existingResearch.executives) {
      enriched.enrichment.data.executives = existingResearch.executives;
      enriched.enrichment.sources.push('executive_team');
    }

    // Recent achievements
    if (existingResearch.recentNews) {
      enriched.enrichment.data.recentNews = existingResearch.recentNews;
      enriched.enrichment.sources.push('recent_achievements');
    }

    // Calculate enrichment completeness score
    enriched.enrichment.completenessScore = (
      enriched.enrichment.sources.length / this.enrichmentStrategies.length * 100
    ).toFixed(1);

    return enriched;
  }

  /**
   * Get enrichment recommendations
   * @param {object} enrichedProspect - Enriched prospect data
   * @returns {array} Recommended enrichments
   */
  getEnrichmentRecommendations(enrichedProspect) {
    const recommendations = [];
    const existingSources = enrichedProspect.enrichment.sources;

    for (const strategy of this.enrichmentStrategies) {
      if (!existingSources.includes(strategy)) {
        recommendations.push({
          strategy,
          priority: this.getStrategyPriority(strategy),
          estimated_value: this.getStrategyValue(strategy)
        });
      }
    }

    return recommendations.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get strategy priority score
   * @param {string} strategy - Strategy name
   * @returns {number} Priority (0-10)
   */
  getStrategyPriority(strategy) {
    const priorities = {
      'hiring_signals': 10,
      'funding_info': 9,
      'executive_team': 8,
      'technology_stack': 7,
      'recent_achievements': 6,
      'customer_base': 5,
      'partnerships': 4,
      'product_info': 3
    };
    return priorities[strategy] || 5;
  }

  /**
   * Get estimated value of enrichment strategy
   * @param {string} strategy - Strategy name
   * @returns {string} Value description
   */
  getStrategyValue(strategy) {
    const values = {
      'hiring_signals': 'high - indicates growth phase',
      'funding_info': 'high - shows financial health',
      'executive_team': 'medium - helps personalization',
      'technology_stack': 'medium - identifies technical fit',
      'recent_achievements': 'medium - conversation starter',
      'customer_base': 'low - contextual information',
      'partnerships': 'low - relationship intelligence',
      'product_info': 'low - positioning context'
    };
    return values[strategy] || 'unknown';
  }

  /**
   * Score enrichment quality
   * @param {object} enrichedProspect - Enriched prospect
   * @returns {object} Quality assessment
   */
  scoreEnrichmentQuality(enrichedProspect) {
    const score = parseFloat(enrichedProspect.enrichment.completenessScore);
    const tier = score >= 80 ? 'excellent' : 
                 score >= 60 ? 'good' : 
                 score >= 40 ? 'fair' : 'poor';

    return {
      completenessScore: score,
      tier,
      sourceCount: enrichedProspect.enrichment.sources.length,
      totalStrategies: this.enrichmentStrategies.length,
      recommendation: tier === 'excellent' ? 'Ready for outreach' : 
                     tier === 'good' ? 'Consider additional research' :
                     tier === 'fair' ? 'Additional enrichment recommended' :
                     'Enrichment needed before outreach'
    };
  }
}

const researchEnrichment = new ResearchEnrichment();
export default researchEnrichment;
