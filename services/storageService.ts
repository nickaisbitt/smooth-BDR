
import { Lead, StrategyNode, AgentLog, ServiceProfile, SMTPConfig, LeadStatus, GoogleSheetsConfig, GlobalStats, IntegrationConfig, IMAPConfig } from '../types';

// --- STORAGE KEYS MAP ---
export const STORAGE_KEY = 'smooth_ai_crm_db_v1';           // Main Database
export const BACKUP_KEY = 'smooth_ai_crm_emergency_backup'; // Safety Net
export const STRATEGY_KEY = 'smooth_ai_strategy_queue_v1';  // AI Conquest Plan
export const LOGS_KEY = 'smooth_ai_agent_logs_v1';          // Terminal History
export const PROFILE_KEY = 'smooth_ai_profile_v1';          // Identity (Nick)
export const API_KEY_STORAGE_KEY = 'smooth_ai_openrouter_key'; // Hybrid Engine Key
export const SMTP_CONFIG_KEY = 'smooth_ai_smtp_config';     // Hostinger SMTP
export const SHEETS_CONFIG_KEY = 'smooth_ai_sheets_config'; // Google Sheets Script
export const BLACKLIST_KEY = 'smooth_ai_blacklist_v1';      // Negative Filters
export const STATS_KEY = 'smooth_ai_global_stats_v1';       // Cost Tracking
export const INTEGRATION_CONFIG_KEY = 'smooth_ai_integration_config_v1'; // Webhooks
export const IMAP_CONFIG_KEY = 'smooth_ai_imap_config'; // IMAP Settings

// --- GENERIC LOADERS ---

export const loadLeadsFromStorage = (): Lead[] => {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    
    const leads: Lead[] = JSON.parse(data);
    
    // Sanitize: If app was closed during analysis, reset those leads to NEW so they aren't stuck.
    return leads.map(lead => {
        if (lead.status === LeadStatus.ANALYZING) {
             return { ...lead, status: LeadStatus.NEW };
        }
        return lead;
    });
  } catch (e) {
    console.error("Failed to load leads", e);
    return [];
  }
};

export const loadStrategies = (): StrategyNode[] => {
    try {
        const data = localStorage.getItem(STRATEGY_KEY);
        return data ? JSON.parse(data) : [];
    } catch (e) { return []; }
};

export const loadLogs = (): AgentLog[] => {
    try {
        const data = localStorage.getItem(LOGS_KEY);
        return data ? JSON.parse(data) : [];
    } catch (e) { return []; }
};

export const loadProfile = (): ServiceProfile | null => {
    try {
        const data = localStorage.getItem(PROFILE_KEY);
        return data ? JSON.parse(data) : null;
    } catch (e) { return null; }
};

export const loadOpenRouterKey = (): string => {
    const saved = localStorage.getItem(API_KEY_STORAGE_KEY);
    const hardcoded = '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';
    return (saved || hardcoded).trim();
};

export const loadSMTPConfig = (): SMTPConfig => {
    try {
        const data = localStorage.getItem(SMTP_CONFIG_KEY);
        return data ? JSON.parse(data) : { host: 'smtp.hostinger.com', port: '465', user: '', pass: '', secure: true };
    } catch (e) { return { host: 'smtp.hostinger.com', port: '465', user: '', pass: '', secure: true }; }
};

export const loadSheetsConfig = (): GoogleSheetsConfig => {
    try {
        const data = localStorage.getItem(SHEETS_CONFIG_KEY);
        return data ? JSON.parse(data) : { scriptUrl: '' };
    } catch (e) { return { scriptUrl: '' }; }
};

export const loadBlacklist = (): string[] => {
    try {
        const data = localStorage.getItem(BLACKLIST_KEY);
        return data ? JSON.parse(data) : ["agency", "consulting", "software", "marketing"];
    } catch (e) { return []; }
};

export const loadStats = (): GlobalStats => {
    try {
        const data = localStorage.getItem(STATS_KEY);
        return data ? JSON.parse(data) : { totalOperations: 0, estimatedCost: 0, abTestWins: { A: 0, B: 0 } };
    } catch (e) { return { totalOperations: 0, estimatedCost: 0, abTestWins: { A: 0, B: 0 } }; }
};

export const loadIntegrationConfig = (): IntegrationConfig => {
    try {
        const data = localStorage.getItem(INTEGRATION_CONFIG_KEY);
        return data ? JSON.parse(data) : { webhookUrl: '', autoSync: false };
    } catch (e) { return { webhookUrl: '', autoSync: false }; }
};

export const loadIMAPConfig = (): IMAPConfig => {
    try {
        const data = localStorage.getItem(IMAP_CONFIG_KEY);
        return data ? JSON.parse(data) : { host: 'imap.hostinger.com', port: '993', user: '', pass: '', secure: true };
    } catch (e) { return { host: 'imap.hostinger.com', port: '993', user: '', pass: '', secure: true }; }
};

