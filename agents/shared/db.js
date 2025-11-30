import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let db = null;

export async function getDatabase() {
  if (db) return db;
  
  db = await open({
    filename: join(__dirname, '../../smooth_ai.db'),
    driver: sqlite3.Database
  });
  
  return db;
}

export async function initAgentTables(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS prospect_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_name TEXT NOT NULL,
      website_url TEXT,
      contact_email TEXT,
      contact_name TEXT,
      source TEXT DEFAULT 'manual',
      priority INTEGER DEFAULT 5,
      status TEXT DEFAULT 'pending',
      locked_by TEXT,
      locked_at INTEGER,
      attempts INTEGER DEFAULT 0,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER
    );
    
    CREATE TABLE IF NOT EXISTS research_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prospect_id INTEGER,
      company_name TEXT NOT NULL,
      website_url TEXT,
      contact_email TEXT,
      contact_name TEXT,
      status TEXT DEFAULT 'pending',
      locked_by TEXT,
      locked_at INTEGER,
      research_pass INTEGER DEFAULT 0,
      current_quality INTEGER DEFAULT 0,
      research_data TEXT,
      attempts INTEGER DEFAULT 0,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER,
      completed_at INTEGER,
      retry_count INTEGER DEFAULT 0,
      sources_tried TEXT DEFAULT '[]',
      exhausted INTEGER DEFAULT 0,
      exhaustion_reason TEXT,
      last_retry_at INTEGER,
      FOREIGN KEY (prospect_id) REFERENCES prospect_queue(id)
    );
    
    CREATE TABLE IF NOT EXISTS draft_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      research_id INTEGER,
      prospect_id INTEGER,
      lead_id TEXT,
      company_name TEXT NOT NULL,
      contact_email TEXT,
      contact_name TEXT,
      research_quality INTEGER NOT NULL,
      research_data TEXT,
      status TEXT DEFAULT 'pending',
      locked_by TEXT,
      locked_at INTEGER,
      email_subject TEXT,
      email_body TEXT,
      attempts INTEGER DEFAULT 0,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER,
      generated_at INTEGER,
      FOREIGN KEY (research_id) REFERENCES research_queue(id),
      FOREIGN KEY (prospect_id) REFERENCES prospect_queue(id)
    );
    
    CREATE TABLE IF NOT EXISTS agent_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_name TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'stopped',
      last_heartbeat INTEGER,
      items_processed INTEGER DEFAULT 0,
      last_processed_at INTEGER,
      current_item TEXT,
      error_count INTEGER DEFAULT 0,
      started_at INTEGER,
      config TEXT
    );
    
    CREATE TABLE IF NOT EXISTS agent_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_name TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      details TEXT,
      created_at INTEGER NOT NULL
    );
    
    CREATE INDEX IF NOT EXISTS idx_prospect_queue_status ON prospect_queue(status);
    CREATE INDEX IF NOT EXISTS idx_research_queue_status ON research_queue(status);
    CREATE INDEX IF NOT EXISTS idx_draft_queue_status ON draft_queue(status);
    CREATE INDEX IF NOT EXISTS idx_agent_logs_agent ON agent_logs(agent_name, created_at);
    
    CREATE TABLE IF NOT EXISTS agent_enabled (
      agent_name TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 1,
      updated_at INTEGER
    );
    
    CREATE TABLE IF NOT EXISTS agent_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_agent TEXT NOT NULL,
      to_agent TEXT NOT NULL,
      message_type TEXT NOT NULL,
      payload TEXT,
      created_at INTEGER NOT NULL,
      read_at INTEGER
    );
    
    CREATE INDEX IF NOT EXISTS idx_agent_messages_to ON agent_messages(to_agent, read_at);
  `);
  
  const agents = ['prospect-finder', 'research', 'research-retry', 'email-generator', 'email-sender', 'inbox'];
  for (const agent of agents) {
    await db.run(`INSERT OR IGNORE INTO agent_enabled (agent_name, enabled, updated_at) VALUES (?, 1, ?)`, [agent, Date.now()]);
  }
  
  // Add retry columns to research_queue if they don't exist
  try {
    await db.run(`ALTER TABLE research_queue ADD COLUMN retry_count INTEGER DEFAULT 0`);
  } catch (e) { /* column exists */ }
  try {
    await db.run(`ALTER TABLE research_queue ADD COLUMN sources_tried TEXT DEFAULT '[]'`);
  } catch (e) { /* column exists */ }
  try {
    await db.run(`ALTER TABLE research_queue ADD COLUMN exhausted INTEGER DEFAULT 0`);
  } catch (e) { /* column exists */ }
  try {
    await db.run(`ALTER TABLE research_queue ADD COLUMN exhaustion_reason TEXT`);
  } catch (e) { /* column exists */ }
  try {
    await db.run(`ALTER TABLE research_queue ADD COLUMN last_retry_at INTEGER`);
  } catch (e) { /* column exists */ }
  
  console.log("✅ Agent tables initialized");
}

export async function acquireQueueItem(db, tableName, agentId, orderBy = 'created_at ASC') {
  const lockTimeout = 5 * 60 * 1000;
  const now = Date.now();
  
  try {
    const tableCheck = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [tableName]);
    if (!tableCheck) {
      return null;
    }
    
    const item = await db.get(`
      SELECT * FROM ${tableName} 
      WHERE status = 'pending' 
        OR (status = 'processing' AND locked_at < ?)
      ORDER BY ${orderBy}
      LIMIT 1
    `, [now - lockTimeout]);
    
    if (!item) return null;
    
    const result = await db.run(`
      UPDATE ${tableName} 
      SET status = 'processing', locked_by = ?, locked_at = ?, updated_at = ?
      WHERE id = ? AND (status = 'pending' OR (status = 'processing' AND locked_at < ?))
    `, [agentId, now, now, item.id, now - lockTimeout]);
    
    if (result.changes === 0) return null;
    
    return { ...item, status: 'processing', locked_by: agentId, locked_at: now };
  } catch (error) {
    console.error(`Error acquiring queue item from ${tableName}:`, error.message);
    return null;
  }
}

export async function completeQueueItem(db, tableName, itemId, newStatus = 'completed', additionalData = {}) {
  const now = Date.now();
  const updates = ['status = ?', 'locked_by = NULL', 'locked_at = NULL', 'updated_at = ?'];
  const values = [newStatus, now];
  
  if (newStatus === 'completed') {
    updates.push('completed_at = ?');
    values.push(now);
  }
  
  for (const [key, value] of Object.entries(additionalData)) {
    updates.push(`${key} = ?`);
    values.push(typeof value === 'object' ? JSON.stringify(value) : value);
  }
  
  values.push(itemId);
  
  await db.run(`UPDATE ${tableName} SET ${updates.join(', ')} WHERE id = ?`, values);
}

export async function failQueueItem(db, tableName, itemId, error, maxAttempts = 3) {
  const item = await db.get(`SELECT attempts FROM ${tableName} WHERE id = ?`, [itemId]);
  const newAttempts = (item?.attempts || 0) + 1;
  const newStatus = newAttempts >= maxAttempts ? 'failed' : 'pending';
  
  await db.run(`
    UPDATE ${tableName} 
    SET status = ?, locked_by = NULL, locked_at = NULL, attempts = ?, last_error = ?, updated_at = ?
    WHERE id = ?
  `, [newStatus, newAttempts, error, Date.now(), itemId]);
  
  return { newStatus, attempts: newAttempts };
}

export async function getQueueStats(db) {
  const tables = ['prospect_queue', 'research_queue', 'draft_queue'];
  const stats = {};
  
  for (const table of tables) {
    const row = await db.get(`
      SELECT 
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
      FROM ${table}
    `);
    stats[table.replace('_queue', '')] = row;
  }
  
  return stats;
}
