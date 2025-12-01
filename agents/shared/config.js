export const AGENT_CONFIG = {
  COO: {
    name: 'coo',
    pollIntervalMs: 15000,
    enabled: true
  },
  PROSPECT_FINDER: {
    name: 'prospect-finder',
    pollIntervalMs: 30000,
    batchSize: 5,
    enabled: true
  },
  RESEARCH: {
    name: 'research',
    pollIntervalMs: 10000,
    batchSize: 1,
    maxPasses: 3,
    targetQuality: 8,
    enabled: true
  },
  RESEARCH_RETRY: {
    name: 'research-retry',
    pollIntervalMs: 30000,
    maxRetries: 10,
    targetQuality: 8,
    retryDelayMs: 60000,
    enabled: true
  },
  EMAIL_GENERATOR: {
    name: 'email-generator',
    pollIntervalMs: 5000,  // 3x faster polling
    batchSize: 1,
    minQuality: 8,
    enabled: true
  },
  EMAIL_REVIEWER: {
    name: 'email-reviewer',
    pollIntervalMs: 3000,  // 3x faster review
    minEmailQuality: 7,
    minResearchQuality: 8,
    enabled: true
  },
  EMAIL_SENDER: {
    name: 'email-sender',
    pollIntervalMs: 10000,  // 6x faster - check every 10s instead of 60s
    batchSize: 5,
    dailyLimit: 200,
    delayBetweenEmailsMs: 1000,  // 3x faster - 1s between emails instead of 3s
    enabled: true
  },
  INBOX: {
    name: 'inbox',
    pollIntervalMs: 30000,
    enabled: true
  },
  LOGO_FINDER: {
    name: 'logo-finder',
    pollIntervalMs: 45000,
    batchSize: 5,
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
