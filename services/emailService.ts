
import { SMTPConfig } from '../types';

// Rate Limiter State
let lastSentTimestamp = 0;
const MIN_SEND_INTERVAL = 5000; // 5 seconds

/**
 * Sends an email via the local Node.js relay (server.js).
 */
export const sendViaServer = async (
    config: SMTPConfig,
    leadId: string, // ID needed for tracking
    toEmail: string, 
    toName: string,
    subject: string,
    message: string,
    fromName: string,
    recipientEmail?: string 
): Promise<boolean> => {
    
    // 1. Rate Check
    const now = Date.now();
    if (now - lastSentTimestamp < MIN_SEND_INTERVAL) {
        console.warn("SMTP Rate Limit Hit. Skipping send.");
        return false;
    }

    const targetEmail = recipientEmail || "hello@smoothaiconsultancy.com"; 

    try {
        console.log(`Sending email via server to ${targetEmail}...`);
        const response = await fetch('/api/send-email', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                smtpConfig: config,
                leadId: leadId,
                publicUrl: config.publicUrl, // Pass URL for pixel generation
                email: {
                    to: targetEmail,
                    fromName: fromName,
                    subject: subject,
                    message: message
                }
            })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            lastSentTimestamp = Date.now(); // Update timestamp on success
            console.log("Email sent successfully", data);
            return true;
        } else {
            console.error("SMTP Send Failed:", data.error);
            return false;
        }
    } catch (error) {
        console.error("Network Error calling /api/send-email", error);
        return false;
    }
};

/**
 * Generates a robust mailto link that handles special characters and newlines correctly.
 */
export const generateMailtoLink = (email: string, subject: string, body: string): string => {
    const encodedSubject = encodeURIComponent(subject);
    const encodedBody = encodeURIComponent(body);
    return `mailto:${email}?subject=${encodedSubject}&body=${encodedBody}`;
};
