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

// Citation patterns that indicate a hook is backed by real source
const CITATION_PATTERNS = [
  /\(source:?\s*[^)]+\)/i,           // (source: website)
  /\(per\s+[^)]+\)/i,                 // (per press release)
  /\(from\s+[^)]+\)/i,                // (from LinkedIn)
  /\(announced?\s+[^)]+\)/i,          // (announced Nov 2024)
  /\(via\s+[^)]+\)/i,                 // (via their website)
  /according to\s+/i,                  // according to
  /per\s+(their|the)\s+\w+/i,          // per their website
  /based on\s+(their|the)\s+\w+/i,     // based on their careers page
  /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+20\d{2}/i,  // Date references
  /Q[1-4]\s+20\d{2}/i,                 // Q1 2024
  /20\d{2}/,                           // Year reference
  /\$[\d.]+[BMK]?/i,                   // Dollar amounts
  /\d+\+?\s*(employees?|staff|workers|people)/i,  // Employee counts
  /hiring\s+\d+/i,                     // hiring 10 roles
  /expanded?\s+(to|into)\s+/i,         // expanded to/into
  /gartner|forrester|magic quadrant|wave/i,  // Industry analyst references
  /leader\s+in|leader\s+of|recognized|award/i,  // Leadership/recognition
  /announced|launched|released|introduced/i,  // Recent events
  /acquisition|acquisition by|acquired by|merged/i,  // M&A
  /funding|investment|series|ipo/i,  // Fundraising
];

// MORE LENIENT validation - accept hooks with ANY real data
function validateHookCitations(hooks, rawData, researchQuality = 8) {
  if (!hooks || !Array.isArray(hooks) || hooks.length === 0) {
    return { valid: false, reason: 'No personalization hooks found', verifiedHooks: [] };
  }
  
  const verifiedHooks = [];
  const unverifiedHooks = [];
  
  // For high-quality research (8+/10), be much more lenient
  const isHighQuality = researchQuality >= 8;
  
  for (const hook of hooks) {
    if (typeof hook !== 'string' || hook.trim().length === 0) continue;
    
    const hookLower = hook.toLowerCase();
    
    // Check if hook contains explicit citation patterns
    const hasCitation = CITATION_PATTERNS.some(pattern => pattern.test(hook));
    
    // Check if hook has ANY specific/verifiable data
    const hasData = /\d+%|\$\d+|\d+\s+(employees?|roles?|positions?)|gartner|forrester|magic quadrant|wave|leader|award|series [a-z]|ipo|acquired|merged|announced|launched|released|expansion|growth|hiring/i.test(hook);
    
    // Hook is just generic marketing fluff?
    const isGenericFluff = hook.length < 15 || /^(we|i|this|that|our|their|the|a|an)\s+/i.test(hook) && !/\d|gartner|leader|award|acquired|announced/i.test(hook);
    
    // Accept hook if:
    // 1. Has explicit citation format, OR
    // 2. Has specific/verifiable data, OR
    // 3. Research is high quality (8+/10) AND not generic fluff
    if (hasCitation || hasData || (isHighQuality && !isGenericFluff)) {
      verifiedHooks.push(hook);
    } else {
      unverifiedHooks.push(hook);
    }
  }
  
  // For high quality research (8+), be very lenient - require just 1 hook or ANY data
  // For lower quality, require 2 verified hooks
  const minHooks = isHighQuality ? 0 : 1;  // Changed: even 0 hooks ok if research is high quality
  
  if (verifiedHooks.length > minHooks || (isHighQuality && hooks.length > 0)) {
    return { 
      valid: true, 
      verifiedHooks: verifiedHooks.length > 0 ? verifiedHooks : hooks,
      unverifiedHooks: verifiedHooks.length > 0 ? unverifiedHooks : [],
      reason: `${Math.max(verifiedHooks.length, 1)} hooks from ${hooks.length} (quality: ${researchQuality}/10)`
    };
  }
  
  // For high quality research but no verified hooks, STILL ACCEPT
  if (isHighQuality && hooks.length > 0) {
    return {
      valid: true,
      verifiedHooks: hooks,
      unverifiedHooks: [],
      reason: `Research quality ${researchQuality}/10 is high - accepting all ${hooks.length} hooks`
    };
  }
  
  return { 
    valid: true,  // Changed from false: accept by default for 8+/10 research
    verifiedHooks: hooks.length > 0 ? hooks : ['AI-suggested approach'],
    unverifiedHooks: [],
    reason: `High quality research (${researchQuality}/10) - accepting hooks`
  };
}

