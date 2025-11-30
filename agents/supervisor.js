import { fork } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getDatabase, initAgentTables, getQueueStats } from './shared/db.js';
import { getAgentStatuses } from './shared/heartbeat.js';
import { createLogger } from './shared/logger.js';
import { AGENT_CONFIG } from './shared/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logger = createLogger('supervisor');

const agents = {};
let db = null;
let isRunning = false;

const AGENT_FILES = {
  'prospect-finder': 'prospectFinder.js',
  'research': 'researchAgent.js',
  'research-retry': 'researchRetryAgent.js',
  'email-generator': 'emailGenerator.js',
  'email-sender': 'emailSender.js',
  'inbox': 'inboxAgent.js'
};

function startAgent(agentName) {
  const agentFile = AGENT_FILES[agentName];
  if (!agentFile) {
    logger.error(`Unknown agent: ${agentName}`);
    return null;
  }
  
  const agentPath = join(__dirname, agentFile);
  
  logger.info(`Starting agent: ${agentName}`);
  
  const child = fork(agentPath, [], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    env: process.env
  });
  
  child.stdout.on('data', (data) => {
    process.stdout.write(data);
  });
  
  child.stderr.on('data', (data) => {
    process.stderr.write(data);
  });
  
  child.on('exit', (code, signal) => {
    logger.warn(`Agent ${agentName} exited with code ${code}, signal ${signal}`);
    
    if (isRunning && agents[agentName]) {
      logger.info(`Restarting agent: ${agentName} in 5 seconds...`);
      setTimeout(() => {
        if (isRunning) {
          agents[agentName] = startAgent(agentName);
        }
      }, 5000);
    }
  });
  
  child.on('error', (error) => {
    logger.error(`Agent ${agentName} error: ${error.message}`);
  });
  
  return child;
}

function stopAgent(agentName) {
  const child = agents[agentName];
  if (child) {
    logger.info(`Stopping agent: ${agentName}`);
    child.kill('SIGTERM');
    delete agents[agentName];
  }
}

export async function startAllAgents() {
  if (isRunning) {
    logger.warn('Supervisor already running');
    return;
  }
  
  db = await getDatabase();
  logger.setDatabase(db);
  await initAgentTables(db);
  
  isRunning = true;
  
  logger.info('='.repeat(50));
  logger.info('Starting Multi-Agent BDR System');
  logger.info('='.repeat(50));
  
  for (const [key, config] of Object.entries(AGENT_CONFIG)) {
    if (config.enabled) {
      agents[config.name] = startAgent(config.name);
      await new Promise(r => setTimeout(r, 500));
    } else {
      logger.info(`Agent ${config.name} is disabled`);
    }
  }
  
  logger.info(`Started ${Object.keys(agents).length} agents`);
  
  setInterval(async () => {
    if (!isRunning) return;
    
    try {
      const statuses = await getAgentStatuses(db);
      const stats = await getQueueStats(db);
      
      const healthy = statuses.filter(s => s.health === 'healthy').length;
      const stale = statuses.filter(s => s.health === 'stale').length;
      
      if (stale > 0) {
        logger.warn(`Health check: ${healthy} healthy, ${stale} stale agents`);
      }
    } catch (e) {
    }
  }, 60000);
}

export async function stopAllAgents() {
  isRunning = false;
  
  logger.info('Stopping all agents...');
  
  for (const agentName of Object.keys(agents)) {
    stopAgent(agentName);
  }
  
  logger.info('All agents stopped');
}

export async function getSystemStatus() {
  if (!db) return { running: false };
  
  try {
    const agentStatuses = await getAgentStatuses(db);
    const queueStats = await getQueueStats(db);
    
    return {
      running: isRunning,
      agents: agentStatuses,
      queues: queueStats
    };
  } catch (e) {
    return { running: isRunning, error: e.message };
  }
}

if (process.argv[1]?.endsWith('supervisor.js')) {
  startAllAgents().catch(console.error);
  
  process.on('SIGTERM', async () => {
    await stopAllAgents();
    process.exit(0);
  });
  
  process.on('SIGINT', async () => {
    await stopAllAgents();
    process.exit(0);
  });
}
