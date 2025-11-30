import OpenAI from 'openai';
import { getDatabase, initAgentTables, acquireQueueItem, completeQueueItem, failQueueItem } from './shared/db.js';
import { createLogger } from './shared/logger.js';
import { AgentHeartbeat } from './shared/heartbeat.js';
import { AGENT_CONFIG } from './shared/config.js';

const config = AGENT_CONFIG.EMAIL_GENERATOR;
const logger = createLogger(config.name);

const openrouter = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY
});

let db = null;
let heartbeat = null;
let isRunning = false;

async function generatePersonalizedEmail(item) {
  const research = typeof item.research_data === 'string' 
    ? JSON.parse(item.research_data) 
    : item.research_data;
  
  const analysis = research.aiAnalysis || {};
  
  if (!analysis.companyOverview || !analysis.personalizedHooks?.length) {
    throw new Error('Insufficient research data for email generation');
  }
  
  const contactName = item.contact_name || analysis.keyPeople?.[0] || 'there';
  const firstName = contactName.split(' ')[0];
  
  const prompt = `You are an expert B2B sales email copywriter. Write a highly personalized cold email based on this research.

RECIPIENT INFO:
- Company: ${item.company_name}
- Contact: ${contactName}
- Industry: ${analysis.industryVertical || 'Unknown'}

RESEARCH FINDINGS (USE THESE SPECIFICALLY):
${analysis.companyOverview}

Key Services: ${analysis.keyServices?.join(', ') || 'Not found'}
Pain Points: ${analysis.potentialPainPoints?.join(', ') || 'Not found'}
Recent Triggers: ${analysis.recentTriggers?.join(', ') || 'None found'}

PERSONALIZED HOOKS TO USE:
${analysis.personalizedHooks?.map((h, i) => `${i + 1}. ${h}`).join('\n')}

Best Outreach Angle: ${analysis.outreachAngle || 'General AI automation'}

OUR OFFERING:
Smooth AI Consulting helps businesses implement AI automation to:
- Reduce operational costs by 40-60%
- Automate repetitive tasks
- Build custom AI solutions

SENDER:
Nick from Smooth AI Consulting

REQUIREMENTS:
1. Subject line must be personalized (mention something specific about their company)
2. Opening line MUST reference a specific finding from the research (recent news, specific service, etc.)
3. Keep it under 150 words
4. End with a soft CTA (quick chat, not a hard sell)
5. Sound human, not salesy
6. NO generic phrases like "I hope this email finds you well" or "I came across your company"

Return JSON only:
{
  "subject": "Personalized subject line",
  "body": "Full email body with line breaks as \\n"
}`;

  const response = await openrouter.chat.completions.create({
    model: "meta-llama/llama-3.3-70b-instruct",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 800
  });

  const content = response.choices[0]?.message?.content || '';
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  
  if (!jsonMatch) {
    throw new Error('Failed to parse email from AI response');
  }
  
  const email = JSON.parse(jsonMatch[0]);
  
  if (!email.subject || !email.body) {
    throw new Error('Invalid email format from AI');
  }
  
  return email;
}

async function processEmailGeneration(item) {
  if (item.research_quality < config.minQuality) {
    logger.warn(`Skipping ${item.company_name} - research quality ${item.research_quality} below minimum ${config.minQuality}`);
    await completeQueueItem(db, 'draft_queue', item.id, 'skipped', {
      last_error: `Research quality ${item.research_quality} below minimum ${config.minQuality}`
    });
    return { success: false, reason: 'Quality too low' };
  }
  
  logger.info(`Generating email for: ${item.company_name} (quality: ${item.research_quality}/10)`);
  
  const email = await generatePersonalizedEmail(item);
  
  await db.run(`
    UPDATE draft_queue 
    SET email_subject = ?, email_body = ?, generated_at = ?, updated_at = ?
    WHERE id = ?
  `, [email.subject, email.body, Date.now(), Date.now(), item.id]);
  
  if (item.contact_email) {
    await db.run(`
      INSERT INTO email_queue (lead_id, lead_name, to_email, subject, body, scheduled_for, status, created_at, research_quality)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `, [
      item.lead_id || `prospect_${item.prospect_id}`,
      item.company_name,
      item.contact_email,
      email.subject,
      email.body,
      Date.now(),
      Date.now(),
      item.research_quality
    ]);
    
    await completeQueueItem(db, 'draft_queue', item.id, 'queued');
    logger.info(`Email generated and queued for ${item.company_name}`);
  } else {
    await completeQueueItem(db, 'draft_queue', item.id, 'draft_ready');
    logger.info(`Email generated for ${item.company_name} (no contact email - saved as draft)`);
  }
  
  return { success: true, email };
}

async function processEmails() {
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
    
    const item = await acquireQueueItem(db, 'draft_queue', config.name);
    
    if (!item) return;
    
    heartbeat.setCurrentItem({ id: item.id, company: item.company_name });
    
    try {
      await processEmailGeneration(item);
      heartbeat.incrementProcessed();
    } catch (error) {
      logger.error(`Email generation failed for ${item.company_name}`, { error: error.message });
      heartbeat.incrementErrors();
      await failQueueItem(db, 'draft_queue', item.id, error.message);
    }
    
    heartbeat.clearCurrentItem();
    
  } catch (error) {
    logger.error('Email generation cycle failed', { error: error.message });
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
  logger.info('Email Generator Agent started');
  
  const poll = async () => {
    if (!isRunning) return;
    await processEmails();
    setTimeout(poll, config.pollIntervalMs);
  };
  
  poll();
}

export async function stop() {
  isRunning = false;
  if (heartbeat) {
    await heartbeat.stop();
  }
  logger.info('Email Generator Agent stopped');
}

export function getStatus() {
  return {
    name: config.name,
    running: isRunning,
    processed: heartbeat?.itemsProcessed || 0,
    errors: heartbeat?.errorCount || 0
  };
}

if (process.argv[1]?.endsWith('emailGenerator.js')) {
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
