export const AGENT_CONFIG = {
  COO: {
    name: 'coo',
    pollIntervalMs: 5000,  // MAXIMUM MONITORING: every 5s
    enabled: true
  },
  PROSPECT_FINDER: {
    name: 'prospect-finder',
    pollIntervalMs: 5000,  // MAXIMUM SPEED: 2x faster from 10s - CRITICAL BOTTLENECK ELIMINATION
    batchSize: 50,  // MASSIVE: 2x increase from 25 - max feed to research
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
    pollIntervalMs: 1500,  // MAXIMUM SPEED: 33% faster from 2000ms
    maxRetries: 2,  // FAIL FASTER: only 2 retries
    targetQuality: 3,  // EXTREME LENIENT: 3/10
    retryDelayMs: 5000,  // 2x faster retry delay
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
    pollIntervalMs: 1000,  // MAXIMUM SPEED: 17% faster from 1200ms
    batchSize: 100,  // ULTIMATE: 100 emails per batch (2x from 50)
    dailyLimit: 10000,  // MAXIMUM: 10000/day capacity
    delayBetweenEmailsMs: 10,  // EXTREME SPEED: 2.5x faster (10ms between emails)
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
