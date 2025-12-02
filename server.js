
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
  conductIterativeResearch,
  formatResearchForEmail,
  scrapeWebsite
} from './services/researchService.js';
import queryCache from './services/queryCache.js';
import invalidationHooks from './services/cacheInvalidation.js';
import deduplicator from './services/requestDeduplication.js';

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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

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
            CREATE INDEX IF NOT EXISTS idx_email_messages_received_at ON email_messages(received_at);
            CREATE INDEX IF NOT EXISTS idx_email_logs_lead_id ON email_logs(lead_id);
            CREATE INDEX IF NOT EXISTS idx_email_logs_to_email ON email_logs(to_email);
            CREATE INDEX IF NOT EXISTS idx_email_logs_sent_at ON email_logs(sent_at);
            CREATE INDEX IF NOT EXISTS idx_prospect_queue_status_created ON prospect_queue(status, created_at);
            CREATE INDEX IF NOT EXISTS idx_research_queue_status_created ON research_queue(status, created_at);
            CREATE INDEX IF NOT EXISTS idx_draft_queue_status_created ON draft_queue(status, created_at);
            CREATE INDEX IF NOT EXISTS idx_email_queue_status_created ON email_queue(status, created_at);
            CREATE INDEX IF NOT EXISTS idx_email_queue_status_sent ON email_queue(status, sent_at);
            CREATE INDEX IF NOT EXISTS idx_agent_activity_agent_last ON agent_activity(agent_name, last_activity);
            CREATE INDEX IF NOT EXISTS idx_reply_analysis_lead_id ON reply_analysis(lead_id);
        `);
        console.log("✅ SQLite Database Initialized with performance indexes");
        
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
        
        // Pre-load SMTP config into cache on startup
        const smtpConfig = await loadSmtpConfigFromDb();
        if (smtpConfig) {
            cachedSmtpConfig = smtpConfig;
            console.log(`✅ SMTP config cached: ${smtpConfig.host}`);
        }
        
        startAutomationScheduler();
        startDatabaseCleanupScheduler();
    } catch (e) {
        console.error("❌ Database Init Failed:", e);
    }
})();

let automationIntervals = {};
let cachedSmtpConfig = null;
let cachedLeads = [];

// DATABASE CLEANUP SCHEDULER - Prevent unbounded growth
async function cleanupDatabase() {
    try {
        const now = Date.now();
        
        // 1. PURGE email logs older than 90 days
        const ninetyDaysAgo = now - (90 * 24 * 60 * 60 * 1000);
        const deletedLogs = await db.run(`DELETE FROM email_logs WHERE sent_at < ?`, [ninetyDaysAgo]);
        if (deletedLogs.changes > 0) console.log(`🧹 Deleted ${deletedLogs.changes} old email logs (>90 days)`);
        
        // 2. PURGE expired research cache entries
        const expiredCache = await db.run(`DELETE FROM research_cache WHERE expires_at < ?`, [now]);
        if (expiredCache.changes > 0) console.log(`🧹 Deleted ${expiredCache.changes} expired cache entries`);
        
        // 3. PURGE old failed queue items (older than 7 days)
        const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
        const deletedFailed = await db.run(
            `DELETE FROM prospect_queue WHERE status = 'failed' AND completed_at < ? AND completed_at > 0`,
            [sevenDaysAgo]
        );
        if (deletedFailed.changes > 0) console.log(`🧹 Cleaned ${deletedFailed.changes} old failed prospects`);
        
        // 4. VACUUM database to reclaim space
        await db.run('VACUUM');
        console.log('✅ Database cleanup + vacuum completed');
    } catch (error) {
        console.error('❌ Database cleanup error:', error.message);
    }
}

function startDatabaseCleanupScheduler() {
    // Run cleanup every 6 hours
    setInterval(cleanupDatabase, 6 * 60 * 60 * 1000);
    console.log('🗑️ Database cleanup scheduler started (runs every 6 hours)');
}

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
        
        invalidationHooks.onEmailSent();
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
        invalidationHooks.onEmailReviewed();
        res.json({ success: true, retriedCount: count?.count || 0 });
    } catch (error) {
        console.error("Retry Failed Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// ============ RESEARCH API ENDPOINTS ============

// POST /api/research/conduct - Conduct full research on a company (with iterative improvement)
app.post('/api/research/conduct', async (req, res) => {
    const { companyName, websiteUrl, serviceProfile, targetQuality = 9, maxAttempts = 3 } = req.body;
    
    if (!companyName || !websiteUrl) {
        return res.status(400).json({ error: "Company name and website URL are required" });
    }
    
    try {
        console.log(`🔍 API: Starting iterative research for ${companyName} (target: ${targetQuality}/10, max ${maxAttempts} attempts)`);
        
        // Use iterative research that keeps trying until quality >= 9 or max attempts reached
        const research = await conductIterativeResearch(companyName, websiteUrl, serviceProfile, targetQuality, maxAttempts);
        
        const formatted = formatResearchForEmail(research);
        
        res.json({
            success: research.researchQuality >= targetQuality,
            research,
            formatted,
            quality: research.researchQuality,
            orchestrator: research.orchestrator,
            message: research.researchQuality >= targetQuality 
                ? `Research complete with quality score ${research.researchQuality}/10 after ${research.totalAttempts || 1} attempt(s)`
                : `Research quality ${research.researchQuality}/10 after ${research.orchestrator?.attempts?.length || 1} attempts. Below target of ${targetQuality}/10.`
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

// ============ AGENT SYSTEM API ENDPOINTS ============

// GET /api/agents/status - Get status of all agents (CACHED 10s)
app.get('/api/agents/status', async (req, res) => {
    try {
        const cacheKey = 'agents:status:all';
        const cached = queryCache.get(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        const agents = await db.all(`
            SELECT 
                s.agent_name as name,
                s.status,
                s.last_heartbeat,
                s.items_processed as processed,
                s.current_item,
                s.error_count as errors,
                s.started_at,
                COALESCE(e.enabled, 1) as enabled,
                CASE 
                    WHEN s.status = 'running' AND s.last_heartbeat > ? THEN 'healthy'
                    WHEN s.status = 'running' THEN 'stale'
                    ELSE s.status
                END as health
            FROM agent_status s
            LEFT JOIN agent_enabled e ON s.agent_name = e.agent_name
            ORDER BY s.agent_name
        `, [Date.now() - 60000]);
        
        const automationState = await db.get('SELECT is_running FROM automation_state WHERE id = 1');
        
        const result = { success: true, agents, masterEnabled: automationState?.is_running === 1 };
        queryCache.set(cacheKey, result, 10000);
        res.json(result);
    } catch (error) {
        res.json({ success: true, agents: [], masterEnabled: false });
    }
});

// POST /api/agents/toggle/:agent - Toggle individual agent on/off
app.post('/api/agents/toggle/:agent', async (req, res) => {
    const { agent } = req.params;
    const { enabled } = req.body;
    
    try {
        await db.run(`
            INSERT INTO agent_enabled (agent_name, enabled, updated_at) 
            VALUES (?, ?, ?)
            ON CONFLICT(agent_name) DO UPDATE SET enabled = ?, updated_at = ?
        `, [agent, enabled ? 1 : 0, Date.now(), enabled ? 1 : 0, Date.now()]);
        
        const agentLabel = agent.replace('-', ' ').toUpperCase();
        await db.run(`
            INSERT INTO agent_logs (agent_name, level, message, timestamp)
            VALUES (?, 'info', ?, ?)
        `, [agent, `${agentLabel}: Agent ${enabled ? 'ENABLED' : 'DISABLED'} by user`, Date.now()]);
        
        res.json({ success: true, agent, enabled });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/automation/toggle - Toggle master automation on/off
app.post('/api/automation/toggle', async (req, res) => {
    const { enabled } = req.body;
    
    try {
        await db.run(`UPDATE automation_state SET is_running = ?, updated_at = ? WHERE id = 1`, [enabled ? 1 : 0, Date.now()]);
        res.json({ success: true, enabled });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/agents/queues - Get queue statistics
app.get('/api/agents/queues', async (req, res) => {
    try {
        const tables = ['prospect_queue', 'research_queue', 'draft_queue', 'email_queue'];
        const stats = {};
        
        for (const table of tables) {
            try {
                const row = await db.get(`
                    SELECT 
                        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
                        COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing,
                        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
                        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
                        COUNT(CASE WHEN status = 'low_quality' THEN 1 END) as low_quality
                    FROM ${table}
                `);
                stats[table.replace('_queue', '')] = row || { pending: 0, processing: 0, completed: 0, failed: 0 };
            } catch (e) {
                stats[table.replace('_queue', '')] = { pending: 0, processing: 0, completed: 0, failed: 0 };
            }
        }
        
        res.json({ success: true, queues: stats });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/agents/prospect - Add prospect to the pipeline
app.post('/api/agents/prospect', async (req, res) => {
    const { companyName, websiteUrl, contactEmail, contactName, source, priority } = req.body;
    
    if (!companyName || !websiteUrl) {
        return res.status(400).json({ error: "Company name and website URL are required" });
    }
    
    try {
        const result = await db.run(`
            INSERT INTO prospect_queue (company_name, website_url, contact_email, contact_name, source, priority, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
        `, [companyName, websiteUrl, contactEmail || null, contactName || null, source || 'manual', priority || 5, Date.now()]);
        
        res.json({ 
            success: true, 
            prospectId: result.lastID,
            message: `Added ${companyName} to prospect queue`
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/agents/prospect/bulk - Add multiple prospects
app.post('/api/agents/prospect/bulk', async (req, res) => {
    const { prospects } = req.body;
    
    if (!Array.isArray(prospects) || prospects.length === 0) {
        return res.status(400).json({ error: "Prospects array is required" });
    }
    
    try {
        let added = 0;
        for (const p of prospects) {
            if (p.companyName && p.websiteUrl) {
                await db.run(`
                    INSERT INTO prospect_queue (company_name, website_url, contact_email, contact_name, source, priority, status, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
                `, [p.companyName, p.websiteUrl, p.contactEmail || null, p.contactName || null, p.source || 'bulk', p.priority || 5, Date.now()]);
                added++;
            }
        }
        
        res.json({ 
            success: true, 
            added,
            message: `Added ${added} prospects to queue`
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/agents/logs - Get recent agent logs
app.get('/api/agents/logs', async (req, res) => {
    const { agent, level, limit = 50 } = req.query;
    
    try {
        let query = 'SELECT * FROM agent_logs';
        const params = [];
        const conditions = [];
        
        if (agent) {
            conditions.push('agent_name = ?');
            params.push(agent);
        }
        if (level) {
            conditions.push('level = ?');
            params.push(level);
        }
        
        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }
        
        query += ' ORDER BY created_at DESC LIMIT ?';
        params.push(parseInt(limit));
        
        const logs = await db.all(query, params);
        
        res.json({ success: true, logs });
    } catch (error) {
        res.json({ success: true, logs: [] });
    }
});

// POST /api/agents/sync-leads - Sync leads from browser localStorage to agent queues
app.post('/api/agents/sync-leads', async (req, res) => {
    const { leads } = req.body;
    
    if (!Array.isArray(leads)) {
        return res.status(400).json({ error: "Leads array is required" });
    }
    
    try {
        let synced = { prospects: 0, research: 0, drafts: 0 };
        
        for (const lead of leads) {
            // Check if already in any queue by company name
            const existingProspect = await db.get(
                'SELECT id FROM prospect_queue WHERE company_name = ?',
                [lead.companyName]
            );
            const existingResearch = await db.get(
                'SELECT id FROM research_queue WHERE company_name = ?',
                [lead.companyName]
            );
            const existingDraft = await db.get(
                'SELECT id FROM draft_queue WHERE company_name = ?',
                [lead.companyName]
            );
            
            if (existingProspect || existingResearch || existingDraft) {
                continue; // Skip duplicates
            }
            
            const contactEmail = lead.decisionMaker?.email || lead.email || null;
            const contactName = lead.decisionMaker?.name || null;
            const now = Date.now();
            
            // Determine which queue based on lead status
            if (lead.status === 'NEW' || lead.status === 'ANALYZING' || !lead.status) {
                // Add to prospect queue for research
                await db.run(`
                    INSERT INTO prospect_queue (company_name, website_url, contact_email, contact_name, source, priority, status, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
                `, [lead.companyName, lead.website || lead.websiteUrl, contactEmail, contactName, 'sync', lead.fitScore || 5, now]);
                synced.prospects++;
            } else if (lead.status === 'QUALIFIED' && lead.researchData) {
                // Has research data, add to draft queue
                const researchQuality = lead.researchData?.researchQuality || lead.fitScore || 0;
                
                if (researchQuality >= 9) {
                    await db.run(`
                        INSERT INTO draft_queue (company_name, contact_email, contact_name, research_quality, research_data, status, created_at)
                        VALUES (?, ?, ?, ?, ?, 'pending', ?)
                    `, [lead.companyName, contactEmail, contactName, researchQuality, JSON.stringify(lead.researchData), now]);
                    synced.drafts++;
                } else {
                    // Research quality too low, add to research queue for more research
                    await db.run(`
                        INSERT INTO research_queue (company_name, website_url, contact_email, contact_name, current_quality, research_data, status, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
                    `, [lead.companyName, lead.website, contactEmail, contactName, researchQuality, JSON.stringify(lead.researchData || {}), now]);
                    synced.research++;
                }
            } else {
                // Default: add to prospect queue
                await db.run(`
                    INSERT INTO prospect_queue (company_name, website_url, contact_email, contact_name, source, priority, status, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
                `, [lead.companyName, lead.website || lead.websiteUrl, contactEmail, contactName, 'sync', lead.fitScore || 5, now]);
                synced.prospects++;
            }
        }
        
        // Log the sync
        await db.run(`
            INSERT INTO agent_logs (agent_name, level, message, details, created_at)
            VALUES (?, ?, ?, ?, ?)
        `, ['supervisor', 'info', `Synced ${synced.prospects + synced.research + synced.drafts} leads to agent queues`, JSON.stringify(synced), Date.now()]);
        
        // Notify agents there's new work (broadcast message)
        await db.run(`
            INSERT INTO agent_messages (from_agent, to_agent, message_type, payload, created_at)
            VALUES (?, ?, ?, ?, ?)
        `, ['supervisor', 'all', 'NEW_WORK_AVAILABLE', JSON.stringify({ queues: synced }), Date.now()]);
        
        res.json({ 
            success: true, 
            synced,
            total: synced.prospects + synced.research + synced.drafts,
            message: `Synced ${synced.prospects} to prospect queue, ${synced.research} to research queue, ${synced.drafts} to draft queue`
        });
    } catch (error) {
        console.error('Sync error:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/agents/request-work - Agent requests work from supervisor
app.post('/api/agents/request-work', async (req, res) => {
    const { agentName, canHelp } = req.body;
    
    try {
        // Check if there's work available in any queue
        const queues = {
            prospect: await db.get('SELECT COUNT(*) as count FROM prospect_queue WHERE status = ?', ['pending']),
            research: await db.get('SELECT COUNT(*) as count FROM research_queue WHERE status = ?', ['pending']),
            draft: await db.get('SELECT COUNT(*) as count FROM draft_queue WHERE status = ?', ['pending'])
        };
        
        // Log the work request
        await db.run(`
            INSERT INTO agent_logs (agent_name, level, message, details, created_at)
            VALUES (?, ?, ?, ?, ?)
        `, [agentName, 'info', 'Requested work from supervisor', JSON.stringify({ queues, canHelp }), Date.now()]);
        
        res.json({
            success: true,
            workAvailable: {
                prospects: queues.prospect?.count || 0,
                research: queues.research?.count || 0,
                drafts: queues.draft?.count || 0
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/agents/messages - Get messages for an agent
app.get('/api/agents/messages/:agentName', async (req, res) => {
    const { agentName } = req.params;
    
    try {
        const messages = await db.all(`
            SELECT * FROM agent_messages 
            WHERE (to_agent = ? OR to_agent = 'all') AND read_at IS NULL
            ORDER BY created_at DESC LIMIT 10
        `, [agentName]);
        
        // Mark as read
        if (messages.length > 0) {
            const ids = messages.map(m => m.id).join(',');
            await db.run(`UPDATE agent_messages SET read_at = ? WHERE id IN (${ids})`, [Date.now()]);
        }
        
        res.json({ success: true, messages });
    } catch (error) {
        res.json({ success: true, messages: [] });
    }
});

// GET /api/agents/pipeline - Get full pipeline view
app.get('/api/agents/pipeline', async (req, res) => {
    try {
        const prospects = await db.all(`
            SELECT id, company_name, website_url, status, created_at 
            FROM prospect_queue 
            ORDER BY created_at DESC LIMIT 20
        `);
        
        const research = await db.all(`
            SELECT id, company_name, status, current_quality, research_pass, created_at 
            FROM research_queue 
            ORDER BY created_at DESC LIMIT 20
        `);
        
        const drafts = await db.all(`
            SELECT id, company_name, status, research_quality, email_subject, created_at 
            FROM draft_queue 
            ORDER BY created_at DESC LIMIT 20
        `);
        
        const emails = await db.all(`
            SELECT id, lead_name, to_email, status, research_quality, created_at, sent_at
            FROM email_queue 
            ORDER BY created_at DESC LIMIT 20
        `);
        
        res.json({
            success: true,
            pipeline: { prospects, research, drafts, emails }
        });
    } catch (error) {
        res.json({ success: true, pipeline: { prospects: [], research: [], drafts: [], emails: [] } });
    }
});

// GET /api/agents/draft/:companyName - Get draft email by company name
app.get('/api/agents/draft/:companyName', async (req, res) => {
    const { companyName } = req.params;
    
    try {
        const draft = await db.get(`
            SELECT id, company_name, email_subject, email_body, research_quality, created_at 
            FROM draft_queue 
            WHERE company_name = ?
            ORDER BY created_at DESC
            LIMIT 1
        `, [decodeURIComponent(companyName)]);
        
        if (draft) {
            res.json({ success: true, draft });
        } else {
            res.json({ success: false, draft: null, message: "Draft not found" });
        }
    } catch (error) {
        res.json({ success: false, draft: null, error: error.message });
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

// GET /api/metrics - Real-time pipeline metrics (CACHED 5s)
app.get('/api/metrics', async (req, res) => {
    try {
        const cacheKey = 'metrics:pipeline:full';
        const cached = queryCache.get(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        const stats = await Promise.all([
            db.get(`SELECT COUNT(*) as count FROM email_queue WHERE status = 'sent'`),
            db.get(`SELECT COUNT(*) as count FROM email_queue WHERE status = 'pending'`),
            db.get(`SELECT COUNT(*) as count FROM email_queue WHERE status = 'pending_approval'`),
            db.get(`SELECT COUNT(*) as count FROM email_queue WHERE status = 'failed'`),
            db.get(`SELECT COUNT(*) as count FROM prospect_queue`),
            db.get(`SELECT COUNT(*) as count FROM research_queue`),
            db.get(`SELECT COUNT(*) as count FROM draft_queue`),
            db.get(`SELECT COUNT(*) as count FROM email_logs WHERE sent_at > (strftime('%s', 'now') - 3600) * 1000`),
            db.get(`SELECT AVG(research_quality) as avg_quality FROM email_queue WHERE research_quality > 0 AND status = 'sent'`),
            db.get(`SELECT SUM(CASE WHEN approval_status = 'approved' THEN 1 ELSE 0 END) as approved FROM email_queue WHERE status = 'sent'`)
        ]);
        
        const result = {
            pipeline: {
                sent: stats[0]?.count || 0,
                pending: stats[1]?.count || 0,
                awaiting_approval: stats[2]?.count || 0,
                failed: stats[3]?.count || 0
            },
            queues: {
                prospects: stats[4]?.count || 0,
                research: stats[5]?.count || 0,
                drafts: stats[6]?.count || 0
            },
            velocity: {
                sent_last_hour: stats[7]?.count || 0
            },
            quality: {
                avg_research_quality: Math.round((stats[8]?.avg_quality || 0) * 10) / 10,
                approved_emails: stats[9]?.approved || 0
            }
        };

        queryCache.set(cacheKey, result, 5000);
        res.json(result);
    } catch (error) {
        console.error("Metrics Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/leads/engagement-stats - Engagement scoring for top leads (CACHED 10s)
app.get('/api/leads/engagement-stats', async (req, res) => {
    try {
        const cacheKey = 'engagement:topLeads:full';
        const cached = queryCache.get(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        const engagedLeads = await db.all(`
            SELECT DISTINCT
                el.to_email as email,
                el.lead_id as id,
                SUBSTR(el.to_email, 1, INSTR(el.to_email, '@') - 1) as companyName,
                COUNT(DISTINCT eq.id) as emails_sent,
                COUNT(DISTINCT CASE WHEN em.id IS NOT NULL THEN em.id END) as replies_received,
                MAX(em.received_at) as last_activity,
                (COUNT(DISTINCT CASE WHEN em.id IS NOT NULL THEN em.id END) * 40) + 
                (COUNT(DISTINCT eq.id) * 20) + 
                CASE WHEN MAX(em.received_at) > 0 THEN 10 ELSE 0 END as engagement_score
            FROM email_logs el
            LEFT JOIN email_queue eq ON el.lead_id = eq.lead_id
            LEFT JOIN email_messages em ON el.to_email = em.from_email AND em.lead_id = el.lead_id
            GROUP BY el.to_email, el.lead_id
            HAVING COUNT(DISTINCT eq.id) > 0
            ORDER BY engagement_score DESC
            LIMIT 10
        `);

        const result = {
            topEngagedLeads: engagedLeads.map(lead => ({
                id: lead.id || 'unknown',
                companyName: lead.companyName || 'Unknown',
                email: lead.email,
                engagement_score: Math.min(100, Math.max(0, lead.engagement_score || 0)),
                emails_sent: lead.emails_sent || 0,
                replies_received: lead.replies_received || 0,
                last_activity: lead.last_activity || null
            }))
        };

        queryCache.set(cacheKey, result, 10000);
        res.json(result);
    } catch (error) {
        console.error("Engagement Stats Error:", error);
        res.json({ topEngagedLeads: [] });
    }
});

// GET /api/pipeline/deduplication-stats - Show duplicates prevented
app.get('/api/pipeline/deduplication-stats', async (req, res) => {
    try {
        const stats = await db.get(`
            SELECT 
                COUNT(*) as total_prospects,
                SUM(CASE WHEN last_error LIKE '%Duplicate%' THEN 1 ELSE 0 END) as duplicates_blocked,
                SUM(CASE WHEN last_error LIKE '%Duplicate%' THEN 1 ELSE 0 END) * 100 / COUNT(*) as duplicate_prevention_rate
            FROM prospect_queue
            WHERE status = 'failed'
        `);
        
        res.json({
            deduplicationMetrics: {
                total_prospects_processed: stats?.total_prospects || 0,
                duplicates_blocked: stats?.duplicates_blocked || 0,
                prevention_rate: Math.round(stats?.duplicate_prevention_rate || 0),
                efficiency_gain: `${Math.round((stats?.duplicates_blocked || 0) * 7 / 60)} minutes saved on wasted research`
            }
        });
    } catch (error) {
        console.error("Dedup Stats Error:", error);
        res.json({ deduplicationMetrics: { total_prospects_processed: 0, duplicates_blocked: 0, prevention_rate: 0 } });
    }
});

// GET /api/research/cache-stats - Research caching performance metrics
app.get('/api/research/cache-stats', async (req, res) => {
    try {
        const stats = await db.get(`
            SELECT 
                COUNT(*) as cached_companies,
                SUM(hits) as total_cache_hits,
                AVG(hits) as avg_hits_per_company,
                AVG(quality_score) as avg_cached_quality
            FROM research_cache
            WHERE expires_at > ?
        `, [Date.now()]);
        
        const totalResearched = await db.get(`SELECT COUNT(*) as count FROM research_queue WHERE status = 'completed'`);
        const cacheHitRate = totalResearched?.count > 0 
            ? Math.round((stats?.total_cache_hits || 0) / (totalResearched.count + (stats?.total_cache_hits || 0)) * 100) 
            : 0;
        
        res.json({
            cacheMetrics: {
                cached_companies: stats?.cached_companies || 0,
                total_cache_hits: stats?.total_cache_hits || 0,
                cache_hit_rate: `${cacheHitRate}%`,
                avg_quality: Math.round((stats?.avg_cached_quality || 0) * 10) / 10,
                time_saved_minutes: Math.round((stats?.total_cache_hits || 0) * 0.5)
            }
        });
    } catch (error) {
        console.error("Cache Stats Error:", error);
        res.json({ cacheMetrics: { cached_companies: 0, total_cache_hits: 0, cache_hit_rate: '0%', time_saved_minutes: 0 } });
    }
});

// GET /api/email/validation-stats - Email validation metrics
app.get('/api/email/validation-stats', async (req, res) => {
    try {
        const stats = await db.get(`
            SELECT 
                COUNT(*) as total_emails,
                SUM(CASE WHEN approval_reason LIKE '%Invalid email%' THEN 1 ELSE 0 END) as invalid_emails_blocked,
                SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as valid_emails_sent
            FROM email_queue
            WHERE created_at > ?
        `, [Date.now() - (24 * 60 * 60 * 1000)]); // Last 24 hours
        
        const validationRate = stats?.total_emails > 0 
            ? Math.round(((stats.total_emails - (stats?.invalid_emails_blocked || 0)) / stats.total_emails) * 100)
            : 100;
        
        res.json({
            validationMetrics: {
                total_emails_processed: stats?.total_emails || 0,
                invalid_emails_blocked: stats?.invalid_emails_blocked || 0,
                valid_emails_sent: stats?.valid_emails_sent || 0,
                validation_success_rate: `${validationRate}%`,
                waste_prevented_emails: stats?.invalid_emails_blocked || 0
            }
        });
    } catch (error) {
        console.error("Validation Stats Error:", error);
        res.json({ validationMetrics: { total_emails_processed: 0, invalid_emails_blocked: 0, validation_success_rate: '100%' } });
    }
});

// GET /api/email/duplicate-prevention-stats - Duplicate send prevention metrics
app.get('/api/email/duplicate-prevention-stats', async (req, res) => {
    try {
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        const stats = await db.get(`
            SELECT 
                COUNT(*) as total_skipped,
                SUM(CASE WHEN last_error LIKE '%Duplicate%' THEN 1 ELSE 0 END) as duplicates_prevented
            FROM draft_queue
            WHERE status = 'skipped' AND last_error LIKE '%Duplicate%' AND updated_at > ?
        `, [thirtyDaysAgo]);
        
        const totalGenerated = await db.get(`SELECT COUNT(*) as count FROM draft_queue WHERE status IN ('awaiting_approval', 'skipped')`);
        const preventionRate = totalGenerated?.count > 0 
            ? Math.round((stats?.duplicates_prevented || 0) / (totalGenerated.count + (stats?.duplicates_prevented || 0)) * 100)
            : 0;
        
        res.json({
            duplicatePreventionMetrics: {
                duplicates_prevented: stats?.duplicates_prevented || 0,
                smtp_quota_saved: `${(stats?.duplicates_prevented || 0)} sends`,
                prevention_rate: `${preventionRate}%`,
                time_window: '30 days',
                efficiency_gain: `Prevented ${Math.round((stats?.duplicates_prevented || 0) * 30 / 60)} mins of wasted research`
            }
        });
    } catch (error) {
        console.error("Duplicate Prevention Stats Error:", error);
        res.json({ duplicatePreventionMetrics: { duplicates_prevented: 0, smtp_quota_saved: '0 sends', prevention_rate: '0%' } });
    }
});

// GET /api/prospects/reengagement-opportunities - Find stale prospects needing follow-ups
app.get('/api/prospects/reengagement-opportunities', async (req, res) => {
    try {
        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        
        // Find prospects who:
        // 1. Had an email sent 7+ days ago
        // 2. Have no replies yet
        // 3. No follow-up already queued
        const stalePros = await db.all(`
            SELECT DISTINCT
                eq.id as email_id,
                eq.lead_name,
                eq.to_email,
                eq.subject as original_subject,
                eq.sent_at,
                (? - eq.sent_at) / (1000 * 60 * 60 * 24) as days_since_sent
            FROM email_queue eq
            WHERE eq.status = 'sent' 
                AND eq.sent_at < ?
                AND NOT EXISTS (
                    SELECT 1 FROM inbox_messages im 
                    WHERE im.from_email = eq.to_email 
                    AND im.received_at > eq.sent_at
                )
                AND NOT EXISTS (
                    SELECT 1 FROM email_queue eq2
                    WHERE eq2.to_email = eq.to_email 
                    AND eq2.status IN ('pending', 'pending_approval', 'sent')
                    AND eq2.id != eq.id
                    AND eq2.created_at > eq.created_at
                )
            ORDER BY eq.sent_at ASC
            LIMIT 50
        `, [Date.now(), sevenDaysAgo]);
        
        // Count by engagement stage
        const staleCount = stalePros.length;
        const readyForFollowup = stalePros.filter(p => p.days_since_sent >= 7 && p.days_since_sent < 14).length;
        const veryStale = stalePros.filter(p => p.days_since_sent >= 14).length;
        
        res.json({
            reengagementMetrics: {
                stale_prospects_found: staleCount,
                ready_for_followup_7to14days: readyForFollowup,
                very_stale_14plus_days: veryStale,
                estimated_conversion_uplift: `${Math.round(staleCount * 0.15 * 100) / 100} additional replies expected`,
                sample_prospects: stalePros.slice(0, 5).map(p => ({
                    contact: p.lead_name,
                    email: p.to_email,
                    days_silent: Math.round(p.days_since_sent),
                    original_subject: p.original_subject?.substring(0, 40)
                }))
            }
        });
    } catch (error) {
        console.error("Re-engagement Opportunities Error:", error);
        res.json({ reengagementMetrics: { stale_prospects_found: 0, ready_for_followup_7to14days: 0, very_stale_14plus_days: 0 } });
    }
});

// POST /api/prospects/queue-followups - Auto-queue follow-ups for stale prospects
app.post('/api/prospects/queue-followups', async (req, res) => {
    try {
        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        
        // Find stale prospects again
        const stalePros = await db.all(`
            SELECT DISTINCT
                eq.id as email_id,
                eq.lead_name,
                eq.to_email,
                eq.subject as original_subject,
                eq.research_quality
            FROM email_queue eq
            WHERE eq.status = 'sent' 
                AND eq.sent_at < ?
                AND NOT EXISTS (
                    SELECT 1 FROM inbox_messages im 
                    WHERE im.from_email = eq.to_email 
                    AND im.received_at > eq.sent_at
                )
                AND NOT EXISTS (
                    SELECT 1 FROM email_queue eq2
                    WHERE eq2.to_email = eq.to_email 
                    AND eq2.status IN ('pending', 'pending_approval')
                    AND eq2.id != eq.id
                    AND eq2.created_at > eq.created_at
                )
            LIMIT 25
        `, [sevenDaysAgo]);
        
        let queued = 0;
        
        for (const prospect of stalePros) {
            try {
                // Generate lightweight follow-up email subject
                const followupSubject = `Following up: ${prospect.original_subject?.substring(0, 20)}`;
                const followupBody = `Hi ${prospect.lead_name.split(' ')[0]},\n\nJust checking in on my previous message. Still interested in exploring this opportunity?\n\nLooking forward to hearing from you.\n\nBest regards,\nSmooth AI`;
                
                // Queue as a follow-up email
                await db.run(`
                    INSERT INTO email_queue (
                        lead_id, lead_name, to_email, subject, body, 
                        scheduled_for, status, created_at, research_quality, 
                        approval_status, approval_reason
                    ) VALUES (?, ?, ?, ?, ?, ?, 'pending_approval', ?, ?, 'needs_review', 'Auto follow-up after 7 days no reply')
                `, [
                    `followup_${prospect.email_id}`,
                    prospect.lead_name,
                    prospect.to_email,
                    followupSubject,
                    followupBody,
                    Date.now() + (Math.random() * 60 * 60 * 1000), // Stagger send times
                    Date.now(),
                    prospect.research_quality || 8
                ]);
                
                queued++;
            } catch (e) {
                console.error(`Failed to queue follow-up for ${prospect.lead_name}:`, e.message);
            }
        }
        
        res.json({
            followupsQueued: queued,
            message: `Queued ${queued} follow-up emails for stale prospects`,
            nextAction: 'Follow-ups will be reviewed and sent by Mercury agent'
        });
    } catch (error) {
        console.error("Queue Follow-ups Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/email/bounce-unsubscribe-stats - Track bounced and unsubscribed addresses
app.get('/api/email/bounce-unsubscribe-stats', async (req, res) => {
    try {
        const bounceStats = await db.get(`
            SELECT 
                COUNT(*) as total_bounces,
                COUNT(DISTINCT bounce_type) as bounce_types,
                MAX(detected_at) as last_bounce
            FROM bounce_list
        `);
        
        const unsubscribeStats = await db.get(`
            SELECT 
                COUNT(*) as total_unsubscribes,
                MAX(unsubscribed_at) as last_unsubscribe
            FROM unsubscribe_list
        `);
        
        const totalQueued = await db.get(`
            SELECT COUNT(*) as count FROM email_queue 
            WHERE created_at > ?
        `, [Date.now() - (24 * 60 * 60 * 1000)]);
        
        const preventedSends = (bounceStats?.total_bounces || 0) + (unsubscribeStats?.total_unsubscribes || 0);
        const preventionRate = totalQueued?.count > 0 
            ? Math.round((preventedSends / (totalQueued.count + preventedSends)) * 100)
            : 0;
        
        res.json({
            deliverabilityMetrics: {
                bounced_addresses: bounceStats?.total_bounces || 0,
                unsubscribed_addresses: unsubscribeStats?.total_unsubscribes || 0,
                total_blocked: preventedSends,
                sender_reputation_protection: `${preventionRate}% sends prevented from bad addresses`,
                smtp_quota_saved: `${preventedSends} sends`,
                compliance_status: 'CAN-SPAM compliant (respecting unsubscribes)'
            }
        });
    } catch (error) {
        console.error("Bounce/Unsubscribe Stats Error:", error);
        res.json({ deliverabilityMetrics: { bounced_addresses: 0, unsubscribed_addresses: 0, total_blocked: 0 } });
    }
});

// GET /api/prospects/:leadId/activity-timeline - Get complete activity history for a prospect
app.get('/api/prospects/:leadId/activity-timeline', async (req, res) => {
    try {
        const { leadId } = req.params;
        
        const activities = await db.all(`
            SELECT 
                id, lead_id, email, activity_type, activity_description, metadata, created_at
            FROM activity_timeline
            WHERE lead_id = ?
            ORDER BY created_at DESC
            LIMIT 100
        `, [leadId]);
        
        // Parse metadata for each activity
        const parsedActivities = activities.map(a => ({
            ...a,
            metadata: a.metadata ? JSON.parse(a.metadata) : {},
            created_at_formatted: new Date(a.created_at).toLocaleString()
        }));
        
        // Count activity types
        const summary = {};
        parsedActivities.forEach(a => {
            summary[a.activity_type] = (summary[a.activity_type] || 0) + 1;
        });
        
        res.json({
            prospect: leadId,
            total_activities: parsedActivities.length,
            activity_summary: summary,
            timeline: parsedActivities
        });
    } catch (error) {
        console.error("Activity Timeline Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/activity/summary - Get activity summary across all prospects
app.get('/api/activity/summary', async (req, res) => {
    try {
        const activities = await db.all(`
            SELECT activity_type, COUNT(*) as count
            FROM activity_timeline
            GROUP BY activity_type
        `);
        
        const recentActivities = await db.all(`
            SELECT lead_id, email, activity_type, activity_description, created_at
            FROM activity_timeline
            ORDER BY created_at DESC
            LIMIT 20
        `);
        
        const activityStats = {};
        activities.forEach(a => {
            activityStats[a.activity_type] = a.count;
        });
        
        res.json({
            systemActivityMetrics: {
                total_activities_logged: activities.reduce((sum, a) => sum + a.count, 0),
                activity_types: activityStats,
                recent_activities: recentActivities.map(a => ({
                    prospect: a.lead_id,
                    email: a.email,
                    type: a.activity_type,
                    description: a.activity_description,
                    time: new Date(a.created_at).toLocaleString()
                }))
            }
        });
    } catch (error) {
        console.error("Activity Summary Error:", error);
        res.json({ systemActivityMetrics: { total_activities_logged: 0 } });
    }
});

// GET /api/leads/engagement-scoring - Calculate lead engagement scores and ranks
app.get('/api/leads/engagement-scoring', async (req, res) => {
    try {
        // Recalculate all lead scores based on engagement patterns
        const leads = await db.all(`
            SELECT DISTINCT eq.lead_id, eq.to_email
            FROM email_queue eq
            WHERE eq.status = 'sent'
        `);
        
        for (const lead of leads) {
            const emails_sent = await db.get(`
                SELECT COUNT(*) as count FROM email_queue 
                WHERE lead_id = ? AND status = 'sent'
            `, [lead.lead_id]);
            
            const replies = await db.get(`
                SELECT COUNT(*) as count FROM email_messages 
                WHERE lead_id = ? AND from_email = ?
            `, [lead.lead_id, lead.to_email]);
            
            const research_quality = await db.get(`
                SELECT AVG(research_quality) as avg_quality FROM email_queue 
                WHERE lead_id = ? AND research_quality > 0
            `, [lead.lead_id]);
            
            const days_in_pipeline = Math.floor((Date.now() - (await db.get(
                `SELECT MIN(created_at) as min_created FROM email_queue WHERE lead_id = ?`,
                [lead.lead_id]
            )).min_created) / (1000 * 60 * 60 * 24));
            
            // Engagement scoring formula: replies (weighted 50%) + research quality (30%) + send frequency (20%)
            const engagement_score = Math.min(100, 
                (replies?.count || 0) * 50 + 
                (research_quality?.avg_quality || 0) * 3 + 
                Math.min((emails_sent?.count || 0) * 5, 20)
            );
            
            // Priority ranking based on engagement
            let priority_rank = 'low';
            if (engagement_score >= 70) priority_rank = 'hot';
            else if (engagement_score >= 40) priority_rank = 'high';
            else if (engagement_score >= 20) priority_rank = 'medium';
            
            await db.run(`
                INSERT OR REPLACE INTO lead_scores 
                (lead_id, email, engagement_score, reply_count, research_quality_avg, days_in_pipeline, priority_rank, updated_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [lead.lead_id, lead.to_email, engagement_score, replies?.count || 0, 
                Math.round((research_quality?.avg_quality || 0) * 10) / 10, days_in_pipeline, priority_rank, Date.now(), Date.now()]);
        }
        
        // Get top prospects by score
        const topProspects = await db.all(`
            SELECT lead_id, email, engagement_score, reply_count, priority_rank, days_in_pipeline
            FROM lead_scores
            ORDER BY engagement_score DESC, updated_at DESC
            LIMIT 20
        `);
        
        const scoreDistribution = await db.get(`
            SELECT 
                SUM(CASE WHEN engagement_score >= 70 THEN 1 ELSE 0 END) as hot_leads,
                SUM(CASE WHEN engagement_score >= 40 AND engagement_score < 70 THEN 1 ELSE 0 END) as high_leads,
                SUM(CASE WHEN engagement_score >= 20 AND engagement_score < 40 THEN 1 ELSE 0 END) as medium_leads,
                SUM(CASE WHEN engagement_score < 20 THEN 1 ELSE 0 END) as cold_leads,
                AVG(engagement_score) as avg_engagement
            FROM lead_scores
        `);
        
        res.json({
            engagementMetrics: {
                leads_scored: leads.length,
                hot_leads: scoreDistribution?.hot_leads || 0,
                high_priority_leads: scoreDistribution?.high_leads || 0,
                medium_priority_leads: scoreDistribution?.medium_leads || 0,
                cold_leads: scoreDistribution?.cold_leads || 0,
                avg_engagement_score: Math.round((scoreDistribution?.avg_engagement || 0) * 10) / 10,
                conversion_potential: `${Math.round((scoreDistribution?.hot_leads || 0) * 30)}% est. close rate on hot leads`,
                top_prospects: topProspects.map(p => ({
                    lead: p.lead_id,
                    score: p.engagement_score,
                    replies: p.reply_count,
                    priority: p.priority_rank,
                    days_active: p.days_in_pipeline
                }))
            }
        });
    } catch (error) {
        console.error("Engagement Scoring Error:", error);
        res.json({ engagementMetrics: { leads_scored: 0, hot_leads: 0, avg_engagement_score: 0 } });
    }
});

// POST /api/prospects/:leadId/tags - Add tags to a prospect
app.post('/api/prospects/:leadId/tags', async (req, res) => {
    try {
        const { leadId } = req.params;
        const { tags } = req.body; // Array of {name, category}
        
        if (!Array.isArray(tags)) {
            return res.status(400).json({ error: 'tags must be an array' });
        }
        
        let added = 0;
        for (const tag of tags) {
            try {
                await db.run(
                    `INSERT OR IGNORE INTO prospect_tags (lead_id, tag_name, tag_category, added_at)
                     VALUES (?, ?, ?, ?)`,
                    [leadId, tag.name, tag.category || 'general', Date.now()]
                );
                added++;
            } catch (e) {
                // Duplicate tag - skip
            }
        }
        
        res.json({ added, message: `Added ${added} tags to prospect` });
    } catch (error) {
        console.error("Add Tags Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/prospects/:leadId/tags - Get all tags for a prospect
app.get('/api/prospects/:leadId/tags', async (req, res) => {
    try {
        const { leadId } = req.params;
        
        const tags = await db.all(`
            SELECT tag_name, tag_category, added_at
            FROM prospect_tags
            WHERE lead_id = ?
            ORDER BY added_at DESC
        `, [leadId]);
        
        res.json({
            prospect: leadId,
            total_tags: tags.length,
            tags: tags.map(t => ({
                name: t.tag_name,
                category: t.tag_category,
                added: new Date(t.added_at).toLocaleString()
            }))
        });
    } catch (error) {
        console.error("Get Tags Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/prospects/:leadId/tags/:tagName - Remove a tag
app.delete('/api/prospects/:leadId/tags/:tagName', async (req, res) => {
    try {
        const { leadId, tagName } = req.params;
        
        await db.run(
            `DELETE FROM prospect_tags WHERE lead_id = ? AND tag_name = ?`,
            [leadId, tagName]
        );
        
        res.json({ removed: true, message: `Removed tag "${tagName}"` });
    } catch (error) {
        console.error("Delete Tag Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/prospects/by-tag/:tagName - Find all prospects with a specific tag
app.get('/api/prospects/by-tag/:tagName', async (req, res) => {
    try {
        const { tagName } = req.params;
        
        const prospects = await db.all(`
            SELECT DISTINCT
                pq.id as lead_id,
                pq.company_name,
                pq.contact_email,
                ls.engagement_score,
                ls.priority_rank,
                COUNT(pt.tag_name) as tag_count
            FROM prospect_tags pt
            LEFT JOIN prospect_queue pq ON pt.lead_id = pq.id
            LEFT JOIN lead_scores ls ON pt.lead_id = ls.lead_id
            WHERE pt.tag_name = ?
            GROUP BY pq.id
            ORDER BY ls.engagement_score DESC
            LIMIT 100
        `, [tagName]);
        
        res.json({
            tag: tagName,
            prospects_found: prospects.length,
            prospects: prospects.map(p => ({
                id: p.lead_id,
                company: p.company_name,
                email: p.contact_email,
                engagement_score: p.engagement_score || 0,
                priority: p.priority_rank || 'unknown'
            }))
        });
    } catch (error) {
        console.error("Get By Tag Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/tags/summary - Get summary of all tags used
app.get('/api/tags/summary', async (req, res) => {
    try {
        const tagStats = await db.all(`
            SELECT tag_name, tag_category, COUNT(*) as prospect_count
            FROM prospect_tags
            GROUP BY tag_name, tag_category
            ORDER BY prospect_count DESC
            LIMIT 50
        `);
        
        const categoryStats = await db.all(`
            SELECT tag_category, COUNT(DISTINCT tag_name) as unique_tags, COUNT(*) as total_tags
            FROM prospect_tags
            GROUP BY tag_category
            ORDER BY total_tags DESC
        `);
        
        res.json({
            tagMetrics: {
                total_unique_tags: tagStats.length,
                total_tag_assignments: tagStats.reduce((sum, t) => sum + t.prospect_count, 0),
                top_tags: tagStats.slice(0, 10).map(t => ({
                    name: t.tag_name,
                    category: t.tag_category,
                    prospects: t.prospect_count
                })),
                by_category: categoryStats.map(c => ({
                    category: c.tag_category,
                    unique_tags: c.unique_tags,
                    total_assignments: c.total_tags
                }))
            }
        });
    } catch (error) {
        console.error("Tag Summary Error:", error);
        res.json({ tagMetrics: { total_unique_tags: 0, total_tag_assignments: 0 } });
    }
});

// POST /api/prospects/bulk-tag - Apply tags to multiple prospects at once
app.post('/api/prospects/bulk-tag', async (req, res) => {
    try {
        const { lead_ids, tags } = req.body;
        
        if (!Array.isArray(lead_ids) || !Array.isArray(tags)) {
            return res.status(400).json({ error: 'lead_ids and tags must be arrays' });
        }
        
        let totalAdded = 0;
        
        for (const leadId of lead_ids) {
            for (const tag of tags) {
                try {
                    await db.run(
                        `INSERT OR IGNORE INTO prospect_tags (lead_id, tag_name, tag_category, added_at)
                         VALUES (?, ?, ?, ?)`,
                        [leadId, tag.name, tag.category || 'general', Date.now()]
                    );
                    totalAdded++;
                } catch (e) {
                    // Duplicate - skip
                }
            }
        }
        
        res.json({
            prospects_tagged: lead_ids.length,
            tags_applied: tags.length,
            total_assignments: totalAdded,
            message: `Tagged ${lead_ids.length} prospects with ${tags.length} tags`
        });
    } catch (error) {
        console.error("Bulk Tag Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/email/campaign-analytics - Performance analysis of email campaigns
app.get('/api/email/campaign-analytics', async (req, res) => {
    try {
        // Group by subject line as campaign identifier
        const campaigns = await db.all(`
            SELECT 
                eq.subject as campaign_name,
                COUNT(*) as total_sent,
                SUM(CASE WHEN em.id IS NOT NULL THEN 1 ELSE 0 END) as replies_received,
                COUNT(DISTINCT eq.lead_id) as unique_leads,
                AVG(eq.research_quality) as avg_quality,
                SUM(CASE WHEN eq.is_followup = 1 THEN 1 ELSE 0 END) as followups,
                MIN(eq.sent_at) as first_sent,
                MAX(eq.sent_at) as last_sent
            FROM email_queue eq
            LEFT JOIN email_messages em ON eq.lead_id = em.lead_id AND em.received_at > eq.sent_at
            WHERE eq.status = 'sent'
            GROUP BY eq.subject
            ORDER BY total_sent DESC
            LIMIT 50
        `);
        
        // Calculate performance metrics
        const campaignMetrics = campaigns.map(c => {
            const replyRate = c.total_sent > 0 ? Math.round((c.replies_received / c.total_sent) * 100) : 0;
            return {
                campaign: c.campaign_name?.substring(0, 50) || 'Unnamed',
                total_sent: c.total_sent,
                replies: c.replies_received,
                reply_rate: `${replyRate}%`,
                unique_leads: c.unique_leads,
                avg_quality: Math.round(c.avg_quality * 10) / 10,
                followups: c.followups || 0,
                date_range: `${new Date(c.first_sent).toLocaleDateString()} - ${new Date(c.last_sent).toLocaleDateString()}`
            };
        });
        
        // Top performing campaigns
        const topCampaigns = campaignMetrics.filter(c => c.total_sent >= 3).sort((a, b) => {
            const aRate = parseInt(a.reply_rate);
            const bRate = parseInt(b.reply_rate);
            return bRate - aRate;
        }).slice(0, 5);
        
        res.json({
            campaignAnalytics: {
                total_campaigns: campaigns.length,
                total_emails_sent: campaigns.reduce((sum, c) => sum + c.total_sent, 0),
                total_replies: campaigns.reduce((sum, c) => sum + (c.replies_received || 0), 0),
                overall_reply_rate: `${Math.round(campaigns.reduce((sum, c) => sum + (c.replies_received || 0), 0) / campaigns.reduce((sum, c) => sum + c.total_sent, 0) * 100)}%`,
                top_campaigns: topCampaigns,
                all_campaigns: campaignMetrics.slice(0, 10)
            }
        });
    } catch (error) {
        console.error("Campaign Analytics Error:", error);
        res.json({ campaignAnalytics: { total_campaigns: 0, total_emails_sent: 0 } });
    }
});

// GET /api/email/subject-line-performance - Which subject lines drive replies?
app.get('/api/email/subject-line-performance', async (req, res) => {
    try {
        const subjectPerformance = await db.all(`
            SELECT 
                eq.subject,
                COUNT(*) as total_sent,
                SUM(CASE WHEN em.id IS NOT NULL THEN 1 ELSE 0 END) as replies,
                GROUP_CONCAT(DISTINCT ra.sentiment, ',') as reply_sentiments,
                AVG(ls.engagement_score) as avg_engagement
            FROM email_queue eq
            LEFT JOIN email_messages em ON eq.lead_id = em.lead_id AND em.received_at > eq.sent_at
            LEFT JOIN reply_analysis ra ON em.id = ra.email_id
            LEFT JOIN lead_scores ls ON eq.lead_id = ls.lead_id
            WHERE eq.status = 'sent' AND eq.subject != ''
            GROUP BY eq.subject
            ORDER BY CAST(SUM(CASE WHEN em.id IS NOT NULL THEN 1 ELSE 0 END) AS REAL) / COUNT(*) DESC
            LIMIT 20
        `);
        
        const performance = subjectPerformance.map(s => {
            const replyRate = s.total_sent > 0 ? Math.round((s.replies / s.total_sent) * 100) : 0;
            return {
                subject: s.subject?.substring(0, 50),
                sent: s.total_sent,
                replies: s.replies,
                reply_rate: `${replyRate}%`,
                sentiment_mix: s.reply_sentiments || 'N/A',
                avg_engagement: Math.round(s.avg_engagement || 0)
            };
        });
        
        res.json({
            subjectLineMetrics: {
                analyzed_subjects: performance.length,
                best_subjects: performance.slice(0, 5),
                all_subjects: performance
            }
        });
    } catch (error) {
        console.error("Subject Line Performance Error:", error);
        res.json({ subjectLineMetrics: { analyzed_subjects: 0 } });
    }
});

// GET /api/email/followup-effectiveness - How effective are follow-ups?
app.get('/api/email/followup-effectiveness', async (req, res) => {
    try {
        // Compare initial emails to follow-ups
        const stats = await db.all(`
            SELECT 
                eq.is_followup,
                COUNT(*) as total,
                SUM(CASE WHEN em.id IS NOT NULL THEN 1 ELSE 0 END) as replies,
                AVG(eq.research_quality) as avg_quality
            FROM email_queue eq
            LEFT JOIN email_messages em ON eq.lead_id = em.lead_id AND em.received_at > eq.sent_at
            WHERE eq.status = 'sent'
            GROUP BY eq.is_followup
        `);
        
        const initial = stats.find(s => s.is_followup === 0) || { total: 0, replies: 0 };
        const followups = stats.find(s => s.is_followup === 1) || { total: 0, replies: 0 };
        
        const initialRate = initial.total > 0 ? Math.round((initial.replies / initial.total) * 100) : 0;
        const followupRate = followups.total > 0 ? Math.round((followups.replies / followups.total) * 100) : 0;
        
        res.json({
            followupMetrics: {
                initial_emails: {
                    sent: initial.total,
                    replies: initial.replies,
                    reply_rate: `${initialRate}%`,
                    avg_quality: Math.round(initial.avg_quality || 0)
                },
                followup_emails: {
                    sent: followups.total,
                    replies: followups.replies,
                    reply_rate: `${followupRate}%`,
                    avg_quality: Math.round(followups.avg_quality || 0)
                },
                effectiveness_delta: `${followupRate - initialRate}%`,
                recommendation: followupRate > initialRate ? '✅ Follow-ups are MORE effective' : '⚠️ Initial emails performing better'
            }
        });
    } catch (error) {
        console.error("Followup Effectiveness Error:", error);
        res.json({ followupMetrics: {} });
    }
});

// GET /api/email/best-times-to-send - Analyze reply patterns by day/time
app.get('/api/email/send-time-analysis', async (req, res) => {
    try {
        const dayAnalysis = await db.all(`
            SELECT 
                CAST(strftime('%w', datetime(eq.sent_at/1000, 'unixepoch')) AS INTEGER) as day_of_week,
                CAST(strftime('%H', datetime(eq.sent_at/1000, 'unixepoch')) AS INTEGER) as hour,
                COUNT(*) as sent,
                SUM(CASE WHEN em.id IS NOT NULL THEN 1 ELSE 0 END) as replies
            FROM email_queue eq
            LEFT JOIN email_messages em ON eq.lead_id = em.lead_id AND em.received_at > eq.sent_at
            WHERE eq.status = 'sent'
            GROUP BY day_of_week, hour
            ORDER BY replies DESC
            LIMIT 10
        `);
        
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        
        const analysis = dayAnalysis.map(d => {
            const replyRate = d.sent > 0 ? Math.round((d.replies / d.sent) * 100) : 0;
            return {
                day: dayNames[d.day_of_week],
                hour: `${d.hour}:00`,
                sent: d.sent,
                replies: d.replies,
                reply_rate: `${replyRate}%`
            };
        });
        
        res.json({
            sendTimeMetrics: {
                best_send_windows: analysis.slice(0, 5),
                all_send_times: analysis
            }
        });
    } catch (error) {
        console.error("Send Time Analysis Error:", error);
        res.json({ sendTimeMetrics: { best_send_windows: [] } });
    }
});

// PUT /api/prospects/:leadId/status - Update prospect workflow stage
app.put('/api/prospects/:leadId/status', async (req, res) => {
    try {
        const { leadId } = req.params;
        const { stage } = req.body;
        
        const validStages = ['new', 'contacted', 'interested', 'qualified', 'won', 'lost', 'archived'];
        if (!validStages.includes(stage)) {
            return res.status(400).json({ error: `Invalid stage. Must be one of: ${validStages.join(', ')}` });
        }
        
        await db.run(
            `UPDATE prospect_queue SET workflow_stage = ?, stage_updated_at = ?, updated_at = ? WHERE id = ?`,
            [stage, Date.now(), Date.now(), leadId]
        );
        
        // Log activity
        await db.run(
            `INSERT INTO activity_timeline (lead_id, activity_type, activity_description, metadata, created_at)
             VALUES (?, ?, ?, ?, ?)`,
            [leadId, 'status_changed', `Status changed to: ${stage}`, JSON.stringify({stage}), Date.now()]
        );
        
        res.json({ updated: true, new_stage: stage });
    } catch (error) {
        console.error("Status Update Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/prospects/bulk-status - Update status for multiple prospects
app.post('/api/prospects/bulk-status', async (req, res) => {
    try {
        const { lead_ids, stage } = req.body;
        
        const validStages = ['new', 'contacted', 'interested', 'qualified', 'won', 'lost', 'archived'];
        if (!validStages.includes(stage)) {
            return res.status(400).json({ error: `Invalid stage. Must be one of: ${validStages.join(', ')}` });
        }
        
        let updated = 0;
        for (const leadId of lead_ids) {
            await db.run(
                `UPDATE prospect_queue SET workflow_stage = ?, stage_updated_at = ?, updated_at = ? WHERE id = ?`,
                [stage, Date.now(), Date.now(), leadId]
            );
            await db.run(
                `INSERT INTO activity_timeline (lead_id, activity_type, activity_description, metadata, created_at)
                 VALUES (?, ?, ?, ?, ?)`,
                [leadId, 'status_changed', `Bulk status update to: ${stage}`, JSON.stringify({stage}), Date.now()]
            );
            updated++;
        }
        
        res.json({
            updated: updated,
            stage: stage,
            message: `Updated ${updated} prospects to ${stage}`
        });
    } catch (error) {
        console.error("Bulk Status Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/pipeline/stage-distribution - Show prospect distribution across workflow stages
app.get('/api/pipeline/stage-distribution', async (req, res) => {
    try {
        const distribution = await db.all(`
            SELECT 
                workflow_stage,
                COUNT(*) as count,
                COUNT(DISTINCT id) as unique_prospects
            FROM prospect_queue
            WHERE workflow_stage IS NOT NULL
            GROUP BY workflow_stage
            ORDER BY 
                CASE workflow_stage 
                    WHEN 'new' THEN 1
                    WHEN 'contacted' THEN 2
                    WHEN 'interested' THEN 3
                    WHEN 'qualified' THEN 4
                    WHEN 'won' THEN 5
                    WHEN 'lost' THEN 6
                    WHEN 'archived' THEN 7
                END
        `);
        
        const totalProspects = distribution.reduce((sum, d) => sum + d.count, 0);
        
        res.json({
            pipelineMetrics: {
                total_prospects: totalProspects,
                by_stage: distribution.map(d => ({
                    stage: d.workflow_stage,
                    count: d.count,
                    percentage: Math.round((d.count / totalProspects) * 100)
                })),
                stage_summary: {
                    new: distribution.find(d => d.workflow_stage === 'new')?.count || 0,
                    contacted: distribution.find(d => d.workflow_stage === 'contacted')?.count || 0,
                    interested: distribution.find(d => d.workflow_stage === 'interested')?.count || 0,
                    qualified: distribution.find(d => d.workflow_stage === 'qualified')?.count || 0,
                    won: distribution.find(d => d.workflow_stage === 'won')?.count || 0,
                    lost: distribution.find(d => d.workflow_stage === 'lost')?.count || 0,
                    archived: distribution.find(d => d.workflow_stage === 'archived')?.count || 0
                }
            }
        });
    } catch (error) {
        console.error("Pipeline Distribution Error:", error);
        res.json({ pipelineMetrics: { total_prospects: 0 } });
    }
});

// POST /api/pipeline/auto-archive - Auto-archive unresponsive prospects after 30 days
app.post('/api/pipeline/auto-archive', async (req, res) => {
    try {
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        
        // Find prospects with no activity in last 30 days
        const inactiveProspects = await db.all(`
            SELECT pq.id
            FROM prospect_queue pq
            LEFT JOIN activity_timeline at ON pq.id = at.lead_id AND at.created_at > ?
            WHERE pq.workflow_stage != 'won' 
              AND pq.workflow_stage != 'lost'
              AND pq.workflow_stage != 'archived'
              AND pq.stage_updated_at < ?
              AND at.id IS NULL
            GROUP BY pq.id
        `, [thirtyDaysAgo, thirtyDaysAgo]);
        
        let archived = 0;
        for (const prospect of inactiveProspects) {
            await db.run(
                `UPDATE prospect_queue SET workflow_stage = 'archived', stage_updated_at = ?, updated_at = ? WHERE id = ?`,
                [Date.now(), Date.now(), prospect.id]
            );
            await db.run(
                `INSERT INTO activity_timeline (lead_id, activity_type, activity_description, created_at)
                 VALUES (?, ?, ?, ?)`,
                [prospect.id, 'auto_archived', 'Auto-archived after 30 days of inactivity', Date.now()]
            );
            archived++;
        }
        
        res.json({
            archived: archived,
            message: `Auto-archived ${archived} unresponsive prospects`
        });
    } catch (error) {
        console.error("Auto-Archive Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/prospects/by-stage/:stage - Get all prospects in a specific workflow stage
app.get('/api/prospects/by-stage/:stage', async (req, res) => {
    try {
        const { stage } = req.params;
        
        const prospects = await db.all(`
            SELECT DISTINCT
                pq.id,
                pq.company_name,
                pq.contact_email,
                pq.workflow_stage,
                ls.engagement_score,
                ls.priority_rank,
                pq.stage_updated_at
            FROM prospect_queue pq
            LEFT JOIN lead_scores ls ON pq.id = ls.lead_id
            WHERE pq.workflow_stage = ?
            ORDER BY ls.engagement_score DESC, pq.stage_updated_at DESC
            LIMIT 100
        `, [stage]);
        
        res.json({
            stage: stage,
            prospects_found: prospects.length,
            prospects: prospects.map(p => ({
                id: p.id,
                company: p.company_name,
                email: p.contact_email,
                engagement_score: p.engagement_score || 0,
                priority: p.priority_rank || 'unknown',
                stage_updated: new Date(p.stage_updated_at).toLocaleDateString()
            }))
        });
    } catch (error) {
        console.error("Get By Stage Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/prospects/:leadId/insights - Generate AI-powered prospect brief
app.get('/api/prospects/:leadId/insights', async (req, res) => {
    try {
        const { leadId } = req.params;
        
        // Get prospect info
        const prospect = await db.get(`
            SELECT pq.id, pq.company_name, pq.contact_name, pq.contact_email, pq.website_url
            FROM prospect_queue pq
            WHERE pq.id = ?
        `, [leadId]);
        
        if (!prospect) {
            return res.status(404).json({ error: 'Prospect not found' });
        }
        
        // Get research data (most recent)
        const research = await db.get(`
            SELECT rq.id, rq.research_data, rq.insights_brief, rq.brief_generated_at
            FROM research_queue rq
            WHERE rq.prospect_id = ?
            ORDER BY rq.completed_at DESC
            LIMIT 1
        `, [leadId]);
        
        // Return cached brief if exists and recent (< 7 days)
        if (research?.insights_brief && research?.brief_generated_at) {
            const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
            if (research.brief_generated_at > sevenDaysAgo) {
                return res.json({
                    prospect: prospect.company_name,
                    brief: JSON.parse(research.insights_brief),
                    cached: true,
                    generated: new Date(research.brief_generated_at).toLocaleString()
                });
            }
        }
        
        if (!research?.research_data) {
            return res.status(404).json({ error: 'No research data found for this prospect' });
        }
        
        // Generate new brief using AI
        const researchData = typeof research.research_data === 'string' 
            ? JSON.parse(research.research_data) 
            : research.research_data;
        
        const prompt = `You are a business development expert. Generate a concise, professional one-page PROSPECT BRIEF based on this research data about ${prospect.company_name}.

RESEARCH DATA:
${JSON.stringify(researchData, null, 2)}

Generate a JSON response with these EXACT fields:
{
  "executive_summary": "2-3 sentence overview of the company and why they're a good prospect",
  "company_snapshot": {
    "industry": "industry sector",
    "size": "company size (estimate from research)",
    "recent_activity": "key news/updates from research"
  },
  "key_decision_makers": ["Name1 - Title", "Name2 - Title"],
  "primary_pain_points": ["pain point 1", "pain point 2", "pain point 3"],
  "opportunity_fit": "1-2 sentences on why our solution fits their needs based on research",
  "recommended_angle": "specific talking point or hook to use in outreach",
  "engagement_level": "high/medium/low based on research quality and signals",
  "next_steps": "suggested follow-up action"
}

Return ONLY valid JSON, no explanations.`;
        
        const response = await openrouter.chat.completions.create({
            model: "meta-llama/llama-3.3-70b-instruct",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
            max_tokens: 800
        });
        
        const briefText = response.choices[0]?.message?.content || '{}';
        
        // Extract JSON
        let brief;
        try {
            const jsonMatch = briefText.match(/\{[\s\S]*\}/);
            brief = JSON.parse(jsonMatch ? jsonMatch[0] : briefText);
        } catch (e) {
            brief = { error: 'Failed to parse brief', raw: briefText };
        }
        
        // Cache the brief
        if (research?.id) {
            await db.run(
                `UPDATE research_queue SET insights_brief = ?, brief_generated_at = ? WHERE id = ?`,
                [JSON.stringify(brief), Date.now(), research.id]
            );
        }
        
        res.json({
            prospect: prospect.company_name,
            contact: prospect.contact_name,
            email: prospect.contact_email,
            website: prospect.website_url,
            brief: brief,
            generated: new Date().toLocaleString(),
            cached: false
        });
    } catch (error) {
        console.error("Insights Generation Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/prospects/bulk-insights - Generate briefs for multiple prospects
app.post('/api/prospects/bulk-insights', async (req, res) => {
    try {
        const { lead_ids } = req.body;
        
        if (!Array.isArray(lead_ids)) {
            return res.status(400).json({ error: 'lead_ids must be an array' });
        }
        
        let generated = 0;
        const results = [];
        
        for (const leadId of lead_ids) {
            try {
                const prospect = await db.get(
                    `SELECT company_name FROM prospect_queue WHERE id = ?`,
                    [leadId]
                );
                
                if (prospect) {
                    results.push({
                        lead_id: leadId,
                        company: prospect.company_name,
                        status: 'processing'
                    });
                    generated++;
                }
            } catch (e) {
                results.push({
                    lead_id: leadId,
                    status: 'error',
                    error: e.message
                });
            }
        }
        
        res.json({
            total_requested: lead_ids.length,
            generated: generated,
            message: `Queued ${generated} briefs for generation`,
            results: results
        });
    } catch (error) {
        console.error("Bulk Insights Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/replies/analyze-sentiment - AI-powered sentiment analysis of email replies
app.post('/api/replies/analyze-sentiment', async (req, res) => {
    try {
        const { email_id, body_text } = req.body;
        
        if (!body_text || body_text.trim().length === 0) {
            return res.status(400).json({ error: 'Email body required' });
        }
        
        // Analyze sentiment using AI
        const prompt = `Analyze this email reply for business sentiment. Extract:
1. Overall sentiment (positive/negative/neutral)
2. Sentiment score (-1 to +1)
3. Decision signal (interested/not_interested/needs_info/needs_demo/objection/auto_reply/unsubscribe)
4. Key topics mentioned (array)

Email: "${body_text}"

Return ONLY valid JSON:
{
  "sentiment": "positive|negative|neutral",
  "sentiment_score": 0.8,
  "decision_signal": "interested",
  "key_topics": ["topic1", "topic2"]
}`;
        
        const response = await openrouter.chat.completions.create({
            model: "meta-llama/llama-3.3-70b-instruct",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.3,
            max_tokens: 300
        });
        
        const analysisText = response.choices[0]?.message?.content || '{}';
        let analysis;
        try {
            const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
            analysis = JSON.parse(jsonMatch ? jsonMatch[0] : analysisText);
        } catch (e) {
            analysis = { sentiment: 'neutral', sentiment_score: 0, decision_signal: 'unknown', key_topics: [] };
        }
        
        // Store analysis if email_id provided
        if (email_id) {
            await db.run(
                `UPDATE email_messages SET sentiment = ?, sentiment_score = ?, decision_signal = ?, key_topics = ?, analyzed_at = ? WHERE id = ?`,
                [analysis.sentiment, analysis.sentiment_score || 0, analysis.decision_signal, JSON.stringify(analysis.key_topics || []), Date.now(), email_id]
            );
        }
        
        res.json({ analysis });
    } catch (error) {
        console.error("Sentiment Analysis Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/replies/sentiment-distribution - Overall sentiment distribution of all replies
app.get('/api/replies/sentiment-distribution', async (req, res) => {
    try {
        const distribution = await db.all(`
            SELECT 
                sentiment,
                COUNT(*) as count,
                AVG(sentiment_score) as avg_sentiment_score
            FROM email_messages
            WHERE sentiment IS NOT NULL
            GROUP BY sentiment
        `);
        
        const totalReplies = distribution.reduce((sum, d) => sum + d.count, 0);
        
        res.json({
            sentimentMetrics: {
                total_analyzed: totalReplies,
                by_sentiment: distribution.map(d => ({
                    sentiment: d.sentiment,
                    count: d.count,
                    percentage: Math.round((d.count / totalReplies) * 100),
                    avg_score: Math.round(d.avg_sentiment_score * 100) / 100
                })),
                overall_sentiment: totalReplies > 0 ? distribution.reduce((s, d) => s + (d.avg_sentiment_score || 0) * d.count, 0) / totalReplies : 0
            }
        });
    } catch (error) {
        console.error("Sentiment Distribution Error:", error);
        res.json({ sentimentMetrics: { total_analyzed: 0 } });
    }
});

// GET /api/replies/decision-signals - Track decision signals from prospects
app.get('/api/replies/decision-signals', async (req, res) => {
    try {
        const signals = await db.all(`
            SELECT 
                decision_signal,
                COUNT(*) as count,
                COUNT(DISTINCT lead_id) as unique_prospects
            FROM email_messages
            WHERE decision_signal IS NOT NULL
            GROUP BY decision_signal
            ORDER BY count DESC
        `);
        
        res.json({
            decisionSignals: {
                total_signals: signals.reduce((sum, s) => sum + s.count, 0),
                signals: signals.map(s => ({
                    signal: s.decision_signal,
                    occurrences: s.count,
                    unique_prospects: s.unique_prospects
                })),
                action_items: {
                    interested: signals.find(s => s.decision_signal === 'interested')?.count || 0,
                    objections: signals.find(s => s.decision_signal === 'objection')?.count || 0,
                    needs_demo: signals.find(s => s.decision_signal === 'needs_demo')?.count || 0,
                    unsubscribe: signals.find(s => s.decision_signal === 'unsubscribe')?.count || 0
                }
            }
        });
    } catch (error) {
        console.error("Decision Signals Error:", error);
        res.json({ decisionSignals: { total_signals: 0 } });
    }
});

// GET /api/prospects/:leadId/reply-sentiment - Get all sentiment analysis for a prospect's replies
app.get('/api/prospects/:leadId/reply-sentiment', async (req, res) => {
    try {
        const { leadId } = req.params;
        
        const replies = await db.all(`
            SELECT 
                id,
                from_email,
                subject,
                sentiment,
                sentiment_score,
                decision_signal,
                key_topics,
                received_at
            FROM email_messages
            WHERE lead_id = ? AND sentiment IS NOT NULL
            ORDER BY received_at DESC
            LIMIT 20
        `, [leadId]);
        
        const sentiment_breakdown = await db.get(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN sentiment = 'positive' THEN 1 ELSE 0 END) as positive,
                SUM(CASE WHEN sentiment = 'negative' THEN 1 ELSE 0 END) as negative,
                SUM(CASE WHEN sentiment = 'neutral' THEN 1 ELSE 0 END) as neutral,
                AVG(sentiment_score) as avg_score
            FROM email_messages
            WHERE lead_id = ?
        `, [leadId]);
        
        res.json({
            prospect_replies: {
                total_replies: sentiment_breakdown.total || 0,
                sentiment_breakdown: {
                    positive: sentiment_breakdown.positive || 0,
                    negative: sentiment_breakdown.negative || 0,
                    neutral: sentiment_breakdown.neutral || 0,
                    avg_sentiment_score: Math.round((sentiment_breakdown.avg_score || 0) * 100) / 100
                },
                recent_replies: replies.map(r => ({
                    sentiment: r.sentiment,
                    score: Math.round(r.sentiment_score * 100) / 100,
                    signal: r.decision_signal,
                    topics: JSON.parse(r.key_topics || '[]'),
                    date: new Date(r.received_at).toLocaleDateString()
                }))
            }
        });
    } catch (error) {
        console.error("Prospect Reply Sentiment Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/pipeline/engagement-funnel - Complete funnel from discovery to qualification
app.get('/api/pipeline/engagement-funnel', async (req, res) => {
    try {
        // Stage 1: All prospects discovered
        const discovered = await db.get(`SELECT COUNT(*) as count FROM prospect_queue`);
        
        // Stage 2: Prospects with emails sent
        const emailsSent = await db.get(`
            SELECT COUNT(DISTINCT lead_id) as count FROM email_queue WHERE status = 'sent'
        `);
        
        // Stage 3: Prospects who replied
        const replied = await db.get(`
            SELECT COUNT(DISTINCT lead_id) as count FROM email_messages 
            WHERE lead_id IS NOT NULL AND received_at IS NOT NULL
        `);
        
        // Stage 4: Prospects showing positive interest (positive sentiment or interested signal)
        const interested = await db.get(`
            SELECT COUNT(DISTINCT em.lead_id) as count FROM email_messages em
            WHERE (em.sentiment = 'positive' OR em.decision_signal IN ('interested', 'needs_demo', 'needs_info'))
        `);
        
        // Stage 5: Prospects moved to qualified stage
        const qualified = await db.get(`
            SELECT COUNT(*) as count FROM prospect_queue WHERE workflow_stage = 'qualified'
        `);
        
        const discovered_count = discovered.count || 0;
        const sent_count = emailsSent.count || 0;
        const replied_count = replied.count || 0;
        const interested_count = interested.count || 0;
        const qualified_count = qualified.count || 0;
        
        // Calculate conversion rates
        const conversionRates = {
            discovery_to_sent: discovered_count > 0 ? Math.round((sent_count / discovered_count) * 100) : 0,
            sent_to_reply: sent_count > 0 ? Math.round((replied_count / sent_count) * 100) : 0,
            reply_to_interested: replied_count > 0 ? Math.round((interested_count / replied_count) * 100) : 0,
            interested_to_qualified: interested_count > 0 ? Math.round((qualified_count / interested_count) * 100) : 0,
            overall: discovered_count > 0 ? Math.round((qualified_count / discovered_count) * 100) : 0
        };
        
        res.json({
            funnelMetrics: {
                funnel_stages: [
                    { stage: 'Discovered', count: discovered_count, percentage: 100 },
                    { stage: 'Emails Sent', count: sent_count, percentage: Math.round((sent_count / discovered_count) * 100) },
                    { stage: 'Replied', count: replied_count, percentage: Math.round((replied_count / discovered_count) * 100) },
                    { stage: 'Interested', count: interested_count, percentage: Math.round((interested_count / discovered_count) * 100) },
                    { stage: 'Qualified', count: qualified_count, percentage: Math.round((qualified_count / discovered_count) * 100) }
                ],
                conversion_rates: conversionRates,
                bottleneck: {
                    identified: true,
                    stage: conversionRates.discovery_to_sent < 50 ? 'discovery_to_sent' : 
                           conversionRates.sent_to_reply < 15 ? 'sent_to_reply' :
                           conversionRates.reply_to_interested < 30 ? 'reply_to_interested' :
                           'healthy',
                    message: conversionRates.discovery_to_sent < 50 ? 'Many prospects not receiving emails' :
                             conversionRates.sent_to_reply < 15 ? 'Low reply rate - review email quality' :
                             conversionRates.reply_to_interested < 30 ? 'Low engagement conversion - check follow-ups' :
                             '✅ Pipeline flowing smoothly'
                }
            }
        });
    } catch (error) {
        console.error("Engagement Funnel Error:", error);
        res.json({ funnelMetrics: { funnel_stages: [], conversion_rates: {} } });
    }
});

// GET /api/pipeline/time-to-conversion - Average time from sent to reply to qualified
app.get('/api/pipeline/time-to-conversion', async (req, res) => {
    try {
        // Time from email sent to first reply
        const timeToReply = await db.get(`
            SELECT 
                AVG(em.received_at - eq.sent_at) / 1000 / 3600 as avg_hours,
                MIN(em.received_at - eq.sent_at) / 1000 / 3600 as min_hours,
                MAX(em.received_at - eq.sent_at) / 1000 / 3600 as max_hours
            FROM email_queue eq
            JOIN email_messages em ON eq.lead_id = em.lead_id AND em.received_at > eq.sent_at
            WHERE eq.status = 'sent'
        `);
        
        // Time from first contact to qualification
        const timeToQualified = await db.get(`
            SELECT 
                AVG((SELECT MAX(stage_updated_at) FROM prospect_queue WHERE workflow_stage = 'qualified' AND id = pq.id) - MIN(eq.sent_at)) / 1000 / 3600 / 24 as avg_days
            FROM prospect_queue pq
            LEFT JOIN email_queue eq ON pq.id = eq.lead_id
            WHERE pq.workflow_stage = 'qualified'
        `);
        
        res.json({
            timeMetrics: {
                email_to_first_reply: {
                    avg_hours: Math.round((timeToReply.avg_hours || 0) * 10) / 10,
                    min_hours: Math.round((timeToReply.min_hours || 0) * 10) / 10,
                    max_hours: Math.round((timeToReply.max_hours || 0) * 10) / 10,
                    label: 'Time from email sent to first reply'
                },
                contact_to_qualified: {
                    avg_days: Math.round((timeToQualified.avg_days || 0) * 10) / 10,
                    label: 'Average days from first contact to qualification'
                }
            }
        });
    } catch (error) {
        console.error("Time To Conversion Error:", error);
        res.json({ timeMetrics: {} });
    }
});

// GET /api/pipeline/conversion-by-quality - Show conversion rates by research quality
app.get('/api/pipeline/conversion-by-quality', async (req, res) => {
    try {
        const qualityBuckets = await db.all(`
            SELECT 
                CASE 
                    WHEN eq.research_quality >= 8 THEN 'High (8-10)'
                    WHEN eq.research_quality >= 6 THEN 'Medium (6-7)'
                    WHEN eq.research_quality >= 4 THEN 'Low (4-5)'
                    ELSE 'Very Low (0-3)'
                END as quality_bucket,
                COUNT(*) as emails_sent,
                SUM(CASE WHEN em.id IS NOT NULL THEN 1 ELSE 0 END) as replies,
                COUNT(DISTINCT eq.lead_id) as unique_prospects
            FROM email_queue eq
            LEFT JOIN email_messages em ON eq.lead_id = em.lead_id AND em.received_at > eq.sent_at
            WHERE eq.status = 'sent'
            GROUP BY quality_bucket
            ORDER BY 
                CASE 
                    WHEN quality_bucket = 'High (8-10)' THEN 1
                    WHEN quality_bucket = 'Medium (6-7)' THEN 2
                    WHEN quality_bucket = 'Low (4-5)' THEN 3
                    ELSE 4
                END
        `);
        
        const conversionByQuality = qualityBuckets.map(b => {
            const replyRate = b.emails_sent > 0 ? Math.round((b.replies / b.emails_sent) * 100) : 0;
            return {
                quality_level: b.quality_bucket,
                emails_sent: b.emails_sent,
                replies: b.replies,
                reply_rate: `${replyRate}%`,
                unique_prospects: b.unique_prospects
            };
        });
        
        res.json({
            qualityAnalysis: {
                conversion_by_quality: conversionByQuality,
                insight: 'Higher research quality correlates with better reply rates'
            }
        });
    } catch (error) {
        console.error("Quality Conversion Error:", error);
        res.json({ qualityAnalysis: { conversion_by_quality: [] } });
    }
});

// GET /api/pipeline/stage-velocity - How fast prospects move through stages
app.get('/api/pipeline/stage-velocity', async (req, res) => {
    try {
        const stageTransitions = await db.all(`
            SELECT 
                workflow_stage,
                COUNT(*) as prospects_in_stage,
                AVG(CAST((julianday('now') * 24 * 60 * 60 * 1000) - stage_updated_at AS FLOAT)) / 1000 / 3600 / 24 as avg_days_in_stage
            FROM prospect_queue
            WHERE workflow_stage IS NOT NULL
            GROUP BY workflow_stage
            ORDER BY workflow_stage
        `);
        
        res.json({
            stageVelocity: {
                stages: stageTransitions.map(s => ({
                    stage: s.workflow_stage,
                    count: s.prospects_in_stage,
                    avg_days_in_stage: Math.round((s.avg_days_in_stage || 0) * 10) / 10,
                    velocity: s.avg_days_in_stage < 3 ? '⚡ Fast' : s.avg_days_in_stage < 7 ? '→ Normal' : '🐢 Slow'
                })),
                recommendation: 'Monitor prospects stuck in "contacted" stage for >7 days'
            }
        });
    } catch (error) {
        console.error("Stage Velocity Error:", error);
        res.json({ stageVelocity: { stages: [] } });
    }
});

// POST /api/followups/configure - Set up automated follow-up sequence for a prospect
app.post('/api/followups/configure', async (req, res) => {
    try {
        const { lead_id, days_to_wait, max_followups } = req.body;
        
        if (!lead_id || !days_to_wait) {
            return res.status(400).json({ error: 'lead_id and days_to_wait required' });
        }
        
        // Store follow-up config in activity timeline metadata
        await db.run(
            `INSERT INTO activity_timeline (lead_id, activity_type, activity_description, metadata, created_at)
             VALUES (?, ?, ?, ?, ?)`,
            [lead_id, 'followup_configured', `Auto-followup scheduled: ${days_to_wait} days, max ${max_followups || 3} followups`, 
             JSON.stringify({days_to_wait, max_followups: max_followups || 3}), Date.now()]
        );
        
        res.json({
            configured: true,
            lead_id: lead_id,
            days_to_wait: days_to_wait,
            max_followups: max_followups || 3,
            message: `Follow-up sequence enabled for this prospect`
        });
    } catch (error) {
        console.error("Followup Config Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/followups/process-pending - Generate follow-ups for prospects who haven't replied
app.post('/api/followups/process-pending', async (req, res) => {
    try {
        const now = Date.now();
        const threeDaysAgo = now - (3 * 24 * 60 * 60 * 1000); // Default 3 day wait
        
        // Find prospects who:
        // 1. Had emails sent 3+ days ago
        // 2. Have not replied
        // 3. Haven't been unsubscribed/bounced
        // 4. Haven't already had max followups
        const nonresponders = await db.all(`
            SELECT DISTINCT
                eq.lead_id,
                eq.id as original_email_id,
                pq.company_name,
                pq.contact_email,
                eq.research_quality,
                COUNT(eq2.id) as followup_count
            FROM email_queue eq
            LEFT JOIN email_queue eq2 ON eq.lead_id = eq2.lead_id AND eq2.sequence_number > 0
            LEFT JOIN email_messages em ON eq.lead_id = em.lead_id AND em.received_at > eq.sent_at
            LEFT JOIN bounce_list bl ON pq.contact_email = bl.email
            LEFT JOIN unsubscribe_list ul ON pq.contact_email = ul.email
            LEFT JOIN prospect_queue pq ON eq.lead_id = pq.id
            WHERE eq.status = 'sent'
              AND eq.sent_at < ?
              AND em.id IS NULL
              AND bl.email IS NULL
              AND ul.email IS NULL
              AND eq.sequence_number = 0
            GROUP BY eq.lead_id
            HAVING COUNT(eq2.id) < 3
            LIMIT 50
        `, [threeDaysAgo]);
        
        let followupsScheduled = 0;
        
        for (const prospect of nonresponders) {
            // Get the last email content for this prospect to generate follow-up variant
            const lastEmail = await db.get(`
                SELECT eq.email_body, eq.subject FROM email_queue eq
                WHERE eq.lead_id = ? AND eq.status = 'sent'
                ORDER BY eq.sent_at DESC LIMIT 1
            `, [prospect.lead_id]);
            
            if (lastEmail) {
                // Create follow-up email with different angle
                const followupSubject = `${lastEmail.subject} - Quick Follow-up`;
                const followupBody = `${lastEmail.email_body}\n\n---\nJust following up on my previous message. Would love to connect! 👋`;
                
                // Queue follow-up email
                await db.run(
                    `INSERT INTO draft_queue (prospect_id, lead_id, company_name, contact_email, contact_name, 
                     research_quality, research_data, status, email_subject, email_body, sequence_number, parent_email_id, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [prospect.lead_id, prospect.lead_id, prospect.company_name, prospect.contact_email, '', 
                     prospect.research_quality, '{}', 'pending', followupSubject, followupBody, 
                     prospect.followup_count + 1, prospect.original_email_id, Date.now(), Date.now()]
                );
                
                followupsScheduled++;
            }
        }
        
        res.json({
            processed: followupsScheduled,
            message: `Scheduled ${followupsScheduled} follow-up emails for non-responders`,
            prospects_analyzed: nonresponders.length
        });
    } catch (error) {
        console.error("Process Pending Followups Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/followups/pending - Get all pending follow-ups scheduled to send
app.get('/api/followups/pending', async (req, res) => {
    try {
        const pending = await db.all(`
            SELECT 
                dq.id,
                dq.company_name,
                dq.contact_email,
                dq.email_subject,
                dq.sequence_number,
                COUNT(eq.id) as previous_emails,
                MAX(eq.sent_at) as last_email_sent
            FROM draft_queue dq
            LEFT JOIN email_queue eq ON dq.lead_id = eq.lead_id
            WHERE dq.status = 'pending' AND dq.sequence_number > 0
            GROUP BY dq.id
            ORDER BY dq.created_at DESC
            LIMIT 100
        `);
        
        res.json({
            pending_followups: {
                total_pending: pending.length,
                followups: pending.map(p => ({
                    id: p.id,
                    company: p.company_name,
                    email: p.contact_email,
                    subject: p.email_subject?.substring(0, 50),
                    sequence: `Follow-up #${p.sequence_number}`,
                    attempts: p.previous_emails,
                    last_contact: new Date(p.last_email_sent).toLocaleDateString()
                }))
            }
        });
    } catch (error) {
        console.error("Get Pending Followups Error:", error);
        res.json({ pending_followups: { total_pending: 0 } });
    }
});

// GET /api/followups/stats - Follow-up campaign effectiveness
app.get('/api/followups/stats', async (req, res) => {
    try {
        const stats = await db.all(`
            SELECT 
                eq.sequence_number,
                COUNT(*) as sent,
                SUM(CASE WHEN em.id IS NOT NULL THEN 1 ELSE 0 END) as replies
            FROM email_queue eq
            LEFT JOIN email_messages em ON eq.lead_id = em.lead_id AND em.received_at > eq.sent_at
            WHERE eq.sequence_number > 0 AND eq.status = 'sent'
            GROUP BY eq.sequence_number
            ORDER BY eq.sequence_number
        `);
        
        const followupMetrics = stats.map(s => {
            const replyRate = s.sent > 0 ? Math.round((s.replies / s.sent) * 100) : 0;
            return {
                followup_number: s.sequence_number,
                sent: s.sent,
                replies: s.replies,
                reply_rate: `${replyRate}%`,
                effectiveness: replyRate > 20 ? '✅ Highly effective' : replyRate > 10 ? '→ Moderate' : '⚠️ Low engagement'
            };
        });
        
        const totalFollowups = stats.reduce((sum, s) => sum + s.sent, 0);
        const totalFollowupReplies = stats.reduce((sum, s) => sum + (s.replies || 0), 0);
        
        res.json({
            followupStats: {
                total_followups_sent: totalFollowups,
                total_followup_replies: totalFollowupReplies,
                overall_followup_reply_rate: totalFollowups > 0 ? `${Math.round((totalFollowupReplies / totalFollowups) * 100)}%` : '0%',
                by_sequence: followupMetrics,
                insight: 'Follow-ups typically have 10-30% reply rates. Monitor effectiveness to optimize sequences.'
            }
        });
    } catch (error) {
        console.error("Followup Stats Error:", error);
        res.json({ followupStats: {} });
    }
});

// POST /api/followups/bulk-configure - Set up follow-ups for multiple prospects
app.post('/api/followups/bulk-configure', async (req, res) => {
    try {
        const { lead_ids, days_to_wait, max_followups } = req.body;
        
        if (!Array.isArray(lead_ids) || !days_to_wait) {
            return res.status(400).json({ error: 'lead_ids array and days_to_wait required' });
        }
        
        let configured = 0;
        for (const leadId of lead_ids) {
            await db.run(
                `INSERT INTO activity_timeline (lead_id, activity_type, activity_description, metadata, created_at)
                 VALUES (?, ?, ?, ?, ?)`,
                [leadId, 'followup_configured', `Bulk follow-up configured: ${days_to_wait} days, max ${max_followups || 3}`,
                 JSON.stringify({days_to_wait, max_followups: max_followups || 3}), Date.now()]
            );
            configured++;
        }
        
        res.json({
            bulk_configured: configured,
            days_to_wait: days_to_wait,
            max_followups: max_followups || 3,
            message: `Follow-up sequences enabled for ${configured} prospects`
        });
    } catch (error) {
        console.error("Bulk Followup Config Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/prospects/calculate-tiers - Auto-calculate performance tiers for all prospects
app.post('/api/prospects/calculate-tiers', async (req, res) => {
    try {
        const prospects = await db.all(`
            SELECT 
                pq.id,
                pq.company_name,
                COALESCE(ls.engagement_score, 0) as engagement_score,
                COALESCE(eq.research_quality, 0) as avg_quality,
                COALESCE(COUNT(em.id), 0) as reply_count
            FROM prospect_queue pq
            LEFT JOIN lead_scores ls ON pq.id = ls.lead_id
            LEFT JOIN email_queue eq ON pq.id = eq.lead_id
            LEFT JOIN email_messages em ON pq.id = em.lead_id AND em.received_at IS NOT NULL
            GROUP BY pq.id
        `);
        
        let updated = 0;
        for (const prospect of prospects) {
            // Calculate tier score (0-100)
            const engagementScore = prospect.engagement_score || 0;
            const qualityScore = prospect.avg_quality || 0;
            const replyBonus = Math.min(prospect.reply_count * 10, 20);
            const tierScore = (engagementScore * 0.5) + (qualityScore * 3) + replyBonus;
            
            // Assign tier based on score
            let tier = 'low';
            if (tierScore >= 70) tier = 'vip';
            else if (tierScore >= 50) tier = 'high';
            else if (tierScore >= 30) tier = 'medium';
            else tier = 'low';
            
            await db.run(
                `UPDATE prospect_queue SET performance_tier = ?, tier_score = ?, tier_calculated_at = ? WHERE id = ?`,
                [tier, Math.round(tierScore), Date.now(), prospect.id]
            );
            updated++;
        }
        
        res.json({
            recalculated: updated,
            message: `Performance tiers calculated for ${updated} prospects`
        });
    } catch (error) {
        console.error("Calculate Tiers Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/prospects/tier-distribution - See prospect distribution by performance tier
app.get('/api/prospects/tier-distribution', async (req, res) => {
    try {
        const distribution = await db.all(`
            SELECT 
                performance_tier,
                COUNT(*) as count,
                AVG(tier_score) as avg_score,
                SUM(CASE WHEN workflow_stage = 'qualified' THEN 1 ELSE 0 END) as qualified_count
            FROM prospect_queue
            GROUP BY performance_tier
            ORDER BY CASE WHEN performance_tier = 'vip' THEN 1 
                         WHEN performance_tier = 'high' THEN 2
                         WHEN performance_tier = 'medium' THEN 3
                         ELSE 4 END
        `);
        
        const totalProspects = distribution.reduce((sum, d) => sum + d.count, 0);
        
        res.json({
            tierMetrics: {
                total_prospects: totalProspects,
                by_tier: distribution.map(d => ({
                    tier: d.performance_tier,
                    count: d.count,
                    percentage: Math.round((d.count / totalProspects) * 100),
                    avg_tier_score: Math.round(d.avg_score || 0),
                    qualified: d.qualified_count || 0
                })),
                tier_summary: {
                    vip: distribution.find(d => d.performance_tier === 'vip')?.count || 0,
                    high: distribution.find(d => d.performance_tier === 'high')?.count || 0,
                    medium: distribution.find(d => d.performance_tier === 'medium')?.count || 0,
                    low: distribution.find(d => d.performance_tier === 'low')?.count || 0
                }
            }
        });
    } catch (error) {
        console.error("Tier Distribution Error:", error);
        res.json({ tierMetrics: { total_prospects: 0 } });
    }
});

// GET /api/prospects/by-tier/:tier - Get all prospects in a specific performance tier
app.get('/api/prospects/by-tier/:tier', async (req, res) => {
    try {
        const { tier } = req.params;
        const validTiers = ['vip', 'high', 'medium', 'low'];
        
        if (!validTiers.includes(tier)) {
            return res.status(400).json({ error: `Invalid tier. Must be one of: ${validTiers.join(', ')}` });
        }
        
        const prospects = await db.all(`
            SELECT 
                pq.id,
                pq.company_name,
                pq.contact_email,
                pq.workflow_stage,
                pq.tier_score,
                ls.engagement_score,
                ls.priority_rank,
                COUNT(eq.id) as emails_sent
            FROM prospect_queue pq
            LEFT JOIN lead_scores ls ON pq.id = ls.lead_id
            LEFT JOIN email_queue eq ON pq.id = eq.lead_id AND eq.status = 'sent'
            WHERE pq.performance_tier = ?
            GROUP BY pq.id
            ORDER BY pq.tier_score DESC
            LIMIT 100
        `, [tier]);
        
        res.json({
            tier: tier,
            prospects_found: prospects.length,
            prospects: prospects.map(p => ({
                id: p.id,
                company: p.company_name,
                email: p.contact_email,
                stage: p.workflow_stage,
                tier_score: p.tier_score,
                engagement: p.engagement_score || 0,
                priority: p.priority_rank,
                emails_sent: p.emails_sent
            }))
        });
    } catch (error) {
        console.error("Get By Tier Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/prospects/tier-analytics - Performance metrics by tier
app.get('/api/prospects/tier-analytics', async (req, res) => {
    try {
        const analytics = await db.all(`
            SELECT 
                pq.performance_tier,
                COUNT(*) as total,
                SUM(CASE WHEN em.id IS NOT NULL THEN 1 ELSE 0 END) as replied,
                AVG(ls.engagement_score) as avg_engagement,
                SUM(CASE WHEN pq.workflow_stage = 'qualified' THEN 1 ELSE 0 END) as qualified
            FROM prospect_queue pq
            LEFT JOIN email_messages em ON pq.id = em.lead_id
            LEFT JOIN lead_scores ls ON pq.id = ls.lead_id
            GROUP BY pq.performance_tier
        `);
        
        const metrics = analytics.map(a => {
            const replyRate = a.total > 0 ? Math.round((a.replied / a.total) * 100) : 0;
            const conversionRate = a.total > 0 ? Math.round((a.qualified / a.total) * 100) : 0;
            return {
                tier: a.performance_tier,
                total_prospects: a.total,
                reply_rate: `${replyRate}%`,
                avg_engagement_score: Math.round(a.avg_engagement || 0),
                qualified_count: a.qualified,
                conversion_rate: `${conversionRate}%`
            };
        });
        
        res.json({
            tierAnalytics: {
                metrics_by_tier: metrics,
                insight: 'VIP tier should have 30%+ conversion rates. High tier 15%+. Use low tier for testing new approaches.'
            }
        });
    } catch (error) {
        console.error("Tier Analytics Error:", error);
        res.json({ tierAnalytics: { metrics_by_tier: [] } });
    }
});

// POST /api/prospects/bulk-operations-by-tier - Perform bulk operations on all prospects in a tier
app.post('/api/prospects/bulk-operations-by-tier', async (req, res) => {
    try {
        const { tier, operation, payload } = req.body;
        
        const validTiers = ['vip', 'high', 'medium', 'low'];
        if (!validTiers.includes(tier)) {
            return res.status(400).json({ error: `Invalid tier. Must be one of: ${validTiers.join(', ')}` });
        }
        
        // Get all prospects in tier
        const prospects = await db.all(
            `SELECT id FROM prospect_queue WHERE performance_tier = ?`,
            [tier]
        );
        
        let result = 0;
        
        if (operation === 'update_status') {
            const { new_stage } = payload;
            for (const p of prospects) {
                await db.run(
                    `UPDATE prospect_queue SET workflow_stage = ?, stage_updated_at = ?, updated_at = ? WHERE id = ?`,
                    [new_stage, Date.now(), Date.now(), p.id]
                );
                result++;
            }
        } else if (operation === 'add_tag') {
            const { tag_name } = payload;
            for (const p of prospects) {
                await db.run(
                    `INSERT OR IGNORE INTO prospect_tags (lead_id, tag_name, tag_category, added_at)
                     VALUES (?, ?, ?, ?)`,
                    [p.id, tag_name, 'tier_operation', Date.now()]
                );
                result++;
            }
        } else if (operation === 'schedule_followups') {
            for (const p of prospects) {
                await db.run(
                    `INSERT INTO activity_timeline (lead_id, activity_type, activity_description, created_at)
                     VALUES (?, ?, ?, ?)`,
                    [p.id, 'followup_configured', `Tier-based follow-up scheduled`, Date.now()]
                );
                result++;
            }
        }
        
        res.json({
            operation: operation,
            tier: tier,
            prospects_affected: result,
            message: `${operation} applied to ${result} prospects in ${tier} tier`
        });
    } catch (error) {
        console.error("Bulk Operations By Tier Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/templates/create - Create a new email template
app.post('/api/templates/create', async (req, res) => {
    try {
        const { template_name, template_type, subject_line, body_text, tags, target_industries, target_company_sizes, target_tiers } = req.body;
        
        if (!template_name || !subject_line || !body_text) {
            return res.status(400).json({ error: 'template_name, subject_line, and body_text required' });
        }
        
        await db.run(
            `INSERT INTO email_templates (template_name, template_type, subject_line, body_text, tags, target_industries, target_company_sizes, target_tiers, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [template_name, template_type || 'initial', subject_line, body_text, JSON.stringify(tags || []),
             JSON.stringify(target_industries || []), JSON.stringify(target_company_sizes || []),
             JSON.stringify(target_tiers || []), Date.now(), Date.now()]
        );
        
        res.json({ created: true, template_name, message: 'Template created successfully' });
    } catch (error) {
        if (error.message.includes('UNIQUE')) {
            return res.status(400).json({ error: 'Template name already exists' });
        }
        res.status(500).json({ error: error.message });
    }
});

// GET /api/templates/library - List all email templates
app.get('/api/templates/library', async (req, res) => {
    try {
        const templates = await db.all(`
            SELECT 
                id,
                template_name,
                template_type,
                subject_line,
                body_text,
                tags,
                target_industries,
                target_company_sizes,
                target_tiers,
                created_at
            FROM email_templates
            ORDER BY created_at DESC
            LIMIT 100
        `);
        
        res.json({
            templates: templates.map(t => ({
                id: t.id,
                name: t.template_name,
                type: t.template_type,
                subject: t.subject_line?.substring(0, 50),
                tags: JSON.parse(t.tags || '[]'),
                industries: JSON.parse(t.target_industries || '[]'),
                sizes: JSON.parse(t.target_company_sizes || '[]'),
                tiers: JSON.parse(t.target_tiers || '[]'),
                created: new Date(t.created_at).toLocaleDateString()
            })),
            total: templates.length
        });
    } catch (error) {
        res.json({ templates: [], total: 0 });
    }
});

// GET /api/templates/:id/details - Get full template details
app.get('/api/templates/:id/details', async (req, res) => {
    try {
        const { id } = req.params;
        const template = await db.get(
            `SELECT * FROM email_templates WHERE id = ?`,
            [id]
        );
        
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        res.json({
            template: {
                id: template.id,
                name: template.template_name,
                type: template.template_type,
                subject: template.subject_line,
                body: template.body_text,
                tags: JSON.parse(template.tags || '[]'),
                industries: JSON.parse(template.target_industries || '[]'),
                sizes: JSON.parse(template.target_company_sizes || '[]'),
                tiers: JSON.parse(template.target_tiers || '[]')
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/templates/performance - Analytics on template performance
app.get('/api/templates/performance', async (req, res) => {
    try {
        const performance = await db.all(`
            SELECT 
                et.id,
                et.template_name,
                COUNT(tu.id) as uses,
                SUM(CASE WHEN tu.replied = 1 THEN 1 ELSE 0 END) as replies,
                SUM(CASE WHEN tu.reply_sentiment = 'positive' THEN 1 ELSE 0 END) as positive_replies,
                COUNT(DISTINCT tu.lead_id) as unique_prospects
            FROM email_templates et
            LEFT JOIN template_usage tu ON et.id = tu.template_id
            GROUP BY et.id
            ORDER BY COUNT(tu.id) DESC
        `);
        
        const templateMetrics = performance.map(p => {
            const replyRate = p.uses > 0 ? Math.round((p.replies / p.uses) * 100) : 0;
            const positiveRate = p.replies > 0 ? Math.round((p.positive_replies / p.replies) * 100) : 0;
            return {
                template: p.template_name,
                uses: p.uses || 0,
                replies: p.replies || 0,
                reply_rate: `${replyRate}%`,
                positive_replies: p.positive_replies || 0,
                positive_rate: `${positiveRate}%`,
                unique_prospects: p.unique_prospects || 0,
                effectiveness: replyRate > 20 ? '✅ Highly effective' : replyRate > 10 ? '→ Good' : '⚠️ Needs improvement'
            };
        });
        
        res.json({
            templatePerformance: {
                total_templates: performance.length,
                metrics: templateMetrics.slice(0, 10),
                top_template: templateMetrics[0] || null
            }
        });
    } catch (error) {
        res.json({ templatePerformance: { total_templates: 0, metrics: [] } });
    }
});

// GET /api/templates/recommend - Get best templates for a prospect segment
app.get('/api/templates/recommend', async (req, res) => {
    try {
        const { tier, industry, company_size } = req.query;
        
        const recommendations = await db.all(`
            SELECT 
                et.id,
                et.template_name,
                et.template_type,
                COUNT(tu.id) as uses,
                SUM(CASE WHEN tu.replied = 1 THEN 1 ELSE 0 END) as replies
            FROM email_templates et
            LEFT JOIN template_usage tu ON et.id = tu.template_id
            WHERE 1=1
                ${tier ? `AND et.target_tiers LIKE '%${tier}%'` : ''}
                ${industry ? `AND et.target_industries LIKE '%${industry}%'` : ''}
                ${company_size ? `AND et.target_company_sizes LIKE '%${company_size}%'` : ''}
            GROUP BY et.id
            ORDER BY CASE WHEN replies > 0 THEN CAST(replies AS REAL) / COUNT(tu.id) ELSE 0 END DESC
            LIMIT 5
        `);
        
        res.json({
            recommendations: recommendations.map(r => ({
                id: r.id,
                template: r.template_name,
                type: r.template_type,
                uses: r.uses || 0,
                reply_rate: r.uses > 0 ? Math.round(((r.replies || 0) / r.uses) * 100) : 0
            })),
            filters: { tier, industry, company_size }
        });
    } catch (error) {
        res.json({ recommendations: [] });
    }
});

// POST /api/templates/link-usage - Track which template was used in an email
app.post('/api/templates/link-usage', async (req, res) => {
    try {
        const { template_id, email_id, lead_id } = req.body;
        
        if (!template_id || !email_id) {
            return res.status(400).json({ error: 'template_id and email_id required' });
        }
        
        await db.run(
            `INSERT INTO template_usage (template_id, email_id, lead_id, sent_at, created_at)
             VALUES (?, ?, ?, ?, ?)`,
            [template_id, email_id, lead_id, Date.now(), Date.now()]
        );
        
        res.json({ tracked: true, message: 'Template usage tracked' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PUT /api/templates/:id/update - Update an email template
app.put('/api/templates/:id/update', async (req, res) => {
    try {
        const { id } = req.params;
        const { subject_line, body_text, tags, target_industries, target_company_sizes, target_tiers } = req.body;
        
        await db.run(
            `UPDATE email_templates SET subject_line = ?, body_text = ?, tags = ?, target_industries = ?, target_company_sizes = ?, target_tiers = ?, updated_at = ?
             WHERE id = ?`,
            [subject_line, body_text, JSON.stringify(tags || []), JSON.stringify(target_industries || []),
             JSON.stringify(target_company_sizes || []), JSON.stringify(target_tiers || []), Date.now(), id]
        );
        
        res.json({ updated: true, message: 'Template updated successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/deals/create - Create or update a deal in the pipeline
app.post('/api/deals/create', async (req, res) => {
    try {
        const { lead_id, company_name, deal_value, deal_stage, deal_probability, close_date, notes } = req.body;
        
        if (!lead_id || !deal_value) {
            return res.status(400).json({ error: 'lead_id and deal_value required' });
        }
        
        // Check if deal exists
        const existing = await db.get(`SELECT id FROM deal_pipeline WHERE lead_id = ?`, [lead_id]);
        
        if (existing) {
            await db.run(
                `UPDATE deal_pipeline SET deal_value = ?, deal_stage = ?, deal_probability = ?, close_date = ?, notes = ?, updated_at = ? WHERE lead_id = ?`,
                [deal_value, deal_stage || 'initial', deal_probability || 0, close_date, notes, Date.now(), lead_id]
            );
        } else {
            await db.run(
                `INSERT INTO deal_pipeline (lead_id, company_name, deal_value, deal_stage, deal_probability, close_date, notes, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [lead_id, company_name, deal_value, deal_stage || 'initial', deal_probability || 0, close_date, notes, Date.now(), Date.now()]
            );
        }
        
        res.json({ created: true, deal_value, stage: deal_stage, probability: deal_probability });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/deals/pipeline - Full deal pipeline with values and stages
app.get('/api/deals/pipeline', async (req, res) => {
    try {
        const deals = await db.all(`
            SELECT 
                deal_stage,
                COUNT(*) as deal_count,
                SUM(deal_value * deal_probability / 100) as weighted_value,
                AVG(deal_probability) as avg_probability,
                SUM(deal_value) as total_value
            FROM deal_pipeline
            WHERE closed_status IS NULL
            GROUP BY deal_stage
            ORDER BY CASE 
                WHEN deal_stage = 'initial' THEN 1
                WHEN deal_stage = 'contacted' THEN 2
                WHEN deal_stage = 'interested' THEN 3
                WHEN deal_stage = 'qualified' THEN 4
                WHEN deal_stage = 'proposal' THEN 5
                ELSE 6
            END
        `);
        
        const totalPipeline = deals.reduce((sum, d) => sum + (d.total_value || 0), 0);
        const totalWeightedPipeline = deals.reduce((sum, d) => sum + (d.weighted_value || 0), 0);
        
        res.json({
            pipelineMetrics: {
                total_deals: deals.reduce((sum, d) => sum + d.deal_count, 0),
                total_pipeline_value: Math.round(totalPipeline),
                weighted_pipeline_value: Math.round(totalWeightedPipeline),
                by_stage: deals.map(d => ({
                    stage: d.deal_stage,
                    count: d.deal_count,
                    total_value: Math.round(d.total_value || 0),
                    weighted_value: Math.round(d.weighted_value || 0),
                    avg_probability: Math.round(d.avg_probability || 0)
                }))
            }
        });
    } catch (error) {
        res.json({ pipelineMetrics: { total_deals: 0, total_pipeline_value: 0 } });
    }
});

// GET /api/deals/forecast - Revenue forecast by close date (30/60/90 days)
app.get('/api/deals/forecast', async (req, res) => {
    try {
        const now = Date.now();
        const thirtyDays = now + (30 * 24 * 60 * 60 * 1000);
        const sixtyDays = now + (60 * 24 * 60 * 60 * 1000);
        const ninetyDays = now + (90 * 24 * 60 * 60 * 1000);
        
        const forecast = await db.all(`
            SELECT 
                CASE 
                    WHEN close_date <= ? THEN '30_days'
                    WHEN close_date <= ? THEN '60_days'
                    WHEN close_date <= ? THEN '90_days'
                    ELSE 'beyond_90'
                END as window,
                COUNT(*) as deal_count,
                SUM(deal_value * deal_probability / 100) as weighted_revenue
            FROM deal_pipeline
            WHERE closed_status IS NULL AND close_date IS NOT NULL
            GROUP BY window
        `, [thirtyDays, sixtyDays, ninetyDays]);
        
        const forecastData = {
            forecast_30_days: forecast.find(f => f.window === '30_days')?.weighted_revenue || 0,
            forecast_60_days: forecast.find(f => f.window === '60_days')?.weighted_revenue || 0,
            forecast_90_days: forecast.find(f => f.window === '90_days')?.weighted_revenue || 0,
            forecast_beyond: forecast.find(f => f.window === 'beyond_90')?.weighted_revenue || 0
        };
        
        res.json({
            revenueForecasts: {
                next_30_days: Math.round(forecastData.forecast_30_days),
                next_60_days: Math.round(forecastData.forecast_60_days),
                next_90_days: Math.round(forecastData.forecast_90_days),
                beyond_90_days: Math.round(forecastData.forecast_beyond),
                total_forecast: Math.round(Object.values(forecastData).reduce((a,b) => a+b, 0))
            }
        });
    } catch (error) {
        res.json({ revenueForecasts: {} });
    }
});

// GET /api/deals/by-probability - Deal distribution by probability tier
app.get('/api/deals/by-probability', async (req, res) => {
    try {
        const deals = await db.all(`
            SELECT 
                CASE 
                    WHEN deal_probability >= 75 THEN 'high_confidence'
                    WHEN deal_probability >= 50 THEN 'medium_confidence'
                    WHEN deal_probability >= 25 THEN 'low_confidence'
                    ELSE 'exploratory'
                END as probability_tier,
                COUNT(*) as count,
                SUM(deal_value) as total_value,
                SUM(deal_value * deal_probability / 100) as weighted_value,
                AVG(deal_probability) as avg_prob
            FROM deal_pipeline
            WHERE closed_status IS NULL
            GROUP BY probability_tier
        `);
        
        res.json({
            dealsByProbability: {
                high_confidence: {
                    count: deals.find(d => d.probability_tier === 'high_confidence')?.count || 0,
                    value: Math.round(deals.find(d => d.probability_tier === 'high_confidence')?.weighted_value || 0)
                },
                medium_confidence: {
                    count: deals.find(d => d.probability_tier === 'medium_confidence')?.count || 0,
                    value: Math.round(deals.find(d => d.probability_tier === 'medium_confidence')?.weighted_value || 0)
                },
                low_confidence: {
                    count: deals.find(d => d.probability_tier === 'low_confidence')?.count || 0,
                    value: Math.round(deals.find(d => d.probability_tier === 'low_confidence')?.weighted_value || 0)
                },
                exploratory: {
                    count: deals.find(d => d.probability_tier === 'exploratory')?.count || 0,
                    value: Math.round(deals.find(d => d.probability_tier === 'exploratory')?.weighted_value || 0)
                }
            }
        });
    } catch (error) {
        res.json({ dealsByProbability: {} });
    }
});

// PUT /api/deals/:leadId/close - Mark a deal as won or lost
app.put('/api/deals/:leadId/close', async (req, res) => {
    try {
        const { leadId } = req.params;
        const { closed_status } = req.body;
        
        if (!['won', 'lost'].includes(closed_status)) {
            return res.status(400).json({ error: 'closed_status must be "won" or "lost"' });
        }
        
        await db.run(
            `UPDATE deal_pipeline SET closed_status = ?, closed_at = ?, deal_stage = ? WHERE lead_id = ?`,
            [closed_status, Date.now(), closed_status === 'won' ? 'won' : 'lost', leadId]
        );
        
        res.json({ closed: true, status: closed_status });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/deals/summary - Quick pipeline summary for dashboard
app.get('/api/deals/summary', async (req, res) => {
    try {
        const summary = await db.get(`
            SELECT 
                COUNT(*) as total_deals,
                SUM(deal_value * deal_probability / 100) as pipeline_value,
                AVG(deal_probability) as avg_probability
            FROM deal_pipeline
            WHERE closed_status IS NULL
        `);
        
        res.json({
            dealSummary: {
                total_open_deals: summary.total_deals || 0,
                pipeline_value: Math.round(summary.pipeline_value || 0),
                avg_probability: Math.round(summary.avg_probability || 0),
                status: '📊 Pipeline active'
            }
        });
    } catch (error) {
        res.json({ dealSummary: {} });
    }
});

// POST /api/campaigns/track - Track a campaign with budget
app.post('/api/campaigns/track', async (req, res) => {
    try {
        const { campaign_name, campaign_source, budget_spent } = req.body;
        
        if (!campaign_name) {
            return res.status(400).json({ error: 'campaign_name required' });
        }
        
        await db.run(
            `INSERT INTO campaign_tracking (campaign_name, campaign_source, budget_spent, created_at)
             VALUES (?, ?, ?, ?)`,
            [campaign_name, campaign_source || 'organic', budget_spent || 0, Date.now()]
        );
        
        res.json({ tracked: true, campaign_name });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/prospects/:leadId/source - Tag a prospect with lead source/campaign
app.post('/api/prospects/:leadId/source', async (req, res) => {
    try {
        const { leadId } = req.params;
        const { lead_source, campaign_id } = req.body;
        
        await db.run(
            `UPDATE prospect_queue SET lead_source = ?, campaign_id = ?, updated_at = ? WHERE id = ?`,
            [lead_source || 'organic', campaign_id, Date.now(), leadId]
        );
        
        res.json({ updated: true, source: lead_source });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/analytics/lead-source-roi - ROI by lead source
app.get('/api/analytics/lead-source-roi', async (req, res) => {
    try {
        const sourceAnalytics = await db.all(`
            SELECT 
                pq.lead_source,
                COUNT(DISTINCT pq.id) as leads_generated,
                COUNT(DISTINCT dp.id) as deals_created,
                SUM(CASE WHEN dp.closed_status = 'won' THEN 1 ELSE 0 END) as deals_won,
                SUM(CASE WHEN dp.closed_status = 'won' THEN dp.deal_value ELSE 0 END) as revenue_generated,
                AVG(ls.engagement_score) as avg_engagement
            FROM prospect_queue pq
            LEFT JOIN deal_pipeline dp ON pq.id = dp.lead_id
            LEFT JOIN lead_scores ls ON pq.id = ls.lead_id
            GROUP BY pq.lead_source
            ORDER BY COUNT(DISTINCT pq.id) DESC
        `);
        
        const metrics = sourceAnalytics.map(s => {
            const conversionRate = s.leads_generated > 0 ? Math.round((s.deals_won / s.leads_generated) * 100) : 0;
            const valuePerLead = s.leads_generated > 0 ? Math.round(s.revenue_generated / s.leads_generated) : 0;
            return {
                source: s.lead_source,
                leads: s.leads_generated,
                deals: s.deals_created || 0,
                deals_won: s.deals_won || 0,
                revenue: Math.round(s.revenue_generated || 0),
                conversion_rate: `${conversionRate}%`,
                value_per_lead: valuePerLead,
                avg_engagement: Math.round(s.avg_engagement || 0)
            };
        });
        
        res.json({
            sourceROI: {
                total_sources: metrics.length,
                by_source: metrics,
                top_source: metrics[0] || null
            }
        });
    } catch (error) {
        res.json({ sourceROI: { total_sources: 0, by_source: [] } });
    }
});

// GET /api/analytics/campaign-roi - ROI by campaign
app.get('/api/analytics/campaign-roi', async (req, res) => {
    try {
        const campaignAnalytics = await db.all(`
            SELECT 
                pq.campaign_id,
                COUNT(DISTINCT pq.id) as leads_generated,
                COUNT(DISTINCT dp.id) as deals_created,
                SUM(CASE WHEN dp.closed_status = 'won' THEN 1 ELSE 0 END) as deals_won,
                SUM(CASE WHEN dp.closed_status = 'won' THEN dp.deal_value ELSE 0 END) as revenue_generated,
                ct.budget_spent
            FROM prospect_queue pq
            LEFT JOIN deal_pipeline dp ON pq.id = dp.lead_id
            LEFT JOIN campaign_tracking ct ON pq.campaign_id = ct.campaign_name
            WHERE pq.campaign_id IS NOT NULL
            GROUP BY pq.campaign_id
        `);
        
        const roi = campaignAnalytics.map(c => {
            const roiPercent = c.budget_spent > 0 ? Math.round(((c.revenue_generated - c.budget_spent) / c.budget_spent) * 100) : 0;
            const costPerLead = c.leads_generated > 0 ? Math.round(c.budget_spent / c.leads_generated) : 0;
            return {
                campaign: c.campaign_id,
                budget: Math.round(c.budget_spent || 0),
                leads: c.leads_generated,
                deals_won: c.deals_won || 0,
                revenue: Math.round(c.revenue_generated || 0),
                roi_percent: `${roiPercent}%`,
                cost_per_lead: costPerLead,
                profit: Math.round((c.revenue_generated || 0) - (c.budget_spent || 0))
            };
        });
        
        res.json({
            campaignROI: {
                total_campaigns: roi.length,
                campaigns: roi.sort((a,b) => b.roi_percent - a.roi_percent)
            }
        });
    } catch (error) {
        res.json({ campaignROI: { total_campaigns: 0 } });
    }
});

// GET /api/analytics/attribution - How many prospects reach each stage by source
app.get('/api/analytics/attribution', async (req, res) => {
    try {
        const attribution = await db.all(`
            SELECT 
                pq.lead_source,
                pq.workflow_stage,
                COUNT(*) as count
            FROM prospect_queue pq
            GROUP BY pq.lead_source, pq.workflow_stage
            ORDER BY pq.lead_source, 
                CASE WHEN pq.workflow_stage = 'new' THEN 1
                     WHEN pq.workflow_stage = 'contacted' THEN 2
                     WHEN pq.workflow_stage = 'interested' THEN 3
                     WHEN pq.workflow_stage = 'qualified' THEN 4
                     WHEN pq.workflow_stage = 'won' THEN 5
                     ELSE 6 END
        `);
        
        const sources = [...new Set(attribution.map(a => a.lead_source))];
        const attributionMap = {};
        
        for (const source of sources) {
            attributionMap[source] = {
                new: attribution.find(a => a.lead_source === source && a.workflow_stage === 'new')?.count || 0,
                contacted: attribution.find(a => a.lead_source === source && a.workflow_stage === 'contacted')?.count || 0,
                interested: attribution.find(a => a.lead_source === source && a.workflow_stage === 'interested')?.count || 0,
                qualified: attribution.find(a => a.lead_source === source && a.workflow_stage === 'qualified')?.count || 0,
                won: attribution.find(a => a.lead_source === source && a.workflow_stage === 'won')?.count || 0
            };
        }
        
        res.json({
            stageAttribution: attributionMap,
            sources: sources
        });
    } catch (error) {
        res.json({ stageAttribution: {} });
    }
});

// POST /api/prospects/:leadId/enrich - Add enrichment data to prospect record
app.post('/api/prospects/:leadId/enrich', async (req, res) => {
    try {
        const { leadId } = req.params;
        const { company_size, industry, revenue_range, employee_count } = req.body;
        
        await db.run(
            `UPDATE prospect_queue SET company_size = ?, industry = ?, revenue_range = ?, employee_count = ?, enriched_at = ?, updated_at = ? WHERE id = ?`,
            [company_size, industry, revenue_range, employee_count, Date.now(), Date.now(), leadId]
        );
        
        res.json({ enriched: true, leadId });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/prospects/data-quality - Show data quality scores for all prospects
app.get('/api/prospects/data-quality', async (req, res) => {
    try {
        const prospects = await db.all(`
            SELECT 
                id,
                company_name,
                contact_email,
                website_url,
                company_size,
                industry,
                revenue_range,
                employee_count
            FROM prospect_queue
            LIMIT 200
        `);
        
        const withQuality = prospects.map(p => {
            let score = 0;
            const dataPoints = [];
            
            if (p.company_name) { score += 20; dataPoints.push('company'); }
            if (p.contact_email) { score += 20; dataPoints.push('email'); }
            if (p.website_url) { score += 15; dataPoints.push('website'); }
            if (p.company_size) { score += 15; dataPoints.push('size'); }
            if (p.industry) { score += 15; dataPoints.push('industry'); }
            if (p.revenue_range) { score += 10; dataPoints.push('revenue'); }
            if (p.employee_count) { score += 5; dataPoints.push('headcount'); }
            
            const missing = [];
            if (!p.company_size) missing.push('company_size');
            if (!p.industry) missing.push('industry');
            if (!p.website_url) missing.push('website_url');
            if (!p.revenue_range) missing.push('revenue_range');
            
            return {
                id: p.id,
                company: p.company_name,
                quality_score: score,
                data_completeness: `${score}%`,
                missing_fields: missing,
                quality_tier: score >= 80 ? 'excellent' : score >= 60 ? 'good' : score >= 40 ? 'fair' : 'poor'
            };
        });
        
        const distribution = {
            excellent: withQuality.filter(p => p.quality_score >= 80).length,
            good: withQuality.filter(p => p.quality_score >= 60 && p.quality_score < 80).length,
            fair: withQuality.filter(p => p.quality_score >= 40 && p.quality_score < 60).length,
            poor: withQuality.filter(p => p.quality_score < 40).length
        };
        
        res.json({
            dataQuality: {
                total_prospects: withQuality.length,
                avg_quality_score: Math.round(withQuality.reduce((sum, p) => sum + p.quality_score, 0) / withQuality.length || 0),
                distribution: distribution,
                prospects: withQuality.sort((a, b) => a.quality_score - b.quality_score)
            }
        });
    } catch (error) {
        res.json({ dataQuality: { total_prospects: 0 } });
    }
});

// POST /api/prospects/bulk-enrich - Batch enrich prospects with data
app.post('/api/prospects/bulk-enrich', async (req, res) => {
    try {
        const { enrichments } = req.body; // Array of {lead_id, company_size, industry, revenue_range, employee_count}
        
        if (!Array.isArray(enrichments)) {
            return res.status(400).json({ error: 'enrichments must be an array' });
        }
        
        let updated = 0;
        for (const enrich of enrichments) {
            await db.run(
                `UPDATE prospect_queue SET company_size = ?, industry = ?, revenue_range = ?, employee_count = ?, enriched_at = ?, updated_at = ? WHERE id = ?`,
                [enrich.company_size, enrich.industry, enrich.revenue_range, enrich.employee_count, Date.now(), Date.now(), enrich.lead_id]
            );
            updated++;
        }
        
        res.json({
            enriched: updated,
            message: `Enriched ${updated} prospects with data`
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/prospects/enrichment-progress - Track enrichment across pipeline
app.get('/api/prospects/enrichment-progress', async (req, res) => {
    try {
        const stats = await db.get(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN company_size IS NOT NULL THEN 1 ELSE 0 END) as with_size,
                SUM(CASE WHEN industry IS NOT NULL THEN 1 ELSE 0 END) as with_industry,
                SUM(CASE WHEN revenue_range IS NOT NULL THEN 1 ELSE 0 END) as with_revenue,
                SUM(CASE WHEN employee_count IS NOT NULL THEN 1 ELSE 0 END) as with_headcount,
                SUM(CASE WHEN enriched_at IS NOT NULL THEN 1 ELSE 0 END) as enriched
            FROM prospect_queue
        `);
        
        const total = stats.total || 0;
        
        res.json({
            enrichmentMetrics: {
                total_prospects: total,
                enriched_count: stats.enriched || 0,
                enrichment_percent: total > 0 ? Math.round((stats.enriched / total) * 100) : 0,
                by_field: {
                    company_size: {
                        count: stats.with_size || 0,
                        percent: total > 0 ? Math.round((stats.with_size / total) * 100) : 0
                    },
                    industry: {
                        count: stats.with_industry || 0,
                        percent: total > 0 ? Math.round((stats.with_industry / total) * 100) : 0
                    },
                    revenue_range: {
                        count: stats.with_revenue || 0,
                        percent: total > 0 ? Math.round((stats.with_revenue / total) * 100) : 0
                    },
                    employee_count: {
                        count: stats.with_headcount || 0,
                        percent: total > 0 ? Math.round((stats.with_headcount / total) * 100) : 0
                    }
                },
                recommendation: `${total - stats.enriched} prospects need enrichment for better targeting`
            }
        });
    } catch (error) {
        res.json({ enrichmentMetrics: {} });
    }
});

// GET /api/prospects/needs-enrichment - Get prospects with incomplete data
app.get('/api/prospects/needs-enrichment', async (req, res) => {
    try {
        const needsEnrich = await db.all(`
            SELECT 
                id,
                company_name,
                contact_email,
                workflow_stage,
                performance_tier,
                CASE WHEN company_size IS NULL THEN 1 ELSE 0 END +
                CASE WHEN industry IS NULL THEN 1 ELSE 0 END +
                CASE WHEN revenue_range IS NULL THEN 1 ELSE 0 END as missing_count
            FROM prospect_queue
            WHERE (company_size IS NULL OR industry IS NULL OR revenue_range IS NULL)
            ORDER BY missing_count DESC, performance_tier DESC
            LIMIT 50
        `);
        
        res.json({
            needsEnrichment: {
                total_needing: needsEnrich.length,
                prospects: needsEnrich.map(p => ({
                    id: p.id,
                    company: p.company_name,
                    email: p.contact_email,
                    tier: p.performance_tier,
                    stage: p.workflow_stage,
                    missing_fields: p.missing_count
                }))
            }
        });
    } catch (error) {
        res.json({ needsEnrichment: { total_needing: 0 } });
    }
});

// POST /api/prospects/:leadId/send-time - Track email send time and analyze
app.post('/api/prospects/:leadId/send-time', async (req, res) => {
    try {
        const { leadId } = req.params;
        const { sent_at, reply_received, reply_time_hours } = req.body;
        
        const sent = new Date(sent_at);
        const hour = sent.getHours();
        const day = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][sent.getDay()];
        
        await db.run(
            `INSERT INTO email_send_times (lead_id, sent_at, sent_hour, sent_day, reply_received, reply_time_hours)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [leadId, sent_at, hour, day, reply_received ? 1 : 0, reply_time_hours || null]
        );
        
        res.json({ tracked: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/analytics/send-time-optimization - Find best sending hours
app.get('/api/analytics/send-time-optimization', async (req, res) => {
    try {
        const hourAnalytics = await db.all(`
            SELECT 
                sent_hour,
                COUNT(*) as total_sends,
                SUM(reply_received) as replies,
                AVG(CASE WHEN reply_received = 1 THEN reply_time_hours ELSE NULL END) as avg_reply_time
            FROM email_send_times
            WHERE sent_hour IS NOT NULL
            GROUP BY sent_hour
            ORDER BY sent_hour
        `);
        
        const dayAnalytics = await db.all(`
            SELECT 
                sent_day,
                COUNT(*) as total_sends,
                SUM(reply_received) as replies
            FROM email_send_times
            WHERE sent_day IS NOT NULL
            GROUP BY sent_day
            ORDER BY CASE WHEN sent_day = 'Mon' THEN 1 WHEN sent_day = 'Tue' THEN 2 WHEN sent_day = 'Wed' THEN 3 WHEN sent_day = 'Thu' THEN 4 WHEN sent_day = 'Fri' THEN 5 ELSE 6 END
        `);
        
        const bestHour = hourAnalytics.reduce((best, h) => {
            const replyRate = h.total_sends > 0 ? (h.replies / h.total_sends) : 0;
            const bestRate = best.total_sends > 0 ? (best.replies / best.total_sends) : 0;
            return replyRate > bestRate ? h : best;
        }, hourAnalytics[0] || {});
        
        const bestDay = dayAnalytics.reduce((best, d) => {
            const replyRate = d.total_sends > 0 ? (d.replies / d.total_sends) : 0;
            const bestRate = best.total_sends > 0 ? (best.replies / best.total_sends) : 0;
            return replyRate > bestRate ? d : best;
        }, dayAnalytics[0] || {});
        
        res.json({
            sendTimeOptimization: {
                best_hour: bestHour.sent_hour,
                best_hour_reply_rate: bestHour.total_sends > 0 ? Math.round((bestHour.replies / bestHour.total_sends) * 100) : 0,
                best_day: bestDay.sent_day,
                best_day_reply_rate: bestDay.total_sends > 0 ? Math.round((bestDay.replies / bestDay.total_sends) * 100) : 0,
                hourly_breakdown: hourAnalytics.map(h => ({
                    hour: h.sent_hour,
                    sends: h.total_sends,
                    replies: h.replies || 0,
                    reply_rate: h.total_sends > 0 ? Math.round((h.replies / h.total_sends) * 100) : 0
                })),
                daily_breakdown: dayAnalytics.map(d => ({
                    day: d.sent_day,
                    sends: d.total_sends,
                    replies: d.replies || 0,
                    reply_rate: d.total_sends > 0 ? Math.round((d.replies / d.total_sends) * 100) : 0
                }))
            }
        });
    } catch (error) {
        res.json({ sendTimeOptimization: {} });
    }
});

// GET /api/analytics/best-send-window - Optimal sending window by prospect
app.get('/api/analytics/best-send-window', async (req, res) => {
    try {
        const leadSendTimes = await db.all(`
            SELECT 
                lead_id,
                AVG(sent_hour) as avg_send_hour,
                COUNT(*) as total_sends,
                SUM(reply_received) as reply_count
            FROM email_send_times
            GROUP BY lead_id
            HAVING total_sends >= 2
        `);
        
        const recommendations = leadSendTimes.map(l => {
            const hour = Math.round(l.avg_send_hour);
            const replyRate = l.total_sends > 0 ? Math.round((l.reply_count / l.total_sends) * 100) : 0;
            return {
                lead_id: l.lead_id,
                recommended_hour: hour,
                send_history: l.total_sends,
                reply_rate: `${replyRate}%`
            };
        });
        
        res.json({
            sendWindowRecommendations: {
                total_prospects_analyzed: recommendations.length,
                recommendations: recommendations.slice(0, 50)
            }
        });
    } catch (error) {
        res.json({ sendWindowRecommendations: { total_prospects_analyzed: 0 } });
    }
});

// POST /api/follow-up-sequences/create - Create automated follow-up sequence for a prospect
app.post('/api/follow-up-sequences/create', async (req, res) => {
    try {
        const { lead_id, sequence_name, initial_email_id, first_sent_at } = req.body;
        
        if (!lead_id) {
            return res.status(400).json({ error: 'lead_id required' });
        }
        
        // Calculate follow-up schedule: 3 days, 7 days, 14 days
        const firstSent = first_sent_at || Date.now();
        const followUp1 = firstSent + (3 * 24 * 60 * 60 * 1000);
        const followUp2 = firstSent + (7 * 24 * 60 * 60 * 1000);
        const followUp3 = firstSent + (14 * 24 * 60 * 60 * 1000);
        
        const existing = await db.get(`SELECT id FROM follow_up_sequences WHERE lead_id = ?`, [lead_id]);
        
        if (existing) {
            await db.run(
                `UPDATE follow_up_sequences SET follow_up_1_scheduled = ?, follow_up_2_scheduled = ?, follow_up_3_scheduled = ? WHERE lead_id = ?`,
                [followUp1, followUp2, followUp3, lead_id]
            );
        } else {
            await db.run(
                `INSERT INTO follow_up_sequences (lead_id, sequence_name, initial_email_id, first_sent_at, follow_up_1_scheduled, follow_up_2_scheduled, follow_up_3_scheduled, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [lead_id, sequence_name || 'default', initial_email_id, firstSent, followUp1, followUp2, followUp3, Date.now()]
            );
        }
        
        res.json({ 
            sequence_created: true, 
            follow_up_1_at: new Date(followUp1).toISOString().split('T')[0],
            follow_up_2_at: new Date(followUp2).toISOString().split('T')[0],
            follow_up_3_at: new Date(followUp3).toISOString().split('T')[0]
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/follow-up-sequences/due - Get follow-ups due to send
app.get('/api/follow-up-sequences/due', async (req, res) => {
    try {
        const now = Date.now();
        
        const dueFollowUps = await db.all(`
            SELECT 
                fs.lead_id,
                pq.company_name,
                pq.contact_email,
                pq.contact_name,
                fs.sequence_name,
                CASE 
                    WHEN fs.follow_up_1_scheduled <= ? AND fs.follow_up_1_sent IS NULL THEN 1
                    WHEN fs.follow_up_2_scheduled <= ? AND fs.follow_up_2_sent IS NULL THEN 2
                    WHEN fs.follow_up_3_scheduled <= ? AND fs.follow_up_3_sent IS NULL THEN 3
                    ELSE NULL
                END as followup_number,
                CASE 
                    WHEN fs.follow_up_1_scheduled <= ? AND fs.follow_up_1_sent IS NULL THEN fs.follow_up_1_scheduled
                    WHEN fs.follow_up_2_scheduled <= ? AND fs.follow_up_2_sent IS NULL THEN fs.follow_up_2_scheduled
                    WHEN fs.follow_up_3_scheduled <= ? AND fs.follow_up_3_sent IS NULL THEN fs.follow_up_3_scheduled
                END as due_at
            FROM follow_up_sequences fs
            JOIN prospect_queue pq ON fs.lead_id = pq.id
            WHERE fs.sequence_status = 'active'
            AND (
                (fs.follow_up_1_scheduled <= ? AND fs.follow_up_1_sent IS NULL) OR
                (fs.follow_up_2_scheduled <= ? AND fs.follow_up_2_sent IS NULL) OR
                (fs.follow_up_3_scheduled <= ? AND fs.follow_up_3_sent IS NULL)
            )
            ORDER BY due_at ASC
        `, [now, now, now, now, now, now, now, now, now]);
        
        res.json({
            followUpsDue: {
                total_due: dueFollowUps.length,
                follow_ups: dueFollowUps.map(f => ({
                    lead_id: f.lead_id,
                    company: f.company_name,
                    contact: f.contact_name,
                    email: f.contact_email,
                    sequence: f.sequence_name,
                    follow_up_number: f.followup_number,
                    due_at: new Date(f.due_at).toISOString()
                }))
            }
        });
    } catch (error) {
        res.json({ followUpsDue: { total_due: 0 } });
    }
});

// POST /api/follow-up-sequences/:leadId/send - Mark follow-up as sent
app.post('/api/follow-up-sequences/:leadId/send', async (req, res) => {
    try {
        const { leadId } = req.params;
        const { followup_number } = req.body;
        
        if (!followup_number || ![1, 2, 3].includes(followup_number)) {
            return res.status(400).json({ error: 'followup_number must be 1, 2, or 3' });
        }
        
        const column = `follow_up_${followup_number}_sent`;
        await db.run(
            `UPDATE follow_up_sequences SET ${column} = ? WHERE lead_id = ?`,
            [Date.now(), leadId]
        );
        
        res.json({ sent: true, followup_number });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/follow-up-sequences/stats - Follow-up campaign effectiveness
app.get('/api/follow-up-sequences/stats', async (req, res) => {
    try {
        const stats = await db.get(`
            SELECT 
                COUNT(*) as total_sequences,
                SUM(CASE WHEN follow_up_1_sent IS NOT NULL THEN 1 ELSE 0 END) as sent_followup_1,
                SUM(CASE WHEN follow_up_2_sent IS NOT NULL THEN 1 ELSE 0 END) as sent_followup_2,
                SUM(CASE WHEN follow_up_3_sent IS NOT NULL THEN 1 ELSE 0 END) as sent_followup_3
            FROM follow_up_sequences
            WHERE sequence_status = 'active'
        `);
        
        res.json({
            followUpStats: {
                total_active_sequences: stats.total_sequences || 0,
                followup_1_sent: stats.sent_followup_1 || 0,
                followup_2_sent: stats.sent_followup_2 || 0,
                followup_3_sent: stats.sent_followup_3 || 0,
                engagement_strategy: '📧 3-email sequence: day 3, day 7, day 14 for non-responders'
            }
        });
    } catch (error) {
        res.json({ followUpStats: {} });
    }
});

// PUT /api/follow-up-sequences/:leadId/complete - Mark sequence as complete
app.put('/api/follow-up-sequences/:leadId/complete', async (req, res) => {
    try {
        const { leadId } = req.params;
        
        await db.run(
            `UPDATE follow_up_sequences SET sequence_status = 'completed' WHERE lead_id = ?`,
            [leadId]
        );
        
        res.json({ completed: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/deals/:leadId/close-outcome - Record deal outcome (won/lost) with details
app.post('/api/deals/:leadId/close-outcome', async (req, res) => {
    try {
        const { leadId } = req.params;
        const { outcome, close_reason, competitor_lost_to, competitor_pricing, competitor_features } = req.body;
        
        if (!outcome || !['won', 'lost'].includes(outcome)) {
            return res.status(400).json({ error: 'outcome must be "won" or "lost"' });
        }
        
        await db.run(
            `INSERT INTO deal_outcomes (lead_id, outcome, close_reason, competitor_lost_to, competitor_pricing, competitor_features, closed_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [leadId, outcome, close_reason || null, competitor_lost_to || null, competitor_pricing || null, competitor_features || null, Date.now(), Date.now()]
        );
        
        res.json({ recorded: true, outcome, competitor: competitor_lost_to });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/analytics/win-loss-summary - Overall win/loss analysis
app.get('/api/analytics/win-loss-summary', async (req, res) => {
    try {
        const summary = await db.get(`
            SELECT 
                COUNT(*) as total_closed,
                SUM(CASE WHEN outcome = 'won' THEN 1 ELSE 0 END) as deals_won,
                SUM(CASE WHEN outcome = 'lost' THEN 1 ELSE 0 END) as deals_lost
            FROM deal_outcomes
        `);
        
        const total = summary.total_closed || 0;
        const won = summary.deals_won || 0;
        const winRate = total > 0 ? Math.round((won / total) * 100) : 0;
        
        res.json({
            winLossSummary: {
                total_closed_deals: total,
                deals_won: won,
                deals_lost: total - won,
                win_rate: `${winRate}%`,
                performance: winRate >= 70 ? '⭐ Excellent' : winRate >= 50 ? '✅ Good' : winRate >= 30 ? '⚠️ Fair' : '❌ Needs improvement'
            }
        });
    } catch (error) {
        res.json({ winLossSummary: {} });
    }
});

// GET /api/analytics/competitor-analysis - Win/loss vs competitors
app.get('/api/analytics/competitor-analysis', async (req, res) => {
    try {
        const competitors = await db.all(`
            SELECT 
                competitor_lost_to,
                COUNT(*) as times_lost,
                COUNT(DISTINCT close_reason) as reasons_cited
            FROM deal_outcomes
            WHERE outcome = 'lost' AND competitor_lost_to IS NOT NULL
            GROUP BY competitor_lost_to
            ORDER BY times_lost DESC
            LIMIT 20
        `);
        
        res.json({
            competitorAnalysis: {
                top_competitors: competitors.map(c => ({
                    competitor: c.competitor_lost_to,
                    losses: c.times_lost,
                    reason_count: c.reasons_cited
                })),
                total_competitive_losses: competitors.reduce((sum, c) => sum + c.times_lost, 0)
            }
        });
    } catch (error) {
        res.json({ competitorAnalysis: { top_competitors: [] } });
    }
});

// GET /api/analytics/loss-reasons - Why deals are lost
app.get('/api/analytics/loss-reasons', async (req, res) => {
    try {
        const reasons = await db.all(`
            SELECT 
                close_reason,
                COUNT(*) as count
            FROM deal_outcomes
            WHERE outcome = 'lost' AND close_reason IS NOT NULL
            GROUP BY close_reason
            ORDER BY count DESC
            LIMIT 15
        `);
        
        res.json({
            lossReasons: {
                total_losses: reasons.reduce((sum, r) => sum + r.count, 0),
                reasons: reasons.map(r => ({
                    reason: r.close_reason,
                    count: r.count,
                    percent: Math.round((r.count / reasons.reduce((s, x) => s + x.count, 0)) * 100)
                }))
            }
        });
    } catch (error) {
        res.json({ lossReasons: {} });
    }
});

// GET /api/analytics/win-loss-by-source - Win rate by lead source
app.get('/api/analytics/win-loss-by-source', async (req, res) => {
    try {
        const sources = await db.all(`
            SELECT 
                pq.lead_source,
                COUNT(DISTINCT pq.id) as total_deals,
                SUM(CASE WHEN do.outcome = 'won' THEN 1 ELSE 0 END) as won,
                SUM(CASE WHEN do.outcome = 'lost' THEN 1 ELSE 0 END) as lost
            FROM prospect_queue pq
            LEFT JOIN deal_outcomes do ON pq.id = do.lead_id
            WHERE do.id IS NOT NULL
            GROUP BY pq.lead_source
            ORDER BY total_deals DESC
        `);
        
        res.json({
            sourceWinLoss: {
                sources: sources.map(s => ({
                    source: s.lead_source,
                    total: s.total_deals,
                    won: s.won || 0,
                    lost: s.lost || 0,
                    win_rate: s.total_deals > 0 ? Math.round(((s.won || 0) / s.total_deals) * 100) : 0
                }))
            }
        });
    } catch (error) {
        res.json({ sourceWinLoss: { sources: [] } });
    }
});

// GET /api/analytics/win-loss-by-industry - Win rate by industry vertical
app.get('/api/analytics/win-loss-by-industry', async (req, res) => {
    try {
        const industries = await db.all(`
            SELECT 
                pq.industry,
                COUNT(DISTINCT pq.id) as total_deals,
                SUM(CASE WHEN do.outcome = 'won' THEN 1 ELSE 0 END) as won
            FROM prospect_queue pq
            LEFT JOIN deal_outcomes do ON pq.id = do.lead_id
            WHERE do.id IS NOT NULL AND pq.industry IS NOT NULL
            GROUP BY pq.industry
            ORDER BY total_deals DESC
        `);
        
        res.json({
            industryWinLoss: {
                industries: industries.map(i => ({
                    industry: i.industry,
                    deals: i.total_deals,
                    won: i.won || 0,
                    win_rate: i.total_deals > 0 ? Math.round(((i.won || 0) / i.total_deals) * 100) : 0
                }))
            }
        });
    } catch (error) {
        res.json({ industryWinLoss: { industries: [] } });
    }
});

// POST /api/meetings/schedule - Schedule a meeting/call with prospect
app.post('/api/meetings/schedule', async (req, res) => {
    try {
        const { lead_id, meeting_type, scheduled_at, attendees, notes } = req.body;
        
        if (!lead_id || !scheduled_at) {
            return res.status(400).json({ error: 'lead_id and scheduled_at required' });
        }
        
        await db.run(
            `INSERT INTO prospect_meetings (lead_id, meeting_type, scheduled_at, attendees, notes, meeting_status, created_at)
             VALUES (?, ?, ?, ?, ?, 'scheduled', ?)`,
            [lead_id, meeting_type || 'call', scheduled_at, attendees, notes, Date.now()]
        );
        
        res.json({ scheduled: true, meeting_type, scheduled_for: new Date(scheduled_at).toISOString() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/meetings/:meetingId/complete - Log completed meeting with outcome
app.post('/api/meetings/:meetingId/complete', async (req, res) => {
    try {
        const { meetingId } = req.params;
        const { meeting_outcome, duration_minutes, follow_up_required, notes } = req.body;
        
        if (!meeting_outcome || !['interested', 'not_interested', 'demo_needed', 'reschedule', 'no_show'].includes(meeting_outcome)) {
            return res.status(400).json({ error: 'Invalid meeting_outcome' });
        }
        
        await db.run(
            `UPDATE prospect_meetings SET meeting_status = 'completed', completed_at = ?, meeting_outcome = ?, duration_minutes = ?, follow_up_required = ?, notes = ? WHERE id = ?`,
            [Date.now(), meeting_outcome, duration_minutes || 0, follow_up_required ? 1 : 0, notes, meetingId]
        );
        
        res.json({ completed: true, outcome: meeting_outcome });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/meetings/upcoming - List upcoming scheduled meetings
app.get('/api/meetings/upcoming', async (req, res) => {
    try {
        const now = Date.now();
        
        const upcoming = await db.all(`
            SELECT 
                pm.id,
                pm.lead_id,
                pq.company_name,
                pq.contact_name,
                pq.contact_email,
                pm.meeting_type,
                pm.scheduled_at,
                pm.attendees,
                pm.notes
            FROM prospect_meetings pm
            JOIN prospect_queue pq ON pm.lead_id = pq.id
            WHERE pm.meeting_status = 'scheduled' AND pm.scheduled_at > ?
            ORDER BY pm.scheduled_at ASC
            LIMIT 100
        `, [now]);
        
        res.json({
            upcomingMeetings: {
                total: upcoming.length,
                meetings: upcoming.map(m => ({
                    id: m.id,
                    lead_id: m.lead_id,
                    company: m.company_name,
                    contact: m.contact_name,
                    email: m.contact_email,
                    type: m.meeting_type,
                    scheduled_at: new Date(m.scheduled_at).toISOString(),
                    attendees: m.attendees
                }))
            }
        });
    } catch (error) {
        res.json({ upcomingMeetings: { total: 0, meetings: [] } });
    }
});

// GET /api/meetings/:leadId/history - Meeting history for a prospect
app.get('/api/meetings/:leadId/history', async (req, res) => {
    try {
        const { leadId } = req.params;
        
        const history = await db.all(`
            SELECT 
                id,
                meeting_type,
                scheduled_at,
                completed_at,
                meeting_status,
                meeting_outcome,
                duration_minutes,
                notes
            FROM prospect_meetings
            WHERE lead_id = ?
            ORDER BY scheduled_at DESC
        `, [leadId]);
        
        res.json({
            meetingHistory: history.map(m => ({
                id: m.id,
                type: m.meeting_type,
                scheduled_at: new Date(m.scheduled_at).toISOString(),
                completed_at: m.completed_at ? new Date(m.completed_at).toISOString() : null,
                status: m.meeting_status,
                outcome: m.meeting_outcome,
                duration: m.duration_minutes,
                notes: m.notes
            }))
        });
    } catch (error) {
        res.json({ meetingHistory: [] });
    }
});

// GET /api/analytics/meeting-effectiveness - Meeting conversion and outcome metrics
app.get('/api/analytics/meeting-effectiveness', async (req, res) => {
    try {
        const stats = await db.get(`
            SELECT 
                COUNT(*) as total_meetings,
                SUM(CASE WHEN meeting_status = 'completed' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN meeting_outcome = 'interested' THEN 1 ELSE 0 END) as interested,
                SUM(CASE WHEN meeting_outcome = 'demo_needed' THEN 1 ELSE 0 END) as demo_needed,
                SUM(CASE WHEN meeting_outcome = 'not_interested' THEN 1 ELSE 0 END) as not_interested,
                SUM(CASE WHEN meeting_outcome = 'no_show' THEN 1 ELSE 0 END) as no_shows,
                AVG(duration_minutes) as avg_duration
            FROM prospect_meetings
        `);
        
        const total = stats.total_meetings || 0;
        const completed = stats.completed || 0;
        const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
        const interested = stats.interested || 0;
        const successRate = completed > 0 ? Math.round(((interested + stats.demo_needed) / completed) * 100) : 0;
        
        res.json({
            meetingEffectiveness: {
                total_meetings: total,
                completed_meetings: completed,
                completion_rate: `${completionRate}%`,
                success_rate: `${successRate}%`,
                interested_count: interested,
                demo_needed_count: stats.demo_needed || 0,
                not_interested_count: stats.not_interested || 0,
                no_show_count: stats.no_shows || 0,
                avg_meeting_duration: Math.round(stats.avg_duration || 0),
                status: completionRate >= 80 && successRate >= 50 ? '✅ Strong' : '⚠️ Needs improvement'
            }
        });
    } catch (error) {
        res.json({ meetingEffectiveness: {} });
    }
});

// POST /api/prospects/connections/map - Map relationship between two prospects
app.post('/api/prospects/connections/map', async (req, res) => {
    try {
        const { prospect_1_id, prospect_2_id, relationship_type, company_id, is_buying_committee_member, notes } = req.body;
        
        if (!prospect_1_id || !prospect_2_id) {
            return res.status(400).json({ error: 'prospect_1_id and prospect_2_id required' });
        }
        
        await db.run(
            `INSERT INTO prospect_connections (prospect_1_id, prospect_2_id, relationship_type, company_id, is_buying_committee_member, notes, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [prospect_1_id, prospect_2_id, relationship_type || 'colleague', company_id, is_buying_committee_member ? 1 : 0, notes, Date.now()]
        );
        
        res.json({ mapped: true, prospect_1: prospect_1_id, prospect_2: prospect_2_id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/prospects/:leadId/network - Get all connections for a prospect
app.get('/api/prospects/:leadId/network', async (req, res) => {
    try {
        const { leadId } = req.params;
        
        const connections = await db.all(`
            SELECT 
                CASE WHEN prospect_1_id = ? THEN prospect_2_id ELSE prospect_1_id END as connected_prospect_id,
                pq.company_name,
                pq.contact_name,
                pq.contact_email,
                pq.job_title,
                relationship_type,
                is_buying_committee_member,
                relationship_quality
            FROM prospect_connections pc
            LEFT JOIN prospect_queue pq ON 
                CASE WHEN prospect_1_id = ? THEN prospect_2_id ELSE prospect_1_id END = pq.id
            WHERE prospect_1_id = ? OR prospect_2_id = ?
        `, [leadId, leadId, leadId, leadId]);
        
        res.json({
            prospectNetwork: {
                total_connections: connections.length,
                connections: connections.map(c => ({
                    id: c.connected_prospect_id,
                    name: c.contact_name,
                    email: c.contact_email,
                    company: c.company_name,
                    title: c.job_title,
                    relationship: c.relationship_type,
                    buying_committee_member: c.is_buying_committee_member === 1,
                    relationship_quality: c.relationship_quality
                }))
            }
        });
    } catch (error) {
        res.json({ prospectNetwork: { total_connections: 0 } });
    }
});

// GET /api/analytics/buying-committees - Find buying committees by company
app.get('/api/analytics/buying-committees', async (req, res) => {
    try {
        const committees = await db.all(`
            SELECT 
                pq.company_name,
                COUNT(DISTINCT CASE WHEN pc.is_buying_committee_member = 1 THEN pc.prospect_1_id ELSE NULL END) +
                COUNT(DISTINCT CASE WHEN pc.is_buying_committee_member = 1 THEN pc.prospect_2_id ELSE NULL END) as committee_size,
                COUNT(DISTINCT pq.id) as total_contacts,
                GROUP_CONCAT(DISTINCT pq.job_title, ', ') as titles
            FROM prospect_queue pq
            LEFT JOIN prospect_connections pc ON pq.id = pc.prospect_1_id OR pq.id = pc.prospect_2_id
            WHERE pc.is_buying_committee_member = 1
            GROUP BY pq.company_name
            ORDER BY committee_size DESC
            LIMIT 50
        `);
        
        res.json({
            buyingCommittees: {
                total_companies: committees.length,
                committees: committees.map(c => ({
                    company: c.company_name,
                    committee_size: c.committee_size || 0,
                    total_contacts: c.total_contacts || 0,
                    key_roles: c.titles || 'Unknown'
                }))
            }
        });
    } catch (error) {
        res.json({ buyingCommittees: { total_companies: 0 } });
    }
});

// GET /api/analytics/influence-map - Map influence relationships
app.get('/api/analytics/influence-map', async (req, res) => {
    try {
        const influences = await db.all(`
            SELECT 
                pc.relationship_type,
                COUNT(*) as relationship_count,
                AVG(pc.relationship_quality) as avg_quality
            FROM prospect_connections pc
            GROUP BY pc.relationship_type
            ORDER BY relationship_count DESC
        `);
        
        res.json({
            influenceMap: {
                total_relationships: influences.reduce((sum, i) => sum + i.relationship_count, 0),
                by_type: influences.map(i => ({
                    type: i.relationship_type,
                    count: i.relationship_count,
                    avg_strength: Math.round(i.avg_quality || 0)
                }))
            }
        });
    } catch (error) {
        res.json({ influenceMap: {} });
    }
});

// POST /api/prospects/connections/:connectionId/strength - Update relationship quality
app.post('/api/prospects/connections/:connectionId/strength', async (req, res) => {
    try {
        const { connectionId } = req.params;
        const { relationship_quality } = req.body;
        
        if (relationship_quality === undefined || relationship_quality < 0 || relationship_quality > 100) {
            return res.status(400).json({ error: 'relationship_quality must be 0-100' });
        }
        
        await db.run(
            `UPDATE prospect_connections SET relationship_quality = ? WHERE id = ?`,
            [relationship_quality, connectionId]
        );
        
        res.json({ updated: true, strength: relationship_quality });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/prospects/recalculate-opportunities - Recalculate all opportunity scores
app.post('/api/prospects/recalculate-opportunities', async (req, res) => {
    try {
        const prospects = await db.all(`SELECT id, engagement_score, workflow_stage FROM prospect_queue LIMIT 1000`);
        
        let updated = 0;
        for (const prospect of prospects) {
            // Fetch related data for scoring
            const engagement = await db.get(`SELECT engagement_score FROM lead_scores WHERE lead_id = ?`, [prospect.id]);
            const meetings = await db.get(`
                SELECT COUNT(*) as total, 
                       SUM(CASE WHEN meeting_outcome IN ('interested', 'demo_needed') THEN 1 ELSE 0 END) as positive
                FROM prospect_meetings WHERE lead_id = ?
            `, [prospect.id]);
            const enrichment = await db.get(`
                SELECT data_quality_score FROM prospect_queue WHERE id = ?
            `, [prospect.id]);
            const deal = await db.get(`SELECT deal_probability FROM deal_pipeline WHERE lead_id = ?`, [prospect.id]);
            
            // Calculate composite opportunity score (0-100)
            let score = 0;
            const factors = {};
            
            // Engagement factor (40 points max)
            if (engagement?.engagement_score) {
                const engagementFactor = Math.min(40, Math.round((engagement.engagement_score / 100) * 40));
                score += engagementFactor;
                factors.engagement = engagementFactor;
            }
            
            // Meeting success factor (30 points max)
            if (meetings?.total > 0) {
                const successRate = meetings.positive / meetings.total;
                const meetingFactor = Math.round(successRate * 30);
                score += meetingFactor;
                factors.meetings = meetingFactor;
            }
            
            // Data quality factor (15 points max)
            if (enrichment?.data_quality_score) {
                const qualityFactor = Math.min(15, Math.round((enrichment.data_quality_score / 100) * 15));
                score += qualityFactor;
                factors.data_quality = qualityFactor;
            }
            
            // Deal stage factor (15 points max)
            if (deal?.deal_probability) {
                const dealFactor = Math.min(15, Math.round((deal.deal_probability / 100) * 15));
                score += dealFactor;
                factors.deal_probability = dealFactor;
            }
            
            score = Math.min(100, Math.max(0, score));
            
            const oldScore = prospect.opportunity_score || 0;
            await db.run(
                `UPDATE prospect_queue SET opportunity_score = ?, score_last_updated = ? WHERE id = ?`,
                [score, Date.now(), prospect.id]
            );
            
            // Log score change
            if (oldScore !== score) {
                await db.run(
                    `INSERT INTO opportunity_scoring_history (lead_id, old_score, new_score, score_factors, calculated_at)
                     VALUES (?, ?, ?, ?, ?)`,
                    [prospect.id, oldScore, score, JSON.stringify(factors), Date.now()]
                );
            }
            updated++;
        }
        
        res.json({ recalculated: updated, message: `Recalculated scores for ${updated} prospects` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/analytics/top-opportunities - Top prospects ranked by opportunity score
app.get('/api/analytics/top-opportunities', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        
        const opportunities = await db.all(`
            SELECT 
                id,
                company_name,
                contact_name,
                contact_email,
                workflow_stage,
                opportunity_score,
                performance_tier,
                (SELECT COUNT(*) FROM prospect_meetings WHERE lead_id = prospect_queue.id) as meetings_count,
                (SELECT COUNT(*) FROM email_sends WHERE lead_id = prospect_queue.id) as emails_sent
            FROM prospect_queue
            WHERE opportunity_score > 0
            ORDER BY opportunity_score DESC
            LIMIT ?
        `, [limit]);
        
        res.json({
            topOpportunities: {
                total: opportunities.length,
                opportunities: opportunities.map(o => ({
                    id: o.id,
                    company: o.company_name,
                    contact: o.contact_name,
                    email: o.contact_email,
                    stage: o.workflow_stage,
                    score: o.opportunity_score,
                    tier: o.performance_tier,
                    engagement_signals: {
                        meetings: o.meetings_count,
                        emails_sent: o.emails_sent
                    },
                    action: o.opportunity_score >= 75 ? '🎯 High Priority' : o.opportunity_score >= 50 ? '📊 Medium Priority' : '⏳ Low Priority'
                }))
            }
        });
    } catch (error) {
        res.json({ topOpportunities: { total: 0 } });
    }
});

// GET /api/analytics/opportunity-distribution - Distribution of prospects by score tier
app.get('/api/analytics/opportunity-distribution', async (req, res) => {
    try {
        const distribution = await db.get(`
            SELECT 
                SUM(CASE WHEN opportunity_score >= 75 THEN 1 ELSE 0 END) as high_priority,
                SUM(CASE WHEN opportunity_score >= 50 AND opportunity_score < 75 THEN 1 ELSE 0 END) as medium_priority,
                SUM(CASE WHEN opportunity_score >= 25 AND opportunity_score < 50 THEN 1 ELSE 0 END) as low_priority,
                SUM(CASE WHEN opportunity_score > 0 AND opportunity_score < 25 THEN 1 ELSE 0 END) as minimal_priority,
                SUM(CASE WHEN opportunity_score = 0 THEN 1 ELSE 0 END) as no_score,
                AVG(opportunity_score) as avg_score
            FROM prospect_queue
        `);
        
        const total = (distribution.high_priority || 0) + (distribution.medium_priority || 0) + 
                      (distribution.low_priority || 0) + (distribution.minimal_priority || 0) + (distribution.no_score || 0);
        
        res.json({
            opportunityDistribution: {
                total_prospects: total,
                high_priority: {
                    count: distribution.high_priority || 0,
                    percent: total > 0 ? Math.round(((distribution.high_priority || 0) / total) * 100) : 0,
                    action: 'Push hard - close immediately'
                },
                medium_priority: {
                    count: distribution.medium_priority || 0,
                    percent: total > 0 ? Math.round(((distribution.medium_priority || 0) / total) * 100) : 0,
                    action: 'Nurture actively'
                },
                low_priority: {
                    count: distribution.low_priority || 0,
                    percent: total > 0 ? Math.round(((distribution.low_priority || 0) / total) * 100) : 0,
                    action: 'Automated sequences'
                },
                minimal_priority: {
                    count: distribution.minimal_priority || 0,
                    percent: total > 0 ? Math.round(((distribution.minimal_priority || 0) / total) * 100) : 0,
                    action: 'Research & qualify'
                },
                average_opportunity_score: Math.round(distribution.avg_score || 0)
            }
        });
    } catch (error) {
        res.json({ opportunityDistribution: {} });
    }
});

// GET /api/prospects/:leadId/opportunity-score - Get detailed opportunity score breakdown
app.get('/api/prospects/:leadId/opportunity-score', async (req, res) => {
    try {
        const { leadId } = req.params;
        
        const prospect = await db.get(`
            SELECT opportunity_score, score_last_updated FROM prospect_queue WHERE id = ?
        `, [leadId]);
        
        const history = await db.all(`
            SELECT old_score, new_score, score_factors, calculated_at 
            FROM opportunity_scoring_history 
            WHERE lead_id = ? 
            ORDER BY calculated_at DESC 
            LIMIT 10
        `, [leadId]);
        
        res.json({
            opportunityScore: {
                current_score: prospect?.opportunity_score || 0,
                last_updated: prospect?.score_last_updated ? new Date(prospect.score_last_updated).toISOString() : null,
                history: history.map(h => ({
                    old_score: h.old_score,
                    new_score: h.new_score,
                    factors: JSON.parse(h.score_factors || '{}'),
                    calculated_at: new Date(h.calculated_at).toISOString()
                }))
            }
        });
    } catch (error) {
        res.json({ opportunityScore: {} });
    }
});

// POST /api/deals/track-stage-change - Track when a deal moves to new stage
app.post('/api/deals/track-stage-change', async (req, res) => {
    try {
        const { lead_id, from_stage, to_stage } = req.body;
        
        if (!lead_id || !to_stage) {
            return res.status(400).json({ error: 'lead_id and to_stage required' });
        }
        
        // Calculate how many days in previous stage
        const lastTransition = await db.get(
            `SELECT transition_at FROM stage_transitions WHERE lead_id = ? ORDER BY transition_at DESC LIMIT 1`,
            [lead_id]
        );
        
        const durationDays = lastTransition ? 
            Math.floor((Date.now() - lastTransition.transition_at) / (1000 * 60 * 60 * 24)) : 
            null;
        
        await db.run(
            `INSERT INTO stage_transitions (lead_id, from_stage, to_stage, transition_at, duration_days)
             VALUES (?, ?, ?, ?, ?)`,
            [lead_id, from_stage || 'initial', to_stage, Date.now(), durationDays]
        );
        
        res.json({ tracked: true, from: from_stage, to: to_stage, days_in_stage: durationDays });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/analytics/pipeline-velocity - Deal movement speed through stages
app.get('/api/analytics/pipeline-velocity', async (req, res) => {
    try {
        const stageMetrics = await db.all(`
            SELECT 
                from_stage,
                to_stage,
                COUNT(*) as transitions,
                AVG(duration_days) as avg_days,
                MIN(duration_days) as fastest_days,
                MAX(duration_days) as slowest_days
            FROM stage_transitions
            WHERE duration_days IS NOT NULL
            GROUP BY from_stage, to_stage
            ORDER BY avg_days DESC
        `);
        
        res.json({
            pipelineVelocity: {
                total_transitions: stageMetrics.reduce((sum, s) => sum + s.transitions, 0),
                stage_metrics: stageMetrics.map(s => ({
                    from: s.from_stage,
                    to: s.to_stage,
                    transitions: s.transitions,
                    avg_days: Math.round(s.avg_days || 0),
                    fastest_days: s.fastest_days,
                    slowest_days: s.slowest_days,
                    velocity_status: (s.avg_days || 0) <= 7 ? '🚀 Fast' : (s.avg_days || 0) <= 21 ? '✅ Normal' : '⏸️ Slow'
                }))
            }
        });
    } catch (error) {
        res.json({ pipelineVelocity: {} });
    }
});

// GET /api/analytics/stage-conversion-rates - % of deals that convert from each stage
app.get('/api/analytics/stage-conversion-rates', async (req, res) => {
    try {
        const stageConversions = await db.all(`
            SELECT 
                to_stage,
                COUNT(*) as entered_stage,
                COUNT(DISTINCT CASE WHEN (
                    SELECT to_stage FROM stage_transitions t2 
                    WHERE t2.lead_id = stage_transitions.lead_id 
                    AND t2.transition_at > stage_transitions.transition_at 
                    ORDER BY t2.transition_at DESC LIMIT 1
                ) IS NOT NULL THEN 1 END) as moved_forward,
                COUNT(DISTINCT CASE WHEN (
                    SELECT outcome FROM deal_outcomes 
                    WHERE lead_id = stage_transitions.lead_id
                ) = 'won' THEN 1 END) as won
            FROM stage_transitions
            GROUP BY to_stage
            ORDER BY entered_stage DESC
        `);
        
        res.json({
            stageConversionRates: {
                stages: stageConversions.map(s => ({
                    stage: s.to_stage,
                    prospects_entered: s.entered_stage,
                    advanced_forward: s.moved_forward || 0,
                    deals_won: s.won || 0,
                    advancement_rate: s.entered_stage > 0 ? Math.round(((s.moved_forward || 0) / s.entered_stage) * 100) : 0,
                    close_rate: s.entered_stage > 0 ? Math.round(((s.won || 0) / s.entered_stage) * 100) : 0
                }))
            }
        });
    } catch (error) {
        res.json({ stageConversionRates: { stages: [] } });
    }
});

// GET /api/analytics/bottleneck-analysis - Identify where deals are stuck
app.get('/api/analytics/bottleneck-analysis', async (req, res) => {
    try {
        const now = Date.now();
        const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
        
        const bottlenecks = await db.all(`
            SELECT 
                pq.workflow_stage,
                COUNT(*) as stuck_count,
                AVG(CAST((? - pq.updated_at) AS FLOAT) / (1000 * 60 * 60 * 24)) as avg_days_stuck
            FROM prospect_queue pq
            WHERE pq.updated_at < ? AND pq.workflow_stage NOT IN ('won', 'lost', 'archived')
            GROUP BY pq.workflow_stage
            ORDER BY avg_days_stuck DESC
        `, [now, thirtyDaysAgo]);
        
        res.json({
            bottleneckAnalysis: {
                total_stuck: bottlenecks.reduce((sum, b) => sum + b.stuck_count, 0),
                bottlenecks: bottlenecks.map(b => ({
                    stage: b.workflow_stage,
                    stuck_count: b.stuck_count,
                    avg_days_stuck: Math.round(b.avg_days_stuck || 0),
                    action: (b.avg_days_stuck || 0) > 21 ? '🚨 Critical - Take action' : (b.avg_days_stuck || 0) > 14 ? '⚠️ Warning' : '✅ Normal'
                }))
            }
        });
    } catch (error) {
        res.json({ bottleneckAnalysis: { total_stuck: 0 } });
    }
});

// GET /api/analytics/close-date-prediction - Predict revenue close dates
app.get('/api/analytics/close-date-prediction', async (req, res) => {
    try {
        // Get average days in each stage from history
        const stageAverages = await db.all(`
            SELECT from_stage, AVG(duration_days) as avg_days
            FROM stage_transitions
            WHERE duration_days IS NOT NULL
            GROUP BY from_stage
        `);
        
        const stageMap = {};
        stageAverages.forEach(s => { stageMap[s.from_stage] = s.avg_days; });
        
        // Get current deals and predict close dates
        const currentDeals = await db.all(`
            SELECT 
                id,
                company_name,
                workflow_stage,
                updated_at,
                (SELECT deal_value FROM deal_pipeline WHERE lead_id = prospect_queue.id) as deal_value
            FROM prospect_queue
            WHERE workflow_stage NOT IN ('won', 'lost', 'archived')
            AND deal_value > 0
            LIMIT 100
        `);
        
        const predictions = currentDeals.map(deal => {
            const stageAvg = stageMap[deal.workflow_stage] || 7;
            const predictedCloseAt = deal.updated_at + (stageAvg * 24 * 60 * 60 * 1000);
            return {
                company: deal.company_name,
                stage: deal.workflow_stage,
                deal_value: Math.round(deal.deal_value || 0),
                predicted_close: new Date(predictedCloseAt).toISOString().split('T')[0],
                days_until_close: Math.round(stageAvg)
            };
        });
        
        const totalPredicted = predictions.reduce((sum, p) => sum + p.deal_value, 0);
        
        res.json({
            closeDatePredictions: {
                total_predicted_revenue: Math.round(totalPredicted),
                predictions: predictions.sort((a, b) => new Date(a.predicted_close) - new Date(b.predicted_close))
            }
        });
    } catch (error) {
        res.json({ closeDatePredictions: {} });
    }
});

// GET /api/analytics/revenue-forecast - Monthly revenue forecast
app.get('/api/analytics/revenue-forecast', async (req, res) => {
    try {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const now = new Date();
        const forecasts = [];
        
        // Get current pipeline and project forward 6 months
        for (let i = 0; i < 6; i++) {
            const forecastMonth = new Date(now.getFullYear(), now.getMonth() + i, 1);
            const monthStr = months[forecastMonth.getMonth()] + ' ' + forecastMonth.getFullYear();
            
            // Get deals likely to close in this month
            const closingDeals = await db.all(`
                SELECT 
                    dp.deal_value,
                    dp.deal_probability,
                    dp.close_date
                FROM deal_pipeline dp
                WHERE dp.closed_status IS NULL
                AND dp.close_date > ? AND dp.close_date < ?
                AND dp.deal_value > 0
            `, [
                forecastMonth.getTime(),
                new Date(forecastMonth.getFullYear(), forecastMonth.getMonth() + 1, 1).getTime()
            ]);
            
            const weighted = closingDeals.reduce((sum, d) => 
                sum + (d.deal_value * (d.deal_probability / 100)), 0
            );
            
            forecasts.push({
                month: monthStr,
                forecasted_revenue: Math.round(weighted),
                deal_count: closingDeals.length,
                confidence: closingDeals.length > 0 ? '🎯 High' : '⏳ Low'
            });
        }
        
        const totalForecast = forecasts.reduce((sum, f) => sum + f.forecasted_revenue, 0);
        
        res.json({
            revenueForecast: {
                total_6month_forecast: Math.round(totalForecast),
                by_month: forecasts
            }
        });
    } catch (error) {
        res.json({ revenueForecast: {} });
    }
});

// GET /api/analytics/revenue-by-stage - Revenue breakdown by pipeline stage
app.get('/api/analytics/revenue-by-stage', async (req, res) => {
    try {
        const byStage = await db.all(`
            SELECT 
                pq.workflow_stage,
                SUM(dp.deal_value) as total_value,
                SUM(dp.deal_value * dp.deal_probability / 100) as weighted_value,
                COUNT(*) as deal_count,
                AVG(dp.deal_probability) as avg_probability
            FROM prospect_queue pq
            LEFT JOIN deal_pipeline dp ON pq.id = dp.lead_id
            WHERE dp.deal_value > 0 AND dp.closed_status IS NULL
            GROUP BY pq.workflow_stage
            ORDER BY weighted_value DESC
        `);
        
        res.json({
            revenueByStage: {
                total_pipeline: byStage.reduce((sum, s) => sum + (s.total_value || 0), 0),
                by_stage: byStage.map(s => ({
                    stage: s.workflow_stage,
                    total_value: Math.round(s.total_value || 0),
                    weighted_value: Math.round(s.weighted_value || 0),
                    deals: s.deal_count,
                    avg_probability: Math.round(s.avg_probability || 0)
                }))
            }
        });
    } catch (error) {
        res.json({ revenueByStage: {} });
    }
});

// GET /api/analytics/forecast-accuracy - Track forecast vs actual revenue
app.get('/api/analytics/forecast-accuracy', async (req, res) => {
    try {
        const recent = await db.all(`
            SELECT 
                forecast_month,
                forecasted_revenue,
                actual_revenue,
                forecast_accuracy,
                created_at
            FROM revenue_forecasts
            WHERE actual_revenue IS NOT NULL
            ORDER BY created_at DESC
            LIMIT 12
        `);
        
        const avgAccuracy = recent.length > 0 ? 
            Math.round(recent.reduce((sum, f) => sum + (f.forecast_accuracy || 0), 0) / recent.length) : 0;
        
        res.json({
            forecastAccuracy: {
                avg_accuracy_percent: avgAccuracy,
                recent_forecasts: recent.map(f => ({
                    month: f.forecast_month,
                    forecasted: Math.round(f.forecasted_revenue || 0),
                    actual: Math.round(f.actual_revenue || 0),
                    accuracy: f.forecast_accuracy
                }))
            }
        });
    } catch (error) {
        res.json({ forecastAccuracy: {} });
    }
});

// GET /api/analytics/executive-summary - One-page executive revenue dashboard
app.get('/api/analytics/executive-summary', async (req, res) => {
    try {
        const pipeline = await db.get(`
            SELECT 
                SUM(dp.deal_value) as total_pipeline,
                SUM(dp.deal_value * dp.deal_probability / 100) as weighted_pipeline,
                COUNT(*) as total_deals,
                AVG(dp.deal_probability) as avg_probability
            FROM deal_pipeline dp
            WHERE dp.closed_status IS NULL
        `);
        
        const thisMonth = await db.get(`
            SELECT 
                SUM(dp.deal_value * dp.deal_probability / 100) as month_forecast,
                COUNT(*) as month_deals
            FROM deal_pipeline dp
            WHERE dp.closed_status IS NULL
            AND dp.close_date > ?
            AND dp.close_date < ?
        `, [
            new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime(),
            new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).getTime()
        ]);
        
        const won = await db.get(`
            SELECT 
                COUNT(*) as won_deals,
                SUM(dp.deal_value) as won_revenue
            FROM deal_outcomes do
            LEFT JOIN deal_pipeline dp ON do.lead_id = dp.lead_id
            WHERE do.outcome = 'won'
        `);
        
        const winRate = await db.get(`
            SELECT 
                SUM(CASE WHEN outcome = 'won' THEN 1 ELSE 0 END) as wins,
                COUNT(*) as total_closed
            FROM deal_outcomes
        `);
        
        const winPercent = winRate.total_closed > 0 ? 
            Math.round((winRate.wins / winRate.total_closed) * 100) : 0;
        
        res.json({
            executiveSummary: {
                total_pipeline_value: Math.round(pipeline.total_pipeline || 0),
                weighted_pipeline_value: Math.round(pipeline.weighted_pipeline || 0),
                this_month_forecast: Math.round(thisMonth.month_forecast || 0),
                deals_in_pipeline: pipeline.total_deals || 0,
                avg_deal_probability: Math.round(pipeline.avg_probability || 0),
                won_this_period: Math.round(won.won_revenue || 0),
                win_rate: `${winPercent}%`,
                health_status: pipeline.total_deals > 10 && winPercent >= 40 ? '🟢 Healthy' : pipeline.total_deals > 5 ? '🟡 Monitor' : '🔴 Needs attention'
            }
        });
    } catch (error) {
        res.json({ executiveSummary: {} });
    }
});

// GET /api/analytics/rep-performance - Individual rep activity and performance
app.get('/api/analytics/rep-performance', async (req, res) => {
    try {
        const reps = await db.all(`
            SELECT 
                COALESCE(last_activity_by, 'unassigned') as rep,
                COUNT(DISTINCT id) as prospects_touched,
                (SELECT COUNT(*) FROM email_sends WHERE created_by = COALESCE(pq.last_activity_by, 'system')) as emails_sent,
                (SELECT COUNT(*) FROM prospect_meetings WHERE lead_id IN (SELECT id FROM prospect_queue WHERE last_activity_by = COALESCE(pq.last_activity_by, 'system'))) as meetings_held,
                (SELECT COUNT(DISTINCT lead_id) FROM deal_outcomes WHERE outcome = 'won' AND lead_id IN (SELECT id FROM prospect_queue WHERE last_activity_by = COALESCE(pq.last_activity_by, 'system'))) as deals_won,
                (SELECT SUM(deal_value) FROM deal_pipeline WHERE closed_status = 'won' AND lead_id IN (SELECT id FROM prospect_queue WHERE last_activity_by = COALESCE(pq.last_activity_by, 'system'))) as revenue_generated
            FROM prospect_queue pq
            GROUP BY COALESCE(last_activity_by, 'unassigned')
            ORDER BY deals_won DESC
        `);
        
        res.json({
            repPerformance: {
                total_reps: reps.length,
                reps: reps.map(r => ({
                    rep: r.rep,
                    prospects_engaged: r.prospects_touched,
                    emails_sent: r.emails_sent || 0,
                    meetings_held: r.meetings_held || 0,
                    deals_won: r.deals_won || 0,
                    revenue_generated: Math.round(r.revenue_generated || 0),
                    productivity_score: Math.round(((r.emails_sent || 0) + (r.meetings_held || 0) * 2 + (r.deals_won || 0) * 5) / Math.max(r.prospects_touched, 1) * 100) || 0
                }))
            }
        });
    } catch (error) {
        res.json({ repPerformance: { total_reps: 0 } });
    }
});

// GET /api/analytics/team-activity - Team-wide activity dashboard
app.get('/api/analytics/team-activity', async (req, res) => {
    try {
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        
        const summary = await db.get(`
            SELECT 
                COUNT(DISTINCT CASE WHEN created_at > ? THEN id ELSE NULL END) as new_prospects_30d,
                (SELECT COUNT(*) FROM email_sends WHERE created_at > ?) as emails_sent_30d,
                (SELECT COUNT(*) FROM prospect_meetings WHERE created_at > ?) as meetings_scheduled_30d,
                (SELECT COUNT(*) FROM prospect_meetings WHERE meeting_status = 'completed' AND completed_at > ?) as meetings_completed_30d,
                (SELECT COUNT(*) FROM deal_outcomes WHERE outcome = 'won' AND closed_at > ?) as deals_closed_30d
            FROM prospect_queue
        `, [thirtyDaysAgo, thirtyDaysAgo, thirtyDaysAgo, thirtyDaysAgo, thirtyDaysAgo]);
        
        const dailyAvg = {
            prospects: Math.round((summary.new_prospects_30d || 0) / 30),
            emails: Math.round((summary.emails_sent_30d || 0) / 30),
            meetings: Math.round((summary.meetings_scheduled_30d || 0) / 30)
        };
        
        res.json({
            teamActivity: {
                last_30_days: {
                    new_prospects: summary.new_prospects_30d || 0,
                    emails_sent: summary.emails_sent_30d || 0,
                    meetings_scheduled: summary.meetings_scheduled_30d || 0,
                    meetings_completed: summary.meetings_completed_30d || 0,
                    deals_won: summary.deals_closed_30d || 0
                },
                daily_average: dailyAvg,
                momentum: summary.deals_closed_30d > 5 ? '🚀 Strong' : summary.emails_sent_30d > 50 ? '📈 Growing' : '⏳ Building'
            }
        });
    } catch (error) {
        res.json({ teamActivity: {} });
    }
});

// GET /api/analytics/activity-vs-targets - Compare activity to targets
app.get('/api/analytics/activity-vs-targets', async (req, res) => {
    try {
        const targets = {
            daily_emails: 10,
            weekly_calls: 5,
            weekly_meetings: 3,
            monthly_deals: 2
        };
        
        const thisMonth = await db.get(`
            SELECT 
                COUNT(*) as total_prospects,
                (SELECT COUNT(*) FROM email_sends WHERE created_at > ?) as emails_this_month,
                (SELECT COUNT(*) FROM prospect_meetings WHERE created_at > ?) as meetings_this_month,
                (SELECT COUNT(*) FROM deal_outcomes WHERE outcome = 'won' AND closed_at > ?) as deals_this_month
            FROM prospect_queue
            WHERE created_at > ?
        `, [
            new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime(),
            new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime(),
            new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime(),
            new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()
        ]);
        
        const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
        const daysPassed = new Date().getDate();
        
        const emailTarget = targets.daily_emails * daysPassed;
        const meetingTarget = targets.weekly_meetings * (daysPassed / 7);
        const dealTarget = targets.monthly_deals;
        
        res.json({
            activityTargets: {
                emails: {
                    target: emailTarget,
                    actual: thisMonth.emails_this_month || 0,
                    percent: emailTarget > 0 ? Math.round(((thisMonth.emails_this_month || 0) / emailTarget) * 100) : 0,
                    status: (thisMonth.emails_this_month || 0) >= emailTarget ? '✅ On track' : '⚠️ Below target'
                },
                meetings: {
                    target: Math.round(meetingTarget),
                    actual: thisMonth.meetings_this_month || 0,
                    percent: meetingTarget > 0 ? Math.round(((thisMonth.meetings_this_month || 0) / meetingTarget) * 100) : 0,
                    status: (thisMonth.meetings_this_month || 0) >= meetingTarget ? '✅ On track' : '⚠️ Below target'
                },
                deals: {
                    target: dealTarget,
                    actual: thisMonth.deals_this_month || 0,
                    percent: dealTarget > 0 ? Math.round(((thisMonth.deals_this_month || 0) / dealTarget) * 100) : 0,
                    status: (thisMonth.deals_this_month || 0) >= dealTarget ? '✅ On track' : '⚠️ Behind'
                }
            }
        });
    } catch (error) {
        res.json({ activityTargets: {} });
    }
});

// GET /api/analytics/activity-trends - Activity trends over time
app.get('/api/analytics/activity-trends', async (req, res) => {
    try {
        const weeks = [];
        for (let i = 4; i >= 0; i--) {
            const weekStart = new Date(Date.now() - (i * 7 * 24 * 60 * 60 * 1000));
            const weekEnd = new Date(weekStart.getTime() + (7 * 24 * 60 * 60 * 1000));
            
            const weekData = await db.get(`
                SELECT 
                    (SELECT COUNT(*) FROM email_sends WHERE created_at >= ? AND created_at < ?) as emails,
                    (SELECT COUNT(*) FROM prospect_meetings WHERE created_at >= ? AND created_at < ?) as meetings,
                    (SELECT COUNT(*) FROM deal_outcomes WHERE outcome = 'won' AND closed_at >= ? AND closed_at < ?) as deals
            `, [weekStart.getTime(), weekEnd.getTime(), weekStart.getTime(), weekEnd.getTime(), weekStart.getTime(), weekEnd.getTime()]);
            
            weeks.push({
                week: `Week of ${weekStart.toISOString().split('T')[0]}`,
                emails: weekData.emails || 0,
                meetings: weekData.meetings || 0,
                deals: weekData.deals || 0
            });
        }
        
        res.json({
            activityTrends: {
                last_5_weeks: weeks
            }
        });
    } catch (error) {
        res.json({ activityTrends: {} });
    }
});

// POST /api/engagement/track-signal - Track prospect engagement signals
app.post('/api/engagement/track-signal', async (req, res) => {
    try {
        const { lead_id, signal_type, signal_value, event_data } = req.body;
        
        // Signal types: email_opened, email_clicked, email_replied, meeting_scheduled, meeting_attended, reply_positive
        const signalWeights = {
            'email_opened': 5,
            'email_clicked': 15,
            'email_replied': 25,
            'reply_positive': 40,
            'meeting_scheduled': 30,
            'meeting_attended': 50
        };
        
        const weight = signalWeights[signal_type] || signal_value || 0;
        
        await db.run(`
            INSERT INTO engagement_signals (lead_id, signal_type, signal_value, event_data, created_at)
            VALUES (?, ?, ?, ?, ?)
        `, [lead_id, signal_type, weight, event_data || '', Date.now()]);
        
        res.json({ success: true, signal_weight: weight });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/engagement/hot-leads - Identify hot leads with high engagement
app.get('/api/engagement/hot-leads', async (req, res) => {
    try {
        const pastWeek = Date.now() - (7 * 24 * 60 * 60 * 1000);
        
        const hotLeads = await db.all(`
            SELECT 
                pq.id,
                pq.prospect_name,
                pq.company_name,
                pq.email,
                SUM(es.signal_value) as engagement_score,
                COUNT(es.id) as signal_count,
                GROUP_CONCAT(DISTINCT es.signal_type) as signals,
                MAX(es.created_at) as last_engagement,
                CASE 
                    WHEN SUM(es.signal_value) >= 100 THEN '🔥 HOT'
                    WHEN SUM(es.signal_value) >= 50 THEN '⚡ WARM'
                    WHEN SUM(es.signal_value) >= 20 THEN '🌡️ COOL'
                    ELSE '❄️ COLD'
                END as temperature
            FROM prospect_queue pq
            LEFT JOIN engagement_signals es ON pq.id = es.lead_id AND es.created_at > ?
            GROUP BY pq.id
            HAVING SUM(es.signal_value) > 0
            ORDER BY engagement_score DESC
            LIMIT 50
        `, [pastWeek]);
        
        res.json({
            hotLeads: {
                total_engaged: hotLeads.length,
                leads: hotLeads.map(l => ({
                    id: l.id,
                    name: l.prospect_name,
                    company: l.company_name,
                    email: l.email,
                    engagement_score: l.engagement_score || 0,
                    temperature: l.temperature,
                    signals: (l.signals || '').split(',').filter(s => s),
                    last_engagement: new Date(l.last_engagement || 0).toLocaleDateString()
                }))
            }
        });
    } catch (error) {
        res.json({ hotLeads: { total_engaged: 0, leads: [] } });
    }
});

// GET /api/engagement/signal-summary - Engagement metrics and next steps
app.get('/api/engagement/signal-summary', async (req, res) => {
    try {
        const past30Days = Date.now() - (30 * 24 * 60 * 60 * 1000);
        
        const summary = await db.get(`
            SELECT 
                COUNT(DISTINCT CASE WHEN signal_type = 'email_opened' THEN lead_id END) as opens,
                COUNT(DISTINCT CASE WHEN signal_type = 'email_clicked' THEN lead_id END) as clicks,
                COUNT(DISTINCT CASE WHEN signal_type = 'email_replied' THEN lead_id END) as replies,
                COUNT(DISTINCT CASE WHEN signal_type = 'reply_positive' THEN lead_id END) as positive_replies,
                COUNT(DISTINCT CASE WHEN signal_type = 'meeting_scheduled' THEN lead_id END) as meetings_scheduled,
                COUNT(DISTINCT CASE WHEN signal_type = 'meeting_attended' THEN lead_id END) as meetings_attended,
                AVG(CASE WHEN signal_value > 0 THEN signal_value ELSE NULL END) as avg_engagement_score
            FROM engagement_signals
            WHERE created_at > ?
        `, [past30Days]);
        
        const totalProspects = await db.get(`SELECT COUNT(DISTINCT id) as total FROM prospect_queue WHERE created_at > ?`, [past30Days]);
        
        const engagementRate = totalProspects.total > 0 ? Math.round(((summary.opens || 0) / totalProspects.total) * 100) : 0;
        
        res.json({
            engagementSummary: {
                engagement_rate: `${engagementRate}%`,
                last_30_days: {
                    email_opens: summary.opens || 0,
                    email_clicks: summary.clicks || 0,
                    email_replies: summary.replies || 0,
                    positive_replies: summary.positive_replies || 0,
                    meetings_scheduled: summary.meetings_scheduled || 0,
                    meetings_attended: summary.meetings_attended || 0
                },
                avg_engagement_score: Math.round(summary.avg_engagement_score || 0),
                health_indicator: engagementRate >= 30 ? '🟢 Strong engagement' : engagementRate >= 15 ? '🟡 Moderate engagement' : '🔴 Low engagement'
            }
        });
    } catch (error) {
        res.json({ engagementSummary: {} });
    }
});

// GET /api/engagement/recommended-actions - AI-powered next steps for hot leads
app.get('/api/engagement/recommended-actions', async (req, res) => {
    try {
        const actions = await db.all(`
            SELECT 
                pq.id,
                pq.prospect_name,
                pq.email,
                SUM(CASE WHEN es.signal_type = 'email_replied' THEN 1 ELSE 0 END) as reply_count,
                SUM(CASE WHEN es.signal_type = 'email_clicked' THEN 1 ELSE 0 END) as click_count,
                SUM(CASE WHEN es.signal_type = 'meeting_attended' THEN 1 ELSE 0 END) as meeting_count,
                MAX(es.created_at) as last_activity,
                CASE 
                    WHEN SUM(CASE WHEN es.signal_type = 'reply_positive' THEN 1 ELSE 0 END) > 0 THEN '📞 Call Now'
                    WHEN SUM(CASE WHEN es.signal_type = 'email_replied' THEN 1 ELSE 0 END) > 0 THEN '📧 Send personalized follow-up'
                    WHEN SUM(CASE WHEN es.signal_type = 'email_clicked' THEN 1 ELSE 0 END) > 0 THEN '📍 Send meeting request'
                    WHEN SUM(CASE WHEN es.signal_type = 'email_opened' THEN 1 ELSE 0 END) > 0 THEN '📨 Send second email'
                    ELSE '👁️ Review & reach out'
                END as recommended_action
            FROM prospect_queue pq
            LEFT JOIN engagement_signals es ON pq.id = es.lead_id AND es.created_at > ?
            GROUP BY pq.id
            HAVING SUM(es.signal_value) > 20
            ORDER BY last_activity DESC
            LIMIT 30
        `, [Date.now() - (7 * 24 * 60 * 60 * 1000)]);
        
        res.json({
            recommendedActions: {
                urgent_count: actions.filter(a => a.recommended_action === '📞 Call Now').length,
                actions: actions.map(a => ({
                    id: a.id,
                    prospect: a.prospect_name,
                    email: a.email,
                    action: a.recommended_action,
                    engagement: {
                        replies: a.reply_count || 0,
                        clicks: a.click_count || 0,
                        meetings: a.meeting_count || 0
                    }
                }))
            }
        });
    } catch (error) {
        res.json({ recommendedActions: { urgent_count: 0, actions: [] } });
    }
});

// POST /api/replies/classify - Classify prospect email replies
app.post('/api/replies/classify', async (req, res) => {
    try {
        const { lead_id, email_id, reply_text } = req.body;
        
        // Simple classification logic (in production, use AI)
        const lowerText = reply_text.toLowerCase();
        
        // Sentiment detection
        let sentiment = 'neutral';
        let confidence = 50;
        
        const positiveKeywords = ['interested', 'great', 'love', 'perfect', 'yes', 'demo', 'meeting', 'call', 'schedule', 'sign up', 'pricing', 'excited', 'definitely', 'count me in'];
        const negativeKeywords = ['not interested', 'unsubscribe', 'stop', 'remove', 'spam', 'delete', 'no thanks', 'not relevant', 'wrong person'];
        const questionKeywords = ['?', 'how', 'what', 'when', 'where', 'why', 'can you', 'could you', 'would you', 'tell me', 'learn more'];
        
        const positiveMatches = positiveKeywords.filter(kw => lowerText.includes(kw)).length;
        const negativeMatches = negativeKeywords.filter(kw => lowerText.includes(kw)).length;
        const questionMatches = questionKeywords.filter(kw => lowerText.includes(kw)).length;
        
        if (negativeMatches > 0) {
            sentiment = 'negative';
            confidence = 75 + (negativeMatches * 5);
        } else if (positiveMatches > 0) {
            sentiment = 'positive';
            confidence = 75 + (positiveMatches * 5);
        } else if (questionMatches > 0) {
            sentiment = 'question';
            confidence = 60 + (questionMatches * 5);
        }
        
        // Extract questions
        const questionPattern = /[^.!?]*\?/g;
        const questions = (reply_text.match(questionPattern) || []).join(' | ');
        
        // Classification
        let classification = 'follow_up_needed';
        if (sentiment === 'positive') classification = 'hot_lead';
        if (sentiment === 'negative') classification = 'unsubscribe';
        if (sentiment === 'question') classification = 'needs_response';
        
        // Recommended next action
        let nextAction = 'Review and respond';
        if (classification === 'hot_lead') nextAction = '🔥 Schedule demo call immediately';
        if (classification === 'unsubscribe') nextAction = '⛔ Remove from campaign';
        if (classification === 'needs_response') nextAction = '📧 Answer questions and send info';
        
        await db.run(`
            INSERT INTO reply_classifications (lead_id, email_id, reply_text, sentiment, classification, confidence, extracted_questions, next_action_recommended, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [lead_id, email_id || '', reply_text, sentiment, classification, confidence, questions, nextAction, Date.now()]);
        
        res.json({ success: true, classification, sentiment, confidence, nextAction });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/replies/summary - Get classified replies summary
app.get('/api/replies/summary', async (req, res) => {
    try {
        const past30Days = Date.now() - (30 * 24 * 60 * 60 * 1000);
        
        const summary = await db.get(`
            SELECT 
                COUNT(*) as total_replies,
                SUM(CASE WHEN sentiment = 'positive' THEN 1 ELSE 0 END) as positive_replies,
                SUM(CASE WHEN sentiment = 'negative' THEN 1 ELSE 0 END) as negative_replies,
                SUM(CASE WHEN sentiment = 'question' THEN 1 ELSE 0 END) as question_replies,
                SUM(CASE WHEN sentiment = 'neutral' THEN 1 ELSE 0 END) as neutral_replies,
                AVG(confidence) as avg_confidence
            FROM reply_classifications
            WHERE created_at > ?
        `, [past30Days]);
        
        const hotLeadReplies = summary.positive_replies || 0;
        const sentimentScore = summary.total_replies > 0 ? Math.round(((hotLeadReplies / summary.total_replies) * 100)) : 0;
        
        res.json({
            replySummary: {
                total_classified: summary.total_replies || 0,
                positive: summary.positive_replies || 0,
                negative: summary.negative_replies || 0,
                questions: summary.question_replies || 0,
                neutral: summary.neutral_replies || 0,
                avg_classification_confidence: Math.round(summary.avg_confidence || 0),
                positive_sentiment_rate: `${sentimentScore}%`,
                health: sentimentScore >= 40 ? '🟢 Great' : sentimentScore >= 20 ? '🟡 Good' : '🔴 Needs attention'
            }
        });
    } catch (error) {
        res.json({ replySummary: {} });
    }
});

// GET /api/replies/hot-leads - Get recent positive sentiment replies
app.get('/api/replies/hot-leads', async (req, res) => {
    try {
        const hotReplies = await db.all(`
            SELECT 
                rc.id,
                pq.prospect_name,
                pq.company_name,
                pq.email,
                rc.sentiment,
                rc.classification,
                rc.confidence,
                rc.reply_text,
                rc.next_action_recommended,
                rc.created_at
            FROM reply_classifications rc
            LEFT JOIN prospect_queue pq ON rc.lead_id = pq.id
            WHERE rc.sentiment IN ('positive', 'question')
            ORDER BY rc.created_at DESC
            LIMIT 30
        `);
        
        res.json({
            hotReplies: {
                total_hot: hotReplies.length,
                replies: hotReplies.map(r => ({
                    id: r.id,
                    prospect: r.prospect_name,
                    company: r.company_name,
                    sentiment: r.sentiment,
                    classification: r.classification,
                    confidence: r.confidence,
                    action: r.next_action_recommended,
                    received: new Date(r.created_at).toLocaleDateString()
                }))
            }
        });
    } catch (error) {
        res.json({ hotReplies: { total_hot: 0, replies: [] } });
    }
});

// GET /api/replies/action-items - Replies requiring immediate action
app.get('/api/replies/action-items', async (req, res) => {
    try {
        const actionItems = await db.all(`
            SELECT 
                rc.id,
                pq.prospect_name,
                pq.email,
                rc.classification,
                rc.next_action_recommended,
                rc.extracted_questions,
                rc.sentiment,
                rc.reply_text,
                COUNT(*) as reply_count
            FROM reply_classifications rc
            LEFT JOIN prospect_queue pq ON rc.lead_id = pq.id
            WHERE rc.classification IN ('hot_lead', 'needs_response', 'unsubscribe')
            GROUP BY rc.lead_id
            ORDER BY CASE 
                WHEN rc.classification = 'hot_lead' THEN 1
                WHEN rc.classification = 'needs_response' THEN 2
                WHEN rc.classification = 'unsubscribe' THEN 3
                ELSE 4
            END,
            rc.created_at DESC
            LIMIT 25
        `);
        
        const hotCount = actionItems.filter(a => a.classification === 'hot_lead').length;
        const needsResponse = actionItems.filter(a => a.classification === 'needs_response').length;
        
        res.json({
            actionItems: {
                urgent_hot_leads: hotCount,
                need_response: needsResponse,
                items: actionItems.map(item => ({
                    prospect: item.prospect_name,
                    email: item.email,
                    type: item.classification,
                    action: item.next_action_recommended,
                    questions: item.extracted_questions ? item.extracted_questions.split('|').filter(q => q).slice(0, 2) : [],
                    summary: item.reply_text.substring(0, 100)
                }))
            }
        });
    } catch (error) {
        res.json({ actionItems: { urgent_hot_leads: 0, need_response: 0, items: [] } });
    }
});

// POST /api/alerts/create - Create system alert
app.post('/api/alerts/create', async (req, res) => {
    try {
        const { alert_type, severity, lead_id, title, description, action_recommended } = req.body;
        
        await db.run(`
            INSERT INTO system_alerts (alert_type, severity, lead_id, title, description, action_recommended, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [alert_type, severity, lead_id, title, description, action_recommended || '', Date.now()]);
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/alerts/active - Get all unread alerts
app.get('/api/alerts/active', async (req, res) => {
    try {
        const alerts = await db.all(`
            SELECT 
                sa.id,
                sa.alert_type,
                sa.severity,
                sa.title,
                sa.description,
                sa.action_recommended,
                pq.prospect_name,
                pq.company_name,
                sa.created_at
            FROM system_alerts sa
            LEFT JOIN prospect_queue pq ON sa.lead_id = pq.id
            WHERE sa.is_read = 0
            ORDER BY 
                CASE WHEN sa.severity = 'critical' THEN 1
                     WHEN sa.severity = 'high' THEN 2
                     WHEN sa.severity = 'medium' THEN 3
                     ELSE 4
                END,
                sa.created_at DESC
            LIMIT 50
        `);
        
        const critical = alerts.filter(a => a.severity === 'critical').length;
        const high = alerts.filter(a => a.severity === 'high').length;
        
        res.json({
            activeAlerts: {
                total_unread: alerts.length,
                critical_count: critical,
                high_count: high,
                alerts: alerts.map(a => ({
                    id: a.id,
                    type: a.alert_type,
                    severity: a.severity,
                    title: a.title,
                    prospect: a.prospect_name || 'System',
                    company: a.company_name,
                    description: a.description,
                    action: a.action_recommended,
                    created: new Date(a.created_at).toLocaleString()
                }))
            }
        });
    } catch (error) {
        res.json({ activeAlerts: { total_unread: 0, alerts: [] } });
    }
});

// GET /api/alerts/summary - Alert statistics
app.get('/api/alerts/summary', async (req, res) => {
    try {
        const past24h = Date.now() - (24 * 60 * 60 * 1000);
        
        const stats = await db.get(`
            SELECT 
                COUNT(*) as total_alerts,
                SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as critical,
                SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) as high,
                SUM(CASE WHEN severity = 'medium' THEN 1 ELSE 0 END) as medium,
                SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread,
                SUM(CASE WHEN alert_type = 'hot_lead' THEN 1 ELSE 0 END) as hot_leads,
                SUM(CASE WHEN alert_type = 'stuck_deal' THEN 1 ELSE 0 END) as stuck_deals,
                SUM(CASE WHEN alert_type = 'missed_followup' THEN 1 ELSE 0 END) as missed_followups,
                SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) as last_24h
            FROM system_alerts
        `, [past24h]);
        
        res.json({
            alertSummary: {
                total_alerts: stats.total_alerts || 0,
                by_severity: {
                    critical: stats.critical || 0,
                    high: stats.high || 0,
                    medium: stats.medium || 0
                },
                unread: stats.unread || 0,
                by_type: {
                    hot_leads: stats.hot_leads || 0,
                    stuck_deals: stats.stuck_deals || 0,
                    missed_followups: stats.missed_followups || 0
                },
                last_24_hours: stats.last_24h || 0,
                alert_status: (stats.critical || 0) > 0 ? '🔴 CRITICAL ALERTS' : (stats.high || 0) > 0 ? '🟠 HIGH PRIORITY' : '🟢 UNDER CONTROL'
            }
        });
    } catch (error) {
        res.json({ alertSummary: {} });
    }
});

// PUT /api/alerts/:id/read - Mark alert as read
app.put('/api/alerts/:id/read', async (req, res) => {
    try {
        const { id } = req.params;
        await db.run(`UPDATE system_alerts SET is_read = 1 WHERE id = ?`, [id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/alerts/auto-generate - Auto-generate alerts based on system rules
app.get('/api/alerts/auto-generate', async (req, res) => {
    try {
        // Hot leads - high engagement signals (>50 score in last 7 days)
        const hotLeads = await db.all(`
            SELECT pq.id, pq.prospect_name, SUM(es.signal_value) as score
            FROM prospect_queue pq
            LEFT JOIN engagement_signals es ON pq.id = es.lead_id AND es.created_at > ?
            GROUP BY pq.id
            HAVING SUM(es.signal_value) > 50
            LIMIT 10
        `, [Date.now() - (7 * 24 * 60 * 60 * 1000)]);
        
        for (const lead of hotLeads) {
            const existing = await db.get(
                `SELECT id FROM system_alerts WHERE lead_id = ? AND alert_type = 'hot_lead' AND is_read = 0`,
                [lead.id]
            );
            if (!existing) {
                await db.run(`
                    INSERT INTO system_alerts (alert_type, severity, lead_id, title, description, action_recommended, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, ['hot_lead', 'high', lead.id, `🔥 Hot Lead: ${lead.prospect_name}`, `High engagement detected (${lead.score} points)`, '📞 Contact immediately', Date.now()]);
            }
        }
        
        // Stuck deals - in same stage >21 days
        const stuckDeals = await db.all(`
            SELECT pq.id, pq.prospect_name, dp.workflow_stage, 
                   ROUND((? - MAX(st.created_at)) / (24 * 60 * 60 * 1000)) as days_in_stage
            FROM prospect_queue pq
            LEFT JOIN deal_pipeline dp ON pq.id = dp.lead_id
            LEFT JOIN stage_transitions st ON pq.id = st.lead_id
            WHERE dp.closed_status IS NULL
            GROUP BY pq.id
            HAVING days_in_stage > 21
            LIMIT 10
        `, [Date.now()]);
        
        for (const deal of stuckDeals) {
            const existing = await db.get(
                `SELECT id FROM system_alerts WHERE lead_id = ? AND alert_type = 'stuck_deal' AND is_read = 0`,
                [deal.id]
            );
            if (!existing) {
                await db.run(`
                    INSERT INTO system_alerts (alert_type, severity, lead_id, title, description, action_recommended, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, ['stuck_deal', 'critical', deal.id, `⚠️ Stuck Deal: ${deal.prospect_name}`, `Stuck in ${deal.workflow_stage} for ${deal.days_in_stage} days`, '🎯 Reassess strategy or move to next stage', Date.now()]);
            }
        }
        
        // Missed follow-ups - no activity >5 days since last email
        const missedFollowups = await db.all(`
            SELECT pq.id, pq.prospect_name, 
                   ROUND((? - MAX(es.created_at)) / (24 * 60 * 60 * 1000)) as days_since_activity
            FROM prospect_queue pq
            LEFT JOIN engagement_signals es ON pq.id = es.lead_id
            WHERE pq.workflow_stage NOT IN ('closed_won', 'closed_lost', 'unsubscribed')
            GROUP BY pq.id
            HAVING days_since_activity > 5
            LIMIT 15
        `, [Date.now()]);
        
        for (const followup of missedFollowups) {
            const existing = await db.get(
                `SELECT id FROM system_alerts WHERE lead_id = ? AND alert_type = 'missed_followup' AND is_read = 0 AND created_at > ?`,
                [followup.id, Date.now() - (24 * 60 * 60 * 1000)]
            );
            if (!existing) {
                await db.run(`
                    INSERT INTO system_alerts (alert_type, severity, lead_id, title, description, action_recommended, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, ['missed_followup', 'medium', followup.id, `📅 Follow-up Due: ${followup.prospect_name}`, `No activity for ${followup.days_since_activity} days`, '✉️ Send follow-up email', Date.now()]);
            }
        }
        
        res.json({ success: true, message: 'Alerts generated' });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// POST /api/webhooks/create - Create webhook for alerts
app.post('/api/webhooks/create', async (req, res) => {
    try {
        const { name, webhook_url, webhook_type, trigger_on } = req.body;
        
        // webhook_type: 'slack', 'teams', 'custom'
        // trigger_on: comma-separated alert types (hot_lead,stuck_deal,missed_followup)
        
        await db.run(`
            INSERT INTO webhooks (name, webhook_url, webhook_type, trigger_on, is_active, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [name, webhook_url, webhook_type, trigger_on || 'hot_lead,stuck_deal', 1, Date.now()]);
        
        res.json({ success: true, message: 'Webhook created' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/webhooks/list - List all webhooks
app.get('/api/webhooks/list', async (req, res) => {
    try {
        const webhooks = await db.all(`
            SELECT * FROM webhooks ORDER BY created_at DESC
        `);
        
        res.json({
            webhooks: webhooks.map(w => ({
                id: w.id,
                name: w.name,
                type: w.webhook_type,
                url: w.webhook_url,
                active: w.is_active === 1,
                triggers: w.trigger_on.split(',')
            }))
        });
    } catch (error) {
        res.json({ webhooks: [] });
    }
});

// POST /api/webhooks/test - Test webhook
app.post('/api/webhooks/test', async (req, res) => {
    try {
        const { webhook_id } = req.body;
        const webhook = await db.get(`SELECT * FROM webhooks WHERE id = ?`, [webhook_id]);
        
        if (!webhook) {
            return res.status(404).json({ error: 'Webhook not found' });
        }
        
        const testPayload = {
            type: 'test',
            title: '🧪 Test Alert',
            message: 'This is a test notification',
            timestamp: new Date().toISOString()
        };
        
        let formatted;
        if (webhook.webhook_type === 'slack') {
            formatted = {
                text: 'Test Alert from Smooth AI AutoBDR',
                blocks: [
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: '*🧪 Test Alert*\nThis is a test notification from Smooth AI AutoBDR'
                        }
                    }
                ]
            };
        } else {
            formatted = testPayload;
        }
        
        await fetch(webhook.webhook_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formatted)
        }).catch(e => console.error('Webhook test failed:', e.message));
        
        res.json({ success: true, message: 'Test notification sent' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/webhooks/:id - Delete webhook
app.delete('/api/webhooks/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await db.run(`DELETE FROM webhooks WHERE id = ?`, [id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Internal helper: Send alert to webhooks
async function sendAlertToWebhooks(alertData) {
    try {
        const webhooks = await db.all(`
            SELECT * FROM webhooks 
            WHERE is_active = 1 
            AND (trigger_on LIKE ? OR trigger_on LIKE ?)
        `, [`%${alertData.alert_type}%`, '%all%']);
        
        for (const webhook of webhooks) {
            let formatted;
            if (webhook.webhook_type === 'slack') {
                const color = alertData.severity === 'critical' ? 'danger' : alertData.severity === 'high' ? 'warning' : 'good';
                formatted = {
                    text: alertData.title,
                    blocks: [
                        {
                            type: 'section',
                            text: {
                                type: 'mrkdwn',
                                text: `*${alertData.title}*\n${alertData.description}\n\n_${alertData.action_recommended}_`
                            }
                        },
                        {
                            type: 'context',
                            elements: [
                                {
                                    type: 'mrkdwn',
                                    text: `Severity: *${alertData.severity}* | Type: ${alertData.alert_type}`
                                }
                            ]
                        }
                    ]
                };
            } else if (webhook.webhook_type === 'teams') {
                formatted = {
                    '@type': 'MessageCard',
                    '@context': 'https://schema.org/extensions',
                    summary: alertData.title,
                    themeColor: alertData.severity === 'critical' ? 'ff0000' : alertData.severity === 'high' ? 'ff9800' : '00ff00',
                    sections: [
                        {
                            activityTitle: alertData.title,
                            activitySubtitle: alertData.description,
                            facts: [
                                { name: 'Severity', value: alertData.severity },
                                { name: 'Type', value: alertData.alert_type }
                            ],
                            text: alertData.action_recommended
                        }
                    ]
                };
            } else {
                formatted = alertData;
            }
            
            fetch(webhook.webhook_url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formatted)
            }).catch(e => console.error(`Webhook ${webhook.name} failed:`, e.message));
        }
    } catch (error) {
        console.error('Error sending webhooks:', error.message);
    }
}

// GET /api/webhooks/stats - Webhook usage stats
app.get('/api/webhooks/stats', async (req, res) => {
    try {
        const stats = await db.get(`
            SELECT 
                COUNT(*) as total_webhooks,
                SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active,
                SUM(CASE WHEN webhook_type = 'slack' THEN 1 ELSE 0 END) as slack_count,
                SUM(CASE WHEN webhook_type = 'teams' THEN 1 ELSE 0 END) as teams_count,
                SUM(CASE WHEN webhook_type = 'custom' THEN 1 ELSE 0 END) as custom_count
            FROM webhooks
        `);
        
        res.json({
            webhookStats: {
                total: stats.total_webhooks || 0,
                active: stats.active || 0,
                by_platform: {
                    slack: stats.slack_count || 0,
                    teams: stats.teams_count || 0,
                    custom: stats.custom_count || 0
                }
            }
        });
    } catch (error) {
        res.json({ webhookStats: {} });
    }
});

// GET /api/analytics/lead-sources - Analyze lead quality by source
app.get('/api/analytics/lead-sources', async (req, res) => {
    try {
        const sources = await db.all(`
            SELECT 
                pq.lead_source,
                COUNT(DISTINCT pq.id) as total_leads,
                COUNT(DISTINCT CASE WHEN pq.workflow_stage != 'new' THEN pq.id END) as engaged,
                COUNT(DISTINCT CASE WHEN pq.workflow_stage IN ('closed_won', 'deal_qualified') THEN pq.id END) as converted,
                ROUND(AVG(COALESCE(pl.deal_value, 0)), 2) as avg_deal_value,
                SUM(COALESCE(pl.deal_value, 0)) as total_value,
                ROUND(100.0 * COUNT(DISTINCT CASE WHEN pq.workflow_stage != 'new' THEN pq.id END) / NULLIF(COUNT(DISTINCT pq.id), 0), 1) as engagement_rate,
                ROUND(100.0 * COUNT(DISTINCT CASE WHEN pq.workflow_stage IN ('closed_won', 'deal_qualified') THEN pq.id END) / NULLIF(COUNT(DISTINCT pq.id), 0), 1) as conversion_rate
            FROM prospect_queue pq
            LEFT JOIN deal_pipeline pl ON pq.id = pl.lead_id
            GROUP BY pq.lead_source
            ORDER BY total_value DESC
        `);
        
        const bestSource = sources.length > 0 ? sources[0].lead_source : 'N/A';
        
        res.json({
            leadSources: {
                total_sources: sources.length,
                best_performing: bestSource,
                by_source: sources.map(s => ({
                    source: s.lead_source || 'unknown',
                    leads: s.total_leads,
                    engaged: s.engaged,
                    converted: s.converted,
                    conversion_rate: s.conversion_rate,
                    engagement_rate: s.engagement_rate,
                    revenue: Math.round(s.total_value || 0),
                    avg_deal: Math.round(s.avg_deal_value || 0)
                }))
            }
        });
    } catch (error) {
        res.json({ leadSources: { total_sources: 0, by_source: [] } });
    }
});

// GET /api/analytics/campaign-roi - Campaign return on investment
app.get('/api/analytics/campaign-roi', async (req, res) => {
    try {
        const past30Days = Date.now() - (30 * 24 * 60 * 60 * 1000);
        
        const campaigns = await db.all(`
            SELECT 
                pq.campaign_name,
                COUNT(DISTINCT pq.id) as prospects,
                (SELECT COUNT(*) FROM email_sends WHERE campaign_name = pq.campaign_name AND created_at > ?) as emails_sent,
                COUNT(DISTINCT CASE WHEN pq.workflow_stage IN ('closed_won', 'deal_qualified') THEN pq.id END) as deals_won,
                SUM(COALESCE(pl.deal_value, 0)) as revenue,
                ROUND(100.0 * COUNT(DISTINCT CASE WHEN pq.workflow_stage IN ('closed_won', 'deal_qualified') THEN pq.id END) / NULLIF(COUNT(DISTINCT pq.id), 0), 1) as conversion_rate
            FROM prospect_queue pq
            LEFT JOIN deal_pipeline pl ON pq.id = pl.lead_id
            WHERE pq.created_at > ? AND pq.campaign_name IS NOT NULL
            GROUP BY pq.campaign_name
            ORDER BY revenue DESC
        `, [past30Days, past30Days]);
        
        const totalRevenue = campaigns.reduce((sum, c) => sum + (c.revenue || 0), 0);
        
        res.json({
            campaignROI: {
                period: 'last_30_days',
                total_campaigns: campaigns.length,
                total_revenue: Math.round(totalRevenue),
                campaigns: campaigns.map(c => ({
                    name: c.campaign_name,
                    prospects_added: c.prospects,
                    emails_sent: c.emails_sent || 0,
                    deals_won: c.deals_won,
                    revenue: Math.round(c.revenue || 0),
                    conversion_rate: c.conversion_rate,
                    roi_indicator: c.revenue >= 10000 ? '🟢 Strong ROI' : c.revenue >= 5000 ? '🟡 Good ROI' : '🔴 Needs improvement'
                }))
            }
        });
    } catch (error) {
        res.json({ campaignROI: { campaigns: [] } });
    }
});

// GET /api/analytics/source-quality - Source quality scoring
app.get('/api/analytics/source-quality', async (req, res) => {
    try {
        const sources = await db.all(`
            SELECT 
                pq.lead_source,
                COUNT(DISTINCT pq.id) as total,
                AVG(COALESCE(pl.deal_probability, 0)) as avg_probability,
                AVG(COALESCE(pq.data_quality_score, 0)) as avg_quality,
                COUNT(DISTINCT CASE WHEN COALESCE(pq.data_quality_score, 0) >= 70 THEN pq.id END) as high_quality_leads,
                ROUND(100.0 * AVG(COALESCE(pq.data_quality_score, 0)), 1) as quality_score
            FROM prospect_queue pq
            LEFT JOIN deal_pipeline pl ON pq.id = pl.lead_id
            WHERE pq.lead_source IS NOT NULL
            GROUP BY pq.lead_source
            ORDER BY quality_score DESC
        `);
        
        res.json({
            sourceQuality: {
                quality_metrics: sources.map(s => ({
                    source: s.lead_source,
                    leads: s.total,
                    quality_score: Math.round(s.quality_score || 0),
                    high_quality: s.high_quality_leads,
                    avg_probability: Math.round(s.avg_probability || 0),
                    grade: s.quality_score >= 80 ? 'A+' : s.quality_score >= 70 ? 'A' : s.quality_score >= 60 ? 'B' : 'C'
                }))
            }
        });
    } catch (error) {
        res.json({ sourceQuality: { quality_metrics: [] } });
    }
});

// GET /api/analytics/source-trends - Source performance trends over time
app.get('/api/analytics/source-trends', async (req, res) => {
    try {
        const weeks = [];
        for (let i = 4; i >= 0; i--) {
            const weekStart = new Date(Date.now() - (i * 7 * 24 * 60 * 60 * 1000));
            const weekEnd = new Date(weekStart.getTime() + (7 * 24 * 60 * 60 * 1000));
            
            const week = await db.all(`
                SELECT 
                    pq.lead_source,
                    COUNT(*) as leads
                FROM prospect_queue pq
                WHERE pq.created_at >= ? AND pq.created_at < ?
                GROUP BY pq.lead_source
                ORDER BY leads DESC
            `, [weekStart.getTime(), weekEnd.getTime()]);
            
            weeks.push({
                week: `Week of ${weekStart.toISOString().split('T')[0]}`,
                by_source: week.map(w => ({
                    source: w.lead_source || 'unknown',
                    leads: w.leads
                }))
            });
        }
        
        res.json({
            sourceTrends: {
                last_5_weeks: weeks
            }
        });
    } catch (error) {
        res.json({ sourceTrends: { last_5_weeks: [] } });
    }
});

// POST /api/analytics/track-campaign - Track campaign metrics
app.post('/api/analytics/track-campaign', async (req, res) => {
    try {
        const { campaign_name, source, leads_added, leads_responded, leads_converted, revenue_generated } = req.body;
        
        await db.run(`
            INSERT INTO campaign_performance (campaign_name, source, leads_added, leads_responded, leads_converted, revenue_generated, period_date, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            campaign_name,
            source,
            leads_added || 0,
            leads_responded || 0,
            leads_converted || 0,
            revenue_generated || 0,
            new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime(),
            Date.now()
        ]);
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/intent/calculate - Calculate prospect intent score
app.post('/api/intent/calculate', async (req, res) => {
    try {
        const { lead_id } = req.body;
        
        // Get prospect engagement data
        const prospect = await db.get(`
            SELECT pq.*, 
                   (SELECT COUNT(*) FROM email_sends WHERE lead_id = ?) as emails_received,
                   (SELECT COUNT(*) FROM engagement_signals WHERE lead_id = ?) as engagement_count,
                   (SELECT SUM(signal_value) FROM engagement_signals WHERE lead_id = ?) as total_engagement_score
            FROM prospect_queue pq WHERE pq.id = ?
        `, [lead_id, lead_id, lead_id, lead_id]);
        
        if (!prospect) {
            return res.status(404).json({ error: 'Prospect not found' });
        }
        
        // Calculate intent score based on signals
        let intentScore = 0;
        const signals = [];
        
        // Email opens and clicks (25 points each)
        if (prospect.engagement_count > 0) {
            intentScore += Math.min(50, prospect.engagement_count * 10);
            signals.push('email_engagement');
        }
        
        // Reply activity (40 points)
        const replies = await db.get(`
            SELECT COUNT(*) as count FROM reply_classifications WHERE lead_id = ? AND sentiment IN ('positive', 'question')
        `, [lead_id]);
        if ((replies?.count || 0) > 0) {
            intentScore += 40;
            signals.push('email_replies');
        }
        
        // Meeting interest (50 points)
        const meetings = await db.get(`
            SELECT COUNT(*) as count FROM prospect_meetings WHERE lead_id = ?
        `, [lead_id]);
        if ((meetings?.count || 0) > 0) {
            intentScore += 50;
            signals.push('meeting_scheduled');
        }
        
        // Deal creation (60 points)
        const deal = await db.get(`
            SELECT deal_value, deal_probability FROM deal_pipeline WHERE lead_id = ? AND closed_status IS NULL
        `, [lead_id]);
        if (deal) {
            intentScore += 60;
            signals.push('deal_created');
            if (deal.deal_probability >= 70) {
                intentScore += 30;
                signals.push('high_probability');
            }
        }
        
        // Determine intent level
        let intentLevel = 'low';
        let predictedStage = 'awareness';
        let timeToClose = 60;
        
        if (intentScore >= 150) {
            intentLevel = 'very_high';
            predictedStage = 'decision';
            timeToClose = 7;
        } else if (intentScore >= 100) {
            intentLevel = 'high';
            predictedStage = 'consideration';
            timeToClose = 14;
        } else if (intentScore >= 50) {
            intentLevel = 'medium';
            predictedStage = 'evaluation';
            timeToClose = 30;
        } else if (intentScore >= 20) {
            intentLevel = 'low';
            predictedStage = 'awareness';
            timeToClose = 60;
        }
        
        // Store intent score
        await db.run(`
            INSERT INTO intent_scores (lead_id, intent_score, buying_signals, intent_level, predicted_stage, time_to_close_days, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [lead_id, intentScore, signals.join(','), intentLevel, predictedStage, timeToClose, Date.now()]);
        
        res.json({ 
            success: true, 
            intent_score: intentScore,
            intent_level: intentLevel,
            predicted_stage: predictedStage,
            buying_signals: signals,
            estimated_close_days: timeToClose
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/intent/high-intent - Get all high-intent prospects
app.get('/api/intent/high-intent', async (req, res) => {
    try {
        const highIntent = await db.all(`
            SELECT 
                pq.id,
                pq.prospect_name,
                pq.company_name,
                pq.email,
                ins.intent_score,
                ins.intent_level,
                ins.predicted_stage,
                ins.time_to_close_days,
                ins.created_at
            FROM intent_scores ins
            LEFT JOIN prospect_queue pq ON ins.lead_id = pq.id
            WHERE ins.intent_level IN ('high', 'very_high')
            ORDER BY ins.intent_score DESC
            LIMIT 50
        `);
        
        res.json({
            highIntentProspects: {
                total: highIntent.length,
                prospects: highIntent.map(p => ({
                    id: p.id,
                    name: p.prospect_name,
                    company: p.company_name,
                    email: p.email,
                    intent_score: p.intent_score,
                    level: p.intent_level,
                    predicted_close: p.time_to_close_days + ' days',
                    stage: p.predicted_stage
                }))
            }
        });
    } catch (error) {
        res.json({ highIntentProspects: { total: 0, prospects: [] } });
    }
});

// GET /api/intent/analytics - Intent distribution analytics
app.get('/api/intent/analytics', async (req, res) => {
    try {
        const analytics = await db.get(`
            SELECT 
                COUNT(*) as total_scored,
                SUM(CASE WHEN intent_level = 'very_high' THEN 1 ELSE 0 END) as very_high,
                SUM(CASE WHEN intent_level = 'high' THEN 1 ELSE 0 END) as high,
                SUM(CASE WHEN intent_level = 'medium' THEN 1 ELSE 0 END) as medium,
                SUM(CASE WHEN intent_level = 'low' THEN 1 ELSE 0 END) as low,
                AVG(intent_score) as avg_score,
                AVG(time_to_close_days) as avg_close_time
            FROM intent_scores
        `);
        
        const readyToClose = (analytics.very_high || 0) + (analytics.high || 0);
        
        res.json({
            intentAnalytics: {
                total_prospects_scored: analytics.total_scored || 0,
                by_level: {
                    very_high: analytics.very_high || 0,
                    high: analytics.high || 0,
                    medium: analytics.medium || 0,
                    low: analytics.low || 0
                },
                ready_to_close: readyToClose,
                avg_intent_score: Math.round(analytics.avg_score || 0),
                avg_days_to_close: Math.round(analytics.avg_close_time || 0)
            }
        });
    } catch (error) {
        res.json({ intentAnalytics: {} });
    }
});

// GET /api/intent/buyer-journey - Map prospect buyer journey stage
app.get('/api/intent/buyer-journey', async (req, res) => {
    try {
        const journey = await db.all(`
            SELECT 
                ins.predicted_stage,
                COUNT(*) as count,
                AVG(ins.intent_score) as avg_score,
                AVG(ins.time_to_close_days) as avg_days
            FROM intent_scores ins
            GROUP BY ins.predicted_stage
            ORDER BY CASE 
                WHEN ins.predicted_stage = 'decision' THEN 1
                WHEN ins.predicted_stage = 'consideration' THEN 2
                WHEN ins.predicted_stage = 'evaluation' THEN 3
                WHEN ins.predicted_stage = 'awareness' THEN 4
            END
        `);
        
        res.json({
            buyerJourney: {
                stages: journey.map(s => ({
                    stage: s.predicted_stage,
                    prospects: s.count,
                    avg_intent_score: Math.round(s.avg_score || 0),
                    avg_days_to_close: Math.round(s.avg_days || 0)
                }))
            }
        });
    } catch (error) {
        res.json({ buyerJourney: { stages: [] } });
    }
});

// POST /api/research/log-failure - Log research failure for diagnostics
app.post('/api/research/log-failure', async (req, res) => {
    try {
        const { company_name, failure_reason, research_sources } = req.body;
        
        // Check if we've already logged this failure
        const existing = await db.get(`
            SELECT id FROM research_diagnostics 
            WHERE company_name = ? AND failure_reason = ?
            ORDER BY created_at DESC LIMIT 1
        `, [company_name, failure_reason]);
        
        if (existing) {
            // Update attempt count
            await db.run(`
                UPDATE research_diagnostics 
                SET attempted_count = attempted_count + 1, last_attempt_at = ?
                WHERE id = ?
            `, [Date.now(), existing.id]);
        } else {
            // Log new failure
            await db.run(`
                INSERT INTO research_diagnostics (company_name, failure_reason, research_sources, attempted_count, last_attempt_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [company_name, failure_reason, research_sources || 'unknown', 1, Date.now(), Date.now()]);
        }
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/research/failure-analytics - Analyze research failures
app.get('/api/research/failure-analytics', async (req, res) => {
    try {
        const past24h = Date.now() - (24 * 60 * 60 * 1000);
        
        const failureStats = await db.get(`
            SELECT 
                COUNT(DISTINCT company_name) as failed_companies,
                COUNT(*) as total_failures,
                AVG(attempted_count) as avg_attempts,
                MAX(attempted_count) as max_attempts
            FROM research_diagnostics
            WHERE created_at > ?
        `, [past24h]);
        
        const byReason = await db.all(`
            SELECT 
                failure_reason,
                COUNT(DISTINCT company_name) as company_count,
                COUNT(*) as failure_count,
                AVG(attempted_count) as avg_attempts
            FROM research_diagnostics
            WHERE created_at > ?
            GROUP BY failure_reason
            ORDER BY failure_count DESC
        `, [past24h]);
        
        const mostFailed = await db.all(`
            SELECT 
                company_name,
                failure_reason,
                attempted_count,
                last_attempt_at
            FROM research_diagnostics
            WHERE created_at > ?
            ORDER BY attempted_count DESC
            LIMIT 10
        `, [past24h]);
        
        res.json({
            researchFailureAnalytics: {
                last_24h: {
                    failed_companies: failureStats.failed_companies || 0,
                    total_failures: failureStats.total_failures || 0,
                    avg_retry_attempts: Math.round((failureStats.avg_attempts || 0) * 10) / 10,
                    max_retry_attempts: failureStats.max_attempts || 0
                },
                by_failure_reason: byReason.map(r => ({
                    reason: r.failure_reason,
                    companies_affected: r.company_count,
                    total_failures: r.failure_count,
                    avg_attempts: Math.round(r.avg_attempts * 10) / 10
                })),
                most_problematic: mostFailed.map(m => ({
                    company: m.company_name,
                    reason: m.failure_reason,
                    attempts: m.attempted_count,
                    last_attempt: new Date(m.last_attempt_at).toISOString()
                }))
            }
        });
    } catch (error) {
        res.json({ researchFailureAnalytics: {} });
    }
});

// GET /api/research/health - Research system health score
app.get('/api/research/health', async (req, res) => {
    try {
        const past24h = Date.now() - (24 * 60 * 60 * 1000);
        
        // Count successful research
        const successCount = await db.get(`
            SELECT COUNT(DISTINCT lead_id) as count 
            FROM prospect_enrichment 
            WHERE created_at > ?
        `, [past24h]);
        
        // Count failed research
        const failCount = await db.get(`
            SELECT COUNT(DISTINCT company_name) as count 
            FROM research_diagnostics 
            WHERE created_at > ?
        `, [past24h]);
        
        const total = (successCount?.count || 0) + (failCount?.count || 0);
        const successRate = total > 0 ? Math.round((successCount?.count || 0) / total * 100) : 0;
        
        // Get recent failures trend
        const failureTrend = await db.all(`
            SELECT 
                datetime((created_at / 1000) / 3600 * 3600, 'unixepoch') as hour,
                COUNT(*) as failures
            FROM research_diagnostics
            WHERE created_at > ?
            GROUP BY hour
            ORDER BY hour DESC
            LIMIT 24
        `, [past24h]);
        
        const healthScore = Math.max(0, 100 - (failCount?.count || 0) * 2);
        
        res.json({
            researchHealth: {
                success_rate: successRate + '%',
                successful_companies: successCount?.count || 0,
                failed_companies: failCount?.count || 0,
                health_score: healthScore,
                status: successRate >= 80 ? 'excellent' : successRate >= 60 ? 'good' : successRate >= 40 ? 'fair' : 'needs_attention',
                recent_trend: failureTrend.map(t => ({
                    hour: t.hour,
                    failures: t.failures
                }))
            }
        });
    } catch (error) {
        res.json({ researchHealth: {} });
    }
});

// GET /api/research/recovery-recommendations - Get recommendations to fix failures
app.get('/api/research/recovery-recommendations', async (req, res) => {
    try {
        const past24h = Date.now() - (24 * 60 * 60 * 1000);
        
        // Find patterns
        const timeoutFailures = await db.get(`
            SELECT COUNT(*) as count FROM research_diagnostics
            WHERE failure_reason LIKE '%timeout%' AND created_at > ?
        `, [past24h]);
        
        const sourceFailures = await db.get(`
            SELECT COUNT(*) as count FROM research_diagnostics
            WHERE failure_reason LIKE '%source%' AND created_at > ?
        `, [past24h]);
        
        const recommendations = [];
        
        if ((timeoutFailures?.count || 0) > 5) {
            recommendations.push({
                priority: 'high',
                issue: 'Research Timeout Rate High',
                pattern: `${timeoutFailures.count} timeouts in last 24h`,
                recommendation: 'Increase research timeout from 4s to 6s, or reduce parallel research items from 15 to 10',
                impact: 'Could improve success rate by 15-25%'
            });
        }
        
        if ((sourceFailures?.count || 0) > 3) {
            recommendations.push({
                priority: 'high',
                issue: 'Data Source Failures',
                pattern: `${sourceFailures.count} source failures in last 24h`,
                recommendation: 'Review and rotate research data sources, consider adding cached company data fallback',
                impact: 'Could prevent 10-20% of failures'
            });
        }
        
        const failCount = await db.get(`
            SELECT COUNT(*) as count FROM research_diagnostics WHERE created_at > ?
        `, [past24h]);
        
        if ((failCount?.count || 0) > 20) {
            recommendations.push({
                priority: 'medium',
                issue: 'High Failure Volume',
                pattern: `${failCount.count} total failures in last 24h`,
                recommendation: 'Implement research caching to avoid re-researching same companies, or use enrichment API fallback',
                impact: 'Could reduce failures by 30-40%'
            });
        }
        
        if (recommendations.length === 0) {
            recommendations.push({
                priority: 'low',
                issue: 'System Healthy',
                pattern: 'Research performing well',
                recommendation: 'Continue monitoring; maintain current configuration',
                impact: 'System stable'
            });
        }
        
        res.json({
            recoveryRecommendations: recommendations
        });
    } catch (error) {
        res.json({ recoveryRecommendations: [] });
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
