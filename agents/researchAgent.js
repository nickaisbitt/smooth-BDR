import { getDatabase, initAgentTables, acquireQueueItem, completeQueueItem, failQueueItem } from './shared/db.js';
import { createLogger } from './shared/logger.js';
import { AgentHeartbeat } from './shared/heartbeat.js';
import { AGENT_CONFIG } from './shared/config.js';
import { conductIterativeResearch } from '../services/researchService.js';

const config = AGENT_CONFIG.RESEARCH;
const logger = createLogger(config.name);

let db = null;
let heartbeat = null;
let isRunning = false;

async function getServiceProfile() {
  return `Smooth AI Consulting provides AI automation solutions including:
- AI-powered process automation
- Custom AI chatbots and assistants
- Business intelligence and analytics
- Workflow optimization
- Document processing and analysis

We help businesses reduce operational costs by 40-60% through intelligent automation.`;
}

async function processResearchItem(item) {
  logger.info(`Starting research for: ${item.company_name}`, { url: item.website_url });
  
  const serviceProfile = await getServiceProfile();
  
  const research = await conductIterativeResearch(
    item.company_name,
    item.website_url,
    serviceProfile,
    config.targetQuality,
    config.maxPasses
  );
  
  const quality = research.researchQuality || 0;
  
  await db.run(`
    UPDATE research_queue 
    SET research_pass = ?, current_quality = ?, research_data = ?, updated_at = ?
    WHERE id = ?
  `, [research.orchestrator?.totalAttempts || 1, quality, JSON.stringify(research), Date.now(), item.id]);
  
  if (quality >= config.targetQuality) {
    await db.run(`
      INSERT INTO draft_queue (research_id, prospect_id, company_name, contact_email, contact_name, research_quality, research_data, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `, [item.id, item.prospect_id, item.company_name, item.contact_email, item.contact_name, quality, JSON.stringify(research), Date.now()]);
    
    await completeQueueItem(db, 'research_queue', item.id, 'completed');
    
    logger.info(`Research completed for ${item.company_name} with quality ${quality}/10 - moved to draft queue`);
    return { success: true, quality };
  } else {
    await completeQueueItem(db, 'research_queue', item.id, 'low_quality', {
      current_quality: quality,
      last_error: `Research quality ${quality}/10 below threshold ${config.targetQuality}`
    });
    
    logger.warn(`Research quality too low for ${item.company_name}: ${quality}/10 (need ${config.targetQuality}+) - NOT proceeding`);
    return { success: false, quality, reason: 'Quality below threshold' };
  }
}

async function processResearch() {
  if (!isRunning) return;
  
  try {
    const state = await db.get('SELECT is_running FROM automation_state WHERE id = 1');
    if (!state || !state.is_running) {
      return;
    }
    
    const agentEnabled = await db.get('SELECT enabled FROM agent_enabled WHERE agent_name = ?', [config.name]);
    if (agentEnabled && !agentEnabled.enabled) {
      return;
    }
    
    // PARALLEL BATCH PROCESSING: Fetch all items first, then process in parallel
    const items = [];
    for (let i = 0; i < config.batchSize; i++) {
      const item = await acquireQueueItem(db, 'research_queue', config.name);
      if (!item) break;
      items.push(item);
    }
    
    if (items.length === 0) return;
    
    // Process all items in PARALLEL using Promise.all
    const results = await Promise.all(
      items.map(async (item) => {
        heartbeat.setCurrentItem({ id: item.id, company: item.company_name });
        try {
          await processResearchItem(item);
          heartbeat.incrementProcessed();
          heartbeat.clearCurrentItem();
          return { success: true };
        } catch (error) {
          logger.error(`Research failed for ${item.company_name}`, { error: error.message });
          heartbeat.incrementErrors();
          await failQueueItem(db, 'research_queue', item.id, error.message);
          heartbeat.clearCurrentItem();
          return { success: false };
        }
      })
    );
    
    const processed = results.filter(r => r.success).length;
    if (processed > 0) {
      logger.info(`⚡ Processed ${processed} research items in PARALLEL this cycle`);
    }
    
  } catch (error) {
    logger.error('Research processing cycle failed', { error: error.message });
    heartbeat.incrementErrors();
  }
}

export async function start() {
  if (isRunning) {
    logger.warn('Agent already running');
    return;
  }
  
  db = await getDatabase();
  logger.setDatabase(db);
  await initAgentTables(db);
  
  heartbeat = new AgentHeartbeat(config.name, db);
  await heartbeat.start();
  
  isRunning = true;
  logger.info('Research Agent started');
  
  const poll = async () => {
    if (!isRunning) return;
    await processResearch();
    setTimeout(poll, config.pollIntervalMs);
  };
  
  poll();
}

export async function stop() {
  isRunning = false;
  if (heartbeat) {
    await heartbeat.stop();
  }
  logger.info('Research Agent stopped');
}

export function getStatus() {
  return {
    name: config.name,
    running: isRunning,
    processed: heartbeat?.itemsProcessed || 0,
    errors: heartbeat?.errorCount || 0
  };
}

if (process.argv[1]?.endsWith('researchAgent.js')) {
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
