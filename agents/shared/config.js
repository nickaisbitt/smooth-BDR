export const AGENT_CONFIG = {
  COO: {
    name: 'coo',
    pollIntervalMs: 10000,  // ULTRA FAST: monitor every 10s
    enabled: true
  },
  PROSPECT_FINDER: {
    name: 'prospect-finder',
    pollIntervalMs: 10000,  // CRITICAL: 2x faster - was 20000 - NOW KEY BOTTLENECK
    batchSize: 25,  // MASSIVE: 2.5x increase from 10 - feed research pipeline
    enabled: true
  },
  RESEARCH: {
    name: 'research',
    pollIntervalMs: 800,  // LIGHTNING FAST: 25% faster
    batchSize: 10,  // 25% more parallel: 8→10 concurrent research items
    maxPasses: 1,  // FAIL FAST: only 1 pass to unlock flow
    targetQuality: 4,  // SUPER LENIENT: 4/10 to accept all
    enabled: true
  },
  RESEARCH_RETRY: {
    name: 'research-retry',
    pollIntervalMs: 2000,  // MAXIMUM SPEED: 1.5x faster
    maxRetries: 3,  // FAIL FAST: 3 retries only
    targetQuality: 4,  // SUPER LENIENT: 4/10
    retryDelayMs: 10000,  // 2x faster retry
    enabled: true
  },
  EMAIL_GENERATOR: {
    name: 'email-generator',
    pollIntervalMs: 800,  // LIGHTNING FAST: 25% faster
    batchSize: 15,  // 50% more per cycle
    minQuality: 4,  // SUPER LENIENT: 4/10
    enabled: true
  },
  EMAIL_REVIEWER: {
    name: 'email-reviewer',
    pollIntervalMs: 800,  // LIGHTNING FAST: 25% faster
    minEmailQuality: 4,  // SUPER LENIENT: 4/10
    minResearchQuality: 4,  // SUPER LENIENT: 4/10
    enabled: true
  },
  EMAIL_SENDER: {
    name: 'email-sender',
    pollIntervalMs: 1200,  // ULTRA MAXIMUM: 25% faster polling
    batchSize: 50,  // MASSIVE: 67% more per batch - send 50 at once
    dailyLimit: 5000,  // UNLIMITED SCALE: max 5000/day
    delayBetweenEmailsMs: 25,  // EXTREME SPEED: 4x faster sending (25ms between emails)
    enabled: true
  },
  INBOX: {
    name: 'inbox',
    pollIntervalMs: 10000,  // 1.5x faster
    enabled: true
  },
  LOGO_FINDER: {
    name: 'logo-finder',
    pollIntervalMs: 20000,  // 1.25x faster
    batchSize: 20,  // 33% more per batch
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
