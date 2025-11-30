
import express from 'express';
import nodemailer from 'nodemailer';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import rateLimit from 'express-rate-limit';
import OpenAI from 'openai';
import { ImapService, syncEmails } from './services/imapService.js';
import {
  initAutomationTables,
  getAutomationStats,
  toggleAutomation,
  updateDailyLimit,
  processPendingEmails,
  processUnanalyzedReplies,
  scheduleFollowups,
  queueEmailForLead,
  logAutomation,
  categorizeReply,
  generateAutoResponse
} from './services/automationService.js';
import {
  conductFullResearch,
  formatResearchForEmail,
  scrapeWebsite
} from './services/researchService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize OpenRouter client using Replit AI Integrations
// This uses Replit's AI Integrations service - no API key needed, charges billed to credits
const openrouter = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY
});

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy for Replit environment (behind reverse proxy)
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());

// RATE LIMITER: Protect SMTP Reputation
const limiter = rateLimit({
        windowMs: 1 * 60 * 1000, // 1 minute
        limit: 60, // Limit each IP to 60 requests per windowMs
    message: "Too many requests, please try again later."
});
app.use('/api/', limiter);

// DATABASE SETUP (SQLite)
let db;
(async () => {
    try {
        db = await open({
            filename: join(__dirname, 'smooth_ai.db'),
            driver: sqlite3.Database
        });
        
        await db.exec(`
            CREATE TABLE IF NOT EXISTS email_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lead_id TEXT,
                to_email TEXT,
                subject TEXT,
                sent_at INTEGER
            );
            CREATE TABLE IF NOT EXISTS tracking_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lead_id TEXT,
                type TEXT,
                timestamp INTEGER
            );
            CREATE TABLE IF NOT EXISTS email_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                external_id TEXT UNIQUE,
                lead_id TEXT,
                from_email TEXT,
                to_email TEXT,
                subject TEXT,
                body_text TEXT,
                body_html TEXT,
                received_at INTEGER,
                is_read INTEGER DEFAULT 0,
                thread_id TEXT,
                created_at INTEGER
            );
            CREATE TABLE IF NOT EXISTS imap_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                host TEXT,
                port INTEGER,
                username TEXT,
                password TEXT,
                use_tls INTEGER DEFAULT 1,
                last_sync INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_email_messages_external_id ON email_messages(external_id);
            CREATE INDEX IF NOT EXISTS idx_email_messages_lead_id ON email_messages(lead_id);
            CREATE INDEX IF NOT EXISTS idx_email_messages_from_email ON email_messages(from_email);
        `);
        console.log("✅ SQLite Database Initialized");
        
        // Migration: Add research_quality column to email_queue if it doesn't exist
        try {
            await db.run('ALTER TABLE email_queue ADD COLUMN research_quality INTEGER DEFAULT 0');
            console.log("✅ Added research_quality column to email_queue");
        } catch (e) {
            // Column likely already exists
        }
        try {
            await db.run('ALTER TABLE email_queue ADD COLUMN approved_by TEXT');
            await db.run('ALTER TABLE email_queue ADD COLUMN approved_at INTEGER');
            console.log("✅ Added approval columns to email_queue");
        } catch (e) {
            // Columns likely already exist
        }
        
        // Auto-configure Hostinger email from environment variables
        const hostingerUser = process.env.HOSTINGER_EMAIL_USERNAME;
        const hostingerPass = process.env.HOSTINGER_EMAIL_PASSWORD;
        if (hostingerUser && hostingerPass) {
            const domain = hostingerUser.split('@')[1] || 'hostinger.com';
            const imapHost = `imap.${domain}`;
            
            // Check if settings already exist
            const existing = await db.get('SELECT * FROM imap_settings WHERE id = 1');
            if (!existing) {
                await db.run(
                    `INSERT INTO imap_settings (id, host, port, username, password, use_tls) VALUES (1, ?, 993, ?, ?, 1)`,
                    [imapHost, hostingerUser, hostingerPass]
                );
                console.log(`✅ Email configured: ${hostingerUser}`);
            } else if (existing.username !== hostingerUser || existing.password !== hostingerPass) {
                // Update if credentials changed
                await db.run(
                    `UPDATE imap_settings SET host = ?, username = ?, password = ? WHERE id = 1`,
                    [imapHost, hostingerUser, hostingerPass]
                );
                console.log(`✅ Email credentials updated: ${hostingerUser}`);
            } else {
                console.log(`✅ Email already configured: ${hostingerUser}`);
            }
        }
        
        await initAutomationTables(db);
        startAutomationScheduler();
    } catch (e) {
        console.error("❌ Database Init Failed:", e);
    }
})();

