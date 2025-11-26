import emailjs from '@emailjs/browser';
import { EmailJSConfig } from '../types';

/**
 * Initializes and sends an email via EmailJS (Hostinger SMTP bridge).
 */
export const sendViaEmailJS = async (
    config: EmailJSConfig,
    toName: string,
    companyName: string,
    subject: string,
    message: string,
    fromName: string
): Promise<boolean> => {
    if (!config.serviceId || !config.templateId || !config.publicKey) {
        console.error("EmailJS Config missing");
        return false;
    }

    try {
        emailjs.init(config.publicKey);

        const templateParams = {
            to_name: toName,         // {{to_name}} in EmailJS template
            company_name: companyName, // {{company_name}}
            subject: subject,        // {{subject}}
            message: message,        // {{message}}
            from_name: fromName,     // {{from_name}}
        };

        const response = await emailjs.send(config.serviceId, config.templateId, templateParams);
        
        if (response.status === 200) {
            return true;
        } else {
            console.error("EmailJS sending failed", response);
            return false;
        }
    } catch (error) {
        console.error("EmailJS Error", error);
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