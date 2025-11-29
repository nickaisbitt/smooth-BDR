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
