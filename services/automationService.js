import OpenAI from 'openai';

const openrouter = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY
});

const AUTOMATION_INTERVALS = {
  INBOX_SYNC: 5 * 60 * 1000,
  FOLLOWUP_CHECK: 10 * 60 * 1000,
  REPLY_PROCESS: 2 * 60 * 1000
};

let automationState = {
  isRunning: false,
  lastInboxSync: null,
  lastFollowupCheck: null,
  emailsSentToday: 0,
  dailyLimit: 200,
  intervals: {}
};

export function getAutomationState() {
  return { ...automationState };
}

export async function initAutomationTables(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS automation_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      is_running INTEGER DEFAULT 0,
      daily_limit INTEGER DEFAULT 200,
      emails_sent_today INTEGER DEFAULT 0,
      last_reset_date TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );
    
    CREATE TABLE IF NOT EXISTS email_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id TEXT NOT NULL,
      lead_name TEXT,
      to_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      sequence_step INTEGER DEFAULT 0,
      scheduled_for INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      attempts INTEGER DEFAULT 0,
      last_error TEXT,
      created_at INTEGER,
      sent_at INTEGER,
      research_quality INTEGER DEFAULT 0,
      approved_by TEXT,
      approved_at INTEGER
    );
    
    CREATE TABLE IF NOT EXISTS reply_analysis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email_id INTEGER NOT NULL,
      lead_id TEXT,
      category TEXT NOT NULL,
      sentiment TEXT,
      summary TEXT,
      suggested_action TEXT,
      auto_response TEXT,
      processed_at INTEGER,
      FOREIGN KEY (email_id) REFERENCES email_messages(id)
    );
    
    CREATE TABLE IF NOT EXISTS automation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      details TEXT,
      created_at INTEGER
    );
    
    CREATE INDEX IF NOT EXISTS idx_email_queue_scheduled ON email_queue(scheduled_for);
    CREATE INDEX IF NOT EXISTS idx_email_queue_status ON email_queue(status);
    CREATE INDEX IF NOT EXISTS idx_reply_analysis_email ON reply_analysis(email_id);
  `);
  
  const state = await db.get('SELECT * FROM automation_state WHERE id = 1');
  if (!state) {
    await db.run(
      'INSERT INTO automation_state (id, is_running, daily_limit, emails_sent_today, last_reset_date, created_at, updated_at) VALUES (1, 0, 200, 0, ?, ?, ?)',
      [new Date().toDateString(), Date.now(), Date.now()]
    );
  }
  
  console.log("✅ Automation tables initialized");
}

export async function logAutomation(db, type, message, details = null) {
  await db.run(
    'INSERT INTO automation_logs (type, message, details, created_at) VALUES (?, ?, ?, ?)',
    [type, message, details ? JSON.stringify(details) : null, Date.now()]
  );
}

export async function categorizeReply(emailBody, emailSubject, leadContext = '') {
  try {
    const response = await openrouter.chat.completions.create({
      model: "meta-llama/llama-3.3-70b-instruct",
      messages: [
        {
          role: "system",
          content: `You are an email classification AI for a B2B sales team. Analyze incoming emails and categorize them.
          
Categories:
- INTERESTED: Positive response, wants to learn more, requests meeting/call
- NOT_INTERESTED: Polite decline, not a fit, asks to be removed
- QUESTION: Has questions about services, needs more info before deciding
- OUT_OF_OFFICE: Auto-reply, vacation, temporary unavailability
- BOUNCE: Delivery failure, invalid email, mailbox full
- REFERRAL: Suggests contacting someone else
- SPAM: Irrelevant, promotional, not related to outreach

Return JSON only: {"category": "CATEGORY", "sentiment": "positive|neutral|negative", "summary": "1 sentence summary", "suggestedAction": "what to do next"}`
        },
        {
          role: "user",
          content: `Subject: ${emailSubject}\n\nBody:\n${emailBody}\n\nLead Context: ${leadContext}`
        }
      ],
      temperature: 0.3,
      max_tokens: 200
    });
    
    const text = response.choices[0]?.message?.content || '{}';
    try {
      const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleaned);
    } catch {
      return { category: 'QUESTION', sentiment: 'neutral', summary: 'Unable to categorize', suggestedAction: 'Manual review needed' };
    }
  } catch (error) {
    console.error("Reply categorization error:", error);
    return { category: 'QUESTION', sentiment: 'neutral', summary: 'Error during analysis', suggestedAction: 'Manual review needed' };
  }
}

export async function generateAutoResponse(category, emailBody, leadName, serviceProfile) {
  if (!['INTERESTED', 'QUESTION'].includes(category)) {
    return null;
  }
  
  try {
    const response = await openrouter.chat.completions.create({
      model: "meta-llama/llama-3.3-70b-instruct",
      messages: [
        {
          role: "system",
          content: `You are a helpful BDR assistant. Generate a brief, professional reply email.
          
