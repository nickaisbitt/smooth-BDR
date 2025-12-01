export const AGENT_CONFIG = {
  COO: {
    name: 'coo',
    pollIntervalMs: 15000,
    enabled: true
  },
  PROSPECT_FINDER: {
    name: 'prospect-finder',
    pollIntervalMs: 20000,  // Faster prospect discovery
    batchSize: 10,  // 2x more prospects per cycle
    enabled: true
  },
  RESEARCH: {
    name: 'research',
    pollIntervalMs: 1500,  // ULTRA FAST: 6.6x faster
    batchSize: 5,  // PARALLEL: process 5 research items concurrently per cycle
    maxPasses: 2,  // REDUCED: was 3, now 2 to fail fast
    targetQuality: 5,  // ULTRA LENIENT: 5/10 to unlock all items
    enabled: true
  },
  RESEARCH_RETRY: {
    name: 'research-retry',
    pollIntervalMs: 3000,  // 10x faster - was 30000
    maxRetries: 5,  // REDUCED: fail faster after 5 retries
    targetQuality: 5,  // ULTRA LENIENT: 5/10
    retryDelayMs: 20000,  // REDUCED from 30000
    enabled: true
  },
  EMAIL_GENERATOR: {
    name: 'email-generator',
    pollIntervalMs: 1500,  // ULTRA FAST: 3.3x faster
    batchSize: 7,  // INCREASED: process 7 emails per cycle
    minQuality: 5,  // ULTRA LENIENT: 5/10
    enabled: true
  },
  EMAIL_REVIEWER: {
    name: 'email-reviewer',
    pollIntervalMs: 1500,  // ULTRA FAST
    minEmailQuality: 5,  // ULTRA LENIENT: 5/10
    minResearchQuality: 5,  // ULTRA LENIENT: 5/10
    enabled: true
  },
  EMAIL_SENDER: {
    name: 'email-sender',
    pollIntervalMs: 2000,  // 2.5x faster polling - every 2s
    batchSize: 20,  // 2x more per batch - send 20 at a time
    dailyLimit: 1500,  // 3x capacity - max 1500/day
    delayBetweenEmailsMs: 100,  // 5x faster - 100ms between emails
    enabled: true
  },
  INBOX: {
    name: 'inbox',
    pollIntervalMs: 15000,  // Even faster inbox sync
    enabled: true
  },
  LOGO_FINDER: {
    name: 'logo-finder',
    pollIntervalMs: 25000,  // Faster logo processing
    batchSize: 15,  // 3x batch size
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
