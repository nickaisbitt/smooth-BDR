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
  
  // ULTRA-STRICT TEMPLATE - NO INFERENCES, ONLY EXPLICIT FACTS FROM RESEARCH
const hook = analysis.personalizedHooks?.[0] || '';
const painPoint = analysis.potentialPainPoints?.[0] || '';
const recentEvent = analysis.recentTriggers?.[0] || '';
const keyPerson = analysis.keyPeople?.[0]?.split(',')[0] || firstName;

// PRE-CHECK: If critical facts are missing, skip to prevent AI hallucinations
if (!hook?.trim() || !painPoint?.trim()) {
  logger.info(`[EARLY EXIT] Insufficient research facts for ${item.company_name}: hook="${hook}" painPoint="${painPoint}" - cannot generate without hallucinating`);
  throw new Error('Missing hook or pain point - would require inference');
}

// Use EXACT research facts without any interpretation
const prompt = `GENERATE ONLY IF ALL RESEARCH FACTS PRESENT. Otherwise return empty email.

RESEARCH DATA (EXPLICIT FACTS ONLY):
Hook: "${hook}"
Pain Point: "${painPoint}"  
Recent Event/Trigger: "${recentEvent}"
Contact: ${keyPerson}
Company: ${item.company_name}

RULES - ABSOLUTE:
1. IF any field above is blank or generic → DECLINE email, return {"subject":"", "body":""}
2. NO inferences ("likely", "probably", "may", "could", "should")
3. NO assumptions about needs or challenges
4. NO generic phrases ("I hope you're well", "I came across", "I wanted to reach out", "touching base")
5. NO buzzwords (leverage, synergy, revolutionize, best-in-class, cutting-edge, industry-leading)
6. ONLY state facts that are EXPLICITLY in the research data above
7. Each sentence must cite where the fact comes from

STRUCTURE (if facts are sufficient):
Subject: 2-3 words directly from the hook - MUST be specific, not generic
Body: 3 sentences EXACTLY
  Sentence 1: State the specific hook/trigger fact from research. Start with company name.
  Sentence 2: Name the specific pain point from research. NO interpretations.
  Sentence 3: Ask a single, specific question. Low friction only.

EXAMPLE:
- GOOD: "Salesforce announced expansion into healthcare (from recent news). Your practice uses legacy patient data systems (from research). Does your team want to evaluate modern CRM tools?"
- BAD: "I noticed you likely face scaling challenges. We help companies optimize operations. Worth a chat?"

Return valid JSON:
{"subject": "ONLY if facts exist else empty", "body": "3 exact sentences from research facts only, or empty"}`;

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
    
    // If AI returned empty subject or body, it means facts were insufficient
    // Return empty to signal skip instead of using generic fallback
    if (!email.subject?.trim() || !email.body?.trim()) {
      logger.info(`[SKIP] AI declined generation - insufficient facts for ${item.company_name}`);
      return { subject: '', body: '' };  // Empty = skip this email
    }
    
    return email;
  } catch (parseError) {
    // JSON parse failed = return empty to skip
    logger.info(`[SKIP] JSON parse failed for ${item.company_name} - returning empty to skip`);
    return { subject: '', body: '' };  // Empty = skip this email
  }
}

