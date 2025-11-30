export const AGENT_CONFIG = {
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
    targetQuality: 9,
    enabled: true
  },
  EMAIL_GENERATOR: {
    name: 'email-generator',
    pollIntervalMs: 15000,
    batchSize: 1,
    minQuality: 9,
    enabled: true
  },
  EMAIL_SENDER: {
    name: 'email-sender',
    pollIntervalMs: 60000,
    batchSize: 5,
    dailyLimit: 200,
    delayBetweenEmailsMs: 3000,
    enabled: true
  },
  INBOX: {
    name: 'inbox',
    pollIntervalMs: 30000,
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
