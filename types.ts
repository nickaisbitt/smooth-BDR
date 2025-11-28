
export interface ServiceProfile {
  companyName: string;
  description: string;
  valueProposition: string;
  contactEmail?: string;
  senderName?: string;
  theme?: 'light' | 'dark';
}

export interface SMTPConfig {
    host: string;
    port: string;
    user: string;
    pass: string;
    secure: boolean;
    publicUrl?: string; // For Tracking Pixel
}

export interface GoogleSheetsConfig {
    scriptUrl: string;
}

export enum LeadStatus {
  NEW = 'NEW',
  ANALYZING = 'ANALYZING',
  QUALIFIED = 'QUALIFIED',
  UNQUALIFIED = 'UNQUALIFIED',
  CONTACTED = 'CONTACTED',
  OPENED = 'OPENED',
  ARCHIVED = 'ARCHIVED',
}

export interface AnalysisResult {
  score: number; // 0-100
  reasoning: string;
  suggestedAngle: string;
  painPoints: string[];
  budgetEstimate?: string;
  competitors?: string[];
  employeeSentiment?: string;
}

export interface DecisionMaker {
    name: string;
    role: string;
    email?: string;
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
    
    // A/B Testing
    variantLabel?: 'A' | 'B';
    alternativeSubject?: string; 
    critique?: string;
}

export interface Lead {
  id: string;
  companyName: string;
  website: string;
  description: string;
  status: LeadStatus;
  analysis?: AnalysisResult;
  
  // Sequence Engine
  emailSequence?: EmailDraft[];
  triggers?: TriggerEvent[];

  sourceUrl?: string;
  foundVia?: string;
  
  // Enrichment Data
  decisionMaker?: DecisionMaker;
  techStack?: string[];
  
  // A/B Test Tracking
  activeVariant?: 'A' | 'B'; 

  createdAt: number;
  lastUpdated: number;
  lastContactedAt?: number;
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

export interface GlobalStats {
    totalOperations: number;
    estimatedCost: number; // In cents
    abTestWins: { A: number, B: number };
}

export interface Shortcut {
    key: string;
    label: string;
    action: () => void;
}

export interface IntegrationConfig {
    webhookUrl: string;
    autoSync: boolean;
}

export type ViewType = 'dashboard' | 'prospects' | 'analytics' | 'settings' | 'quality_control' | 'debug' | 'calendar' | 'linkedin';