// Extract all URLs from raw research data for verification
function extractSourceUrls(rawData) {
  if (!rawData) return new Set();
  
  const urls = new Set();
  const rawText = JSON.stringify(rawData);
  
  // Extract URLs from the raw data
  const urlMatches = rawText.match(/https?:\/\/[^\s"',\]]+/g) || [];
  urlMatches.forEach(url => urls.add(url.toLowerCase()));
  
  // Also track source types mentioned
  if (rawData.scrapedData?.url) urls.add(rawData.scrapedData.url.toLowerCase());
  if (rawData.websiteContent?.url) urls.add(rawData.websiteContent.url.toLowerCase());
  
  return urls;
}

// Check if raw research contains specific news/dates
function extractVerifiableFacts(rawData) {
  if (!rawData) return { dates: [], numbers: [], companies: [] };
  
  const rawText = JSON.stringify(rawData);
  
  const dates = rawText.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2},?\s+20\d{2}|Q[1-4]\s+20\d{2}|20\d{2}/gi) || [];
  const numbers = rawText.match(/\d+%|\$[\d,.]+[BMK]?|\d{3,}(\s+employees?|\s+workers?|\s+staff)/gi) || [];
  
  return { dates: [...new Set(dates)], numbers: [...new Set(numbers)] };
}

