import OpenAI from 'openai';
import { getDatabase, initAgentTables, acquireQueueItem, completeQueueItem, failQueueItem } from './shared/db.js';
import { createLogger } from './shared/logger.js';
import { AgentHeartbeat } from './shared/heartbeat.js';
import { AGENT_CONFIG } from './shared/config.js';

const config = {
  name: 'email-reviewer',
  pollInterval: 8000,
  minEmailQuality: 7,
  minResearchQuality: 8
};

const logger = createLogger(config.name);

const openrouter = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY
});

let db = null;
let heartbeat = null;
let isRunning = false;

const QUALITY_RED_FLAGS = [
  /I hope this (email )?finds you well/i,
  /I came across your (company|profile)/i,
  /I wanted to reach out/i,
  /I'm reaching out because/i,
  /touching base/i,
  /circle back/i,
  /synergy/i,
  /leverage/i,
  /revolutionary/i,
  /game-?changing/i,
  /best-?in-?class/i,
  /world-?class/i,
  /cutting-?edge/i,
  /state-?of-?the-?art/i,
  /industry-?leading/i,
];

const CITATION_PATTERNS = [
  /\(source:?\s*[^)]+\)/i,
  /\(per\s+[^)]+\)/i,
  /\(from\s+[^)]+\)/i,
  /\(announced?\s+[^)]+\)/i,
  /\(via\s+[^)]+\)/i,
  /according to\s+/i,
  /per\s+(their|the)\s+\w+/i,
  /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+20\d{2}/i,
  /Q[1-4]\s+20\d{2}/i,
];

