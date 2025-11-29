import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

export class ImapService {
    constructor(config) {
        this.config = config;
        this.client = null;
    }

    async connect() {
        try {
            this.client = new ImapFlow({
                host: this.config.host,
                port: parseInt(this.config.port) || 993,
                secure: this.config.use_tls !== false,
                auth: {
                    user: this.config.username,
                    pass: this.config.password
                },
                logger: false
            });

            await this.client.connect();
            console.log('✅ IMAP Connected to', this.config.host);
            return true;
        } catch (error) {
            console.error('❌ IMAP Connection Failed:', error.message);
            throw new Error(`IMAP connection failed: ${error.message}`);
        }
    }

    async disconnect() {
        if (this.client) {
            await this.client.logout();
            this.client = null;
        }
    }

    async fetchNewEmails(lastSyncUid = 0) {
        const emails = [];
        
        try {
            if (!this.client) {
                await this.connect();
            }

            const lock = await this.client.getMailboxLock('INBOX');
            
            try {
                const searchCriteria = lastSyncUid > 0 
                    ? { uid: `${lastSyncUid + 1}:*` }
                    : { all: true };

                for await (const message of this.client.fetch(searchCriteria, { 
                    envelope: true, 
                    source: true,
                    uid: true,
                    flags: true
                })) {
                    try {
                        const parsed = await simpleParser(message.source);
                        
                        const email = {
                            uid: message.uid,
                            external_id: message.envelope.messageId || `uid-${message.uid}`,
                            from_email: parsed.from?.value?.[0]?.address || '',
                            from_name: parsed.from?.value?.[0]?.name || '',
                            to_email: parsed.to?.value?.[0]?.address || '',
                            subject: parsed.subject || '(No Subject)',
                            body_text: parsed.text || '',
                            body_html: parsed.html || '',
                            received_at: parsed.date ? new Date(parsed.date).getTime() : Date.now(),
                            is_read: message.flags?.has('\\Seen') ? 1 : 0,
                            thread_id: parsed.headers?.get('in-reply-to') || parsed.headers?.get('references') || null
                        };
                        
                        emails.push(email);
                    } catch (parseError) {
                        console.error('Error parsing email UID', message.uid, ':', parseError.message);
                    }
                }
            } finally {
                lock.release();
            }

            return emails;
        } catch (error) {
            console.error('❌ IMAP Fetch Error:', error.message);
            throw new Error(`Failed to fetch emails: ${error.message}`);
        }
    }

    async markAsRead(uid) {
        try {
            if (!this.client) {
                await this.connect();
            }

            const lock = await this.client.getMailboxLock('INBOX');
            
            try {
                await this.client.messageFlagsAdd({ uid: uid.toString() }, ['\\Seen']);
                console.log(`📧 Marked email UID ${uid} as read`);
                return true;
            } finally {
                lock.release();
            }
        } catch (error) {
            console.error('❌ Failed to mark email as read:', error.message);
            throw new Error(`Failed to mark email as read: ${error.message}`);
        }
    }

    async testConnection() {
        try {
            await this.connect();
            
            const lock = await this.client.getMailboxLock('INBOX');
            const status = this.client.mailbox;
            lock.release();
            
            await this.disconnect();
            
            return {
                success: true,
                exists: status.exists || 0,
                message: `Connected successfully. ${status.exists || 0} emails in INBOX.`
            };
        } catch (error) {
            return {
                success: false,
                message: error.message
            };
        }
    }
}

export async function syncEmails(db, imapSettings, leadEmails = []) {
    const service = new ImapService(imapSettings);
    
    try {
        await service.connect();
        
        const lastSyncRow = await db.get('SELECT MAX(uid) as lastUid FROM (SELECT CAST(external_id AS INTEGER) as uid FROM email_messages WHERE external_id GLOB \'[0-9]*\')');
        const lastSyncUid = lastSyncRow?.lastUid || 0;
        
        const emails = await service.fetchNewEmails(lastSyncUid);
        
        let newCount = 0;
        let linkedCount = 0;

        for (const email of emails) {
            const existingEmail = await db.get(
                'SELECT id FROM email_messages WHERE external_id = ?',
                [email.external_id]
            );

            if (existingEmail) {
                continue;
            }

            let matchedLeadId = null;
            const normalizedFromEmail = email.from_email.toLowerCase().trim();
            
            for (const lead of leadEmails) {
                if (lead.email && lead.email.toLowerCase().trim() === normalizedFromEmail) {
                    matchedLeadId = lead.id;
                    linkedCount++;
                    break;
                }
            }

            await db.run(
                `INSERT INTO email_messages (external_id, lead_id, from_email, to_email, subject, body_text, body_html, received_at, is_read, thread_id, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    email.external_id,
                    matchedLeadId,
                    email.from_email,
                    email.to_email,
                    email.subject,
                    email.body_text,
                    email.body_html,
                    email.received_at,
                    email.is_read,
                    email.thread_id,
                    Date.now()
                ]
            );
            
            newCount++;
        }

        await db.run('UPDATE imap_settings SET last_sync = ? WHERE id = 1', [Date.now()]);
        
        await service.disconnect();
        
        return {
            success: true,
            newEmails: newCount,
            linkedEmails: linkedCount,
            totalFetched: emails.length
        };
    } catch (error) {
        await service.disconnect();
        throw error;
    }
}