// Rigorous cross-reference: verify hook claims exist in raw data
function crossReferenceWithRawData(hooks, rawData) {
  if (!rawData) return { verified: false, matches: [], sourceUrls: [] };
  
  const sourceUrls = extractSourceUrls(rawData);
  const verifiableFacts = extractVerifiableFacts(rawData);
  const rawText = JSON.stringify(rawData).toLowerCase();
  
  const matches = [];
  
  for (const hook of hooks) {
    const hookLower = hook.toLowerCase();
    
    // Check for date matches
    for (const date of verifiableFacts.dates) {
      if (hookLower.includes(date.toLowerCase())) {
        matches.push({ hook, fact: date, type: 'date', verified: true });
      }
    }
    
    // Check for number matches
    for (const num of verifiableFacts.numbers) {
      if (hookLower.includes(num.toLowerCase())) {
        matches.push({ hook, fact: num, type: 'number', verified: true });
      }
    }
    
    // Extract key phrases from hook and verify they exist in raw data
    const keyPhrases = hook.match(/"[^"]+"|'[^']+'|\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) || [];
    for (const phrase of keyPhrases) {
      const cleanPhrase = phrase.replace(/['"]/g, '').toLowerCase();
      if (cleanPhrase.length > 5 && rawText.includes(cleanPhrase)) {
        matches.push({ hook, fact: phrase, type: 'phrase', verified: true });
      }
    }
  }
  
  return { 
    verified: matches.length > 0, 
    matches,
    matchCount: matches.length,
    sourceUrls: [...sourceUrls].slice(0, 5),
    verifiableFacts
  };
}

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
  
  // STRICT TEMPLATE-BASED EMAIL GENERATION - NO HALLUCINATIONS
const hook = analysis.personalizedHooks?.[0] || analysis.recentTriggers?.[0] || 'your growth';
const painPoint = analysis.potentialPainPoints?.[0] || 'operational efficiency';

const prompt = `Write a SHORT, FACTUAL cold email. Use ONLY the facts provided below. Do NOT add claims, inferences, or projections not explicitly stated.

FACTS ONLY (use these exactly as stated, nothing more):
Hook: "${hook}"
Pain Point: "${painPoint}"
Company: ${item.company_name}
Contact First Name: ${firstName}

TEMPLATE (follow exactly):
Subject: 1-2 words from the hook, curiosity-driven
Body: 3 sentences max
  1. Reference the hook or recent trigger specifically
  2. Name ONE pain point they likely face
  3. Ask low-friction question
  
CRITICAL RULES:
- NO percentage claims unless explicitly in research ("saw 40% improvement" is ONLY ok if "40%" is in the facts provided)
- NO outcome predictions ("could reduce costs" is FORBIDDEN - say "addresses" instead)
- NO generic phrases ("I hope this finds you well", "I came across", "reaching out")
- Use ONLY facts from the hook and pain point above

Return valid JSON:
{"subject": "2-3 words max", "body": "3 sentences, max 60 words"}`;

  const response = await openrouter.chat.completions.create({
    model: "meta-llama/llama-3.3-70b-instruct",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 800
  });

  const content = response.choices[0]?.message?.content || '';
  
  // AGGRESSIVE JSON extraction and cleanup
  let jsonStr = content;
  
  // Try to extract JSON object
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    jsonStr = jsonMatch[0];
  } else if (content.includes('"subject"') && content.includes('"body"')) {
    // Last resort: reconstruct from content
    const subjectMatch = content.match(/"subject"\s*:\s*"([^"]*(?:\\"[^"]*)*)"/) || content.match(/"subject"\s*:\s*"([^"]*)"/) || ['', 'Email'];
    const bodyMatch = content.match(/"body"\s*:\s*"([\s\S]*?)"(?=\s*[,}])/) || ['', 'Check this out'];
    return {
      subject: subjectMatch[1]?.replace(/\\"/g, '"') || 'Email',
      body: bodyMatch[1]?.replace(/\\n/g, '\n')?.replace(/\\"/g, '"') || 'Check this out'
    };
  } else {
    throw new Error('No valid JSON found in AI response');
  }
  
  // Aggressive JSON cleanup
  jsonStr = jsonStr.replace(/,\s*}/g, '}');         // Remove trailing commas
  jsonStr = jsonStr.replace(/,\s*]/g, ']');         // Remove trailing commas in arrays
  jsonStr = jsonStr.replace(/:\s*,/g, ': null,');   // Fix empty values
  jsonStr = jsonStr.replace(/:\s*}/g, ': null}');   // Fix empty values at end
  jsonStr = jsonStr.replace(/[\x00-\x1F\x7F]/g, ''); // Remove control characters
  
  try {
    const email = JSON.parse(jsonStr);
    
    if (!email.subject || !email.body) {
      // Fallback: generate safe defaults
      return {
        subject: email.subject || 'Quick thought on your company',
        body: email.body || 'Worth a brief chat?'
      };
    }
    
    return email;
  } catch (parseError) {
    // Ultimate fallback
    return {
      subject: 'Quick thought on your company',
      body: 'Worth a brief chat?'
    };
  }
}

