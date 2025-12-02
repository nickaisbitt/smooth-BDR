
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

// GET /api/agents/status - Get status of all agents
app.get('/api/agents/status', async (req, res) => {
    try {
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
        
        res.json({ success: true, agents, masterEnabled: automationState?.is_running === 1 });
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

// GET /api/metrics - Real-time pipeline metrics
app.get('/api/metrics', async (req, res) => {
    try {
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
        
        res.json({
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
        });
    } catch (error) {
        console.error("Metrics Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/leads/engagement-stats - Engagement scoring for top leads
app.get('/api/leads/engagement-stats', async (req, res) => {
    try {
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

        res.json({
            topEngagedLeads: engagedLeads.map(lead => ({
                id: lead.id || 'unknown',
                companyName: lead.companyName || 'Unknown',
                email: lead.email,
                engagement_score: Math.min(100, Math.max(0, lead.engagement_score || 0)),
                emails_sent: lead.emails_sent || 0,
                replies_received: lead.replies_received || 0,
                last_activity: lead.last_activity || null
            }))
        });
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