let automationIntervals = {};
let cachedSmtpConfig = null;
let cachedLeads = [];

async function loadSmtpConfigFromDb() {
  try {
    const settings = await db.get('SELECT * FROM imap_settings WHERE id = 1');
    if (settings && settings.host) {
      let smtpHost = settings.host;
      if (smtpHost.startsWith('imap.')) {
        smtpHost = smtpHost.replace('imap.', 'smtp.');
      } else if (!smtpHost.startsWith('smtp.')) {
        smtpHost = 'smtp.' + smtpHost;
      }
      return {
        host: smtpHost,
        port: '465',
        user: settings.username,
        pass: settings.password,
        secure: settings.use_tls === 1,
        fromName: 'Smooth AI'
      };
    }
  } catch (error) {
    console.error("Failed to load SMTP config from DB:", error.message);
  }
  return null;
}

function startAutomationScheduler() {
  console.log("🤖 Automation Scheduler Started");
  
  automationIntervals.inboxSync = setInterval(async () => {
    try {
      const state = await db.get('SELECT is_running FROM automation_state WHERE id = 1');
      if (!state || !state.is_running) return;
      
      const imapSettings = await db.get('SELECT * FROM imap_settings WHERE id = 1');
      if (!imapSettings || !imapSettings.host) return;
      
      const leadEmails = cachedLeads.map(l => ({
        id: l.id,
        email: l.decisionMaker?.email
      })).filter(l => l.email);
      
      const result = await syncEmails(db, imapSettings, leadEmails);
      if (result.newEmails > 0) {
        await logAutomation(db, 'INBOX_SYNC', `Auto-synced ${result.newEmails} new emails`);
      }
    } catch (error) {
      console.error("Auto inbox sync error:", error.message);
    }
  }, 5 * 60 * 1000);
  
  automationIntervals.replyProcess = setInterval(async () => {
    try {
      const state = await db.get('SELECT is_running FROM automation_state WHERE id = 1');
      if (!state || !state.is_running) return;
      
      const processed = await processUnanalyzedReplies(db, null);
      if (processed > 0) {
        console.log(`Processed ${processed} replies`);
      }
    } catch (error) {
      console.error("Reply processing error:", error.message);
    }
  }, 2 * 60 * 1000);
  
  automationIntervals.emailQueue = setInterval(async () => {
    try {
      const state = await db.get('SELECT is_running FROM automation_state WHERE id = 1');
      if (!state || !state.is_running) return;
      
      let smtpConfig = cachedSmtpConfig;
      if (!smtpConfig || !smtpConfig.host) {
        smtpConfig = await loadSmtpConfigFromDb();
      }
      if (!smtpConfig || !smtpConfig.host) return;
      
      const result = await processPendingEmails(db, smtpConfig, nodemailer);
      if (result.sent > 0) {
        console.log(`Sent ${result.sent} queued emails`);
        await logAutomation(db, 'EMAIL_BATCH_SENT', `Sent ${result.sent} queued emails`);
      }
    } catch (error) {
      console.error("Email queue processing error:", error.message);
    }
  }, 60 * 1000);
}