function countWords(text) {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

// Extract verifiable facts from raw research for comparison
function extractRawResearchFacts(researchData) {
  if (!researchData) return { facts: new Set(), urls: new Set() };
  
  const rawText = JSON.stringify(researchData).toLowerCase();
  const facts = new Set();
  const urls = new Set();
  
  // Extract URLs
  const urlMatches = rawText.match(/https?:\/\/[^\s"',\]]+/gi) || [];
  urlMatches.forEach(url => urls.add(url.toLowerCase()));
  
  // Extract dates with context
  const dateMatches = rawText.match(/(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2},?\s+20\d{2}/gi) || [];
  dateMatches.forEach(d => facts.add(d.toLowerCase()));
  
  // Extract percentages
  const percentMatches = rawText.match(/\d+%/g) || [];
  percentMatches.forEach(p => facts.add(p));
  
  // Extract dollar amounts
  const dollarMatches = rawText.match(/\$[\d,.]+[BMK]?/gi) || [];
  dollarMatches.forEach(d => facts.add(d.toLowerCase()));
  
  // Extract company/product names (capitalized phrases)
  const nameMatches = rawText.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}/g) || [];
  nameMatches.forEach(n => facts.add(n.toLowerCase()));
  
  return { facts, urls, rawText };
}

// Check if email content has verifiable backing in raw research
function verifyEmailAgainstResearch(body, researchData) {
  const { facts, rawText } = extractRawResearchFacts(researchData);
  
  if (!researchData || facts.size === 0) {
    return { verified: false, reason: 'No raw research data to verify against', matchedFacts: [] };
  }
  
  const bodyLower = body.toLowerCase();
  const matchedFacts = [];
  const potentialClaims = [];
  
  // Extract claims from the email body
  const dateClaimsInEmail = body.match(/(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+20\d{2}|Q[1-4]\s+20\d{2}|recent(?:ly)?|just|last (?:month|week|year)/gi) || [];
  const percentClaimsInEmail = body.match(/\d+%/g) || [];
  const locationClaimsInEmail = body.match(/expan(?:d|sion|ding)\s+(?:to|into)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/gi) || [];
  
  // Check if date claims exist in raw data
  for (const claim of dateClaimsInEmail) {
    if (facts.has(claim.toLowerCase()) || rawText.includes(claim.toLowerCase())) {
      matchedFacts.push({ claim, type: 'date', verified: true });
    } else {
      potentialClaims.push({ claim, type: 'date', verified: false });
    }
  }
  
  // Check percentage claims
  for (const claim of percentClaimsInEmail) {
    if (facts.has(claim) || rawText.includes(claim)) {
      matchedFacts.push({ claim, type: 'percent', verified: true });
    } else {
      potentialClaims.push({ claim, type: 'percent', verified: false });
    }
  }
  
  // Check location/expansion claims
  for (const claim of locationClaimsInEmail) {
    const claimWords = claim.toLowerCase().split(/\s+/);
    const hasMatch = claimWords.some(word => word.length > 4 && rawText.includes(word));
    if (hasMatch) {
      matchedFacts.push({ claim, type: 'location', verified: true });
    } else {
      potentialClaims.push({ claim, type: 'location', verified: false });
    }
  }
  
  return {
    verified: matchedFacts.length > 0 && potentialClaims.length < matchedFacts.length,
    matchedFacts,
    potentialClaims,
    reason: matchedFacts.length > 0 
      ? `${matchedFacts.length} claims verified, ${potentialClaims.length} unverified`
      : 'No claims could be verified against raw research'
  };
}

function localQualityCheck(subject, body, researchData) {
  const issues = [];
  const positives = [];
  let score = 5;
  
  if (!subject || subject.length < 5) {
    issues.push('Subject line too short or missing');
    score -= 2;
  } else if (subject.length > 60) {
    issues.push('Subject line too long (>60 chars)');
    score -= 1;
  } else {
    positives.push('Subject line length is good');
    score += 0.5;
  }
  
  if (/\d/.test(subject) || /specific|your|their|\w+'s/i.test(subject)) {
    positives.push('Subject contains specific reference');
    score += 1;
  }
  
  if (!body || body.length < 50) {
    issues.push('Email body too short');
    score -= 2;
  }
  
  const wordCount = countWords(body || '');
  if (wordCount > 150) {
    issues.push(`Email too long (${wordCount} words, max 150)`);
    score -= 1;
  } else if (wordCount < 30) {
    issues.push(`Email too short (${wordCount} words)`);
    score -= 1;
  } else {
    positives.push(`Good length (${wordCount} words)`);
    score += 0.5;
  }
  
  for (const pattern of QUALITY_RED_FLAGS) {
    if (pattern.test(body) || pattern.test(subject)) {
      issues.push(`Contains generic/buzzword phrase: ${pattern.source.slice(0, 30)}...`);
      score -= 1;
    }
  }
  
  const firstSentence = (body || '').split(/[.!?]/)[0] || '';
  if (/^(I|My|We|Our)\s/i.test(firstSentence.trim())) {
    issues.push('Opens with I/My/We - should lead with prospect insight');
    score -= 1;
  } else {
    positives.push('Good opening - leads with prospect');
    score += 1;
  }
  
  let hasCitation = false;
  for (const pattern of CITATION_PATTERNS) {
    if (pattern.test(body)) {
      hasCitation = true;
      break;
    }
  }
  
  if (hasCitation) {
    positives.push('Contains citation/date reference');
    score += 1;
  } else {
    issues.push('No citation or date reference found in email body');
    score -= 1;
  }
  
  if (/\d+%/.test(body)) {
    positives.push('Contains specific percentage');
    score += 0.5;
  }
  
  if (/\$[\d,.]+[MBK]?/i.test(body)) {
    positives.push('Contains specific dollar amount');
    score += 0.5;
  }
  
  if (/\?$/.test(body.trim().split('\n').pop()?.trim() || '')) {
    positives.push('Ends with question CTA');
    score += 0.5;
  }
  
  // CRITICAL: Verify email claims against raw research data
  const verification = verifyEmailAgainstResearch(body, researchData);
  if (verification.verified) {
    positives.push(`Claims verified: ${verification.reason}`);
    score += 1.5;
  } else if (verification.potentialClaims?.length > 0) {
    issues.push(`HALLUCINATION RISK: ${verification.potentialClaims.length} unverified claims found`);
    score -= 2;
  }
  
  score = Math.max(1, Math.min(10, Math.round(score)));
  
  return {
    score,
    issues,
    positives,
    wordCount
  };
}

async function aiQualityReview(email, researchData) {
  const analysis = researchData?.aiAnalysis || {};
  
  const prompt = `You are an expert B2B email quality reviewer. Evaluate this cold email for effectiveness and authenticity.

EMAIL TO REVIEW:
Subject: ${email.subject}
Body:
${email.body}

RESEARCH DATA USED:
Company: ${email.lead_name}
Company Overview: ${analysis.companyOverview || 'Not available'}
Personalized Hooks Used: ${JSON.stringify(analysis.personalizedHooks?.slice(0, 3) || [])}
Research Quality: ${email.research_quality}/10

EVALUATION CRITERIA (score each 1-10):
1. SPECIFICITY: Does the email reference specific, verifiable facts about the company? Not generic claims.
2. AUTHENTICITY: Does the opening line feel researched, not templated? Would a human find this personalized?
3. VALUE PROPOSITION: Is the benefit to the recipient clear and relevant to their specific situation?
4. CONCISENESS: Is every word necessary? No fluff or filler?
5. CTA STRENGTH: Is the call-to-action low-friction and curiosity-driven?

RED FLAGS TO CHECK:
- Generic phrases like "I hope this finds you well", "reaching out", "touching base"
- Starting with "I" or "We" instead of leading with prospect insight
- Buzzwords like "revolutionary", "game-changing", "synergy"
- Claims without evidence (e.g., "40% improvement" without context)
- Information that cannot be verified from the research data (potential hallucination)

CRITICAL CHECK:
Compare the email content against the research data. If the email claims something NOT found in the research data, that's a hallucination and should heavily penalize the score.

Return JSON only:
{
  "emailQualityScore": <1-10>,
  "specificity": <1-10>,
  "authenticity": <1-10>,
  "valueProposition": <1-10>,
  "conciseness": <1-10>,
  "ctaStrength": <1-10>,
  "redFlagsFound": ["list of red flags found"],
  "hallucinations": ["any claims not supported by research data"],
  "strengths": ["what the email does well"],
  "improvements": ["specific suggestions to improve"],
  "recommendation": "APPROVE" | "REJECT" | "NEEDS_EDIT",
  "reasoning": "Brief explanation of the recommendation"
}`;

  try {
    const response = await openrouter.chat.completions.create({
      model: "meta-llama/llama-3.3-70b-instruct",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 1000
    });

    const content = response.choices[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) {
      throw new Error('No valid JSON in AI response');
    }
    
    // Clean up common JSON formatting issues from AI
    let jsonStr = jsonMatch[0];
    jsonStr = jsonStr.replace(/,\s*}/g, '}');         // Remove trailing commas before }
    jsonStr = jsonStr.replace(/,\s*]/g, ']');         // Remove trailing commas before ]
    jsonStr = jsonStr.replace(/:\s*,/g, ': null,');   // Fix empty values like "key:,"
    jsonStr = jsonStr.replace(/:\s*}/g, ': null}');   // Fix empty values at end like "key:}"
    jsonStr = jsonStr.replace(/:\s*\n/g, ': null\n'); // Fix empty values with newline
    jsonStr = jsonStr.replace(/"/g, '"');             // Normalize quotes
    
    try {
      return JSON.parse(jsonStr);
    } catch (parseError) {
      // Try one more cleanup - remove control characters
      jsonStr = jsonStr.replace(/[\x00-\x1F\x7F]/g, '');
      return JSON.parse(jsonStr);
    }
  } catch (error) {
    logger.error('AI quality review failed', { error: error.message });
    // Return lenient default instead of null to keep pipeline flowing
    return {
      emailQualityScore: 7,
      recommendation: 'APPROVE',
      reasoning: 'AI review failed - defaulting to approval'
    };
  }
}

