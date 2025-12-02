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
      updated_at INTEGER,
      logo_url TEXT
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
      unverified_hooks TEXT,
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
    
    CREATE TABLE IF NOT EXISTS bounce_list (
      email TEXT PRIMARY KEY,
      bounce_type TEXT DEFAULT 'hard_bounce',
      detected_at INTEGER NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS unsubscribe_list (
      email TEXT PRIMARY KEY,
      reason TEXT,
      unsubscribed_at INTEGER NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS lead_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id TEXT NOT NULL UNIQUE,
      email TEXT,
      engagement_score INTEGER DEFAULT 0,
      reply_count INTEGER DEFAULT 0,
      click_count INTEGER DEFAULT 0,
      open_count INTEGER DEFAULT 0,
      research_quality_avg INTEGER DEFAULT 0,
      days_in_pipeline INTEGER DEFAULT 0,
      last_activity_at INTEGER,
      priority_rank TEXT DEFAULT 'medium',
      updated_at INTEGER,
      created_at INTEGER NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS activity_timeline (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id TEXT NOT NULL,
      email TEXT,
      activity_type TEXT NOT NULL,
      activity_description TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (lead_id) REFERENCES prospect_queue(id)
    );
    
    CREATE TABLE IF NOT EXISTS prospect_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id TEXT NOT NULL,
      tag_name TEXT NOT NULL,
      tag_category TEXT,
      added_at INTEGER NOT NULL,
      UNIQUE(lead_id, tag_name),
      FOREIGN KEY (lead_id) REFERENCES prospect_queue(id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_activity_timeline_lead ON activity_timeline(lead_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_activity_timeline_type ON activity_timeline(activity_type);
    CREATE INDEX IF NOT EXISTS idx_prospect_tags_lead ON prospect_tags(lead_id);
    CREATE INDEX IF NOT EXISTS idx_prospect_tags_tag ON prospect_tags(tag_name);
    CREATE INDEX IF NOT EXISTS idx_lead_scores_priority ON lead_scores(priority_rank);
    CREATE INDEX IF NOT EXISTS idx_bounce_list_email ON bounce_list(email);
    CREATE INDEX IF NOT EXISTS idx_unsubscribe_list_email ON unsubscribe_list(email);
  `);
  
  // Add campaign_id column to email_queue if it doesn't exist
  try {
    await db.run(`ALTER TABLE email_queue ADD COLUMN campaign_id TEXT`);
  } catch (e) { /* column exists */ }
  try {
    await db.run(`ALTER TABLE email_queue ADD COLUMN is_followup INTEGER DEFAULT 0`);
  } catch (e) { /* column exists */ }
  
  // Add workflow_stage column to prospect_queue for CRM status tracking
  try {
    await db.run(`ALTER TABLE prospect_queue ADD COLUMN workflow_stage TEXT DEFAULT 'new'`);
  } catch (e) { /* column exists */ }
  try {
    await db.run(`ALTER TABLE prospect_queue ADD COLUMN stage_updated_at INTEGER`);
  } catch (e) { /* column exists */ }
  
  // Add brief storage for cached insights
  try {
    await db.run(`ALTER TABLE research_queue ADD COLUMN insights_brief TEXT`);
  } catch (e) { /* column exists */ }
  try {
    await db.run(`ALTER TABLE research_queue ADD COLUMN brief_generated_at INTEGER`);
  } catch (e) { /* column exists */ }
  
  // Add sentiment analysis columns to email_messages for reply analysis
  try {
    await db.run(`ALTER TABLE email_messages ADD COLUMN sentiment TEXT DEFAULT 'neutral'`);
  } catch (e) { /* column exists */ }
  try {
    await db.run(`ALTER TABLE email_messages ADD COLUMN sentiment_score REAL DEFAULT 0`);
  } catch (e) { /* column exists */ }
  try {
    await db.run(`ALTER TABLE email_messages ADD COLUMN decision_signal TEXT`);
  } catch (e) { /* column exists */ }
  try {
    await db.run(`ALTER TABLE email_messages ADD COLUMN key_topics TEXT DEFAULT '[]'`);
  } catch (e) { /* column exists */ }
  try {
    await db.run(`ALTER TABLE email_messages ADD COLUMN analyzed_at INTEGER`);
  } catch (e) { /* column exists */ }
  
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
  
  // Add logo_url column to prospect_queue if it doesn't exist
  try {
    await db.run(`ALTER TABLE prospect_queue ADD COLUMN logo_url TEXT`);
  } catch (e) { /* column exists */ }
  
  // Add unverified_hooks column to draft_queue if it doesn't exist
  try {
    await db.run(`ALTER TABLE draft_queue ADD COLUMN unverified_hooks TEXT`);
  } catch (e) { /* column exists */ }
  
  // Add followup tracking columns to email_queue
  try {
    await db.run(`ALTER TABLE email_queue ADD COLUMN parent_email_id INTEGER`);
  } catch (e) { /* column exists */ }
  try {
    await db.run(`ALTER TABLE email_queue ADD COLUMN sequence_number INTEGER DEFAULT 0`);
  } catch (e) { /* column exists */ }
  try {
    await db.run(`ALTER TABLE email_queue ADD COLUMN scheduled_followup_at INTEGER`);
  } catch (e) { /* column exists */ }
  
  // Add performance tier column to prospect_queue for segmentation
  try {
    await db.run(`ALTER TABLE prospect_queue ADD COLUMN performance_tier TEXT DEFAULT 'medium'`);
  } catch (e) { /* column exists */ }
  try {
    await db.run(`ALTER TABLE prospect_queue ADD COLUMN tier_score INTEGER DEFAULT 0`);
  } catch (e) { /* column exists */ }
  try {
    await db.run(`ALTER TABLE prospect_queue ADD COLUMN tier_calculated_at INTEGER`);
  } catch (e) { /* column exists */ }
  
  // Create email template library table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS email_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_name TEXT NOT NULL UNIQUE,
      template_type TEXT DEFAULT 'initial',
      subject_line TEXT NOT NULL,
      body_text TEXT NOT NULL,
      tags TEXT DEFAULT '[]',
      target_industries TEXT DEFAULT '[]',
      target_company_sizes TEXT DEFAULT '[]',
      target_tiers TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER
    );
    
    CREATE TABLE IF NOT EXISTS template_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER,
      email_id INTEGER,
      lead_id TEXT,
      sent_at INTEGER,
      replied INTEGER DEFAULT 0,
      reply_sentiment TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (template_id) REFERENCES email_templates(id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_template_usage_template ON template_usage(template_id);
    CREATE INDEX IF NOT EXISTS idx_template_usage_lead ON template_usage(lead_id);
    
    CREATE TABLE IF NOT EXISTS deal_pipeline (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id TEXT NOT NULL UNIQUE,
      company_name TEXT,
      deal_value REAL DEFAULT 0,
      deal_stage TEXT DEFAULT 'initial',
      deal_probability INTEGER DEFAULT 0,
      close_date INTEGER,
      notes TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER,
      closed_at INTEGER,
      closed_status TEXT,
      FOREIGN KEY (lead_id) REFERENCES prospect_queue(id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_deal_pipeline_stage ON deal_pipeline(deal_stage);
    CREATE INDEX IF NOT EXISTS idx_deal_pipeline_probability ON deal_pipeline(deal_probability);
    CREATE INDEX IF NOT EXISTS idx_deal_pipeline_close_date ON deal_pipeline(close_date);
    
    CREATE TABLE IF NOT EXISTS campaign_tracking (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_name TEXT NOT NULL UNIQUE,
      campaign_source TEXT,
      leads_generated INTEGER DEFAULT 0,
      budget_spent REAL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    
    CREATE INDEX IF NOT EXISTS idx_campaign_source ON campaign_tracking(campaign_source);
  `);
  
  // Add source tracking columns to prospect_queue
  try {
    await db.run(`ALTER TABLE prospect_queue ADD COLUMN lead_source TEXT DEFAULT 'organic'`);
  } catch (e) { /* column exists */ }
  try {
    await db.run(`ALTER TABLE prospect_queue ADD COLUMN campaign_id TEXT`);
  } catch (e) { /* column exists */ }
  
  // Add data enrichment columns to prospect_queue
  try {
    await db.run(`ALTER TABLE prospect_queue ADD COLUMN company_size TEXT`);
  } catch (e) { /* column exists */ }
  try {
    await db.run(`ALTER TABLE prospect_queue ADD COLUMN industry TEXT`);
  } catch (e) { /* column exists */ }
  try {
    await db.run(`ALTER TABLE prospect_queue ADD COLUMN revenue_range TEXT`);
  } catch (e) { /* column exists */ }
  try {
    await db.run(`ALTER TABLE prospect_queue ADD COLUMN employee_count INTEGER`);
  } catch (e) { /* column exists */ }
  try {
    await db.run(`ALTER TABLE prospect_queue ADD COLUMN data_quality_score INTEGER DEFAULT 0`);
  } catch (e) { /* column exists */ }
  try {
    await db.run(`ALTER TABLE prospect_queue ADD COLUMN enriched_at INTEGER`);
  } catch (e) { /* column exists */ }
  
  // Add send time optimization columns
  try {
    await db.run(`ALTER TABLE prospect_queue ADD COLUMN timezone TEXT DEFAULT 'US/Eastern'`);
  } catch (e) { /* column exists */ }
  try {
    await db.run(`ALTER TABLE prospect_queue ADD COLUMN preferred_send_hour INTEGER`);
  } catch (e) { /* column exists */ }
  try {
    await db.run(`ALTER TABLE prospect_queue ADD COLUMN last_email_sent INTEGER`);
  } catch (e) { /* column exists */ }
  
  CREATE TABLE IF NOT EXISTS email_send_times (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id TEXT NOT NULL,
    sent_at INTEGER NOT NULL,
    sent_hour INTEGER,
    sent_day TEXT,
    reply_received INTEGER,
    reply_time_hours INTEGER,
    FOREIGN KEY (lead_id) REFERENCES prospect_queue(id)
  );
  
  CREATE INDEX IF NOT EXISTS idx_send_times_lead ON email_send_times(lead_id);
  CREATE INDEX IF NOT EXISTS idx_send_times_hour ON email_send_times(sent_hour);
  
  CREATE TABLE IF NOT EXISTS follow_up_sequences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id TEXT NOT NULL UNIQUE,
    sequence_name TEXT,
    initial_email_id TEXT,
    first_sent_at INTEGER,
    follow_up_1_scheduled INTEGER,
    follow_up_1_sent INTEGER,
    follow_up_2_scheduled INTEGER,
    follow_up_2_sent INTEGER,
    follow_up_3_scheduled INTEGER,
    follow_up_3_sent INTEGER,
    sequence_status TEXT DEFAULT 'active',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (lead_id) REFERENCES prospect_queue(id)
  );
  
  CREATE INDEX IF NOT EXISTS idx_followup_lead ON follow_up_sequences(lead_id);
  CREATE INDEX IF NOT EXISTS idx_followup_status ON follow_up_sequences(sequence_status);
  
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
