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
    pollIntervalMs: 2000,  // AGGRESSIVE: 5x faster - was 10000
    batchSize: 5,  // PARALLEL: process 5 research items concurrently per cycle
    maxPasses: 3,
    targetQuality: 6,  // LOWERED to 6/10 to unlock more items
    enabled: true
  },
  RESEARCH_RETRY: {
    name: 'research-retry',
    pollIntervalMs: 5000,  // 6x faster - was 30000
    maxRetries: 8,  // LOWERED: mark as exhausted after 8 retries instead of 50
    targetQuality: 6,  // LOWERED to 6/10
    retryDelayMs: 30000,  // HALVED from 60000
    enabled: true
  },
  EMAIL_GENERATOR: {
    name: 'email-generator',
    pollIntervalMs: 2000,  // AGGRESSIVE: 2.5x faster - was 5000
    batchSize: 5,  // INCREASED: process 5 emails per cycle (was 3)
    minQuality: 6,  // LOWERED to 6/10
    enabled: true
  },
  EMAIL_REVIEWER: {
    name: 'email-reviewer',
    pollIntervalMs: 2000,  // AGGRESSIVE: faster polling
    minEmailQuality: 6,  // LOWERED to 6/10
    minResearchQuality: 6,  // LOWERED to 6/10
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