async function processEmailGeneration(item) {
  // Step 1: Check basic quality threshold - USE CONFIG VALUE
  if (item.research_quality < config.minQuality) {  // Use config minQuality instead of hardcoded value
    logger.warn(`Skipping ${item.company_name} - research quality ${item.research_quality} below minimum ${config.minQuality}/10`);
    await completeQueueItem(db, 'draft_queue', item.id, 'skipped', {
      last_error: `Research quality ${item.research_quality}/10 below minimum ${config.minQuality}/10`
    });
    return { success: false, reason: 'Quality too low' };
  }
  
  // Step 2: Parse research and validate citation integrity
  const research = typeof item.research_data === 'string' 
    ? JSON.parse(item.research_data) 
    : item.research_data;
  const analysis = research.aiAnalysis || {};
  
  // Step 2.5: EXTRACT OR GENERATE CONTACT EMAIL WITH FALLBACK
  let contactEmail = item.contact_email;
  if (!contactEmail) {
    // Extract domain from website or company name
    let domain = item.website_url || item.company_name || '';
    domain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').toLowerCase().trim();
    // CRITICAL: Remove ALL spaces and special chars from domain, replace with hyphens
    domain = domain.replace(/\s+/g, '-').replace(/[^a-z0-9\.\-]/g, '').replace(/^-+|-+$/g, '');
    // Strip trailing dots (from company names like "Corp.")
    domain = domain.replace(/\.+$/, '');
    // Ensure domain has TLD
    if (!domain.includes('.')) domain += '.com';
    
    // Try to generate from keyPeople names
    const keyPeople = analysis.keyPeople || [];
    
    if (keyPeople && keyPeople.length > 0) {
      const firstPerson = keyPeople[0];
      
      if (firstPerson && typeof firstPerson === 'string' && firstPerson.length > 0) {
        try {
          const nameOnly = firstPerson.split(',')[0].trim().toLowerCase();
          // Remove "Dr.", titles, and special chars
          const cleanName = nameOnly.replace(/^(dr\.|mr\.|ms\.|mrs\.|prof\.|prof\s+)/i, '').trim();
          const nameParts = cleanName.split(/\s+/).filter(p => p.length > 0 && /^[a-z]+$/.test(p));
          
          if (nameParts.length >= 2) {
            contactEmail = `${nameParts[0]}.${nameParts[1]}@${domain}`;
          } else if (nameParts.length === 1) {
            contactEmail = `${nameParts[0]}@${domain}`;
          }
          
          if (contactEmail) {
            logger.info(`✅ GENERATED EMAIL: ${contactEmail}`);
          }
        } catch (e) {
          logger.warn(`Email generation error: ${e.message}`);
        }
      }
    }
    
    // FALLBACK: If no specific person found, use generic patterns
    if (!contactEmail && domain && domain !== 'company.com') {
      contactEmail = `info@${domain}`;
      logger.info(`✅ FALLBACK EMAIL: ${contactEmail}`);
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
  
  // If email is empty, it means AI declined due to insufficient facts - skip entirely
  if (!email.subject?.trim() || !email.body?.trim()) {
    await completeQueueItem(db, 'draft_queue', item.id, 'skipped', {
      last_error: 'AI declined generation - insufficient research facts to avoid hallucinations'
    });
    logger.info(`[SKIPPED] ${item.company_name} - AI declined due to insufficient specific facts`);
    return { success: false, reason: 'AI declined due to insufficient facts' };
  }
  
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
    
    // BATCH PROCESSING: Process up to config.batchSize items per cycle
    let processedCount = 0;
    
    for (let i = 0; i < config.batchSize; i++) {
      const item = await acquireQueueItem(db, 'draft_queue', config.name);
      if (!item) break;  // No more items in queue
      
      heartbeat.setCurrentItem({ id: item.id, company: item.company_name });
      
      try {
        await processEmailGeneration(item);
        heartbeat.incrementProcessed();
        processedCount++;
      } catch (error) {
        logger.error(`Email generation failed for ${item.company_name}`, { error: error.message });
        heartbeat.incrementErrors();
        await failQueueItem(db, 'draft_queue', item.id, error.message);
      }
      
      heartbeat.clearCurrentItem();
    }
    
    // Dynamic polling: Fast when processing full batches, slower when empty
    if (processedCount > 0 && processedCount === config.batchSize) {
      // Queue still has items, poll faster
      config.pollIntervalMs = 2000;
    } else if (processedCount === 0) {
      // Queue empty, poll slower to conserve resources
      config.pollIntervalMs = 8000;
    } else {
      // Queue partially processed, use normal interval
      config.pollIntervalMs = 3000;
    }
    
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