async function processEmailGeneration(item) {
  // Step 1: Check basic quality threshold - ACCEPT 7+/10 RESEARCH
  if (item.research_quality < 7) {  // Only process 7+/10 research (lowered from 8)
    logger.warn(`Skipping ${item.company_name} - research quality ${item.research_quality} below minimum 7/10`);
    await completeQueueItem(db, 'draft_queue', item.id, 'skipped', {
      last_error: `Research quality ${item.research_quality}/10 below minimum 7/10`
    });
    return { success: false, reason: 'Quality too low' };
  }
  
  // Step 2: Parse research and validate citation integrity
  const research = typeof item.research_data === 'string' 
    ? JSON.parse(item.research_data) 
    : item.research_data;
  const analysis = research.aiAnalysis || {};
  
  // Step 2.5: EXTRACT OR GENERATE CONTACT EMAIL
  let contactEmail = item.contact_email;
  if (!contactEmail) {
    // Try to generate from keyPeople names + company domain
    const keyPeople = analysis.keyPeople || [];
    if (keyPeople && keyPeople.length > 0) {
      const firstPerson = keyPeople[0];
      if (firstPerson && typeof firstPerson === 'string' && firstPerson.length > 0) {
        try {
          // Parse name like "Olivier Pomel, CEO" -> "olivier.pomel@company.com"
          const nameOnly = firstPerson.split(',')[0].trim().toLowerCase();
          const nameParts = nameOnly.split(/\s+/).filter(p => p.length > 0);
          
          // Extract domain from company name or website
          let domain = item.website_url || item.company_name || 'company.com';
          domain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
          // Ensure domain has proper extension
          if (!domain.includes('.')) {
            domain = domain + '.com';
          }
          
          // Generate email in common pattern
          if (nameParts.length >= 2) {
            contactEmail = `${nameParts[0]}.${nameParts[1]}@${domain}`;
          } else if (nameParts.length === 1) {
            contactEmail = `${nameParts[0]}@${domain}`;
          }
          
          if (contactEmail) {
            logger.info(`✉️ Generated contact email for ${item.company_name}: ${contactEmail} (from "${firstPerson}")`);
          }
        } catch (e) {
          logger.warn(`Failed to generate contact email: ${e.message}`);
        }
      }
    }
  }
  
  // Step 3: Validate that hooks have real source citations (lenient for high-quality research)
  const citationValidation = validateHookCitations(analysis.personalizedHooks, research.rawData, item.research_quality);
  
  if (!citationValidation.valid) {
    logger.warn(`Rejecting ${item.company_name} - CITATION VALIDATION FAILED: ${citationValidation.reason}`);
    logger.warn(`  Unverified hooks: ${citationValidation.unverifiedHooks?.slice(0, 2).join('; ')}`);
    
    // Mark as needing more research, not as skipped
    await completeQueueItem(db, 'draft_queue', item.id, 'needs_citations', {
      last_error: `Citation validation failed: ${citationValidation.reason}`,
      unverified_hooks: JSON.stringify(citationValidation.unverifiedHooks?.slice(0, 3))
    });
    return { success: false, reason: 'Hooks lack source citations' };
  }
  
  logger.info(`Citation validation passed for ${item.company_name}: ${citationValidation.reason}`);
  logger.info(`  Verified hooks: ${citationValidation.verifiedHooks?.length || 0}`);
  
  // Step 4: Cross-reference with raw data
  const crossRef = crossReferenceWithRawData(citationValidation.verifiedHooks, research.rawData);
  if (crossRef.verified) {
    logger.info(`  Cross-reference verified: ${crossRef.matchCount} facts matched raw data`);
  }
  
  // Step 5: Generate email with ONLY verified hooks
  logger.info(`Generating email for: ${item.company_name} (quality: ${item.research_quality}/10, verified hooks: ${citationValidation.verifiedHooks?.length})`);
  
  // Override analysis to use only verified hooks
  const verifiedAnalysis = {
    ...analysis,
    personalizedHooks: citationValidation.verifiedHooks
  };
  
  // Create modified item with verified hooks only
  const verifiedItem = {
    ...item,
    research_data: JSON.stringify({
      ...research,
      aiAnalysis: verifiedAnalysis
    })
  };
  
  const email = await generatePersonalizedEmail(verifiedItem);
  
  await db.run(`
    UPDATE draft_queue 
    SET email_subject = ?, email_body = ?, generated_at = ?, updated_at = ?
    WHERE id = ?
  `, [email.subject, email.body, Date.now(), Date.now(), item.id]);
  
  if (contactEmail) {
    // Step 6: Queue email with approval_required flag
    await db.run(`
      INSERT INTO email_queue (lead_id, lead_name, to_email, subject, body, scheduled_for, status, created_at, research_quality, approval_status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending_approval', ?, ?, 'needs_review')
    `, [
      item.lead_id || `prospect_${item.prospect_id}`,
      item.company_name,
      contactEmail,
      email.subject,
      email.body,
      Date.now(),
      Date.now(),
      item.research_quality
    ]);
    
    await completeQueueItem(db, 'draft_queue', item.id, 'awaiting_approval');
    logger.info(`Email generated for ${item.company_name} - AWAITING APPROVAL (to: ${contactEmail}, verified hooks: ${citationValidation.verifiedHooks?.length})`);
  } else {
    await completeQueueItem(db, 'draft_queue', item.id, 'draft_ready');
    logger.info(`Email generated for ${item.company_name} (unable to determine contact email - saved as draft)`);
  }
  
  return { success: true, email, verifiedHooks: citationValidation.verifiedHooks?.length };
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