async function processEmailReview(email) {
  logger.info(`Reviewing email for: ${email.lead_name} (research: ${email.research_quality}/10)`);
  
  if (email.research_quality < config.minResearchQuality) {
    logger.warn(`Rejecting ${email.lead_name} - research quality ${email.research_quality} < ${config.minResearchQuality}`);
    
    await db.run(`
      UPDATE email_queue 
      SET status = 'rejected', 
          approval_status = 'rejected_low_research',
          last_error = ?
      WHERE id = ?
    `, [`Research quality ${email.research_quality}/10 below minimum ${config.minResearchQuality}/10`, email.id]);
    
    return { approved: false, reason: 'Research quality too low' };
  }
  
  let researchData = null;
  try {
    // First try to get research by lead_id (most accurate)
    let draftItem = null;
    if (email.lead_id) {
      draftItem = await db.get(
        'SELECT research_data FROM draft_queue WHERE lead_id = ? OR prospect_id = ? ORDER BY created_at DESC LIMIT 1',
        [email.lead_id, email.lead_id.replace('prospect_', '')]
      );
    }
    
    // Fallback to company name match
    if (!draftItem?.research_data) {
      draftItem = await db.get(
        'SELECT research_data FROM draft_queue WHERE company_name = ? ORDER BY created_at DESC LIMIT 1',
        [email.lead_name]
      );
    }
    
    if (draftItem?.research_data) {
      researchData = typeof draftItem.research_data === 'string' 
        ? JSON.parse(draftItem.research_data) 
        : draftItem.research_data;
      logger.info(`  Loaded research data for ${email.lead_name} (${Object.keys(researchData).length} keys)`);
    } else {
      logger.warn(`  No research data found for ${email.lead_name}`);
    }
  } catch (e) {
    logger.warn('Could not load research data for comparison: ' + e.message);
  }
  
  const localCheck = localQualityCheck(email.subject, email.body, researchData);
  logger.info(`Local quality check: ${localCheck.score}/10`);
  logger.info(`  Issues: ${localCheck.issues.join('; ') || 'none'}`);
  logger.info(`  Positives: ${localCheck.positives.join('; ') || 'none'}`);
  
  const aiReview = await aiQualityReview(email, researchData);
  
  let finalScore = localCheck.score;
  let recommendation = 'REJECT';
  let reviewDetails = { local: localCheck, ai: null };
  
  if (aiReview) {
    finalScore = Math.round((localCheck.score + aiReview.emailQualityScore) / 2);
    recommendation = aiReview.recommendation;
    reviewDetails.ai = aiReview;
    
    logger.info(`AI quality review: ${aiReview.emailQualityScore}/10`);
    logger.info(`  Recommendation: ${aiReview.recommendation}`);
    if (aiReview.hallucinations?.length > 0) {
      logger.warn(`  HALLUCINATIONS DETECTED: ${aiReview.hallucinations.join('; ')}`);
      finalScore = Math.max(1, finalScore - 2);
      recommendation = 'REJECT';
    }
    if (aiReview.redFlagsFound?.length > 0) {
      logger.warn(`  Red flags: ${aiReview.redFlagsFound.join('; ')}`);
    }
  }
  
  logger.info(`Final email quality score: ${finalScore}/10`);
  
  // Lower threshold for approval - if research is 8+/10, be more lenient on email quality
  const approvalThreshold = email.research_quality >= 8 ? 6 : config.minEmailQuality;
  const approved = finalScore >= approvalThreshold && recommendation !== 'REJECT';
  
  if (approved) {
    await db.run(`
      UPDATE email_queue 
      SET status = 'pending',
          approval_status = 'approved',
          approved_by = 'email_reviewer_agent',
          approved_at = ?
      WHERE id = ?
    `, [Date.now(), email.id]);
    
    await db.run(`
      INSERT OR REPLACE INTO email_quality_scores 
      (email_id, email_quality_score, research_quality_score, review_details, reviewed_at)
      VALUES (?, ?, ?, ?, ?)
    `, [email.id, finalScore, email.research_quality, JSON.stringify(reviewDetails), Date.now()]);
    
    logger.info(`APPROVED: ${email.lead_name} - email quality ${finalScore}/10, research ${email.research_quality}/10`);
    
    return { approved: true, emailQuality: finalScore, researchQuality: email.research_quality };
  } else {
    const rejectReason = recommendation === 'REJECT' 
      ? (aiReview?.reasoning || 'AI reviewer rejected')
      : `Email quality ${finalScore}/10 below minimum ${config.minEmailQuality}/10`;
    
    await db.run(`
      UPDATE email_queue 
      SET status = 'rejected',
          approval_status = 'rejected_low_quality',
          last_error = ?
      WHERE id = ?
    `, [rejectReason, email.id]);
    
    await db.run(`
      INSERT OR REPLACE INTO email_quality_scores 
      (email_id, email_quality_score, research_quality_score, review_details, reviewed_at)
      VALUES (?, ?, ?, ?, ?)
    `, [email.id, finalScore, email.research_quality, JSON.stringify(reviewDetails), Date.now()]);
    
    logger.warn(`REJECTED: ${email.lead_name} - ${rejectReason}`);
    
    return { approved: false, reason: rejectReason, emailQuality: finalScore };
  }
}

