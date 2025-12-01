import { getDatabase, initAgentTables, completeQueueItem, failQueueItem } from './shared/db.js';
import { createLogger } from './shared/logger.js';
import { AgentHeartbeat } from './shared/heartbeat.js';
import { AGENT_CONFIG } from './shared/config.js';
import { 
  scrapeWebsite, 
  scrapeAboutPage, 
  scrapeTeamPage, 
  scrapeCareersPage,
  searchCompanyNews,
  searchPressReleases,
  searchCompanyJobs,
  searchExecutives,
  webSearch,
  conductWebResearch
} from '../services/researchService.js';
import OpenAI from 'openai';

const openrouter = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY
});

const sharedConfig = AGENT_CONFIG.RESEARCH_RETRY;
const config = {
  name: sharedConfig.name,
  pollIntervalMs: sharedConfig.pollIntervalMs,
  targetQuality: sharedConfig.targetQuality,
  maxRetries: 50,
  consecutiveNoDataLimit: 3,
  retryDelayMs: sharedConfig.retryDelayMs
};

const logger = createLogger(config.name);

let db = null;
let heartbeat = null;
let isRunning = false;

const DEEP_SEARCH_STRATEGIES = [
  {
    name: 'deep_website_crawl',
    description: 'Crawl additional website pages (most reliable)',
    execute: async (companyName, websiteUrl) => {
      const additionalPaths = [
        '/blog', '/news', '/press', '/media', '/resources', 
        '/case-studies', '/customers', '/partners', '/investors',
        '/about/history', '/about/mission', '/about/vision',
        '/company/team', '/company/leadership', '/company/board',
        '/company', '/about-us', '/our-team', '/management'
      ];
      
      const results = [];
      for (const path of additionalPaths) {
        try {
          const url = new URL(path, websiteUrl).href;
          const scraped = await scrapeWebsite(url);
          if (scraped.success && scraped.bodyText.length > 200) {
            results.push({
              path,
              title: scraped.title,
              content: scraped.bodyText.slice(0, 1500)
            });
          }
        } catch (e) {
          continue;
        }
        
        if (results.length >= 5) break;
      }
      
      return { success: results.length > 0, data: results, type: 'crawled_pages' };
    }
  },
  {
    name: 'google_news_deep',
    description: 'Deep Google News search with variations',
    execute: async (companyName, websiteUrl) => {
      const results = [];
      const seenTitles = new Set();
      
      const queries = [
        companyName,
        `${companyName} CEO`,
        `${companyName} funding`,
        `${companyName} hiring`,
        `${companyName} announces`,
        `${companyName} partnership`
      ];
      
      for (const query of queries) {
        const news = await searchCompanyNews(query);
        if (news.success && news.articles) {
          for (const article of news.articles) {
            if (!seenTitles.has(article.title)) {
              seenTitles.add(article.title);
              results.push(article);
            }
          }
        }
        await new Promise(r => setTimeout(r, 200));
      }
      
      return { success: results.length > 0, data: results, type: 'news_articles' };
    }
  },
  {
    name: 'press_releases_deep',
    description: 'Search for press releases and announcements',
    execute: async (companyName, websiteUrl) => {
      const results = [];
      const seenTitles = new Set();
      
      const queries = [
        `${companyName} announces`,
        `${companyName} launches`,
        `${companyName} expands`,
        `${companyName} partners`,
        `${companyName} raises`,
        `${companyName} acquires`
      ];
      
      for (const query of queries) {
        const press = await searchPressReleases(query);
        if (press.success && press.releases) {
          for (const release of press.releases) {
            if (!seenTitles.has(release.title)) {
              seenTitles.add(release.title);
              results.push(release);
            }
          }
        }
        await new Promise(r => setTimeout(r, 200));
      }
      
      return { success: results.length > 0, data: results, type: 'press_releases' };
    }
  },
  {
    name: 'jobs_and_careers',
    description: 'Search for job postings and hiring signals',
    execute: async (companyName, websiteUrl) => {
      const results = [];
      
      const [jobs, careers] = await Promise.all([
        searchCompanyJobs(companyName),
        scrapeCareersPage(websiteUrl)
      ]);
      
      if (jobs.success && jobs.jobs?.length > 0) {
        results.push(...jobs.jobs.map(j => ({ type: 'job_news', ...j })));
      }
      
      if (careers.success) {
        results.push({ 
          type: 'careers_page', 
          jobCount: careers.jobCount,
          jobs: careers.jobs 
        });
      }
      
      return { success: results.length > 0, data: results, type: 'jobs_data' };
    }
  },
  {
    name: 'executives_search',
    description: 'Search for executive and leadership mentions',
    execute: async (companyName, websiteUrl) => {
      const results = [];
      
      const [execNews, teamPage] = await Promise.all([
        searchExecutives(companyName),
        scrapeTeamPage(websiteUrl)
      ]);
      
      if (execNews.success && execNews.mentions?.length > 0) {
        results.push(...execNews.mentions.map(m => ({ type: 'exec_news', ...m })));
      }
      
      if (teamPage.success && teamPage.people?.length > 0) {
        results.push(...teamPage.people.map(p => ({ type: 'team_member', ...p })));
      }
      
      return { success: results.length > 0, data: results, type: 'executive_data' };
    }
  },
  {
    name: 'web_search_comprehensive',
    description: 'Comprehensive web search (may be rate limited)',
    execute: async (companyName, websiteUrl) => {
      const results = await conductWebResearch(companyName, websiteUrl);
      
      const allData = [
        ...(results.companyInfo || []),
        ...(results.reviewsInfo || []),
        ...(results.fetchedContent || [])
      ];
      
      if (results.linkedinInfo) allData.push(results.linkedinInfo);
      if (results.crunchbaseInfo) allData.push(results.crunchbaseInfo);
      
      return { success: allData.length > 0, data: allData, type: 'web_search_results' };
    }
  }
];

