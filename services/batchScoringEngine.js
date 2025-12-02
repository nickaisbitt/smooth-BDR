/**
 * Prospect Batch Scoring Engine
 * Efficiently score multiple leads in parallel with caching
 */

class BatchScoringEngine {
  constructor(aiClient, cache) {
    this.aiClient = aiClient;
    this.cache = cache;
    this.batchSize = 10;
  }

  /**
   * Score multiple prospects in batches
   * @param {array} prospects - Array of prospects
   * @param {object} researchMap - Map of ID to research data
   * @returns {Promise<array>} Scored prospects
   */
  async scoreProspectBatch(prospects, researchMap = {}) {
    const results = [];
    const batches = this.chunkArray(prospects, this.batchSize);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchResults = await Promise.all(
        batch.map(p => this.scoreProspect(p, researchMap[p.id]))
      );
      results.push(...batchResults);
      
      // Delay between batches to avoid rate limiting
      if (i < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    return results;
  }

  /**
   * Score individual prospect
   * @param {object} prospect - Prospect data
   * @param {object} research - Research data
   * @returns {Promise<object>} Score result
   */
  async scoreProspect(prospect, research) {
    const cacheKey = `score:${prospect.id}`;
    const cached = this.cache?.get(cacheKey);
    if (cached) return cached;

    const data = {
      prospectId: prospect.id,
      name: prospect.name,
      company: prospect.company,
      score: Math.random() * 40 + 60, // Placeholder
      tier: 'Medium',
      timestamp: new Date().toISOString()
    };

    this.cache?.set(cacheKey, data, 3600000);
    return data;
  }

  /**
   * Get batch scoring statistics
   * @param {array} scores - Scored prospects
   * @returns {object} Statistics
   */
  getBatchStats(scores) {
    const vipCount = scores.filter(s => s.score >= 80).length;
    const highCount = scores.filter(s => s.score >= 60 && s.score < 80).length;
    const mediumCount = scores.filter(s => s.score >= 40 && s.score < 60).length;
    const lowCount = scores.filter(s => s.score < 40).length;

    const totalScore = scores.reduce((sum, s) => sum + s.score, 0);

    return {
      totalProspects: scores.length,
      tierDistribution: {
        vip: vipCount,
        high: highCount,
        medium: mediumCount,
        low: lowCount
      },
      averageScore: (totalScore / scores.length).toFixed(1),
      topProspects: scores.slice(0, 5).map(s => ({
        name: s.name,
        company: s.company,
        score: s.score
      }))
    };
  }

  /**
   * Chunk array for batch processing
   * @param {array} arr - Array to chunk
   * @param {number} size - Chunk size
   * @returns {array} Chunked array
   */
  chunkArray(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }
}

export default BatchScoringEngine;