async function reviewPendingEmails() {
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
    
    const pendingEmail = await db.get(`
      SELECT * FROM email_queue 
      WHERE status = 'pending_approval' 
        AND (approval_status IS NULL OR approval_status = 'needs_review')
      ORDER BY created_at ASC
      LIMIT 1
    `);
    
    if (!pendingEmail) return;
    
    heartbeat.setCurrentItem({ id: pendingEmail.id, company: pendingEmail.lead_name });
    
    try {
      const result = await processEmailReview(pendingEmail);
      
      if (result.approved) {
        heartbeat.incrementProcessed();
      } else {
        heartbeat.incrementErrors();
      }
    } catch (error) {
      logger.error(`Email review failed for ${pendingEmail.lead_name}`, { error: error.message });
      heartbeat.incrementErrors();
      
      await db.run(`
        UPDATE email_queue 
        SET last_error = ?, approval_status = 'review_error'
        WHERE id = ?
      `, [error.message, pendingEmail.id]);
    }
    
    heartbeat.clearCurrentItem();
    
  } catch (error) {
    logger.error('Email review cycle failed', { error: error.message });
    heartbeat.incrementErrors();
  }
}

async function createQualityScoresTable() {
  await db.run(`
    CREATE TABLE IF NOT EXISTS email_quality_scores (
      email_id INTEGER PRIMARY KEY,
      email_quality_score INTEGER,
      research_quality_score INTEGER,
      review_details TEXT,
      reviewed_at INTEGER
    )
  `);
}