async function getServiceProfile() {
  return `Smooth AI Consulting provides AI automation solutions including:
- AI-powered process automation
- Custom AI chatbots and assistants
- Business intelligence and analytics
- Workflow optimization
- Document processing and analysis

We help businesses reduce operational costs by 40-60% through intelligent automation.`;
}

async function analyzeWithDeepContext(companyName, websiteUrl, existingData, newData, retryCount) {
  try {
    const allSearchResults = [
      ...(newData.search_results || []),
      ...(newData.industry_results || []),
      ...(newData.social_results || []),
      ...(newData.executive_results || []),
      ...(newData.financial_results || [])
    ];
    
    const searchSnippets = allSearchResults.slice(0, 20).map(r => 
      `[${r.title}]: ${r.snippet || ''} (${r.url})`
    ).join('\n');
    
    const crawledPages = (newData.crawled_pages || []).map(p =>
      `[${p.path}]: ${p.title}\n${p.content.slice(0, 800)}`
    ).join('\n\n');
    
    const keyPeople = Array.isArray(existingData?.aiAnalysis?.keyPeople) 
      ? existingData.aiAnalysis.keyPeople.join(', ')
      : (typeof existingData?.aiAnalysis?.keyPeople === 'string' ? existingData.aiAnalysis.keyPeople : 'None found');
    
    const keyServices = Array.isArray(existingData?.aiAnalysis?.keyServices)
      ? existingData.aiAnalysis.keyServices.join(', ')
      : (typeof existingData?.aiAnalysis?.keyServices === 'string' ? existingData.aiAnalysis.keyServices : 'None found');
    
    const missingData = Array.isArray(existingData?.aiAnalysis?.missingData)
      ? existingData.aiAnalysis.missingData.join(', ')
      : (typeof existingData?.aiAnalysis?.missingData === 'string' ? existingData.aiAnalysis.missingData : 'Unknown');

    const prompt = `You are an expert B2B researcher. This is DEEP RETRY #${retryCount} for ${companyName}. Previous research scored below 9/10.

COMPANY: ${companyName}
WEBSITE: ${websiteUrl}

═══════════════════════════════════════════
PREVIOUS RESEARCH DATA:
═══════════════════════════════════════════
${existingData?.aiAnalysis?.companyOverview || 'No previous overview'}

Previous Key People: ${keyPeople}
Previous Services: ${keyServices}
Previous Quality: ${existingData?.researchQuality || 0}/10
Missing Data: ${missingData}

═══════════════════════════════════════════
NEW DEEP SEARCH RESULTS (${allSearchResults.length} total):
═══════════════════════════════════════════
${searchSnippets || 'No new search results'}

═══════════════════════════════════════════
ADDITIONAL PAGES CRAWLED:
═══════════════════════════════════════════
${crawledPages || 'No additional pages found'}

═══════════════════════════════════════════
SERVICE WE'RE SELLING:
${await getServiceProfile()}

═══════════════════════════════════════════
INSTRUCTIONS:
1. COMBINE all previous and new data to build the MOST COMPLETE picture
2. Extract SPECIFIC names, numbers, dates from search results
3. Be STRICT with scoring - only 9-10 if you have REAL specifics
4. If genuinely no new data found, set dataExhausted: true

Return JSON:
{
  "companyOverview": "Detailed 3-4 sentence summary with ALL specifics",
  "industryVertical": "Specific industry",
  "companySize": "Size estimate with evidence",
  "keyServices": ["SPECIFIC services"],
  "potentialPainPoints": ["SPECIFIC pain points"],
  "recentTriggers": ["REAL news with dates"],
  "personalizedHooks": ["5 SPECIFIC hooks using real names/data"],
  "keyPeople": ["ACTUAL names with roles"],
  "hiringInsights": "Hiring analysis",
  "competitiveAdvantage": "Unique value",
  "outreachAngle": "Best approach",
  "researchQuality": 1-10,
  "missingData": ["What's still missing"],
  "dataExhausted": true/false,
  "exhaustionReason": "Why no more data available (only if dataExhausted is true)"
}

Return ONLY valid JSON.`;

    const response = await openrouter.chat.completions.create({
      model: "meta-llama/llama-3.3-70b-instruct",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 2500
    });

    const content = response.choices[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) {
      throw new Error('No valid JSON in response');
    }
    
    let jsonStr = jsonMatch[0];
    jsonStr = jsonStr.replace(/,\s*}/g, '}');
    jsonStr = jsonStr.replace(/,\s*]/g, ']');
    
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error('Deep analysis failed:', error.message);
    return null;
  }
}

