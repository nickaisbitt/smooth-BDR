
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
    } catch (e) {
        console.error("❌ Database Init Failed:", e);
    }
})();

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
    
    try {
        let whereClause = '';
        const params = [];
        
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
            `SELECT id, external_id, lead_id, 
                    from_email as 'from', to_email as 'to', subject, 
                    SUBSTR(body_text, 1, 200) as preview, received_at as date, is_read as isRead, thread_id, created_at
             FROM email_messages ${whereClause}
             ORDER BY received_at DESC
             LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );
        
        res.json({
            emails,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error("Inbox Fetch Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/inbox/:id - Get single email details
app.get('/api/inbox/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
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
