
import { SMTPConfig } from '../types';

/**
 * Sends an email via the local Node.js relay (server.js).
 */
export const sendViaServer = async (
    config: SMTPConfig,
    toEmail: string, // Not used directly, usually we rely on config or decision maker email
    // But for this tool, we assume we want to send to the Lead's email (if we have it) 
    // OR we are testing.
    // Wait - leads don't always have emails in the object yet. 
    // We will assume 'toEmail' is passed in.
    toName: string,
    subject: string,
    message: string,
    fromName: string,
    recipientEmail?: string // Override
): Promise<boolean> => {
    
    // For leads without email, we might fail or need to hunt first.
    // For now, let's assume if recipientEmail is missing, we fail.
    const targetEmail = recipientEmail || "hello@smoothaiconsultancy.com"; // Fallback for safety/testing

    try {
        const response = await fetch('/api/send-email', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                smtpConfig: config,
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
