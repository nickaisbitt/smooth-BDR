import { getDatabase, initAgentTables } from './shared/db.js';
import { createLogger } from './shared/logger.js';
import { AgentHeartbeat } from './shared/heartbeat.js';
import { AGENT_CONFIG } from './shared/config.js';

const config = AGENT_CONFIG.LOGO_FINDER;
const logger = createLogger(config.name);

let db = null;
let heartbeat = null;
let isRunning = false;

const LOGO_SEARCH_STRATEGIES = [
  (domain) => `https://logo.clearbit.com/${domain}`,
  (domain) => `https://www.google.com/s2/favicons?sz=128&domain=${domain}`,
  (domain) => `https://icons.duckduckgo.com/ip3/${domain}.ico`
];

async function findLogo(companyName, website) {
  try {
    // Validate website URL exists and is valid
    if (!website || typeof website !== 'string' || website.trim() === '') {
      return null;
    }
    
    // Ensure URL has protocol
    let url = website;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    
    const domain = new URL(url).hostname.replace('www.', '');
    
    for (const strategy of LOGO_SEARCH_STRATEGIES) {
      const logoUrl = strategy(domain);
      
      try {
        const response = await fetch(logoUrl, { method: 'HEAD', timeout: 5000 });
        if (response.ok || response.status === 200) {
          logger.info(`Found logo for ${companyName}: ${logoUrl}`);
          return logoUrl;
        }
      } catch (e) {
        // Continue to next strategy
      }
    }
    
    logger.warn(`No logo found for ${companyName}`);
    return null;
  } catch (error) {
    logger.error(`Failed to find logo for ${companyName}: ${error.message}`);
    return null;
  }
}

async function processLeads() {
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
    
    const leads = await db.all(`
      SELECT id, company_name as companyName, website_url as website FROM prospect_queue 
      WHERE (logo_url IS NULL OR logo_url = '') 
      AND website_url IS NOT NULL
      AND website_url != ''
      AND status IN ('completed', 'processing', 'pending')
      LIMIT ?
    `, [config.batchSize]);
    
    if (!leads || leads.length === 0) {
      return;
    }
    
    let processed = 0;
    
    for (const lead of leads) {
      if (!isRunning) break;
      
      try {
        heartbeat.setCurrentItem({ id: lead.id, company: lead.companyName });
        
        const logoUrl = await findLogo(lead.companyName, lead.website);
        
        if (logoUrl) {
          await db.run('UPDATE prospect_queue SET logo_url = ? WHERE id = ?', [logoUrl, lead.id]);
          logger.info(`Updated logo for prospect: ${lead.companyName}`);
        }
        
        heartbeat.incrementProcessed();
        processed++;
        
      } catch (error) {
        logger.error(`Failed to process lead ${lead.companyName}: ${error.message}`);
        heartbeat.incrementErrors();
      }
      
      heartbeat.clearCurrentItem();
      
      // Throttle requests
      await new Promise(r => setTimeout(r, 1000));
    }
    
    if (processed > 0) {
      logger.info(`Processed ${processed} leads for logos this cycle`);
    }
    
  } catch (error) {
    logger.error('Logo processing cycle failed', { error: error.message });
    heartbeat.incrementErrors();
  }
}

export async function start() {
  if (isRunning) {
    logger.warn('Agent already running');
    return;
  }
  
  db = await getDatabase();
  heartbeat = new AgentHeartbeat(db, config.name);
  
  logger.info(`${config.name} started`);
  isRunning = true;
  
  const interval = setInterval(() => {
    if (!isRunning) {
      clearInterval(interval);
    }
    processLeads().catch(error => {
      logger.error('Cycle error', { error: error.message });
    });
  }, config.pollIntervalMs);
  
  await processLeads();
}

process.on('SIGTERM', () => {
  isRunning = false;
  logger.warn('Shutting down');
  process.exit(0);
});

start().catch(error => {
  logger.error('Fatal error', { error: error.message });
  process.exit(1);
});
