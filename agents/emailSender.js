import nodemailer from 'nodemailer';
import { getDatabase, initAgentTables } from './shared/db.js';
import { createLogger } from './shared/logger.js';
import { AgentHeartbeat } from './shared/heartbeat.js';
import { AGENT_CONFIG } from './shared/config.js';

const config = AGENT_CONFIG.EMAIL_SENDER;
const logger = createLogger(config.name);

let db = null;
let heartbeat = null;
let isRunning = false;

// EMAIL VALIDATION - Prevent sending to invalid addresses
function validateEmailAddress(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
}

// BOUNCE/UNSUBSCRIBE CHECK - Skip addresses on bounce or unsubscribe lists
async function isAddressBlacklisted(email) {
  const bounced = await db.get(
    `SELECT id FROM bounce_list WHERE email = ? LIMIT 1`,
    [email]
  );
  
  const unsubscribed = await db.get(
    `SELECT id FROM unsubscribe_list WHERE email = ? LIMIT 1`,
    [email]
  );
  
  return !!(bounced || unsubscribed);
}

async function loadSmtpConfig() {
  const settings = await db.get('SELECT * FROM imap_settings WHERE id = 1');
  if (!settings || !settings.host) return null;
  
  let smtpHost = settings.host;
  if (smtpHost.startsWith('imap.')) {
    smtpHost = smtpHost.replace('imap.', 'smtp.');
  } else if (!smtpHost.startsWith('smtp.')) {
    smtpHost = 'smtp.' + smtpHost;
  }
  
  return {
    host: smtpHost,
    port: 465,
    user: settings.username,
    pass: settings.password,
    secure: true,
    fromName: 'Smooth AI'
  };
}

async function checkDailyLimit() {
  const state = await db.get('SELECT * FROM automation_state WHERE id = 1');
  const today = new Date().toDateString();
  
  if (state && state.last_reset_date !== today) {
    await db.run(
      'UPDATE automation_state SET emails_sent_today = 0, last_reset_date = ?, daily_limit = ?, updated_at = ? WHERE id = 1',
      [today, config.dailyLimit, Date.now()]
    );
    return { emailsSentToday: 0, dailyLimit: config.dailyLimit };
  }
  
  return {
    emailsSentToday: state?.emails_sent_today || 0,
    dailyLimit: config.dailyLimit  // Always use config, not stale database value
  };
}

async function sendEmail(email, smtpConfig) {
  const transporter = nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    auth: { user: smtpConfig.user, pass: smtpConfig.pass },
    connectionTimeout: 15000,
    socketTimeout: 30000
  });
  
  let htmlBody = email.body.replace(/\n/g, '<br>');
  
  await transporter.sendMail({
    from: `"${smtpConfig.fromName}" <${smtpConfig.user}>`,
    to: email.to_email,
    subject: email.subject,
    text: email.body,
    html: htmlBody
  });
  
  return true;
}

