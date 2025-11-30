import { getDatabase, initAgentTables } from './shared/db.js';
import { createLogger } from './shared/logger.js';
import { AgentHeartbeat } from './shared/heartbeat.js';
import { AGENT_CONFIG } from './shared/config.js';
import { syncEmails } from '../services/imapService.js';
import { categorizeReply, generateAutoResponse } from '../services/automationService.js';

const config = AGENT_CONFIG.INBOX;
const logger = createLogger(config.name);

let db = null;
let heartbeat = null;
let isRunning = false;

async function loadImapSettings() {
  return await db.get('SELECT * FROM imap_settings WHERE id = 1');
}

async function getLeadEmails() {
  const leads = await db.all(`
    SELECT DISTINCT from_email as email, lead_id as id 
    FROM email_messages 
    WHERE lead_id IS NOT NULL AND from_email IS NOT NULL
  `);
  return leads;
}

async function syncInbox() {
  const imapSettings = await loadImapSettings();
  if (!imapSettings || !imapSettings.host) {
    return { success: false, reason: 'IMAP not configured' };
  }
  
  const leadEmails = await getLeadEmails();
  
  const result = await syncEmails(db, imapSettings, leadEmails);
  
  if (result.newEmails > 0) {
    logger.info(`Synced ${result.newEmails} new emails, linked ${result.linkedEmails}`);
    heartbeat.incrementProcessed();
  }
  
  return result;
}

async function processUnanalyzedReplies() {
  const unprocessed = await db.all(`
    SELECT em.id, em.lead_id, em.from_email, em.subject, em.body_text, em.body_html
    FROM email_messages em
    LEFT JOIN reply_analysis ra ON em.id = ra.email_id
    WHERE ra.id IS NULL AND em.lead_id IS NOT NULL
    ORDER BY em.received_at DESC
    LIMIT 5
  `);
  
  let processed = 0;
  
  for (const email of unprocessed) {
    const body = email.body_text || email.body_html || '';
    
    heartbeat.setCurrentItem({ id: email.id, from: email.from_email });
    
    try {
      const analysis = await categorizeReply(body, email.subject, '');
      
      let autoResponse = null;
      if (['INTERESTED', 'QUESTION'].includes(analysis.category)) {
        autoResponse = await generateAutoResponse(analysis.category, body, '', null);
      }
      
      await db.run(
        `INSERT INTO reply_analysis (email_id, lead_id, category, sentiment, summary, suggested_action, auto_response, processed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [email.id, email.lead_id, analysis.category, analysis.sentiment, analysis.summary, analysis.suggestedAction, autoResponse, Date.now()]
      );
      
      logger.info(`Categorized reply from ${email.from_email} as ${analysis.category}`);
      heartbeat.incrementProcessed();
      processed++;
      
    } catch (error) {
      logger.error(`Failed to analyze reply from ${email.from_email}`, { error: error.message });
      heartbeat.incrementErrors();
    }
    
    heartbeat.clearCurrentItem();
  }
  
  return processed;
}

async function processInbox() {
  if (!isRunning) return;
  
  try {
    const state = await db.get('SELECT is_running FROM automation_state WHERE id = 1');
    if (!state || !state.is_running) {
      return;
    }
    
    await syncInbox();
    
    await processUnanalyzedReplies();
    
  } catch (error) {
    logger.error('Inbox processing cycle failed', { error: error.message });
    heartbeat.incrementErrors();
  }
}

export async function start() {
  if (isRunning) {
    logger.warn('Agent already running');
    return;
  }
  
  db = await getDatabase();
  logger.setDatabase(db);
  await initAgentTables(db);
  
  heartbeat = new AgentHeartbeat(config.name, db);
  await heartbeat.start();
  
  isRunning = true;
  logger.info('Inbox Agent started');
  
  const poll = async () => {
    if (!isRunning) return;
    await processInbox();
    setTimeout(poll, config.pollIntervalMs);
  };
  
  poll();
}

export async function stop() {
  isRunning = false;
  if (heartbeat) {
    await heartbeat.stop();
  }
  logger.info('Inbox Agent stopped');
}

export function getStatus() {
  return {
    name: config.name,
    running: isRunning,
    processed: heartbeat?.itemsProcessed || 0,
    errors: heartbeat?.errorCount || 0
  };
}

if (process.argv[1]?.endsWith('inboxAgent.js')) {
  start().catch(console.error);
  
  process.on('SIGTERM', async () => {
    await stop();
    process.exit(0);
  });
  
  process.on('SIGINT', async () => {
    await stop();
    process.exit(0);
  });
}
