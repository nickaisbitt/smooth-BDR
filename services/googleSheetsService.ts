
import { Lead } from '../types';

/**
 * Fetches the entire database from the Google Apps Script Web App.
 */
export const fetchLeadsFromSheet = async (scriptUrl: string): Promise<Lead[] | null> => {
    if (!scriptUrl) return null;
    try {
        // 'follow' redirects is essential for Google Apps Script Web Apps
        const response = await fetch(scriptUrl, {
            method: 'GET',
            redirect: 'follow'
        });
        
        if (!response.ok) throw new Error(`Network response was not ok: ${response.status}`);
        
        const text = await response.text();
        
        // Detect HTML error pages (Permissions/Crash)
        // If the response starts with "<", it's likely <!DOCTYPE html>... which means the script returned a webpage (login/error)
        if (text.trim().startsWith('<')) {
            console.error("Google Sheets returned HTML instead of JSON. Likely a permission error.");
            throw new Error("Connection Failed: Google returned a webpage. Please ensure your Apps Script is deployed with access set to 'Anyone'.");
        }

        try {
            const data = JSON.parse(text);
            return Array.isArray(data) ? data : [];
        } catch (e) {
            console.error("Failed to parse JSON from Sheets:", text.substring(0, 100));
            throw new Error("Invalid JSON response from Sheets.");
        }
    } catch (error: any) {
        console.error("Error fetching from Google Sheets:", error);
        throw error; // Propagate error so UI shows the red status
    }
};

/**
 * Uploads the current local database to the Google Sheet (Overwrites).
 */
export const saveLeadsToSheet = async (scriptUrl: string, leads: Lead[]): Promise<boolean> => {
    if (!scriptUrl) return false;
    try {
        const response = await fetch(scriptUrl, {
            method: 'POST',
            redirect: 'follow',
            headers: {
                'Content-Type': 'text/plain;charset=utf-8', 
            },
            body: JSON.stringify({ leads }),
        });
        
        if (!response.ok) return false;
        
        const text = await response.text();
        
        if (text.trim().startsWith('<')) {
             console.error("Google Sheets returned HTML during save.");
             return false;
        }

        return text.includes("Success");
    } catch (error) {
        console.error("Error saving to Google Sheets:", error);
        return false;
    }
};