async function processRetryItem(item) {
  const companyName = item.company_name;
  const websiteUrl = item.website_url;
  const retryCount = (item.retry_count || 0) + 1;
  
  logger.info(`🔄 Retry #${retryCount} for: ${companyName} (current quality: ${item.current_quality}/10)`);
  
  let existingData = {};
  try {
    existingData = JSON.parse(item.research_data || '{}');
  } catch (e) {
    existingData = {};
  }
  
  let sourcesTried = [];
  try {
    sourcesTried = JSON.parse(item.sources_tried || '[]');
  } catch (e) {
    sourcesTried = [];
  }
  
  const consecutiveNoData = existingData.consecutiveNoDataRounds || 0;
  
  let strategiesToTry = DEEP_SEARCH_STRATEGIES.filter(s => !sourcesTried.includes(s.name));
  
  if (strategiesToTry.length === 0) {
    logger.info(`  🔄 All strategies used, cycling back to start with fresh attempts`);
    sourcesTried = [];
    strategiesToTry = [...DEEP_SEARCH_STRATEGIES];
  }
  
  const strategyBatchSize = 2;
  const strategiesThisRun = strategiesToTry.slice(0, strategyBatchSize);
  
  const newData = {};
  
  for (const strategy of strategiesThisRun) {
    logger.info(`  🔍 Trying strategy: ${strategy.name}`);
    sourcesTried.push(strategy.name);
    
    try {
      const result = await strategy.execute(companyName, websiteUrl);
      if (result.success && result.data.length > 0) {
        newData[result.type] = result.data;
        logger.info(`    ✓ Found ${result.data.length} results`);
      } else {
        logger.info(`    ✗ No new data`);
      }
    } catch (error) {
      logger.error(`    ✗ Strategy failed: ${error.message}`);
    }
  }
  
  const totalNewData = Object.values(newData).reduce((sum, arr) => sum + arr.length, 0);
  
  let newConsecutiveNoData = consecutiveNoData;
  
  if (totalNewData === 0) {
    newConsecutiveNoData = consecutiveNoData + 1;
    logger.info(`  ℹ️ No new data this round (${newConsecutiveNoData} consecutive rounds without new data)`);
    
    if (newConsecutiveNoData >= config.consecutiveNoDataLimit) {
      logger.warn(`No new data for ${newConsecutiveNoData} consecutive rounds for ${companyName}`);
      return { 
        exhausted: true, 
        reason: `No new data found for ${newConsecutiveNoData} consecutive retry rounds after trying all strategies`,
        sourcesTried,
        retryCount
      };
    }
    
    const updatedDataNoNew = {
      ...existingData,
      consecutiveNoDataRounds: newConsecutiveNoData,
      lastRetryAt: Date.now(),
      retryCount
    };
    
    return {
      success: true,
      quality: item.current_quality || 0,
      reachedTarget: false,
      sourcesTried,
      retryCount,
      updatedData: updatedDataNoNew
    };
  }
  
  newConsecutiveNoData = 0;
  logger.info(`  ✓ Found ${totalNewData} new data items (resetting no-data counter)`);
  
  const analysis = await analyzeWithDeepContext(companyName, websiteUrl, existingData, newData, retryCount);
  
  if (!analysis) {
    logger.warn(`  ⚠️ AI analysis failed, will retry`);
    return { 
      success: true,
      quality: item.current_quality || 0,
      reachedTarget: false,
      sourcesTried,
      retryCount,
      updatedData: { ...existingData, consecutiveNoDataRounds: 0 }
    };
  }
  
  const newQuality = analysis.researchQuality || 0;
  const bestQuality = Math.max(newQuality, item.current_quality || 0);
  logger.info(`  📊 New quality: ${newQuality}/10 (best: ${bestQuality}/10)`);
  
  const updatedData = {
    ...existingData,
    aiAnalysis: {
      ...existingData.aiAnalysis,
      ...analysis
    },
    researchQuality: bestQuality,
    lastRetryAt: Date.now(),
    retryCount,
    consecutiveNoDataRounds: 0,
    newDataFound: totalNewData
  };
  
  return {
    success: true,
    quality: bestQuality,
    reachedTarget: bestQuality >= config.targetQuality,
    sourcesTried,
    retryCount,
    updatedData
  };
}

