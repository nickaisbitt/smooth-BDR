/**
 * Data Retention Policy Manager
 * Manages database cleanup and archival of old records
 */

class DataRetentionPolicy {
  constructor() {
    this.policies = {
      email_logs: { retentionDays: 90, archiveAfterDays: 180 },
      email_messages: { retentionDays: 180, archiveAfterDays: 365 },
      agent_logs: { retentionDays: 30, archiveAfterDays: 90 },
      automation_logs: { retentionDays: 60, archiveAfterDays: 180 },
      reply_analysis: { retentionDays: 180, archiveAfterDays: 365 },
      tracking_events: { retentionDays: 90, archiveAfterDays: 180 }
    };
  }

  /**
   * Get retention policy for table
   * @param {string} table - Table name
   * @returns {object} Policy
   */
  getPolicy(table) {
    return this.policies[table] || { retentionDays: 90, archiveAfterDays: 180 };
  }

  /**
   * Calculate cleanup thresholds
   * @returns {object} Thresholds for each table
   */
  getCleanupThresholds() {
    const now = Date.now();
    const thresholds = {};

    for (const [table, policy] of Object.entries(this.policies)) {
      thresholds[table] = {
        deleteAfterMs: policy.retentionDays * 24 * 60 * 60 * 1000,
        archiveAfterMs: policy.archiveAfterDays * 24 * 60 * 60 * 1000,
        deleteBefore: now - (policy.retentionDays * 24 * 60 * 60 * 1000),
        archiveBefore: now - (policy.archiveAfterDays * 24 * 60 * 60 * 1000)
      };
    }

    return thresholds;
  }

  /**
   * Clean old records from a table
   * @param {object} db - Database instance
   * @param {string} table - Table name
   * @param {string} dateColumn - Date column name
   * @returns {Promise<number>} Rows deleted
   */
  async cleanOldRecords(db, table, dateColumn = 'created_at') {
    const policy = this.getPolicy(table);
    const cutoffTime = Date.now() - (policy.retentionDays * 24 * 60 * 60 * 1000);
    
    try {
      await db.run(
        `DELETE FROM ${table} WHERE ${dateColumn} < ?`,
        [cutoffTime]
      );
      
      const result = await db.get('SELECT changes() as count');
      return result?.count || 0;
    } catch (error) {
      console.error(`Error cleaning ${table}:`, error);
      return 0;
    }
  }

  /**
   * Clean all old records
   * @param {object} db - Database instance
   * @returns {Promise<object>} Cleanup results
   */
  async cleanAllOldRecords(db) {
    const results = {};

    for (const table of Object.keys(this.policies)) {
      results[table] = await this.cleanOldRecords(db, table);
    }

    return results;
  }

  /**
   * Archive old records (mark as archived vs delete)
   * @param {object} db - Database instance
   * @param {string} table - Table name
   * @param {string} dateColumn - Date column name
   * @returns {Promise<number>} Rows archived
   */
  async archiveOldRecords(db, table, dateColumn = 'created_at') {
    const policy = this.getPolicy(table);
    const cutoffTime = Date.now() - (policy.archiveAfterDays * 24 * 60 * 60 * 1000);
    
    try {
      await db.run(
        `UPDATE ${table} SET archived = 1 WHERE ${dateColumn} < ? AND archived = 0`,
        [cutoffTime]
      );
      
      const result = await db.get('SELECT changes() as count');
      return result?.count || 0;
    } catch (error) {
      console.error(`Error archiving ${table}:`, error);
      return 0;
    }
  }

  /**
   * Get database statistics
   * @param {object} db - Database instance
   * @returns {Promise<object>} Table sizes and record counts
   */
  async getDatabaseStats(db) {
    const stats = {};

    for (const table of Object.keys(this.policies)) {
      try {
        const result = await db.get(
          `SELECT COUNT(*) as count FROM ${table}`
        );
        stats[table] = {
          records: result?.count || 0,
          policy: this.policies[table]
        };
      } catch (error) {
        stats[table] = { records: 0, error: error.message };
      }
    }

    return stats;
  }

  /**
   * Set custom retention policy
   * @param {string} table - Table name
   * @param {number} retentionDays - Retention period
   * @param {number} archiveAfterDays - Archive period
   */
  setPolicy(table, retentionDays, archiveAfterDays) {
    this.policies[table] = { retentionDays, archiveAfterDays };
  }
}

const retentionPolicy = new DataRetentionPolicy();
export default retentionPolicy;
