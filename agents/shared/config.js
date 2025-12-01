export const AGENT_CONFIG = {
  COO: {
    name: 'coo',
    pollIntervalMs: 5000,  // MAXIMUM MONITORING: every 5s
    enabled: true
  },
  PROSPECT_FINDER: {
    name: 'prospect-finder',
    pollIntervalMs: 3000,  // EXTREME SPEED: 40% faster from 5s - CRITICAL FOR CONTINUOUS FEED
    batchSize: 50,  // MASSIVE: max batch size
    enabled: true
  },
  RESEARCH: {
    name: 'research',
    pollIntervalMs: 600,  // LIGHTNING: 25% faster from 800ms
    batchSize: 15,  // 50% more parallel: 10→15 concurrent research items
    maxPasses: 1,  // FAIL FAST: only 1 pass to unlock flow
    targetQuality: 3,  // EXTREME LENIENT: 3/10 to accept ALL items
    enabled: true
  },
  RESEARCH_RETRY: {
    name: 'research-retry',
    pollIntervalMs: 1000,  // EXTREME SPEED: 33% faster from 1500ms
    maxRetries: 1,  // FAIL INSTANTLY: only 1 retry (fail-fast philosophy)
    targetQuality: 3,  // EXTREME LENIENT: 3/10
    retryDelayMs: 3000,  // 40% faster retry delay
    enabled: true
  },
  EMAIL_GENERATOR: {
    name: 'email-generator',
    pollIntervalMs: 600,  // LIGHTNING: 25% faster
    batchSize: 20,  // 33% more per cycle
    minQuality: 3,  // EXTREME LENIENT: 3/10
    enabled: true
  },
  EMAIL_REVIEWER: {
    name: 'email-reviewer',
    pollIntervalMs: 600,  // LIGHTNING FAST: 25% faster
    minEmailQuality: 3,  // EXTREME LENIENT: 3/10
    minResearchQuality: 3,  // EXTREME LENIENT: 3/10
    enabled: true
  },
  EMAIL_SENDER: {
    name: 'email-sender',
    pollIntervalMs: 600,  // Standard polling: respect SMTP rate limits
    batchSize: 25,  // Conservative batch: reduce pressure on SMTP
    dailyLimit: 250,  // Ultra-conservative: ~1 email per 6 minutes to respect Hostinger strict limits
    delayBetweenEmailsMs: 250,  // Very safe delay: 250ms between emails = 4 emails/sec = VERY sustainable
    enabled: true
  },
  INBOX: {
    name: 'inbox',
    pollIntervalMs: 5000,  // FASTER: 2x from 10s
    enabled: true
  },
  LOGO_FINDER: {
    name: 'logo-finder',
    pollIntervalMs: 60000,  // BACKGROUND: slower to preserve resources
    batchSize: 30,  // INCREASED batch when it runs
    enabled: true
  }
};

export const QUEUE_TABLES = {
  PROSPECT: 'prospect_queue',
  RESEARCH: 'research_queue',
  DRAFT: 'draft_queue'
};

export function getAgentConfig(agentName) {
  return Object.values(AGENT_CONFIG).find(c => c.name === agentName) || null;
}