async function acquireRetryItem() {
  const lockTimeout = 5 * 60 * 1000;
  const now = Date.now();
  
  const item = await db.get(`
    SELECT * FROM research_queue 
    WHERE (status = 'low_quality' OR (status = 'completed' AND current_quality < ?))
      AND exhausted = 0
      AND (locked_by IS NULL OR locked_at < ?)
      AND (last_retry_at IS NULL OR last_retry_at < ?)
      AND retry_count < ?
    ORDER BY current_quality DESC, created_at ASC
    LIMIT 1
  `, [config.targetQuality, now - lockTimeout, now - config.retryDelayMs, config.maxRetries]);
  
  if (!item) return null;
  
  const result = await db.run(`
    UPDATE research_queue 
    SET locked_by = ?, locked_at = ?, updated_at = ?
    WHERE id = ? AND (locked_by IS NULL OR locked_at < ?)
  `, [config.name, now, now, item.id, now - lockTimeout]);
  
  if (result.changes === 0) return null;
  
  return { ...item, locked_by: config.name, locked_at: now };
}

async function processRetry() {
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
    
    const item = await acquireRetryItem();
    
    if (!item) return;
    
    heartbeat.setCurrentItem({ id: item.id, company: item.company_name });
    
    try {
      const result = await processRetryItem(item);
      heartbeat.incrementProcessed();
      
      if (result.exhausted) {
        await db.run(`
          UPDATE research_queue 
          SET status = 'exhausted',
              exhausted = 1,
              exhaustion_reason = ?,
              retry_count = ?,
              sources_tried = ?,
              locked_by = NULL,
              locked_at = NULL,
              updated_at = ?
          WHERE id = ?
        `, [result.reason, result.retryCount, JSON.stringify(result.sourcesTried), Date.now(), item.id]);
        
        logger.warn(`Research exhausted for ${item.company_name}: ${result.reason}`);
        
      } else if (result.reachedTarget) {
        const updatedResearch = result.updatedData;
        
        await db.run(`
          INSERT INTO draft_queue (research_id, prospect_id, company_name, contact_email, contact_name, research_quality, research_data, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        `, [item.id, item.prospect_id, item.company_name, item.contact_email, item.contact_name, result.quality, JSON.stringify(updatedResearch), Date.now()]);
        
        await db.run(`
          UPDATE research_queue 
          SET status = 'completed',
              current_quality = ?,
              research_data = ?,
              retry_count = ?,
              sources_tried = ?,
              last_retry_at = ?,
              locked_by = NULL,
              locked_at = NULL,
              updated_at = ?,
              completed_at = ?
          WHERE id = ?
        `, [result.quality, JSON.stringify(updatedResearch), result.retryCount, JSON.stringify(result.sourcesTried), Date.now(), Date.now(), Date.now(), item.id]);
        
        logger.info(`✅ Retry SUCCESS for ${item.company_name} - Quality ${result.quality}/10 - moved to draft queue`);
        
      } else {
        await db.run(`
          UPDATE research_queue 
          SET status = 'low_quality',
              current_quality = ?,
              research_data = ?,
              retry_count = ?,
              sources_tried = ?,
              last_retry_at = ?,
              locked_by = NULL,
              locked_at = NULL,
              updated_at = ?
          WHERE id = ?
        `, [result.quality, JSON.stringify(result.updatedData || {}), result.retryCount, JSON.stringify(result.sourcesTried), Date.now(), Date.now(), item.id]);
        
        logger.info(`Retry ${result.retryCount} for ${item.company_name}: ${result.quality}/10 - will retry again`);
      }
      
    } catch (error) {
      logger.error(`Retry failed for ${item.company_name}`, { error: error.message });
      heartbeat.incrementErrors();
      await failQueueItem(db, 'research_queue', item.id, error.message, config.maxRetries);
    }
    
    heartbeat.clearCurrentItem();
    
  } catch (error) {
    logger.error('Retry processing cycle failed', { error: error.message });
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
  logger.info('Research Retry Agent started');
  
  const poll = async () => {
    if (!isRunning) return;
    await processRetry();
    setTimeout(poll, config.pollIntervalMs);
  };
  
  poll();
}

export async function stop() {
  isRunning = false;
  if (heartbeat) {
    await heartbeat.stop();
  }
  logger.info('Research Retry Agent stopped');
}

export function getStatus() {
  return {
    name: config.name,
    running: isRunning,
    processed: heartbeat?.itemsProcessed || 0,
    errors: heartbeat?.errorCount || 0
  };
}

if (process.argv[1]?.endsWith('researchRetryAgent.js')) {
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
