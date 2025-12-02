/**
 * AI-Powered Lead Quality Scorer
 * Uses Gemini AI to automatically score lead quality based on research data
 */

class LeadQualityScorer {
  constructor(aiClient) {
    this.aiClient = aiClient;
  }

  /**
   * Score a lead's quality using AI analysis
   * @param {object} prospect - Prospect data
   * @param {object} research - Research data
   * @returns {Promise<object>} Quality score and analysis
   */
  async scoreLeadQuality(prospect, research) {
    const prompt = `Analyze this prospect and provide a quality score (0-100) with reasoning.

Prospect: ${prospect.name || 'Unknown'}
Company: ${prospect.company || 'Unknown'}
Email: ${prospect.email || 'Unknown'}

Research Data:
${research ? `
- Company Size: ${research.companySize || 'Unknown'}
- Industry: ${research.industry || 'Unknown'}
- Revenue: ${research.revenue || 'Unknown'}
- Hiring: ${research.isHiring ? 'Yes - Active Hiring' : 'No hiring activity detected'}
- Technology Stack: ${research.technologies?.join(', ') || 'Unknown'}
- Recent News: ${research.recentNews?.slice(0, 3).join('; ') || 'None found'}
` : 'No research data available'}

Provide JSON response:
{
  "qualityScore": <0-100>,
  "tier": "VIP|High|Medium|Low",
  "strengths": [<list strengths>],
  "concerns": [<list concerns>],
  "recommendations": [<list actions>],
  "likelihood_to_engage": <0-100>
}`;

    try {
      const response = await this.aiClient.generateContent(prompt);
      const text = response.response.text();
      const json = JSON.parse(text);
      
      return {
        prospectId: prospect.id,
        qualityScore: json.qualityScore || 0,
        tier: json.tier || 'Low',
        strengths: json.strengths || [],
        concerns: json.concerns || [],
        recommendations: json.recommendations || [],
        engagementLikelihood: json.likelihood_to_engage || 0,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Lead Quality Scoring Error:', error);
      return {
        prospectId: prospect.id,
        qualityScore: 30,
        tier: 'Low',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Batch score multiple leads
   * @param {array} prospects - Array of prospects
   * @param {object} researchMap - Map of prospect ID to research data
   * @returns {Promise<array>} Scoring results
   */
  async scoreMultipleLeads(prospects, researchMap = {}) {
    const results = [];
    
    for (const prospect of prospects) {
      const research = researchMap[prospect.id] || null;
      const score = await this.scoreLeadQuality(prospect, research);
      results.push(score);
      
      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return results;
  }

  /**
   * Identify high-value leads
   * @param {array} scores - Quality scores from scoreLeadQuality
   * @param {number} threshold - Score threshold (default 70)
   * @returns {array} High-value leads
   */
  filterHighValueLeads(scores, threshold = 70) {
    return scores
      .filter(s => s.qualityScore >= threshold)
      .sort((a, b) => b.qualityScore - a.qualityScore);
  }
}

export default LeadQualityScorer;
