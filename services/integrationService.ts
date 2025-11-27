
import { Lead } from '../types';

/**
 * Sends lead data to a configured Webhook URL (e.g., Zapier, n8n, Make).
 */
export const syncLeadToWebhook = async (lead: Lead, webhookUrl: string): Promise<boolean> => {
    if (!webhookUrl) return false;
    
    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                ...lead,
                syncedAt: Date.now()
            }),
        });

        if (!response.ok) {
            console.warn(`Webhook sync failed: ${response.status} ${response.statusText}`);
            return false;
        }

        return true;
    } catch (error) {
        console.error("Webhook Network Error:", error);
        return false;
    }
};
