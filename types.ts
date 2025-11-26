
export interface ServiceProfile {
  companyName: string;
  description: string;
  valueProposition: string;
  contactEmail?: string;
  senderName?: string;
}

export interface EmailJSConfig {
    serviceId: string;
    templateId: string;
    publicKey: string;
}

export enum LeadStatus {
  NEW = 'NEW',
  ANALYZING = 'ANALYZING',
  QUALIFIED = 'QUALIFIED',
  UNQUALIFIED = 'UNQUALIFIED',
  CONTACTED = 'CONTACTED',
}

export interface AnalysisResult {
  score: number; // 0-100
  reasoning: string;
  suggestedAngle: string;
  painPoints: string[];
}

export interface DecisionMaker {
    name: string;
    role: string;
    linkedinUrl?: string;
}

export interface TriggerEvent {
    type: 'hiring' | 'news' | 'growth' | 'other';
    description: string;
    sourceUrl?: string;
}

export interface EmailDraft {
    subject: string;
    body: string;
    delayDays: number; // 0 for immediate
    context: string; // e.g. "Initial Hook", "Follow Up"
}

export interface Lead {
  id: string;
  companyName: string;
  website: string;
  description: string;
  status: LeadStatus;
  analysis?: AnalysisResult;
  
  // Deprecated single draft, keeping for backward compatibility
  emailDraft?: string; 
  
  // New Sequence Engine
  emailSequence?: EmailDraft[];
  triggers?: TriggerEvent[];

  sourceUrl?: string; // From grounding
  foundVia?: string; // The query strategy that found this lead
  
  // Enrichment Data
  decisionMaker?: DecisionMaker;
  techStack?: string[];
  
  createdAt: number;
  lastUpdated: number;
}

export interface SearchResult {
  leads: Lead[];
  groundingUrls: string[];
}

export interface AgentLog {
  id: string;
  timestamp: number;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'action';
}

export interface StrategyNode {
  id: string;
  sector: string;
  query: string;
  rationale: string;
  status: 'pending' | 'active' | 'completed' | 'failed';
}

export type ViewType = 'dashboard' | 'prospects' | 'analytics' | 'settings';