// API Route: Send Email
app.post('/api/send-email', async (req, res) => {
    const { smtpConfig, email, leadId, publicUrl } = req.body;

    if (!smtpConfig || !email) {
        return res.status(400).json({ error: "Missing config or email data" });
    }

    try {
        const transporter = nodemailer.createTransport({
            host: smtpConfig.host,
            port: parseInt(smtpConfig.port),
            secure: smtpConfig.secure, 
            auth: { user: smtpConfig.user, pass: smtpConfig.pass },
        });

        // Inject Tracking Pixel if Public URL is present
        let htmlBody = email.message.replace(/\n/g, '<br>');
        if (publicUrl && leadId) {
            const pixelUrl = `${publicUrl}/api/track/open/${leadId}`;
            htmlBody += `<br><img src="${pixelUrl}" width="1" height="1" style="display:none;" />`;
        }

        const info = await transporter.sendMail({
            from: `"${email.fromName}" <${smtpConfig.user}>`,
            to: email.to,
            subject: email.subject,
            text: email.message, 
            html: htmlBody, 
        });

        // Log to DB
        if (db) {
            await db.run(
                'INSERT INTO email_logs (lead_id, to_email, subject, sent_at) VALUES (?, ?, ?, ?)',
                [leadId, email.to, email.subject, Date.now()]
            );
        }

        console.log("Message sent: %s", info.messageId);
        res.status(200).json({ success: true, messageId: info.messageId });

    } catch (error) {
        console.error("SMTP Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// API Route: Tracking Pixel
app.get('/api/track/open/:leadId', async (req, res) => {
    const { leadId } = req.params;
    console.log(`👁️ Email Opened by Lead: ${leadId}`);
    
    if (db) {
        await db.run(
            'INSERT INTO tracking_events (lead_id, type, timestamp) VALUES (?, ?, ?)',
            [leadId, 'OPEN', Date.now()]
        );
    }
    
    // Return transparent 1x1 GIF
    const img = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    res.writeHead(200, {
        'Content-Type': 'image/gif',
        'Content-Length': img.length,
    });
    res.end(img);
});

// API Route: Get Opens (For Frontend Polling)
app.get('/api/track/status', async (req, res) => {
    if (!db) return res.json({});
    try {
        const rows = await db.all('SELECT lead_id, MAX(timestamp) as last_open FROM tracking_events WHERE type="OPEN" GROUP BY lead_id');
        const map = {};
        rows.forEach(r => map[r.lead_id] = r.last_open);
        res.json(map);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// API Route: AI Chat Completion (using Replit AI Integrations)
app.post('/api/ai/chat', async (req, res) => {
    const { systemPrompt, userPrompt, model } = req.body;
    
    if (!systemPrompt || !userPrompt) {
        return res.status(400).json({ error: "Missing systemPrompt or userPrompt" });
    }
    
    try {
        const response = await openrouter.chat.completions.create({
            model: model || "meta-llama/llama-3.3-70b-instruct",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            max_tokens: 8192,
            temperature: 0.7
        });
        
        const content = response.choices[0]?.message?.content || "";
        res.json({ success: true, content });
    } catch (error) {
        console.error("AI Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// ======== IMAP SETTINGS API ========

// POST /api/imap/settings - Save IMAP configuration
app.post('/api/imap/settings', async (req, res) => {
    const { host, port, username, password, use_tls } = req.body;
    
    if (!host || !port || !username || !password) {
        return res.status(400).json({ error: "Missing required IMAP settings" });
    }
    
    try {
        const existing = await db.get('SELECT id FROM imap_settings WHERE id = 1');
        
        if (existing) {
            await db.run(
                'UPDATE imap_settings SET host = ?, port = ?, username = ?, password = ?, use_tls = ? WHERE id = 1',
                [host, parseInt(port), username, password, use_tls ? 1 : 0]
            );
        } else {
            await db.run(
                'INSERT INTO imap_settings (id, host, port, username, password, use_tls) VALUES (1, ?, ?, ?, ?, ?)',
                [host, parseInt(port), username, password, use_tls ? 1 : 0]
            );
        }
        
        res.json({ success: true, message: "IMAP settings saved" });
    } catch (error) {
        console.error("IMAP Settings Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/imap/settings - Get IMAP settings (password masked)
app.get('/api/imap/settings', async (req, res) => {
    try {
        const settings = await db.get('SELECT * FROM imap_settings WHERE id = 1');
        
        if (!settings) {
            return res.json({ 
                configured: false,
                host: 'imap.hostinger.com',
                port: 993,
                use_tls: true
            });
        }
        
        res.json({
            configured: true,
            host: settings.host,
            port: settings.port,
            username: settings.username,
            password: settings.password ? '********' : '',
            use_tls: settings.use_tls === 1,
            last_sync: settings.last_sync
        });
    } catch (error) {
        console.error("IMAP Settings Fetch Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/imap/test - Test IMAP connection
app.post('/api/imap/test', async (req, res) => {
    const { host, port, username, password, use_tls } = req.body;
    
    if (!host || !port || !username || !password) {
        return res.status(400).json({ error: "Missing required IMAP settings" });
    }
    
    try {
        const service = new ImapService({ host, port, username, password, use_tls });
        const result = await service.testConnection();
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/imap/sync - Trigger email sync from mailbox
app.post('/api/imap/sync', async (req, res) => {
    const { leadEmails } = req.body;
    
    try {
        const settings = await db.get('SELECT * FROM imap_settings WHERE id = 1');
        
        if (!settings) {
            return res.status(400).json({ error: "IMAP settings not configured" });
        }
        
        const result = await syncEmails(db, {
            host: settings.host,
            port: settings.port,
            username: settings.username,
            password: settings.password,
            use_tls: settings.use_tls === 1
        }, leadEmails || []);
        
        console.log(`📬 Email Sync Complete: ${result.newEmails} new, ${result.linkedEmails} linked`);
        res.json(result);
    } catch (error) {
        console.error("IMAP Sync Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// ======== INBOX API ========

// GET /api/inbox - List emails with pagination
app.get('/api/inbox', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const filter = req.query.filter;
    const type = req.query.type || 'received';  // 'received' or 'sent'
    
    try {
        let whereClause = '';
        const params = [];
        
        if (type === 'sent') {
            // Fetch sent emails from email_queue
            whereClause = 'WHERE status = ?';
            params.push('sent');
            
            const countRow = await db.get(`SELECT COUNT(*) as total FROM email_queue ${whereClause}`, params);
            const total = countRow?.total || 0;
            
            const emails = await db.all(
                `SELECT id, 'sent' as type, lead_id, 
                        'Smooth AI' as 'from', to_email as 'to', subject, 
                        SUBSTR(body, 1, 200) as preview, sent_at as date, 0 as isRead
                 FROM email_queue ${whereClause}
                 ORDER BY sent_at DESC
                 LIMIT ? OFFSET ?`,
                [...params, limit, offset]
            );
            
            return res.json({
                emails: emails.map(e => ({
                    id: `sent_${e.id}`,
                    type: 'sent',
                    lead_id: e.lead_id,
                    from: e.from || 'Smooth AI',
                    to: e.to,
                    subject: e.subject,
                    preview: e.preview,
                    date: new Date(e.date).toISOString(),
                    isRead: true,
                    leadName: e.leadName
                })),
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit)
                }
            });
        } else {
            // Fetch received emails from email_messages (original behavior)
            if (filter === 'unread') {
                whereClause = 'WHERE is_read = 0';
            } else if (filter === 'linked') {
                whereClause = 'WHERE lead_id IS NOT NULL';
            } else if (filter === 'unlinked') {
                whereClause = 'WHERE lead_id IS NULL';
            }
            
            const countRow = await db.get(`SELECT COUNT(*) as total FROM email_messages ${whereClause}`, params);
            const total = countRow?.total || 0;
            
            const emails = await db.all(
                `SELECT id, 'received' as type, external_id, lead_id, 
                        from_email as 'from', to_email as 'to', subject, 
                        SUBSTR(body_text, 1, 200) as preview, received_at as date, is_read as isRead, thread_id, created_at
                 FROM email_messages ${whereClause}
                 ORDER BY received_at DESC
                 LIMIT ? OFFSET ?`,
                [...params, limit, offset]
            );
            
            res.json({
                emails: emails.map(e => ({
                    id: e.id,
                    type: 'received',
                    lead_id: e.lead_id,
                    from: e.from,
                    to: e.to,
                    subject: e.subject,
                    preview: e.preview,
                    date: new Date(e.date).toISOString(),
                    isRead: e.isRead
                })),
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit)
                }
            });
        }
    } catch (error) {
        console.error("Inbox Fetch Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/inbox/:id - Get single email details
app.get('/api/inbox/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        // Check if this is a sent email (prefixed with "sent_")
        if (id.startsWith('sent_')) {
            const sentId = id.replace('sent_', '');
            const email = await db.get(
                `SELECT id, lead_id, lead_name,
                        'Smooth AI' as 'from', to_email as 'to', subject, 
                        body, body as body_html, sent_at as date, 1 as isRead
                 FROM email_queue WHERE id = ? AND status = 'sent'`, 
                [sentId]
            );
            
            if (!email) {
                return res.status(404).json({ error: "Sent email not found" });
            }
            
            return res.json({
                id: `sent_${email.id}`,
                type: 'sent',
                lead_id: email.lead_id,
                leadName: email.lead_name,
                from: email.from,
                to: email.to,
                subject: email.subject,
                body: email.body,
                body_html: email.body_html,
                date: new Date(email.date).toISOString(),
                isRead: true
            });
        }
        
        // Regular received email
        const email = await db.get(
            `SELECT id, external_id, lead_id, 
                    from_email as 'from', to_email as 'to', subject, 
                    body_text as body, body_html, received_at as date, is_read as isRead, thread_id, created_at
             FROM email_messages WHERE id = ?`, 
            [id]
        );
        
        if (!email) {
            return res.status(404).json({ error: "Email not found" });
        }
        
        if (!email.isRead) {
            await db.run('UPDATE email_messages SET is_read = 1 WHERE id = ?', [id]);
            email.isRead = 1;
        }
        
        res.json(email);
    } catch (error) {
        console.error("Email Fetch Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/inbox/:id/link/:leadId - Link email to a lead
app.post('/api/inbox/:id/link/:leadId', async (req, res) => {
    const { id, leadId } = req.params;
    
    try {
        const email = await db.get('SELECT id FROM email_messages WHERE id = ?', [id]);
        
        if (!email) {
            return res.status(404).json({ error: "Email not found" });
        }
        
        await db.run('UPDATE email_messages SET lead_id = ? WHERE id = ?', [leadId, id]);
        
        res.json({ success: true, message: `Email ${id} linked to lead ${leadId}` });
    } catch (error) {
        console.error("Link Email Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/inbox/:id/unlink - Unlink email from lead
app.post('/api/inbox/:id/unlink', async (req, res) => {
    const { id } = req.params;
    
    try {
        const email = await db.get('SELECT id FROM email_messages WHERE id = ?', [id]);
        
        if (!email) {
            return res.status(404).json({ error: "Email not found" });
        }
        
        await db.run('UPDATE email_messages SET lead_id = NULL WHERE id = ?', [id]);
        
        res.json({ success: true, message: `Email ${id} unlinked from lead` });
    } catch (error) {
        console.error("Unlink Email Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/inbox/lead/:leadId - Get emails for a specific lead
app.get('/api/inbox/lead/:leadId', async (req, res) => {
    const { leadId } = req.params;
    
    try {
        const emails = await db.all(
            `SELECT id, external_id, from_email, to_email, subject, 
                    SUBSTR(body_text, 1, 200) as preview, received_at, is_read, thread_id
             FROM email_messages 
             WHERE lead_id = ?
             ORDER BY received_at DESC`,
            [leadId]
        );
        
        res.json({ emails });
    } catch (error) {
        console.error("Lead Emails Fetch Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/inbox/:id - Delete an email
app.delete('/api/inbox/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        const email = await db.get('SELECT id FROM email_messages WHERE id = ?', [id]);
        
        if (!email) {
            return res.status(404).json({ error: "Email not found" });
        }
        
        await db.run('DELETE FROM email_messages WHERE id = ?', [id]);
        
        res.json({ success: true, message: `Email ${id} deleted` });
    } catch (error) {
        console.error("Delete Email Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// ============ AUTOMATION API ENDPOINTS ============

// GET /api/automation/status - Get automation status and stats
app.get('/api/automation/status', async (req, res) => {
    try {
        const stats = await getAutomationStats(db);
        res.json(stats);
    } catch (error) {
        console.error("Automation Status Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/automation/toggle - Enable/disable automation
app.post('/api/automation/toggle', async (req, res) => {
    const enabled = req.body.enabled ?? req.body.enable ?? false;
    
    try {
        const result = await toggleAutomation(db, enabled);
        res.json({ success: true, isRunning: result });
    } catch (error) {
        console.error("Automation Toggle Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/automation/daily-limit - Update daily email limit
app.post('/api/automation/daily-limit', async (req, res) => {
    const { limit } = req.body;
    
    if (!limit || limit < 1 || limit > 200) {
        return res.status(400).json({ error: "Limit must be between 1 and 200" });
    }
    
    try {
        const result = await updateDailyLimit(db, limit);
        res.json({ success: true, dailyLimit: result });
    } catch (error) {
        console.error("Daily Limit Update Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/automation/queue-email - Queue an email for sending (with server-side quality gate)
app.post('/api/automation/queue-email', async (req, res) => {
    const { lead, emailDraft, sequenceStep, delayMinutes } = req.body;
    
    if (!lead || !emailDraft) {
        return res.status(400).json({ error: "Missing lead or email draft" });
    }
    
    try {
        const result = await queueEmailForLead(db, lead, emailDraft, sequenceStep || 0, delayMinutes || 0);
        
        if (!result.success) {
            return res.status(400).json({ 
                error: result.reason, 
                researchQuality: result.researchQuality,
                message: `Email blocked: research quality ${result.researchQuality}/10 is below the required minimum of 5/10`
            });
        }
        
        res.json({ success: true, message: "Email queued successfully" });
    } catch (error) {
        console.error("Queue Email Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/automation/sync-leads - Update cached leads for automation
app.post('/api/automation/sync-leads', async (req, res) => {
    const { leads } = req.body;
    
    try {
        cachedLeads = leads || [];
        res.json({ success: true, count: cachedLeads.length });
    } catch (error) {
        console.error("Sync Leads Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/automation/sync-smtp - Update cached SMTP config for automation
app.post('/api/automation/sync-smtp', async (req, res) => {
    const { smtpConfig } = req.body;
    
    try {
        cachedSmtpConfig = smtpConfig;
        res.json({ success: true });
    } catch (error) {
        console.error("Sync SMTP Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/automation/queue - Get email queue status
app.get('/api/automation/queue', async (req, res) => {
    try {
        const pending = await db.all(
            `SELECT * FROM email_queue WHERE status = 'pending' ORDER BY scheduled_for ASC LIMIT 20`
        );
        const sent = await db.all(
            `SELECT * FROM email_queue WHERE status = 'sent' ORDER BY sent_at DESC LIMIT 20`
        );
        const failed = await db.all(
            `SELECT * FROM email_queue WHERE status = 'failed' ORDER BY created_at DESC LIMIT 10`
        );
        res.json({ pending, sent, failed });
    } catch (error) {
        console.error("Queue Fetch Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/automation/replies - Get analyzed replies
app.get('/api/automation/replies', async (req, res) => {
    try {
        const replies = await db.all(`
            SELECT ra.*, em.from_email, em.subject as email_subject
            FROM reply_analysis ra
            JOIN email_messages em ON ra.email_id = em.id
            ORDER BY ra.processed_at DESC
            LIMIT 50
        `);
        res.json({ replies });
    } catch (error) {
        console.error("Replies Fetch Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/automation/process-replies - Manually trigger reply processing
app.post('/api/automation/process-replies', async (req, res) => {
    try {
        const processed = await processUnanalyzedReplies(db, null);
        res.json({ success: true, processed });
    } catch (error) {
        console.error("Process Replies Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/automation/send-queued - Manually trigger sending queued emails
app.post('/api/automation/send-queued', async (req, res) => {
    if (!cachedSmtpConfig || !cachedSmtpConfig.host) {
        return res.status(400).json({ error: "SMTP not configured" });
    }
    
    try {
        const result = await processPendingEmails(db, cachedSmtpConfig, nodemailer);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error("Send Queued Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/automation/logs - Get automation activity logs
app.get('/api/automation/logs', async (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    
    try {
        const logs = await db.all(
            `SELECT * FROM automation_logs ORDER BY created_at DESC LIMIT ?`,
            [limit]
        );
        res.json({ logs });
    } catch (error) {
        console.error("Logs Fetch Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/automation/approve-email/:id - Approve and send a specific email immediately
app.post('/api/automation/approve-email/:id', async (req, res) => {
    const { id } = req.params;
    const { subject, body } = req.body;
    
    if (!cachedSmtpConfig || !cachedSmtpConfig.host) {
        return res.status(400).json({ error: "SMTP not configured. Go to Settings > Email Configuration." });
    }
    
    try {
        const email = await db.get('SELECT * FROM email_queue WHERE id = ? AND status = ?', [id, 'pending']);
        if (!email) {
            return res.status(404).json({ error: "Email not found or already processed" });
        }
        
        if (subject || body) {
            await db.run(
                'UPDATE email_queue SET subject = COALESCE(?, subject), body = COALESCE(?, body), approved_by = ?, approved_at = ? WHERE id = ?',
                [subject || null, body || null, 'manual_review', Date.now(), id]
            );
        } else {
            await db.run(
                'UPDATE email_queue SET approved_by = ?, approved_at = ? WHERE id = ?',
                ['manual_review', Date.now(), id]
            );
        }
        
        const updatedEmail = await db.get('SELECT * FROM email_queue WHERE id = ?', [id]);
        
        const transporter = nodemailer.createTransport({
            host: cachedSmtpConfig.host,
            port: parseInt(cachedSmtpConfig.port) || 465,
            secure: true,
            auth: {
                user: cachedSmtpConfig.user,
                pass: cachedSmtpConfig.pass
            }
        });
        
        let htmlBody = updatedEmail.body?.replace(/\n/g, '<br>') || '';
        if (cachedSmtpConfig.publicUrl) {
            htmlBody += `<img src="${cachedSmtpConfig.publicUrl}/api/track/open/${updatedEmail.lead_id}" width="1" height="1" style="display:none" />`;
        }
        
        await transporter.sendMail({
            from: cachedSmtpConfig.user,
            to: updatedEmail.to_email,
            subject: updatedEmail.subject,
            text: updatedEmail.body,
            html: htmlBody
        });
        
        await db.run(
            'UPDATE email_queue SET status = ?, sent_at = ? WHERE id = ?',
            ['sent', Date.now(), id]
        );
        
        await logAutomation(db, 'EMAIL_APPROVED_SENT', `Manually reviewed & sent: ${updatedEmail.subject} to ${updatedEmail.to_email}`, { leadName: updatedEmail.lead_name, approvedBy: 'manual_review' });
        
        res.json({ success: true, message: 'Email approved and sent successfully' });
    } catch (error) {
        console.error("Approve Email Error:", error);
        
        await db.run(
            'UPDATE email_queue SET status = ?, last_error = ?, attempts = attempts + 1 WHERE id = ?',
            ['failed', error.message, id]
        );
        
        await logAutomation(db, 'EMAIL_SEND_FAILED', `Failed to send approved email: ${error.message}`, { emailId: id, error: error.message });
        
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/automation/queue/:id - Remove email from queue
app.delete('/api/automation/queue/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        await db.run('DELETE FROM email_queue WHERE id = ? AND status = ?', [id, 'pending']);
        res.json({ success: true });
    } catch (error) {
        console.error("Queue Delete Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/automation/retry-failed - Retry failed emails
app.post('/api/automation/retry-failed', async (req, res) => {
    try {
        await db.run(
            `UPDATE email_queue SET status = 'pending', attempts = 0, last_error = NULL WHERE status = 'failed'`
        );
        const count = await db.get('SELECT changes() as count');
        res.json({ success: true, retriedCount: count?.count || 0 });
    } catch (error) {
        console.error("Retry Failed Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// ============ RESEARCH API ENDPOINTS ============

// POST /api/research/conduct - Conduct full research on a company
app.post('/api/research/conduct', async (req, res) => {
    const { companyName, websiteUrl, serviceProfile } = req.body;
    
    if (!companyName || !websiteUrl) {
        return res.status(400).json({ error: "Company name and website URL are required" });
    }
    
    try {
        console.log(`🔍 API: Starting research for ${companyName}`);
        const research = await conductFullResearch(companyName, websiteUrl, serviceProfile);
        
        const formatted = formatResearchForEmail(research);
        
        res.json({
            success: research.researchQuality >= 5,
            research,
            formatted,
            quality: research.researchQuality,
            message: research.researchQuality >= 5 
                ? `Research complete with quality score ${research.researchQuality}/10`
                : `Research quality too low (${research.researchQuality}/10). Need more data before emailing.`
        });
    } catch (error) {
        console.error("Research Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/research/scrape - Quick scrape of a single URL
app.post('/api/research/scrape', async (req, res) => {
    const { url } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: "URL is required" });
    }
    
    try {
        const result = await scrapeWebsite(url);
        res.json(result);
    } catch (error) {
        console.error("Scrape Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/research/generate-email - Generate email with research data
app.post('/api/research/generate-email', async (req, res) => {
    const { lead, research, serviceProfile } = req.body;
    
    if (!lead || !research) {
        return res.status(400).json({ error: "Lead and research data are required" });
    }
    
    if (research.researchQuality < 9) {
        return res.status(400).json({ 
            error: "Research quality too low. Must be at least 9/10 to generate email.",
            quality: research.researchQuality
        });
    }
    
    try {
        const prompt = `You are an expert B2B cold email copywriter. Write a highly personalized email based on REAL research data.

CRITICAL RULES:
1. ONLY reference facts from the research data below - never make things up
2. The email must mention at least 2 specific facts about the company
3. Keep it under 100 words
4. Be conversational, not salesy
5. End with a soft call-to-action (question, not demand)

RECIPIENT COMPANY:
Name: ${lead.companyName}
Website: ${lead.website}

RESEARCH DATA (USE THIS - IT'S REAL):
Company Overview: ${research.companyOverview || research.aiAnalysis?.companyOverview}
Industry: ${research.industryVertical || research.aiAnalysis?.industryVertical}
Their Services: ${JSON.stringify(research.keyServices || research.aiAnalysis?.keyServices)}
Pain Points Identified: ${JSON.stringify(research.potentialPainPoints || research.aiAnalysis?.potentialPainPoints)}
Recent Triggers/News: ${JSON.stringify(research.recentTriggers || research.aiAnalysis?.recentTriggers)}
Best Outreach Angle: ${research.outreachAngle || research.aiAnalysis?.outreachAngle}
Personalized Hooks: ${JSON.stringify(research.personalizedHooks || research.aiAnalysis?.personalizedHooks)}
Key People: ${JSON.stringify(research.keyPeople || research.aiAnalysis?.keyPeople)}

CONTACT:
Name: ${lead.decisionMaker?.name || 'there'}
Role: ${lead.decisionMaker?.role || 'Decision Maker'}

OUR SERVICE:
${serviceProfile?.description || 'AI-powered automation solutions that help businesses streamline operations'}

Value Proposition: ${serviceProfile?.valueProposition || 'Reduce manual work by 70% and free up time for strategic initiatives'}

Sender Name: ${serviceProfile?.senderName || 'Nick'}

Return a JSON object:
{
  "subject": "Short, personalized subject referencing something specific about them",
  "body": "The email body with specific references to their company/situation",
  "usedFacts": ["list", "of", "specific", "facts", "from", "research", "used", "in", "email"],
  "angle": "The approach taken"
}

Return ONLY valid JSON.`;

        const response = await openrouter.chat.completions.create({
            model: "meta-llama/llama-3.3-70b-instruct",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
            max_tokens: 800
        });

        const content = response.choices[0]?.message?.content || '';
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        
        if (!jsonMatch) {
            throw new Error('Failed to generate valid email');
        }
        
        const emailDraft = JSON.parse(jsonMatch[0]);
        
        res.json({
            success: true,
            email: emailDraft,
            researchQuality: research.researchQuality
        });
    } catch (error) {
        console.error("Email Generation Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Serve React App
const distPath = join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
        res.sendFile(join(distPath, 'index.html'));
    });
} else {
    console.log("Dev Mode: API Server running.");
}

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on 0.0.0.0:${PORT}`);
});