// --- GENERIC SAVERS ---

export const saveLeadsToStorage = (leads: Lead[]) => {
  try {
    const currentData = localStorage.getItem(STORAGE_KEY);
    if (leads.length === 0 && currentData && currentData.length > 50) {
        console.warn("⚠️ Attempting to wipe DB. Creating Emergency Backup first.");
        localStorage.setItem(BACKUP_KEY, currentData);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(leads));
  } catch (e) {
    console.error("Failed to save leads", e);
  }
};

export const saveStrategies = (queue: StrategyNode[]) => {
    try { localStorage.setItem(STRATEGY_KEY, JSON.stringify(queue)); } catch (e) { console.error(e); }
};

export const saveLogs = (logs: AgentLog[]) => {
    try { localStorage.setItem(LOGS_KEY, JSON.stringify(logs.slice(-100))); } catch (e) { console.error(e); }
};

export const saveProfile = (profile: ServiceProfile) => {
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch (e) { console.error(e); }
};

export const saveOpenRouterKey = (key: string) => {
    localStorage.setItem(API_KEY_STORAGE_KEY, key.trim());
};

export const saveSMTPConfig = (config: SMTPConfig) => {
    localStorage.setItem(SMTP_CONFIG_KEY, JSON.stringify(config));
};

export const saveSheetsConfig = (config: GoogleSheetsConfig) => {
    localStorage.setItem(SHEETS_CONFIG_KEY, JSON.stringify(config));
};

export const saveBlacklist = (blacklist: string[]) => {
    localStorage.setItem(BLACKLIST_KEY, JSON.stringify(blacklist));
};

export const saveStats = (stats: GlobalStats) => {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
};

export const saveIntegrationConfig = (config: IntegrationConfig) => {
    localStorage.setItem(INTEGRATION_CONFIG_KEY, JSON.stringify(config));
};

export const saveIMAPConfig = (config: IMAPConfig) => {
    localStorage.setItem(IMAP_CONFIG_KEY, JSON.stringify(config));
};

// --- GARBAGE COLLECTOR ---
export const manageStorageQuota = () => {
    try {
        let total = 0;
        for (let x in localStorage) {
            if (localStorage.hasOwnProperty(x)) {
                total += ((localStorage[x].length * 2));
            }
        }
        const usageKB = total / 1024;
        // Limit is roughly 5MB (5120KB). If we cross 80% (4000KB), clean up.
        if (usageKB > 4000) {
            console.warn(`Storage usage high (${usageKB.toFixed(0)}KB). Running Garbage Collector.`);
            // 1. Trim Logs aggressively
            const logs = loadLogs();
            if (logs.length > 20) {
                saveLogs(logs.slice(-20)); // Keep only last 20
            } else {
                saveLogs([]); // Wipe logs if desperate
            }
            
            // 2. Trim Completed Strategies
            const strats = loadStrategies();
            const active = strats.filter(s => s.status !== 'completed');
            if (active.length !== strats.length) {
                saveStrategies(active);
            }
        }
    } catch (e) {
        console.error("GC Failed", e);
    }
};

// --- BACKUP & RESTORE ---

export const exportDatabase = (): string => {
    const db = {
        leads: loadLeadsFromStorage(),
        strategies: loadStrategies(),
        logs: loadLogs(),
        profile: loadProfile(),
        blacklist: loadBlacklist(),
        integrationConfig: loadIntegrationConfig(),
        timestamp: Date.now(),
        version: '0.0.1'
    };
    return JSON.stringify(db, null, 2);
};

export const importDatabase = (jsonString: string): boolean => {
    try {
        const db = JSON.parse(jsonString);
        if (db.leads) localStorage.setItem(STORAGE_KEY, JSON.stringify(db.leads));
        if (db.strategies) localStorage.setItem(STRATEGY_KEY, JSON.stringify(db.strategies));
        if (db.logs) localStorage.setItem(LOGS_KEY, JSON.stringify(db.logs));
        if (db.profile) localStorage.setItem(PROFILE_KEY, JSON.stringify(db.profile));
        if (db.blacklist) localStorage.setItem(BLACKLIST_KEY, JSON.stringify(db.blacklist));
        if (db.integrationConfig) localStorage.setItem(INTEGRATION_CONFIG_KEY, JSON.stringify(db.integrationConfig));
        return true;
    } catch (e) {
        console.error("Import failed", e);
        return false;
    }
};

export const clearStorage = () => {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(STRATEGY_KEY);
  localStorage.removeItem(LOGS_KEY);
  localStorage.removeItem(BACKUP_KEY);
  localStorage.removeItem(STATS_KEY);
  localStorage.removeItem(INTEGRATION_CONFIG_KEY);
};
