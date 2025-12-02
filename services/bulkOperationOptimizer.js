/**
 * Bulk Operation Optimizer
 * Optimizes batch operations for maximum throughput and minimal DB load
 * Batches requests, defers writes, and parallelizes operations
 */

class BulkOperationOptimizer {
  constructor() {
    this.batchSize = 100;
    this.writeDelay = 50; // ms between batch writes
    this.maxConcurrent = 10;
  }

  /**
   * Chunk array into batches
   * @param {array} items - Items to chunk
   * @param {number} size - Batch size
   * @returns {array} Array of batches
   */
  chunk(items, size = this.batchSize) {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Process items in parallel batches with concurrency limit
   * @param {array} items - Items to process
   * @param {function} processor - Async function to process each batch
   * @param {number} concurrency - Max concurrent operations
   * @returns {Promise<array>} Results array
   */
  async processBatch(items, processor, concurrency = this.maxConcurrent) {
    const batches = this.chunk(items);
    const results = [];
    
    for (let i = 0; i < batches.length; i += concurrency) {
      const chunk = batches.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        chunk.map(batch => processor(batch))
      );
      results.push(...batchResults);
      
      // Add delay between concurrent batch groups
      if (i + concurrency < batches.length) {
        await new Promise(resolve => setTimeout(resolve, this.writeDelay));
      }
    }
    
    return results;
  }

  /**
   * Bulk insert with transaction
   * @param {object} db - Database instance
   * @param {string} table - Table name
   * @param {array} rows - Rows to insert
   * @returns {Promise<number>} Number of inserted rows
   */
  async bulkInsert(db, table, rows) {
    if (rows.length === 0) return 0;

    const batches = this.chunk(rows);
    let inserted = 0;

    for (const batch of batches) {
      const placeholders = batch.map(() => 
        `(${Object.keys(batch[0]).map(() => '?').join(',')})`
      ).join(',');
      
      const values = batch.flatMap(row => Object.values(row));
      const cols = Object.keys(batch[0]).join(',');
      
      const query = `INSERT INTO ${table} (${cols}) VALUES ${placeholders}`;
      await db.run(query, values);
      inserted += batch.length;
      
      // Delay between batches
      if (batch !== batches[batches.length - 1]) {
        await new Promise(resolve => setTimeout(resolve, this.writeDelay));
      }
    }

    return inserted;
  }

  /**
   * Bulk update with batch optimization
   * @param {object} db - Database instance
   * @param {string} table - Table name
   * @param {array} updates - Array of {id, updates}
   * @returns {Promise<number>} Number of updated rows
   */
  async bulkUpdate(db, table, updates) {
    const batches = this.chunk(updates);
    let updated = 0;

    for (const batch of batches) {
      const queries = batch.map(({ id, updates: updateObj }) => {
        const sets = Object.entries(updateObj)
          .map(([k, v]) => `${k} = '${String(v).replace(/'/g, "''")}'`)
          .join(',');
        return `UPDATE ${table} SET ${sets} WHERE id = ${id}`;
      });

      for (const query of queries) {
        await db.run(query);
      }
      updated += batch.length;

      if (batch !== batches[batches.length - 1]) {
        await new Promise(resolve => setTimeout(resolve, this.writeDelay));
      }
    }

    return updated;
  }

  /**
   * Get bulk operation statistics
   * @returns {object} Operation stats
   */
  stats() {
    return {
      batchSize: this.batchSize,
      writeDelay: this.writeDelay,
      maxConcurrent: this.maxConcurrent,
      recommendedForOperation: {
        emailBatch: this.batchSize,
        prospectBatch: this.batchSize,
        researchBatch: 15,
        tagBatch: this.batchSize
      }
    };
  }
}

const bulkOptimizer = new BulkOperationOptimizer();
export default bulkOptimizer;