Company: ${serviceProfile?.companyName || 'Smooth AI Consulting'}
Sender Name: ${serviceProfile?.senderName || 'Nick'}

Guidelines:
- Keep it under 100 words
- Be warm but professional
- If INTERESTED: Propose a quick call, offer 2-3 time slots
- If QUESTION: Answer helpfully, pivot to scheduling a call
- Sign off with sender name

Return ONLY the email body text, no subject line.`
        },
        {
          role: "user",
          content: `Reply Category: ${category}\nLead Name: ${leadName}\nTheir Email:\n${emailBody}`
        }
      ],
      temperature: 0.7,
      max_tokens: 300
    });
    
    return response.choices[0]?.message?.content || null;
  } catch (error) {
    console.error("Auto-response generation error:", error);
    return null;
  }
}

export async function processUnanalyzedReplies(db, serviceProfile) {
  const unprocessed = await db.all(`
    SELECT em.id, em.lead_id, em.from_email, em.subject, em.body_text, em.body_html
    FROM email_messages em
    LEFT JOIN reply_analysis ra ON em.id = ra.email_id
    WHERE ra.id IS NULL AND em.lead_id IS NOT NULL
    ORDER BY em.received_at DESC
    LIMIT 10
  `);
  
  let processed = 0;
  
  for (const email of unprocessed) {
    const body = email.body_text || email.body_html || '';
    const analysis = await categorizeReply(body, email.subject, '');
    
    let autoResponse = null;
    if (['INTERESTED', 'QUESTION'].includes(analysis.category)) {
      autoResponse = await generateAutoResponse(analysis.category, body, '', serviceProfile);
    }
    
    await db.run(
      `INSERT INTO reply_analysis (email_id, lead_id, category, sentiment, summary, suggested_action, auto_response, processed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [email.id, email.lead_id, analysis.category, analysis.sentiment, analysis.summary, analysis.suggestedAction, autoResponse, Date.now()]
    );
    
    await logAutomation(db, 'REPLY_ANALYZED', `Categorized reply as ${analysis.category}`, { emailId: email.id, category: analysis.category });
    processed++;
  }
  
  return processed;
}

export async function checkDailyLimitReset(db) {
  const state = await db.get('SELECT * FROM automation_state WHERE id = 1');
  const today = new Date().toDateString();
  
  if (state && state.last_reset_date !== today) {
    await db.run(
      'UPDATE automation_state SET emails_sent_today = 0, last_reset_date = ?, updated_at = ? WHERE id = 1',
      [today, Date.now()]
    );
    automationState.emailsSentToday = 0;
    await logAutomation(db, 'DAILY_RESET', 'Daily email counter reset');
  } else if (state) {
    automationState.emailsSentToday = state.emails_sent_today;
    automationState.dailyLimit = state.daily_limit;
  }
}

