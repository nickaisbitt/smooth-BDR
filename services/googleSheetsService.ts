
import { Lead } from '../types';

/**
 * Fetches the entire database from the Google Apps Script Web App.
 */
export const fetchLeadsFromSheet = async (scriptUrl: string): Promise<Lead[] | null> => {
    if (!scriptUrl) return null;
    try {
        const response = await fetch(scriptUrl, {
            method: 'GET',
        });
        if (!response.ok) throw new Error("Network response was not ok");
        const data = await response.json();
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.error("Error fetching from Google Sheets:", error);
        return null;
    }
};

/**
 * Uploads the current local database to the Google Sheet (Overwrites).
 */
export const saveLeadsToSheet = async (scriptUrl: string, leads: Lead[]): Promise<boolean> => {
    if (!scriptUrl) return false;
    try {
        // Apps Script requires POST data to be stringified in the body
        // and often requires 'no-cors' or specific headers depending on deployment,
        // but standard fetch usually works if the script is set to "Anyone" access.
        const response = await fetch(scriptUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain;charset=utf-8', // Apps Script handles text/plain better than application/json sometimes due to CORS preflight
            },
            body: JSON.stringify({ leads }),
        });
        
        if (!response.ok) return false;
        
        const text = await response.text();
        return text.includes("Success");
    } catch (error) {
        console.error("Error saving to Google Sheets:", error);
        return false;
    }
};
