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
  
  try {
    await db.run(`CREATE TABLE IF NOT EXISTS email_send_times (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id TEXT NOT NULL,
      sent_at INTEGER NOT NULL,
      sent_hour INTEGER,
      sent_day TEXT,
      reply_received INTEGER,
      reply_time_hours INTEGER,
      FOREIGN KEY (lead_id) REFERENCES prospect_queue(id)
    )`);
  } catch (e) { /* table exists */ }
  
  try {
    await db.run(`CREATE INDEX IF NOT EXISTS idx_send_times_lead ON email_send_times(lead_id)`);
  } catch (e) { /* index exists */ }
  try {
    await db.run(`CREATE INDEX IF NOT EXISTS idx_send_times_hour ON email_send_times(sent_hour)`);
  } catch (e) { /* index exists */ }
  
  try {
    await db.run(`CREATE TABLE IF NOT EXISTS follow_up_sequences (
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
    )`);
  } catch (e) { /* table exists */ }
  
  try {
    await db.run(`CREATE INDEX IF NOT EXISTS idx_followup_lead ON follow_up_sequences(lead_id)`);
  } catch (e) { /* index exists */ }
  try {
    await db.run(`CREATE INDEX IF NOT EXISTS idx_followup_status ON follow_up_sequences(sequence_status)`);
  } catch (e) { /* index exists */ }
  
  try {
    await db.run(`CREATE TABLE IF NOT EXISTS deal_outcomes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id TEXT NOT NULL UNIQUE,
      outcome TEXT,
      close_reason TEXT,
      competitor_lost_to TEXT,
      competitor_pricing TEXT,
      competitor_features TEXT,
      close_date INTEGER,
      closed_at INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (lead_id) REFERENCES prospect_queue(id)
    )`);
  } catch (e) { /* table exists */ }
  
  try {
    await db.run(`CREATE INDEX IF NOT EXISTS idx_outcome_status ON deal_outcomes(outcome)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_outcome_competitor ON deal_outcomes(competitor_lost_to)`);
  } catch (e) { /* indexes exist */ }
  
  try {
    await db.run(`CREATE TABLE IF NOT EXISTS prospect_meetings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id TEXT NOT NULL,
      meeting_type TEXT,
      scheduled_at INTEGER,
      completed_at INTEGER,
      meeting_status TEXT DEFAULT 'scheduled',
      meeting_outcome TEXT,
      duration_minutes INTEGER,
      attendees TEXT,
      notes TEXT,
      follow_up_required INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (lead_id) REFERENCES prospect_queue(id)
    )`);
  } catch (e) { /* table exists */ }
  
  try {
    await db.run(`CREATE INDEX IF NOT EXISTS idx_meeting_lead ON prospect_meetings(lead_id)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_meeting_scheduled ON prospect_meetings(scheduled_at)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_meeting_status ON prospect_meetings(meeting_status)`);
  } catch (e) { /* indexes exist */ }
  
  try {
    await db.run(`CREATE TABLE IF NOT EXISTS prospect_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prospect_1_id TEXT NOT NULL,
      prospect_2_id TEXT NOT NULL,
      relationship_type TEXT,
      company_id TEXT,
      relationship_quality INTEGER DEFAULT 0,
      is_buying_committee_member INTEGER DEFAULT 0,
      notes TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(prospect_1_id, prospect_2_id),
      FOREIGN KEY (prospect_1_id) REFERENCES prospect_queue(id),
      FOREIGN KEY (prospect_2_id) REFERENCES prospect_queue(id)
    )`);
  } catch (e) { /* table exists */ }
  
  try {
    await db.run(`CREATE INDEX IF NOT EXISTS idx_connection_prospect1 ON prospect_connections(prospect_1_id)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_connection_prospect2 ON prospect_connections(prospect_2_id)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_connection_company ON prospect_connections(company_id)`);
  } catch (e) { /* indexes exist */ }
  
  try {
    await db.run(`ALTER TABLE prospect_queue ADD COLUMN opportunity_score INTEGER DEFAULT 0`);
  } catch (e) { /* column exists */ }
  try {
    await db.run(`ALTER TABLE prospect_queue ADD COLUMN score_last_updated INTEGER`);
  } catch (e) { /* column exists */ }
  
  try {
    await db.run(`CREATE TABLE IF NOT EXISTS opportunity_scoring_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id TEXT NOT NULL,
      old_score INTEGER,
      new_score INTEGER,
      score_factors TEXT,
      calculated_at INTEGER NOT NULL,
      FOREIGN KEY (lead_id) REFERENCES prospect_queue(id)
    )`);
  } catch (e) { /* table exists */ }
  
  try {
    await db.run(`CREATE INDEX IF NOT EXISTS idx_score_history_lead ON opportunity_scoring_history(lead_id)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_score_history_date ON opportunity_scoring_history(calculated_at)`);
  } catch (e) { /* indexes exist */ }
  
  try {
    await db.run(`CREATE TABLE IF NOT EXISTS stage_transitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id TEXT NOT NULL,
      from_stage TEXT,
      to_stage TEXT,
      transition_at INTEGER NOT NULL,
      duration_days INTEGER,
      FOREIGN KEY (lead_id) REFERENCES prospect_queue(id)
    )`);
  } catch (e) { /* table exists */ }
  
  try {
    await db.run(`CREATE INDEX IF NOT EXISTS idx_transition_lead ON stage_transitions(lead_id)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_transition_from ON stage_transitions(from_stage)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_transition_to ON stage_transitions(to_stage)`);
  } catch (e) { /* indexes exist */ }
  
  try {
    await db.run(`CREATE TABLE IF NOT EXISTS revenue_forecasts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      forecast_month TEXT,
      forecast_date INTEGER,
      forecasted_revenue REAL,
      actual_revenue REAL,
      forecast_accuracy INTEGER,
      by_stage TEXT,
      created_at INTEGER NOT NULL
    )`);
  } catch (e) { /* table exists */ }
  
  try {
    await db.run(`CREATE INDEX IF NOT EXISTS idx_forecast_month ON revenue_forecasts(forecast_month)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_forecast_date ON revenue_forecasts(forecast_date)`);
  } catch (e) { /* indexes exist */ }
  
  try {
    await db.run(`ALTER TABLE prospect_queue ADD COLUMN assigned_to TEXT`);
  } catch (e) { /* column exists */ }
  try {
    await db.run(`ALTER TABLE prospect_queue ADD COLUMN last_activity_by TEXT`);
  } catch (e) { /* column exists */ }
  
  try {
    await db.run(`CREATE TABLE IF NOT EXISTS rep_activity_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rep_id TEXT NOT NULL UNIQUE,
      rep_name TEXT,
      period_date INTEGER,
      emails_sent INTEGER DEFAULT 0,
      calls_made INTEGER DEFAULT 0,
      meetings_scheduled INTEGER DEFAULT 0,
      meetings_completed INTEGER DEFAULT 0,
      deals_won INTEGER DEFAULT 0,
      revenue_generated REAL DEFAULT 0,
      created_at INTEGER NOT NULL
    )`);
  } catch (e) { /* table exists */ }
  
  try {
    await db.run(`CREATE INDEX IF NOT EXISTS idx_rep_activity_rep ON rep_activity_metrics(rep_id)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_rep_activity_period ON rep_activity_metrics(period_date)`);
  } catch (e) { /* indexes exist */ }
  
  try {
    await db.run(`CREATE TABLE IF NOT EXISTS engagement_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      signal_type TEXT,
      signal_value INTEGER DEFAULT 0,
      event_data TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (lead_id) REFERENCES prospect_queue(id)
    )`);
  } catch (e) { /* table exists */ }
  
  try {
    await db.run(`CREATE INDEX IF NOT EXISTS idx_engagement_lead ON engagement_signals(lead_id)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_engagement_type ON engagement_signals(signal_type)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_engagement_created ON engagement_signals(created_at)`);
  } catch (e) { /* indexes exist */ }
  
  try {
    await db.run(`CREATE TABLE IF NOT EXISTS reply_classifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      email_id TEXT,
      reply_text TEXT,
      sentiment TEXT,
      classification TEXT,
      confidence INTEGER,
      extracted_questions TEXT,
      extracted_objections TEXT,
      next_action_recommended TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (lead_id) REFERENCES prospect_queue(id)
    )`);
  } catch (e) { /* table exists */ }
  
  try {
    await db.run(`CREATE INDEX IF NOT EXISTS idx_reply_lead ON reply_classifications(lead_id)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_reply_sentiment ON reply_classifications(sentiment)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_reply_classification ON reply_classifications(classification)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_reply_created ON reply_classifications(created_at)`);
  } catch (e) { /* indexes exist */ }
  
  try {
    await db.run(`CREATE TABLE IF NOT EXISTS system_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_type TEXT,
      severity TEXT,
      lead_id INTEGER,
      title TEXT,
      description TEXT,
      action_recommended TEXT,
      is_read INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (lead_id) REFERENCES prospect_queue(id)
    )`);
  } catch (e) { /* table exists */ }
  
  try {
    await db.run(`CREATE INDEX IF NOT EXISTS idx_alert_type ON system_alerts(alert_type)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_alert_severity ON system_alerts(severity)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_alert_lead ON system_alerts(lead_id)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_alert_read ON system_alerts(is_read)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_alert_created ON system_alerts(created_at)`);
  } catch (e) { /* indexes exist */ }
  
  try {
    await db.run(`CREATE TABLE IF NOT EXISTS webhooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      webhook_url TEXT NOT NULL,
      webhook_type TEXT,
      is_active INTEGER DEFAULT 1,
      trigger_on TEXT,
      created_at INTEGER NOT NULL
    )`);
  } catch (e) { /* table exists */ }
  
  try {
    await db.run(`CREATE INDEX IF NOT EXISTS idx_webhook_active ON webhooks(is_active)`);
  } catch (e) { /* index exists */ }
  
  try {
    await db.run(`CREATE TABLE IF NOT EXISTS campaign_performance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_name TEXT,
      source TEXT,
      leads_added INTEGER DEFAULT 0,
      leads_responded INTEGER DEFAULT 0,
      leads_converted INTEGER DEFAULT 0,
      revenue_generated REAL DEFAULT 0,
      avg_engagement_score INTEGER DEFAULT 0,
      period_date INTEGER,
      created_at INTEGER NOT NULL
    )`);
  } catch (e) { /* table exists */ }
  
  try {
    await db.run(`CREATE INDEX IF NOT EXISTS idx_campaign_source ON campaign_performance(source)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_campaign_period ON campaign_performance(period_date)`);
  } catch (e) { /* indexes exist */ }
  
  try {
    await db.run(`CREATE TABLE IF NOT EXISTS intent_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      intent_score INTEGER DEFAULT 0,
      buying_signals TEXT,
      intent_level TEXT,
      predicted_stage TEXT,
      time_to_close_days INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (lead_id) REFERENCES prospect_queue(id)
    )`);
  } catch (e) { /* table exists */ }
  
  try {
    await db.run(`CREATE INDEX IF NOT EXISTS idx_intent_lead ON intent_scores(lead_id)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_intent_score ON intent_scores(intent_score)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_intent_level ON intent_scores(intent_level)`);
  } catch (e) { /* indexes exist */ }
  
  try {
    await db.run(`CREATE TABLE IF NOT EXISTS research_diagnostics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_name TEXT,
      failure_reason TEXT,
      research_sources TEXT,
      attempted_count INTEGER DEFAULT 1,
      last_attempt_at INTEGER,
      created_at INTEGER NOT NULL
    )`);
  } catch (e) { /* table exists */ }
  
  try {
    await db.run(`CREATE INDEX IF NOT EXISTS idx_research_company ON research_diagnostics(company_name)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_research_reason ON research_diagnostics(failure_reason)`);
  } catch (e) { /* indexes exist */ }
  
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
