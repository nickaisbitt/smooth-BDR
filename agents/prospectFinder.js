import { getDatabase, initAgentTables, acquireQueueItem, completeQueueItem, failQueueItem } from './shared/db.js';
import { createLogger } from './shared/logger.js';
import { AgentHeartbeat } from './shared/heartbeat.js';
import { AGENT_CONFIG } from './shared/config.js';

const config = AGENT_CONFIG.PROSPECT_FINDER;
const logger = createLogger(config.name);

let db = null;
let heartbeat = null;
let isRunning = false;

async function moveProspectToResearchQueue(prospect) {
  const now = Date.now();
  
  await db.run(`
    INSERT INTO research_queue (prospect_id, company_name, website_url, contact_email, contact_name, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `, [prospect.id, prospect.company_name, prospect.website_url, prospect.contact_email, prospect.contact_name, now]);
  
  await completeQueueItem(db, 'prospect_queue', prospect.id, 'completed');
  
  logger.info(`Moved prospect to research queue: ${prospect.company_name}`);
}

async function processProspects() {
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
    
    let processed = 0;
    
    while (processed < config.batchSize && isRunning) {
      const prospect = await acquireQueueItem(db, 'prospect_queue', config.name);
      
      if (!prospect) break;
      
      heartbeat.setCurrentItem({ id: prospect.id, company: prospect.company_name });
      
      try {
        // VALIDATION: Skip placeholder/bad data
        if (!prospect.website_url) {
          logger.warn(`Skipping prospect without website: ${prospect.company_name}`);
          await failQueueItem(db, 'prospect_queue', prospect.id, 'No website URL provided', 1);
          continue;
        }
        
        // VALIDATION: Skip placeholder company names and invalid URLs
        if (prospect.company_name === 'Company Name' || prospect.website_url === 'https://Website URL' || prospect.website_url.includes('Website')) {
          logger.warn(`Skipping placeholder prospect: ${prospect.company_name}`);
          await failQueueItem(db, 'prospect_queue', prospect.id, 'Placeholder data - skipped', 1);
          continue;
        }
        
        // VALIDATION: Skip invalid URLs
        try {
          new URL(prospect.website_url);
        } catch (e) {
          logger.warn(`Skipping prospect with invalid URL: ${prospect.company_name} (${prospect.website_url})`);
          await failQueueItem(db, 'prospect_queue', prospect.id, 'Invalid URL format', 1);
          continue;
        }
        
        await moveProspectToResearchQueue(prospect);
        heartbeat.incrementProcessed();
        processed++;
        
      } catch (error) {
        logger.error(`Failed to process prospect: ${prospect.company_name}`, { error: error.message });
        heartbeat.incrementErrors();
        await failQueueItem(db, 'prospect_queue', prospect.id, error.message);
      }
      
      heartbeat.clearCurrentItem();
    }
    
    if (processed > 0) {
      logger.info(`Processed ${processed} prospects this cycle`);
    }
    
  } catch (error) {
    logger.error('Prospect processing cycle failed', { error: error.message });
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
  logger.info('Prospect Finder Agent started');
  
  const poll = async () => {
    if (!isRunning) return;
    await processProspects();
    setTimeout(poll, config.pollIntervalMs);
  };
  
  poll();
}

export async function stop() {
  isRunning = false;
  if (heartbeat) {
    await heartbeat.stop();
  }
  logger.info('Prospect Finder Agent stopped');
}

export function getStatus() {
  return {
    name: config.name,
    running: isRunning,
    processed: heartbeat?.itemsProcessed || 0,
    errors: heartbeat?.errorCount || 0
  };
}

if (process.argv[1]?.endsWith('prospectFinder.js')) {
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
