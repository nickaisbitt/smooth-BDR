/**
 * Outreach Sequence Optimizer
 * Optimizes timing and cadence of follow-ups for maximum engagement
 */

class OutreachSequencer {
  constructor() {
    this.defaultSequence = [
      { step: 1, name: 'Initial Outreach', delayHours: 0 },
      { step: 2, name: 'Follow-up', delayHours: 48 },
      { step: 3, name: 'Second Follow-up', delayHours: 96 },
      { step: 4, name: 'Third Follow-up', delayHours: 168 }
    ];
  }

  /**
   * Generate personalized sequence for prospect
   * @param {object} prospect - Prospect data
   * @param {object} research - Research data
   * @returns {array} Optimized sequence
   */
  generateSequence(prospect, research = {}) {
    const sequence = JSON.parse(JSON.stringify(this.defaultSequence));

    // Adjust sequence based on prospect tier
    if (research.companySize === 'enterprise') {
      // More patient with enterprise
      sequence[1].delayHours = 72;
      sequence[2].delayHours = 144;
      sequence[3].delayHours = 240;
    } else if (research.companySize === 'startup') {
      // More aggressive with startups
      sequence[1].delayHours = 24;
      sequence[2].delayHours = 72;
      sequence[3].delayHours = 120;
    }

    // Add specific times based on business hours
    sequence.forEach(step => {
      step.scheduledTime = this.getOptimalTime(step.delayHours);
      step.timezone = prospect.timezone || 'America/New_York';
    });

    return sequence;
  }

  /**
   * Calculate optimal send time
   * @param {number} delayHours - Hours from now
   * @returns {string} ISO timestamp
   */
  getOptimalTime(delayHours) {
    const date = new Date();
    date.setHours(date.getHours() + delayHours);
    
    // Adjust to business hours (9 AM)
    if (date.getHours() < 9 || date.getHours() > 17) {
      date.setHours(9);
    }

    return date.toISOString();
  }

  /**
   * Recommend next action for prospect
   * @param {object} prospect - Prospect data
   * @param {number} daysSinceLastEmail - Days since last contact
   * @returns {object} Recommendation
   */
  recommendNextAction(prospect, daysSinceLastEmail) {
    if (daysSinceLastEmail === 0) {
      return {
        action: 'wait',
        message: 'Email sent today, wait before follow-up',
        suggestedDays: 2
      };
    } else if (daysSinceLastEmail === 2) {
      return {
        action: 'follow_up',
        message: 'Send first follow-up',
        urgency: 'high'
      };
    } else if (daysSinceLastEmail === 4) {
      return {
        action: 'follow_up',
        message: 'Send second follow-up',
        urgency: 'medium'
      };
    } else if (daysSinceLastEmail >= 7) {
      return {
        action: 'final_follow_up',
        message: 'Final follow-up or move to nurture list',
        urgency: 'low'
      };
    }

    return {
      action: 'monitor',
      message: 'Monitor for replies'
    };
  }

  /**
   * Get sequence analytics
   * @param {object} db - Database instance
   * @returns {Promise<object>} Sequence performance stats
   */
  static async getSequenceAnalytics(db) {
    try {
      const performance = await db.get(`
        SELECT
          COUNT(*) as total_sequences,
          SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) as successful,
          AVG(days_to_reply) as avg_days_to_reply
        FROM outreach_sequences
      `);

      return {
        totalSequences: performance?.total_sequences || 0,
        successCount: performance?.successful || 0,
        successRate: performance?.total_sequences 
          ? ((performance.successful / performance.total_sequences) * 100).toFixed(1)
          : 0,
        avgDaysToReply: performance?.avg_days_to_reply || 0
      };
    } catch (error) {
      console.error('Sequence Analytics Error:', error);
      return { error: error.message };
    }
  }
}

const sequencer = new OutreachSequencer();
export default sequencer;