export async function queueEmailForLead(db, lead, emailDraft, sequenceStep = 0, delayMinutes = 0) {
  const researchQuality = lead.researchQuality || 0;
  
  if (researchQuality < 9) {
    await logAutomation(db, 'QUEUE_BLOCKED', `Email NOT queued for ${lead.companyName} - research quality ${researchQuality}/10 below minimum threshold (requires 9+)`, { leadId: lead.id, researchQuality });
    return { success: false, reason: 'Research quality too low (requires 9+)', researchQuality };
  }
  
  const scheduledFor = Date.now() + (delayMinutes * 60 * 1000);
  
  await db.run(
    `INSERT INTO email_queue (lead_id, lead_name, to_email, subject, body, sequence_step, scheduled_for, status, created_at, research_quality)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [lead.id, lead.companyName, lead.decisionMaker?.email || '', emailDraft.subject, emailDraft.body, sequenceStep, scheduledFor, Date.now(), researchQuality]
  );
  
  await logAutomation(db, 'EMAIL_QUEUED', `Queued email for ${lead.companyName} (research quality: ${researchQuality}/10)`, { leadId: lead.id, step: sequenceStep, researchQuality });
  return { success: true };
}

export async function processPendingEmails(db, smtpConfig, nodemailer) {
  await checkDailyLimitReset(db);
  
  const state = await db.get('SELECT * FROM automation_state WHERE id = 1');
  if (state.emails_sent_today >= state.daily_limit) {
    return { sent: 0, reason: 'Daily limit reached' };
  }
  
  const pendingEmails = await db.all(`
    SELECT * FROM email_queue 
    WHERE status = 'pending' AND scheduled_for <= ? AND to_email != ''
    ORDER BY scheduled_for ASC
    LIMIT 5
  `, [Date.now()]);
  
  let sent = 0;
  
  for (const email of pendingEmails) {
    if (state.emails_sent_today + sent >= state.daily_limit) break;
    
    try {
      const transporter = nodemailer.createTransport({
        host: smtpConfig.host,
        port: parseInt(smtpConfig.port),
        secure: smtpConfig.secure,
        auth: { user: smtpConfig.user, pass: smtpConfig.pass },
        connectionTimeout: 15000,
        socketTimeout: 30000
      });
      
      let htmlBody = email.body.replace(/\n/g, '<br>');
      if (smtpConfig.publicUrl && email.lead_id) {
        const pixelUrl = `${smtpConfig.publicUrl}/api/track/open/${email.lead_id}`;
        htmlBody += `<br><img src="${pixelUrl}" width="1" height="1" style="display:none;" />`;
      }
      
      await transporter.sendMail({
        from: `"${smtpConfig.fromName || 'Smooth AI'}" <${smtpConfig.user}>`,
        to: email.to_email,
        subject: email.subject,
        text: email.body,
        html: htmlBody
      });
      
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
      
      await logAutomation(db, 'EMAIL_SENT', `Sent email to ${email.to_email}`, { leadId: email.lead_id, step: email.sequence_step });
      sent++;
      
      await new Promise(r => setTimeout(r, 3000));
      
    } catch (error) {
      await db.run(
        'UPDATE email_queue SET status = ?, attempts = attempts + 1, last_error = ? WHERE id = ?',
        ['failed', error.message, email.id]
      );
      await logAutomation(db, 'EMAIL_FAILED', `Failed to send to ${email.to_email}: ${error.message}`, { emailId: email.id });
    }
  }
  
  return { sent, remaining: pendingEmails.length - sent };
}

export async function scheduleFollowups(db, leads) {
  let scheduled = 0;
  
  for (const lead of leads) {
    if (!lead.emailSequence || lead.emailSequence.length <= 1) continue;
    if (!lead.lastContactedAt) continue;
    if (!lead.decisionMaker?.email) continue;
    
    const existingQueued = await db.get(
      'SELECT id FROM email_queue WHERE lead_id = ? AND status = ? AND sequence_step > 0',
      [lead.id, 'pending']
    );
    
    if (existingQueued) continue;
    
    const lastSent = await db.get(
      'SELECT MAX(sent_at) as last_sent, MAX(sequence_step) as last_step FROM email_queue WHERE lead_id = ? AND status = ?',
      [lead.id, 'sent']
    );
    
    const nextStep = (lastSent?.last_step || 0) + 1;
    
    if (nextStep < lead.emailSequence.length) {
      const nextEmail = lead.emailSequence[nextStep];
      const daysSinceContact = Math.floor((Date.now() - lead.lastContactedAt) / (1000 * 60 * 60 * 24));
      
      if (daysSinceContact >= nextEmail.delayDays) {
        await queueEmailForLead(db, lead, nextEmail, nextStep, 0);
        scheduled++;
      }
    }
  }
  
  return scheduled;
}

export async function getAutomationStats(db) {
  const state = await db.get('SELECT * FROM automation_state WHERE id = 1');
  const queueStats = await db.get(`
    SELECT 
      COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
      COUNT(CASE WHEN status = 'sent' THEN 1 END) as sent,
      COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
    FROM email_queue
  `);
  
  const replyStats = await db.get(`
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN category = 'INTERESTED' THEN 1 END) as interested,
      COUNT(CASE WHEN category = 'QUESTION' THEN 1 END) as questions,
      COUNT(CASE WHEN category = 'NOT_INTERESTED' THEN 1 END) as declined
    FROM reply_analysis
  `);
  
  const recentLogs = await db.all(`
    SELECT * FROM automation_logs ORDER BY created_at DESC LIMIT 20
  `);
  
  return {
    isRunning: state?.is_running === 1,
    emailsSentToday: state?.emails_sent_today || 0,
    dailyLimit: state?.daily_limit || 50,
    queue: queueStats || { pending: 0, sent: 0, failed: 0 },
    replies: replyStats || { total: 0, interested: 0, questions: 0, declined: 0 },
    recentLogs
  };
}

export async function toggleAutomation(db, enabled) {
  await db.run(
    'UPDATE automation_state SET is_running = ?, updated_at = ? WHERE id = 1',
    [enabled ? 1 : 0, Date.now()]
  );
  automationState.isRunning = enabled;
  await logAutomation(db, enabled ? 'AUTOMATION_STARTED' : 'AUTOMATION_STOPPED', `Automation ${enabled ? 'enabled' : 'disabled'}`);
  return enabled;
}

export async function updateDailyLimit(db, limit) {
  await db.run(
    'UPDATE automation_state SET daily_limit = ?, updated_at = ? WHERE id = 1',
    [limit, Date.now()]
  );
  automationState.dailyLimit = limit;
  return limit;
}