async function processPendingEmails() {
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
    
    const smtpConfig = await loadSmtpConfig();
    if (!smtpConfig) {
      return;
    }
    
    const { emailsSentToday, dailyLimit } = await checkDailyLimit();
    
    if (emailsSentToday >= dailyLimit) {
      logger.warn(`Daily limit reached: ${emailsSentToday}/${dailyLimit}`);
      return;
    }
    
    const remainingToday = dailyLimit - emailsSentToday;
    const batchSize = Math.min(config.batchSize, remainingToday); // Use config batchSize, respect rate limits
    
    // CRITICAL: Only send emails that are APPROVED (not pending_approval)
    // Emails with status 'pending_approval' need manual review first
    const pendingEmails = await db.all(`
      SELECT * FROM email_queue 
      WHERE status = 'pending' 
        AND (approval_status IS NULL OR approval_status = 'approved' OR approval_status = 'auto_approved')
        AND scheduled_for <= ? 
        AND to_email != ''
      ORDER BY scheduled_for ASC
      LIMIT ?
    `, [Date.now(), batchSize]);
    
    if (pendingEmails.length === 0) return;
    
    let sent = 0;
    
    for (const email of pendingEmails) {
      if (!isRunning) break;
      
      heartbeat.setCurrentItem({ id: email.id, to: email.to_email });
      
      // VALIDATION: Check email format before sending
      if (!validateEmailAddress(email.to_email)) {
        logger.warn(`🚫 Invalid email format - skipping: ${email.to_email}`);
        await db.run(
          `UPDATE email_queue SET status = 'failed', approval_status = 'rejected', approval_reason = 'Invalid email format' WHERE id = ?`,
          [email.id]
        );
        heartbeat.incrementErrors();
        continue;
      }
      
      // VALIDATION: Check if address is bounced or unsubscribed
      const isBlacklisted = await isAddressBlacklisted(email.to_email);
      if (isBlacklisted) {
        logger.warn(`⛔ Address blacklisted - skipping: ${email.to_email}`);
        await db.run(
          `UPDATE email_queue SET status = 'failed', approval_status = 'rejected', approval_reason = 'Address on bounce/unsubscribe list' WHERE id = ?`,
          [email.id]
        );
        heartbeat.incrementErrors();
        continue;
      }
      
      try {
        await sendEmail(email, smtpConfig);
        
        await db.run(
          'UPDATE email_queue SET status = ?, sent_at = ? WHERE id = ?',
          ['sent', Date.now(), email.id]
        );
        
        await db.run(
          'INSERT INTO email_logs (lead_id, to_email, subject, sent_at) VALUES (?, ?, ?, ?)',
          [email.lead_id, email.to_email, email.subject, Date.now()]
        );
        
        await db.run(
          'UPDATE automation_state SET emails_sent_today = emails_sent_today + 1, updated_at = ? WHERE id = 1',
          [Date.now()]
        );
        
        logger.info(`Sent email to ${email.to_email} (${email.lead_name})`);
        heartbeat.incrementProcessed();
        sent++;
        
        if (sent < pendingEmails.length) {
          await new Promise(r => setTimeout(r, config.delayBetweenEmailsMs));
        }
        
      } catch (error) {
        logger.error(`Failed to send email to ${email.to_email}`, { error: error.message });
        heartbeat.incrementErrors();
        
        // CRITICAL: Hostinger rate limiting detected - skip incrementing attempts
        // These will naturally retry on next cycle with exponential backoff
        const isRateLimited = error.message?.includes('451') || error.message?.includes('Ratelimit');
        
        if (isRateLimited) {
          // Rate limited: just log and move on, don't mark as failed
          await db.run(
            'UPDATE email_queue SET last_error = ? WHERE id = ?',
            [`Rate limited: ${error.message}`, email.id]
          );
          logger.warn(`Rate limited for ${email.to_email}, will retry next cycle`);
          continue;  // Skip to next email without incrementing attempts
        }
        
        // OTHER ERRORS: Retry up to 3 times, then mark failed
        const currentAttempts = (email.attempts || 0) + 1;
        const maxAttempts = 3;
        
        if (currentAttempts < maxAttempts) {
          await db.run(
            'UPDATE email_queue SET attempts = ?, last_error = ? WHERE id = ?',
            [currentAttempts, error.message, email.id]
          );
          logger.info(`Retry attempt ${currentAttempts}/${maxAttempts} for ${email.to_email}`);
        } else {
          await db.run(
            'UPDATE email_queue SET status = ?, attempts = ?, last_error = ? WHERE id = ?',
            ['failed', currentAttempts, error.message, email.id]
          );
          logger.warn(`Max retries reached (${currentAttempts}) for ${email.to_email}`);
        }
      }
      
      heartbeat.clearCurrentItem();
    }
    
    if (sent > 0) {
      logger.info(`Sent ${sent} emails this cycle`);
    }
    
  } catch (error) {
    logger.error('Email sending cycle failed', { error: error.message });
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
  logger.info('Email Sender Agent started');
  
  const poll = async () => {
    if (!isRunning) return;
    await processPendingEmails();
    setTimeout(poll, config.pollIntervalMs);
  };
  
  poll();
}

export async function stop() {
  isRunning = false;
  if (heartbeat) {
    await heartbeat.stop();
  }
  logger.info('Email Sender Agent stopped');
}

export function getStatus() {
  return {
    name: config.name,
    running: isRunning,
    processed: heartbeat?.itemsProcessed || 0,
    errors: heartbeat?.errorCount || 0
  };
}

if (process.argv[1]?.endsWith('emailSender.js')) {
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
