export class AgentHeartbeat {
  constructor(agentName, db, intervalMs = 30000) {
    this.agentName = agentName;
    this.db = db;
    this.intervalMs = intervalMs;
    this.intervalId = null;
    this.itemsProcessed = 0;
    this.currentItem = null;
    this.errorCount = 0;
    this.startedAt = null;
  }
  
  async start() {
    this.startedAt = Date.now();
    
    await this.db.run(`
      INSERT INTO agent_status (agent_name, status, last_heartbeat, items_processed, started_at)
      VALUES (?, 'running', ?, 0, ?)
      ON CONFLICT(agent_name) DO UPDATE SET 
        status = 'running',
        last_heartbeat = ?,
        started_at = ?,
        error_count = 0
    `, [this.agentName, this.startedAt, this.startedAt, this.startedAt, this.startedAt]);
    
    this.intervalId = setInterval(() => this.beat(), this.intervalMs);
    await this.beat();
    
    return this;
  }
  
  async beat() {
    try {
      await this.db.run(`
        UPDATE agent_status 
        SET last_heartbeat = ?, items_processed = ?, current_item = ?, error_count = ?
        WHERE agent_name = ?
      `, [Date.now(), this.itemsProcessed, this.currentItem, this.errorCount, this.agentName]);
    } catch (e) {
      console.error(`Heartbeat failed for ${this.agentName}:`, e.message);
    }
  }
  
  setCurrentItem(item) {
    this.currentItem = typeof item === 'object' ? JSON.stringify(item) : item;
  }
  
  clearCurrentItem() {
    this.currentItem = null;
  }
  
  incrementProcessed() {
    this.itemsProcessed++;
  }
  
  incrementErrors() {
    this.errorCount++;
  }
  
  async stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    try {
      await this.db.run(`
        UPDATE agent_status SET status = 'stopped', current_item = NULL WHERE agent_name = ?
      `, [this.agentName]);
    } catch (e) {
    }
  }
}

export async function getAgentStatuses(db) {
  return await db.all(`
    SELECT 
      agent_name,
      status,
      last_heartbeat,
      items_processed,
      last_processed_at,
      current_item,
      error_count,
      started_at,
      CASE 
        WHEN status = 'running' AND last_heartbeat > ? THEN 'healthy'
        WHEN status = 'running' THEN 'stale'
        ELSE status
      END as health
    FROM agent_status
    ORDER BY agent_name
  `, [Date.now() - 60000]);
}

export async function isAgentHealthy(db, agentName) {
  const agent = await db.get(
    'SELECT status, last_heartbeat FROM agent_status WHERE agent_name = ?',
    [agentName]
  );
  
  if (!agent) return false;
  if (agent.status !== 'running') return false;
  if (Date.now() - agent.last_heartbeat > 60000) return false;
  
  return true;
}
