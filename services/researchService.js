import OpenAI from 'openai';
import * as cheerio from 'cheerio';
import axios from 'axios';
import https from 'https';

const openrouter = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY
});

const RESEARCH_TIMEOUT = 20000;

const axiosInstance = axios.create({
  timeout: RESEARCH_TIMEOUT,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5'
  },
  httpsAgent: new https.Agent({
    rejectUnauthorized: false
  }),
  maxRedirects: 5
});

async function fetchWithTimeout(url, timeout = RESEARCH_TIMEOUT) {
  try {
    const response = await axiosInstance.get(url, { timeout });
    return {
      ok: response.status >= 200 && response.status < 400,
      status: response.status,
      statusText: response.statusText,
      text: () => Promise.resolve(response.data)
    };
  } catch (error) {
    if (error.response) {
      return {
        ok: false,
        status: error.response.status,
        statusText: error.response.statusText,
        text: () => Promise.resolve(error.response.data || '')
      };
    }
    throw error;
  }
}

export async function scrapeWebsite(url) {
  try {
    if (!url.startsWith('http')) {
      url = 'https://' + url;
    }
    
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const html = await response.text();
    const $ = cheerio.load(html);
    
    $('script, style, nav, footer, header, iframe, noscript').remove();
    
    const title = $('title').text().trim();
    const metaDescription = $('meta[name="description"]').attr('content') || '';
    const h1s = $('h1').map((_, el) => $(el).text().trim()).get().slice(0, 5);
    const h2s = $('h2').map((_, el) => $(el).text().trim()).get().slice(0, 10);
    
    const mainContent = $('main, article, .content, #content, .main, #main')
      .first()
      .text()
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 5000);
    
    const bodyText = mainContent || $('body')
      .text()
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 5000);
    
    const aboutLinks = $('a[href*="about"], a[href*="team"], a[href*="company"]')
      .map((_, el) => ({
        text: $(el).text().trim(),
        href: $(el).attr('href')
      }))
      .get()
      .slice(0, 5);
    
    const serviceLinks = $('a[href*="service"], a[href*="practice"], a[href*="solution"]')
      .map((_, el) => ({
        text: $(el).text().trim(),
        href: $(el).attr('href')
      }))
      .get()
      .slice(0, 10);
    
    return {
      success: true,
      url,
      title,
      metaDescription,
      headings: { h1s, h2s },
      bodyText,
      aboutLinks,
      serviceLinks,
      scrapedAt: Date.now()
    };
  } catch (error) {
    console.error(`Scrape failed for ${url}:`, error.message);
    return {
      success: false,
      url,
      error: error.message,
      scrapedAt: Date.now()
    };
  }
}

export async function scrapeAboutPage(baseUrl) {
  const aboutPaths = ['/about', '/about-us', '/company', '/team', '/our-team', '/who-we-are'];
  
  for (const path of aboutPaths) {
    try {
      const url = new URL(path, baseUrl).href;
      const result = await scrapeWebsite(url);
      if (result.success && result.bodyText.length > 200) {
        return result;
      }
    } catch (error) {
      continue;
    }
  }
  
  return null;
}

