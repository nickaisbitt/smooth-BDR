
import { Lead, StrategyNode, AgentLog, ServiceProfile, EmailJSConfig, LeadStatus } from '../types';

const STORAGE_KEY = 'smooth_ai_crm_db_v1';
const BACKUP_KEY = 'smooth_ai_crm_emergency_backup'; // Safety Net
const API_KEY_STORAGE_KEY = 'smooth_ai_openrouter_key';
const STRATEGY_KEY = 'smooth_ai_strategy_queue_v1';
const LOGS_KEY = 'smooth_ai_agent_logs_v1';
const PROFILE_KEY = 'smooth_ai_profile_v1';
const EMAIL_CONFIG_KEY = 'smooth_ai_emailjs_config';

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
    // If main load fails, try backup? 
    // For now, return empty to prevent crash, but user can manually restore via settings.
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
    // Returns user saved key, OR the hardcoded backup key provided by the user
    return localStorage.getItem(API_KEY_STORAGE_KEY) || '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';
};

export const loadEmailConfig = (): EmailJSConfig => {
    try {
        const data = localStorage.getItem(EMAIL_CONFIG_KEY);
        return data ? JSON.parse(data) : { serviceId: '', templateId: '', publicKey: '' };
    } catch (e) { return { serviceId: '', templateId: '', publicKey: '' }; }
};

// --- GENERIC SAVERS ---

export const saveLeadsToStorage = (leads: Lead[]) => {
  try {
    const currentData = localStorage.getItem(STORAGE_KEY);
    
    // SAFETY CHECK:
    // If we are about to save an empty array, but we currently have a lot of data,
    // this might be a bug (state wiped). We create an emergency backup first.
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
    try {
        localStorage.setItem(STRATEGY_KEY, JSON.stringify(queue));
    } catch (e) { console.error(e); }
};

export const saveLogs = (logs: AgentLog[]) => {
    try {
        localStorage.setItem(LOGS_KEY, JSON.stringify(logs.slice(-100)));
    } catch (e) { console.error(e); }
};

export const saveProfile = (profile: ServiceProfile) => {
    try {
        localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch (e) { console.error(e); }
};

export const saveOpenRouterKey = (key: string) => {
    localStorage.setItem(API_KEY_STORAGE_KEY, key);
};

export const saveEmailConfig = (config: EmailJSConfig) => {
    localStorage.setItem(EMAIL_CONFIG_KEY, JSON.stringify(config));
};

// --- BACKUP & RESTORE SYSTEM ---

export const exportDatabase = (): string => {
    const db = {
        leads: loadLeadsFromStorage(),
        strategies: loadStrategies(),
        logs: loadLogs(),
        profile: loadProfile(),
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
  // We intentionally keep API keys and Profile so the user doesn't lose access/identity
};