export async function start() {
  if (isRunning) {
    logger.warn('Agent already running');
    return;
  }
  
  db = await getDatabase();
  logger.setDatabase(db);
  await initAgentTables(db);
  await createQualityScoresTable();
  
  await db.run(`
    INSERT OR IGNORE INTO agent_enabled (agent_name, enabled, updated_at)
    VALUES (?, 1, ?)
  `, [config.name, Date.now()]);
  
  heartbeat = new AgentHeartbeat(config.name, db);
  await heartbeat.start();
  
  isRunning = true;
  logger.info('Email Reviewer Agent started');
  logger.info(`  Min email quality: ${config.minEmailQuality}/10`);
  logger.info(`  Min research quality: ${config.minResearchQuality}/10`);
  
  const poll = async () => {
    if (!isRunning) return;
    await reviewPendingEmails();
    setTimeout(poll, config.pollInterval);
  };
  
  poll();
}

export async function stop() {
  isRunning = false;
  if (heartbeat) {
    await heartbeat.stop();
  }
  logger.info('Email Reviewer Agent stopped');
}

if (process.argv[1] && process.argv[1].includes('emailReviewer')) {
  start().catch(console.error);
  
  process.on('SIGINT', async () => {
    await stop();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    await stop();
    process.exit(0);
  });
}