export async function searchCompanyNews(companyName) {
  try {
    const searchUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(companyName)}&hl=en-US&gl=US&ceid=US:en`;
    const response = await fetchWithTimeout(searchUrl, 10000);
    
    if (!response.ok) {
      return { success: false, articles: [] };
    }
    
    const xml = await response.text();
    const $ = cheerio.load(xml, { xmlMode: true });
    
    const articles = $('item').map((_, item) => ({
      title: $(item).find('title').text(),
      link: $(item).find('link').text(),
      pubDate: $(item).find('pubDate').text(),
      source: $(item).find('source').text()
    })).get().slice(0, 5);
    
    return { success: true, articles };
  } catch (error) {
    console.error(`News search failed for ${companyName}:`, error.message);
    return { success: false, articles: [], error: error.message };
  }
}

export async function analyzeResearchWithAI(scrapedData, companyName, serviceProfile) {
  try {
    const prompt = `You are a B2B sales researcher. Analyze this company's website data and provide actionable insights for a personalized outreach email.

COMPANY: ${companyName}
WEBSITE: ${scrapedData.url}

SCRAPED DATA:
Title: ${scrapedData.title}
Meta Description: ${scrapedData.metaDescription}
Main Headings: ${scrapedData.headings?.h1s?.join(', ') || 'None found'}
Sub Headings: ${scrapedData.headings?.h2s?.join(', ') || 'None found'}
Services/Practice Areas: ${scrapedData.serviceLinks?.map(l => l.text).join(', ') || 'None found'}

CONTENT EXCERPT:
${scrapedData.bodyText?.slice(0, 3000) || 'No content extracted'}

${scrapedData.aboutPageContent ? `ABOUT PAGE:
${scrapedData.aboutPageContent.slice(0, 2000)}` : ''}

${scrapedData.news?.articles?.length > 0 ? `RECENT NEWS:
${scrapedData.news.articles.map(a => `- ${a.title} (${a.pubDate})`).join('\n')}` : ''}

OUR SERVICE (what we're selling):
${serviceProfile || 'AI automation solutions for business operations'}

Analyze and return a JSON object with these exact fields:
{
  "companyOverview": "2-3 sentence summary of what this company does",
  "industryVertical": "Their specific industry/niche",
  "companySize": "Estimate: small/medium/large based on website",
  "keyServices": ["list", "of", "their", "main", "services"],
  "potentialPainPoints": ["specific", "pain", "points", "relevant", "to", "our", "service"],
  "recentTriggers": ["any", "recent", "news", "hires", "expansions", "that", "are", "outreach", "triggers"],
  "personalizedHooks": ["3-5 specific angles to use in outreach based on their real situation"],
  "keyPeople": ["names of executives or key contacts mentioned"],
  "competitiveAdvantage": "What makes them unique in their market",
  "outreachAngle": "The single best angle to approach them with our service",
  "researchQuality": "Score 1-10 based on how much useful data was found"
}

Return ONLY valid JSON, no markdown or explanation.`;

    const response = await openrouter.chat.completions.create({
      model: "meta-llama/llama-3.3-70b-instruct",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 1500
    });

    const content = response.choices[0]?.message?.content || '';
    
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No valid JSON in AI response');
    }
    
    const analysis = JSON.parse(jsonMatch[0]);
    return {
      success: true,
      analysis
    };
  } catch (error) {
    console.error('AI analysis failed:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

export async function conductFullResearch(companyName, websiteUrl, serviceProfile) {
  console.log(`🔍 Starting research for: ${companyName} (${websiteUrl})`);
  
  const results = {
    companyName,
    websiteUrl,
    researchStarted: Date.now(),
    mainSite: null,
    aboutPage: null,
    news: null,
    aiAnalysis: null,
    researchQuality: 0,
    error: null
  };
  
  try {
    console.log(`  📄 Scraping main website...`);
    results.mainSite = await scrapeWebsite(websiteUrl);
    
    if (results.mainSite.success) {
      console.log(`  📄 Scraping about page...`);
      results.aboutPage = await scrapeAboutPage(websiteUrl);
    }
    
    console.log(`  📰 Searching for news...`);
    results.news = await searchCompanyNews(companyName);
    
    if (results.mainSite.success) {
      console.log(`  🤖 Analyzing with AI...`);
      
      const combinedData = {
        ...results.mainSite,
        aboutPageContent: results.aboutPage?.bodyText || '',
        news: results.news
      };
      
      const aiResult = await analyzeResearchWithAI(combinedData, companyName, serviceProfile);
      
      if (aiResult.success) {
        results.aiAnalysis = aiResult.analysis;
        results.researchQuality = aiResult.analysis.researchQuality || 5;
      }
    }
    
    if (!results.mainSite.success) {
      results.researchQuality = 1;
      results.error = 'Failed to scrape website';
    } else if (!results.aiAnalysis) {
      results.researchQuality = 3;
      results.error = 'AI analysis failed';
    }
    
    results.researchCompleted = Date.now();
    console.log(`✅ Research complete for ${companyName} (Quality: ${results.researchQuality}/10)`);
    
    return results;
    
  } catch (error) {
    console.error(`❌ Research failed for ${companyName}:`, error.message);
    results.error = error.message;
    results.researchQuality = 0;
    results.researchCompleted = Date.now();
    return results;
  }
}

export function formatResearchForEmail(research) {
  if (!research.aiAnalysis) {
    return null;
  }
  
  const a = research.aiAnalysis;
  
  return {
    companyOverview: a.companyOverview,
    industry: a.industryVertical,
    services: a.keyServices?.join(', '),
    painPoints: a.potentialPainPoints,
    triggers: a.recentTriggers,
    hooks: a.personalizedHooks,
    keyPeople: a.keyPeople,
    bestAngle: a.outreachAngle,
    quality: research.researchQuality
  };
}

// Additional page paths for deeper scraping on retry attempts
const EXTENDED_ABOUT_PATHS = [
  '/about', '/about-us', '/company', '/team', '/our-team', '/who-we-are',
  '/leadership', '/our-story', '/history', '/mission', '/values',
  '/management', '/executives', '/founders', '/people', '/staff'
];

const EXTENDED_SERVICE_PATHS = [
  '/services', '/solutions', '/products', '/what-we-do', '/offerings',
  '/capabilities', '/expertise', '/practice-areas', '/industries'
];

// Scrape additional pages for more context
async function scrapeExtendedPages(baseUrl, paths) {
  const results = [];
  
  for (const path of paths) {
    try {
      const url = new URL(path, baseUrl).href;
      const result = await scrapeWebsite(url);
      if (result.success && result.bodyText.length > 200) {
        results.push({
          path,
          content: result.bodyText.slice(0, 2000),
          title: result.title
        });
      }
    } catch (error) {
      continue;
    }
    
    // Limit to 3 successful scrapes per category to save time
    if (results.length >= 3) break;
  }
  
  return results;
}

// Search for company news with variations
async function searchCompanyNewsExtended(companyName) {
  const variations = [
    companyName,
    companyName.replace(/\s+(Inc|LLC|Corp|Ltd|Co)\.?$/i, ''),
    companyName.split(' ').slice(0, 2).join(' ')
  ];
  
  const allArticles = [];
  const seenTitles = new Set();
  
  for (const query of variations) {
    const news = await searchCompanyNews(query);
    if (news.success && news.articles) {
      for (const article of news.articles) {
        if (!seenTitles.has(article.title)) {
          seenTitles.add(article.title);
          allArticles.push(article);
        }
      }
    }
  }
  
  // Also try industry-specific searches
  const industryQueries = [
    `"${companyName}" expansion`,
    `"${companyName}" hiring`,
    `"${companyName}" growth`
  ];
  
  for (const query of industryQueries) {
    try {
      const news = await searchCompanyNews(query);
      if (news.success && news.articles) {
        for (const article of news.articles) {
          if (!seenTitles.has(article.title)) {
            seenTitles.add(article.title);
            allArticles.push(article);
          }
        }
      }
    } catch (e) {
      continue;
    }
  }
  
  return { success: true, articles: allArticles.slice(0, 10) };
}

// Enhanced AI analysis with more data
async function analyzeResearchWithAIEnhanced(scrapedData, companyName, serviceProfile, attempt) {
  try {
    const prompt = `You are an expert B2B sales researcher. This is research attempt #${attempt}. Analyze ALL available data thoroughly and provide detailed, actionable insights.

COMPANY: ${companyName}
WEBSITE: ${scrapedData.url}

SCRAPED DATA:
Title: ${scrapedData.title}
Meta Description: ${scrapedData.metaDescription}
Main Headings: ${scrapedData.headings?.h1s?.join(', ') || 'None found'}
Sub Headings: ${scrapedData.headings?.h2s?.join(', ') || 'None found'}

MAIN CONTENT:
${scrapedData.bodyText?.slice(0, 3000) || 'No content extracted'}

${scrapedData.aboutPageContent ? `ABOUT PAGE:
${scrapedData.aboutPageContent.slice(0, 2000)}` : ''}

${scrapedData.extendedPages?.length > 0 ? `ADDITIONAL PAGES SCRAPED:
${scrapedData.extendedPages.map(p => `[${p.path}]: ${p.content.slice(0, 500)}`).join('\n')}` : ''}

${scrapedData.news?.articles?.length > 0 ? `RECENT NEWS (${scrapedData.news.articles.length} articles):
${scrapedData.news.articles.map(a => `- ${a.title} (${a.pubDate})`).join('\n')}` : 'NO RECENT NEWS FOUND'}

OUR SERVICE:
${serviceProfile || 'AI automation solutions for business operations'}

CRITICAL SCORING RULES:
- Score 9-10: ONLY if we have SPECIFIC company details (real names, real numbers, real news, real services mentioned)
- Score 7-8: Good data but missing specifics
- Score 5-6: Basic info only
- Score 1-4: Very little useful data

Return a JSON object with these fields:
{
  "companyOverview": "Detailed 3-4 sentence summary with SPECIFIC details about what they do",
  "industryVertical": "Their specific industry/niche",
  "companySize": "Estimate with reasoning",
  "keyServices": ["SPECIFIC services from website, not generic"],
  "potentialPainPoints": ["SPECIFIC pain points based on their actual business"],
  "recentTriggers": ["ACTUAL news, hires, or events - empty array if none found"],
  "personalizedHooks": ["5 SPECIFIC hooks using real data from research"],
  "keyPeople": ["ACTUAL names found on website"],
  "competitiveAdvantage": "What makes them unique based on their content",
  "outreachAngle": "The SPECIFIC best angle based on real research data",
  "researchQuality": "Score 1-10 - BE STRICT, only 9+ if truly excellent data",
  "missingData": ["What data would help improve this research"]
}

Return ONLY valid JSON, no markdown.`;

    const response = await openrouter.chat.completions.create({
      model: "meta-llama/llama-3.3-70b-instruct",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 2000
    });

    const content = response.choices[0]?.message?.content || '';
    
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No valid JSON in AI response');
    }
    
    // Clean up common JSON issues from AI responses
    let jsonStr = jsonMatch[0];
    jsonStr = jsonStr.replace(/,\s*}/g, '}'); // Remove trailing commas
    jsonStr = jsonStr.replace(/,\s*]/g, ']'); // Remove trailing commas in arrays
    jsonStr = jsonStr.replace(/:\s*,/g, ': null,'); // Fix empty values
    jsonStr = jsonStr.replace(/:\s*}/g, ': null}'); // Fix empty values at end
    jsonStr = jsonStr.replace(/\n/g, ' '); // Remove newlines
    jsonStr = jsonStr.replace(/\r/g, ''); // Remove carriage returns
    
    try {
      const analysis = JSON.parse(jsonStr);
      return {
        success: true,
        analysis
      };
    } catch (parseError) {
      // Try one more cleanup - remove control characters
      jsonStr = jsonStr.replace(/[\x00-\x1F\x7F]/g, '');
      const analysis = JSON.parse(jsonStr);
      return {
        success: true,
        analysis
      };
    }
  } catch (error) {
    console.error('Enhanced AI analysis failed:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// Main iterative research orchestrator
export async function conductIterativeResearch(companyName, websiteUrl, serviceProfile, targetQuality = 9, maxAttempts = 3) {
  console.log(`🔍 Starting iterative research for: ${companyName} (target: ${targetQuality}/10)`);
  
  const orchestratorState = {
    companyName,
    websiteUrl,
    targetQuality,
    maxAttempts,
    attempts: [],
    currentAttempt: 0,
    bestResult: null,
    bestQuality: 0,
    status: 'in_progress'
  };
  
  let accumulatedData = {
    mainSite: null,
    aboutPage: null,
    news: null,
    extendedPages: [],
    servicesPages: []
  };
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    orchestratorState.currentAttempt = attempt;
    console.log(`\n  📊 Attempt ${attempt}/${maxAttempts}...`);
    
    const attemptLog = {
      attempt,
      startedAt: Date.now(),
      strategies: [],
      quality: 0
    };
    
    try {
      // PASS 1: Standard research
      if (attempt === 1) {
        console.log(`    📄 Pass 1: Standard scraping...`);
        attemptLog.strategies.push('standard_scrape');
        
        accumulatedData.mainSite = await scrapeWebsite(websiteUrl);
        
        if (accumulatedData.mainSite.success) {
          accumulatedData.aboutPage = await scrapeAboutPage(websiteUrl);
        }
        
        accumulatedData.news = await searchCompanyNews(companyName);
      }
      
      // PASS 2: Extended scraping - more pages, more news sources
      if (attempt >= 2 && accumulatedData.mainSite?.success) {
        console.log(`    📄 Pass 2: Extended page scraping...`);
        attemptLog.strategies.push('extended_pages');
        
        // Scrape additional about/team pages
        const moreAboutPages = await scrapeExtendedPages(websiteUrl, EXTENDED_ABOUT_PATHS);
        accumulatedData.extendedPages = [...accumulatedData.extendedPages, ...moreAboutPages];
        
        // Scrape service pages
        const servicePages = await scrapeExtendedPages(websiteUrl, EXTENDED_SERVICE_PATHS);
        accumulatedData.servicesPages = [...accumulatedData.servicesPages, ...servicePages];
        
        // Extended news search
        console.log(`    📰 Extended news search...`);
        attemptLog.strategies.push('extended_news');
        accumulatedData.news = await searchCompanyNewsExtended(companyName);
      }
      
      // PASS 3: Deep dive - try alternative domains, subdomains
      if (attempt >= 3) {
        console.log(`    🔎 Pass 3: Deep research strategies...`);
        attemptLog.strategies.push('deep_research');
        
        // Try www vs non-www
        const altUrl = websiteUrl.includes('www.') 
          ? websiteUrl.replace('www.', '')
          : websiteUrl.replace('://', '://www.');
        
        const altScrape = await scrapeWebsite(altUrl);
        if (altScrape.success && altScrape.bodyText.length > (accumulatedData.mainSite?.bodyText?.length || 0)) {
          console.log(`    ✓ Alternative URL had more content`);
          accumulatedData.mainSite = altScrape;
        }
      }
      
      // Run AI analysis with all accumulated data
      if (accumulatedData.mainSite?.success) {
        console.log(`    🤖 AI analysis (attempt ${attempt})...`);
        
        const combinedData = {
          ...accumulatedData.mainSite,
          aboutPageContent: accumulatedData.aboutPage?.bodyText || '',
          news: accumulatedData.news,
          extendedPages: [...accumulatedData.extendedPages, ...accumulatedData.servicesPages]
        };
        
        const aiResult = await analyzeResearchWithAIEnhanced(combinedData, companyName, serviceProfile, attempt);
        
        if (aiResult.success) {
          attemptLog.quality = aiResult.analysis.researchQuality || 0;
          attemptLog.missingData = aiResult.analysis.missingData || [];
          
          // Track best result
          if (attemptLog.quality > orchestratorState.bestQuality) {
            orchestratorState.bestQuality = attemptLog.quality;
            orchestratorState.bestResult = {
              companyName,
              websiteUrl,
              researchStarted: orchestratorState.attempts[0]?.startedAt || Date.now(),
              mainSite: accumulatedData.mainSite,
              aboutPage: accumulatedData.aboutPage,
              news: accumulatedData.news,
              extendedPages: accumulatedData.extendedPages,
              aiAnalysis: aiResult.analysis,
              researchQuality: attemptLog.quality,
              totalAttempts: attempt,
              researchCompleted: Date.now()
            };
          }
          
          console.log(`    📊 Quality: ${attemptLog.quality}/10 (target: ${targetQuality})`);
          
          // Check if we've reached target quality
          if (attemptLog.quality >= targetQuality) {
            console.log(`  ✅ Target quality reached on attempt ${attempt}!`);
            orchestratorState.status = 'completed';
            attemptLog.completedAt = Date.now();
            orchestratorState.attempts.push(attemptLog);
            break;
          } else if (attempt < maxAttempts) {
            console.log(`    ⚠️ Below target. Missing: ${(attemptLog.missingData || []).join(', ') || 'unknown'}`);
          }
        }
      } else {
        attemptLog.quality = 1;
        attemptLog.error = 'Main site scrape failed';
      }
      
    } catch (error) {
      console.error(`    ❌ Attempt ${attempt} error:`, error.message);
      attemptLog.error = error.message;
    }
    
    attemptLog.completedAt = Date.now();
    orchestratorState.attempts.push(attemptLog);
  }
  
  // Final status
  if (orchestratorState.bestQuality >= targetQuality) {
    orchestratorState.status = 'completed';
  } else if (orchestratorState.bestQuality > 0) {
    orchestratorState.status = 'max_attempts_reached';
  } else {
    orchestratorState.status = 'failed';
  }
  
  console.log(`\n🏁 Research complete for ${companyName}:`);
  console.log(`   Best quality: ${orchestratorState.bestQuality}/10 after ${orchestratorState.attempts.length} attempts`);
  console.log(`   Status: ${orchestratorState.status}`);
  
  return {
    ...orchestratorState.bestResult,
    orchestrator: {
      attempts: orchestratorState.attempts,
      status: orchestratorState.status,
      targetQuality,
      maxAttempts
    }
  };
}
