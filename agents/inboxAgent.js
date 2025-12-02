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

async function detectBounceOrUnsubscribe(email) {
  // Detect bounce emails from mailer daemons
  const bouncePatterns = [
    /mailer.?daemon|mail.?delivery.?failed|undeliverable|delivery.?status|failure.?notice/i,
    /550\s|551\s|552\s|553\s|554\s/, // SMTP error codes
    /permanent.?failure|hard.?bounce|rejected/i
  ];
  
  const unsubscribePatterns = [
    /unsubscribe|list-unsubscribe|opt.?out/i,
    /removed.{0,20}list|no.?longer.{0,20}mail/i
  ];
  
  const subject = (email.subject || '').toLowerCase();
  const body = ((email.body_text || '') + (email.body_html || '')).toLowerCase();
  const combinedText = subject + ' ' + body;
  
  // Check for bounces
  const isBounce = bouncePatterns.some(p => p.test(combinedText));
  
  // Check for unsubscribes
  const isUnsubscribe = unsubscribePatterns.some(p => p.test(combinedText));
  
  return { isBounce, isUnsubscribe };
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
      // BOUNCE/UNSUBSCRIBE DETECTION
      const { isBounce, isUnsubscribe } = await detectBounceOrUnsubscribe(email);
      
      if (isBounce) {
        logger.warn(`⚠️ BOUNCE DETECTED for ${email.from_email} - marking as invalid`);
        await db.run(
          `INSERT INTO bounce_list (email, bounce_type, detected_at) VALUES (?, ?, ?)`,
          [email.from_email, 'hard_bounce', Date.now()]
        );
        await db.run(
          `UPDATE email_queue SET status = 'failed', approval_reason = 'Hard bounce detected' WHERE to_email = ?`,
          [email.from_email]
        );
        heartbeat.incrementProcessed();
        processed++;
        heartbeat.clearCurrentItem();
        continue;
      }
      
      if (isUnsubscribe) {
        logger.warn(`🚫 UNSUBSCRIBE DETECTED for ${email.from_email} - respecting opt-out`);
        await db.run(
          `INSERT INTO unsubscribe_list (email, reason, unsubscribed_at) VALUES (?, ?, ?)`,
          [email.from_email, 'User requested unsubscribe', Date.now()]
        );
        await db.run(
          `UPDATE email_queue SET status = 'failed', approval_reason = 'User unsubscribed' WHERE to_email = ?`,
          [email.from_email]
        );
        heartbeat.incrementProcessed();
        processed++;
        heartbeat.clearCurrentItem();
        continue;
      }
      
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
    
    const agentEnabled = await db.get('SELECT enabled FROM agent_enabled WHERE agent_name = ?', [config.name]);
    if (agentEnabled && !agentEnabled.enabled) {
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
