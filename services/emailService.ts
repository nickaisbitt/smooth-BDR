
import { SMTPConfig } from '../types';

// Rate Limiting Configuration
const SEND_INTERVAL_MS = 3000; // 3 seconds between emails to satisfy Hostinger/SMTP limits

interface QueuedEmail {
    config: SMTPConfig;
    leadId: string;
    toEmail: string;
    toName: string;
    subject: string;
    message: string;
    fromName: string;
    recipientEmail?: string;
    resolve: (success: boolean) => void;
}

const emailQueue: QueuedEmail[] = [];
let isProcessingQueue = false;

/**
 * Internal function to process the queue sequentially.
 */
const processQueue = async () => {
    if (isProcessingQueue || emailQueue.length === 0) return;

    isProcessingQueue = true;
    const task = emailQueue.shift();

    if (!task) {
        isProcessingQueue = false;
        return;
    }

    const targetEmail = task.recipientEmail || "hello@smoothaiconsultancy.com";
    console.log(`[Email Queue] Processing email to: ${targetEmail} (Lead: ${task.leadId})...`);

    try {
        const response = await fetch('/api/send-email', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                smtpConfig: task.config,
                leadId: task.leadId,
                publicUrl: task.config.publicUrl, // Pass URL for pixel generation
                email: {
                    to: targetEmail,
                    fromName: task.fromName,
                    subject: task.subject,
                    message: task.message
                }
            })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            console.log(`[Email Queue] ✅ Success: Sent to ${targetEmail}`);
            task.resolve(true);
        } else {
            console.error(`[Email Queue] ❌ Failed: Server responded with error for ${targetEmail}.`, data.error);
            task.resolve(false);
        }
    } catch (error: any) {
        console.error(`[Email Queue] ❌ Network Error for ${targetEmail}:`, error.message);
        task.resolve(false);
    }

    // Wait for the rate limit interval before processing the next item
    setTimeout(() => {
        isProcessingQueue = false;
        processQueue();
    }, SEND_INTERVAL_MS);
};

/**
 * Sends an email via the local Node.js relay (server.js).
 * Uses a Queue system to prevent SMTP blocking.
 */
export const sendViaServer = (
    config: SMTPConfig,
    leadId: string, 
    toEmail: string, 
    toName: string,
    subject: string,
    message: string,
    fromName: string,
    recipientEmail?: string 
): Promise<boolean> => {
    return new Promise((resolve) => {
        // Push to queue
        emailQueue.push({
            config,
            leadId,
            toEmail,
            toName,
            subject,
            message,
            fromName,
            recipientEmail,
            resolve
        });

        console.log(`[Email Queue] Request queued for ${toEmail}. Position: ${emailQueue.length}`);
        
        // Trigger processor if idle
        processQueue();
    });
};

/**
 * Generates a robust mailto link that handles special characters and newlines correctly.
 */
export const generateMailtoLink = (email: string, subject: string, body: string): string => {
    const encodedSubject = encodeURIComponent(subject);
    const encodedBody = encodeURIComponent(body);
    return `mailto:${email}?subject=${encodedSubject}&body=${encodedBody}`;
};
