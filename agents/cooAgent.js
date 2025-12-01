import { getDatabase, initAgentTables, getQueueStats } from './shared/db.js';
import { createLogger } from './shared/logger.js';
import { AgentHeartbeat } from './shared/heartbeat.js';

const config = {
  name: 'coo',
  pollIntervalMs: 15000
};

const logger = createLogger(config.name);

let db = null;
let heartbeat = null;
let isRunning = false;

// Track agent performance metrics over time
const agentMetrics = {};

async function getAgentStatuses() {
  try {
    const statuses = await db.all(`
      SELECT agent_name, heartbeats, processed, errors, last_activity, current_item
      FROM agent_activity
      WHERE last_activity > ?
      ORDER BY agent_name
    `, [Date.now() - 300000]); // Last 5 minutes
    
    return statuses || [];
  } catch (e) {
    return [];
  }
}

async function analyzeSystemHealth() {
  try {
    const queues = await getQueueStats(db);
    const agents = await getAgentStatuses();
    
    const report = {
      timestamp: Date.now(),
      queues,
      agents,
      bottlenecks: [],
      recommendations: [],
      systemHealth: 'HEALTHY'
    };
    
    // Analyze queue depths
    if (queues.prospect?.pending > 20) {
      report.bottlenecks.push({
        queue: 'prospect',
        issue: 'High prospect backlog',
        pending: queues.prospect.pending,
        recommendation: 'Spawn additional prospect-finder agents'
      });
    }
    
    if (queues.research?.pending > 50) {
      report.bottlenecks.push({
        queue: 'research',
        issue: 'High research backlog',
        pending: queues.research.pending,
        recommendation: 'Spawn additional research agents'
      });
    }
    
    if (queues.draft?.pending > 30) {
      report.bottlenecks.push({
        queue: 'draft',
        issue: 'Email generation backlog',
        pending: queues.draft.pending,
        recommendation: 'Spawn additional email-generator agents'
      });
    }
    
    // Analyze agent performance
    const slowAgents = agents.filter(a => {
      const metricsKey = a.agent_name;
      const prevMetrics = agentMetrics[metricsKey];
      
      if (prevMetrics) {
        const processed = a.processed - prevMetrics.processed;
        const timeElapsed = (a.last_activity - prevMetrics.timestamp) / 1000; // seconds
        const throughput = processed / (timeElapsed / 60); // items per minute
        
        if (throughput < 1) {
          return true; // Slow agent
        }
      }
      
      agentMetrics[metricsKey] = { ...a, timestamp: Date.now() };
      return false;
    });
    
    if (slowAgents.length > 0) {
      report.bottlenecks.push({
        issue: 'Slow agents detected',
        agents: slowAgents.map(a => a.agent_name),
        recommendation: 'Monitor and consider scaling slow agents'
      });
    }
    
    // Overall system health
    const totalBacklog = (queues.prospect?.pending || 0) + 
                        (queues.research?.pending || 0) + 
                        (queues.draft?.pending || 0);
    
    if (totalBacklog > 100) {
      report.systemHealth = 'STRESSED';
    } else if (totalBacklog > 50) {
      report.systemHealth = 'BUSY';
    }
    
    return report;
  } catch (error) {
    logger.error('Failed to analyze system health', { error: error.message });
    return null;
  }
}

async function storeHealthReport(report) {
  try {
    await db.run(`
      INSERT INTO coo_health_reports (timestamp, report_data, system_health, bottleneck_count)
      VALUES (?, ?, ?, ?)
    `, [
      report.timestamp,
      JSON.stringify(report),
      report.systemHealth,
      report.bottlenecks.length
    ]);
  } catch (e) {
    // Table might not exist yet, that's ok
  }
}

async function monitorSystem() {
  if (!isRunning) return;
  
  try {
    const state = await db.get('SELECT is_running FROM automation_state WHERE id = 1');
    if (!state || !state.is_running) {
      return;
    }
    
    const report = await analyzeSystemHealth();
    
    if (report) {
      await storeHealthReport(report);
      
      logger.info(`System Health: ${report.systemHealth}`);
      logger.info(`  Queues: Prospect=${report.queues.prospect?.pending || 0}, Research=${report.queues.research?.pending || 0}, Draft=${report.queues.draft?.pending || 0}, Email=${report.queues.email?.pending || 0}`);
      
      if (report.bottlenecks.length > 0) {
        logger.warn(`Bottlenecks detected (${report.bottlenecks.length}):`);
        for (const bottleneck of report.bottlenecks) {
          logger.warn(`  - ${bottleneck.issue}: ${bottleneck.recommendation}`);
        }
      }
      
      // Log agent status
      if (report.agents && report.agents.length > 0) {
        logger.info(`Active Agents: ${report.agents.length}`);
        for (const agent of report.agents) {
          logger.info(`  - ${agent.agent_name}: processed=${agent.processed}, errors=${agent.errors}, active=${agent.current_item ? 'YES' : 'NO'}`);
        }
      }
      
      heartbeat.incrementProcessed();
    }
  } catch (error) {
    logger.error('Monitoring cycle failed', { error: error.message });
    heartbeat.incrementErrors();
  }
}

export async function start() {
  if (isRunning) {
    logger.warn('COO Agent already running');
    return;
  }
  
  db = await getDatabase();
  logger.setDatabase(db);
  await initAgentTables(db);
  
  heartbeat = new AgentHeartbeat(config.name, db);
  await heartbeat.start();
  
  isRunning = true;
  logger.info('COO Agent started - monitoring system health and performance');
  
  const poll = async () => {
    if (!isRunning) return;
    await monitorSystem();
    setTimeout(poll, config.pollIntervalMs);
  };
  
  poll();
}

export async function stop() {
  isRunning = false;
  if (heartbeat) {
    await heartbeat.stop();
  }
  logger.info('COO Agent stopped');
}

export function getStatus() {
  return {
    name: config.name,
    running: isRunning,
    processed: heartbeat?.itemsProcessed || 0,
    errors: heartbeat?.errorCount || 0
  };
}

if (process.argv[1]?.endsWith('cooAgent.js')) {
  start().catch(console.error);
  
  process.on('SIGTERM', async () => {
    await stop();
    process.exit(0);
  });
  
  process.on('SIGINT', async () => {
    await stop();
    process.exit(0);
  });
}
