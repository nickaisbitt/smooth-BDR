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

// Search for company hiring/jobs to understand growth and pain points
export async function searchCompanyJobs(companyName) {
  try {
    const searchUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(companyName + ' hiring OR jobs OR careers')}&hl=en-US&gl=US&ceid=US:en`;
    const response = await fetchWithTimeout(searchUrl, 10000);
    
    if (!response.ok) {
      return { success: false, jobs: [] };
    }
    
    const xml = await response.text();
    const $ = cheerio.load(xml, { xmlMode: true });
    
    const jobs = $('item').map((_, item) => ({
      title: $(item).find('title').text(),
      link: $(item).find('link').text(),
      pubDate: $(item).find('pubDate').text()
    })).get().slice(0, 5);
    
    return { success: true, jobs };
  } catch (error) {
    return { success: false, jobs: [], error: error.message };
  }
}

// Search for press releases and announcements
export async function searchPressReleases(companyName) {
  try {
    const searchUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(companyName + ' announces OR launches OR expands OR partners')}&hl=en-US&gl=US&ceid=US:en`;
    const response = await fetchWithTimeout(searchUrl, 10000);
    
    if (!response.ok) {
      return { success: false, releases: [] };
    }
    
    const xml = await response.text();
    const $ = cheerio.load(xml, { xmlMode: true });
    
    const releases = $('item').map((_, item) => ({
      title: $(item).find('title').text(),
      link: $(item).find('link').text(),
      pubDate: $(item).find('pubDate').text()
    })).get().slice(0, 5);
    
    return { success: true, releases };
  } catch (error) {
    return { success: false, releases: [], error: error.message };
  }
}

// Search for executive/leadership mentions
export async function searchExecutives(companyName) {
  try {
    const searchUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(companyName + ' CEO OR founder OR president OR director')}&hl=en-US&gl=US&ceid=US:en`;
    const response = await fetchWithTimeout(searchUrl, 10000);
    
    if (!response.ok) {
      return { success: false, mentions: [] };
    }
    
    const xml = await response.text();
    const $ = cheerio.load(xml, { xmlMode: true });
    
    const mentions = $('item').map((_, item) => ({
      title: $(item).find('title').text(),
      link: $(item).find('link').text(),
      pubDate: $(item).find('pubDate').text()
    })).get().slice(0, 5);
    
    return { success: true, mentions };
  } catch (error) {
    return { success: false, mentions: [], error: error.message };
  }
}

// Search Wikipedia for company information
export async function searchWikipedia(companyName) {
  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(companyName)}&format=json&origin=*`;
    const response = await axiosInstance.get(searchUrl, { timeout: 30000 });
    
    if (response.data?.query?.search?.length > 0) {
      const topResult = response.data.query.search[0];
      const pageUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(topResult.title.replace(/ /g, '_'))}`;
      
      // Fetch the actual page content
      const contentUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(topResult.title)}&prop=extracts&exintro=true&explaintext=true&format=json&origin=*`;
      const contentResponse = await axiosInstance.get(contentUrl, { timeout: 30000 });
      
      const pages = contentResponse.data?.query?.pages || {};
      const pageContent = Object.values(pages)[0]?.extract || '';
      
      return {
        success: true,
        title: topResult.title,
        snippet: topResult.snippet.replace(/<[^>]*>/g, ''),
        url: pageUrl,
        content: pageContent.slice(0, 2000)
      };
    }
    return { success: false, error: 'No Wikipedia results found' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Search Yahoo Finance for public company information
export async function searchYahooFinance(companyName) {
  try {
    const searchUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(companyName)}&quotesCount=3&newsCount=0`;
    const response = await axiosInstance.get(searchUrl, { timeout: 30000 });
    
    const quotes = response.data?.quotes || [];
    if (quotes.length > 0) {
      const results = quotes.map(q => ({
        symbol: q.symbol,
        name: q.shortname || q.longname,
        exchange: q.exchange,
        type: q.quoteType,
        industry: q.industry,
        sector: q.sector
      }));
      return { success: true, results };
    }
    return { success: false, results: [] };
  } catch (error) {
    return { success: false, results: [], error: error.message };
  }
}

// Search industry news sources (TechCrunch, Business Wire)
export async function searchIndustryNews(companyName) {
  try {
    const sources = [
      `https://news.google.com/rss/search?q=${encodeURIComponent(companyName + ' site:techcrunch.com')}&hl=en-US&gl=US&ceid=US:en`,
      `https://news.google.com/rss/search?q=${encodeURIComponent(companyName + ' site:businesswire.com')}&hl=en-US&gl=US&ceid=US:en`,
      `https://news.google.com/rss/search?q=${encodeURIComponent(companyName + ' acquisition OR funding OR partnership')}&hl=en-US&gl=US&ceid=US:en`
    ];
    
    const allNews = [];
    for (const url of sources) {
      try {
        const response = await fetchWithTimeout(url, 15000);
        if (response.ok) {
          const xml = await response.text();
          const $ = cheerio.load(xml, { xmlMode: true });
          $('item').slice(0, 3).each((_, item) => {
            allNews.push({
              title: $(item).find('title').text(),
              link: $(item).find('link').text(),
              pubDate: $(item).find('pubDate').text(),
              source: $(item).find('source').text()
            });
          });
        }
      } catch (e) { /* continue to next source */ }
    }
    
    return { success: allNews.length > 0, news: allNews };
  } catch (error) {
    return { success: false, news: [], error: error.message };
  }
}

// Bing search as fallback (RSS-based, no API key needed)
async function bingSearch(query, maxResults = 3) {
  try {
    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss`;
    const response = await axiosInstance.get(searchUrl, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const $ = cheerio.load(response.data, { xmlMode: true });
    const results = [];
    
    $('item').slice(0, maxResults).each((_, item) => {
      const title = $(item).find('title').text().trim();
      const description = $(item).find('description').text().trim().replace(/<[^>]*>/g, '');
      const link = $(item).find('link').text().trim();
      
      if (title && link && !link.includes('bing.com')) {
        results.push({ title, snippet: description || 'No description', url: link });
      }
    });
    
    if (results.length > 0) {
      console.log(`    🔍 Bing fallback found ${results.length} results`);
    }
    return { success: results.length > 0, results };
  } catch (error) {
    return { success: false, results: [] };
  }
}

// Google scraping as last resort fallback
async function googleScrape(query, maxResults = 3) {
  try {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=5`;
    const response = await axiosInstance.get(searchUrl, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    });
    
    const $ = cheerio.load(response.data);
    const results = [];
    
    // Google search result containers
    $('div.g, div[data-hveid]').each((i, el) => {
      if (results.length >= maxResults) return;
      
      const titleEl = $(el).find('h3').first();
      const linkEl = $(el).find('a[href^="http"]').first();
      const snippetEl = $(el).find('[data-sncf], .VwiC3b, span.st').first();
      
      const title = titleEl.text().trim();
      const url = linkEl.attr('href') || '';
      const snippet = snippetEl.text().trim();
      
      if (title && url && !url.includes('google.com') && !url.includes('webcache')) {
        results.push({ title, snippet: snippet || 'No description', url });
      }
    });
    
    if (results.length > 0) {
      console.log(`    🔍 Google fallback found ${results.length} results`);
    }
    return { success: results.length > 0, results };
  } catch (error) {
    return { success: false, results: [] };
  }
}

// Search Reddit for company mentions (no auth needed - uses public JSON API)
export async function searchReddit(companyName, maxResults = 5) {
  try {
    const subreddits = ['business', 'startups', 'technology', 'entrepreneur'];
    const allPosts = [];
    
    for (const subreddit of subreddits) {
      try {
        const searchUrl = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(companyName)}&sort=relevance&t=year&limit=3`;
        const response = await axiosInstance.get(searchUrl, {
          timeout: 10000,
          headers: {
            'User-Agent': 'SmoothAI-ResearchBot/1.0 (Company Research)'
          }
        });
        
        if (response.data?.data?.children) {
          response.data.data.children.forEach(post => {
            if (post.data?.title) {
              allPosts.push({
                title: post.data.title,
                subreddit: post.data.subreddit,
                score: post.data.score,
                url: `https://reddit.com${post.data.permalink}`,
                comments: post.data.num_comments,
                created: new Date(post.data.created_utc * 1000).toISOString()
              });
            }
          });
        }
      } catch (e) { /* continue to next subreddit */ }
      
      // Rate limit protection
      await new Promise(r => setTimeout(r, 200));
    }
    
    // Dedupe and sort by score
    const uniquePosts = [...new Map(allPosts.map(p => [p.url, p])).values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);
    
    return { success: uniquePosts.length > 0, posts: uniquePosts };
  } catch (error) {
    return { success: false, posts: [], error: error.message };
  }
}

// Search SEC EDGAR for public company filings
export async function searchSECFilings(companyName) {
  try {
    const searchUrl = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(companyName)}&dateRange=custom&startdt=2023-01-01&enddt=2025-12-31&forms=10-K,10-Q,8-K&from=0&size=5`;
    
    const response = await axiosInstance.get(searchUrl, {
      timeout: 15000,
      headers: {
        'User-Agent': 'SmoothAI Research (contact@smoothaiconsultancy.com)',
        'Accept': 'application/json'
      }
    });
    
    const filings = [];
    if (response.data?.hits?.hits) {
      response.data.hits.hits.forEach(hit => {
        const source = hit._source || {};
        filings.push({
          company: source.display_names?.[0] || companyName,
          form: source.form,
          filedAt: source.file_date,
          description: source.file_description,
          cik: source.ciks?.[0],
          url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${source.ciks?.[0]}&type=10-K`
        });
      });
    }
    
    return { success: filings.length > 0, filings };
  } catch (error) {
    return { success: false, filings: [], error: error.message };
  }
}

// Web search using DuckDuckGo HTML (free, no API key needed)
export async function webSearch(query, maxResults = 5) {
  try {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await axiosInstance.get(searchUrl, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    });
    
    const $ = cheerio.load(response.data);
    const results = [];
    
    $('.result').each((i, el) => {
      if (results.length >= maxResults) return;
      
      const titleEl = $(el).find('.result__a');
      const snippetEl = $(el).find('.result__snippet');
      const urlEl = $(el).find('.result__url');
      
      const title = titleEl.text().trim();
      const snippet = snippetEl.text().trim();
      let url = titleEl.attr('href') || '';
      
      // DuckDuckGo wraps URLs, extract the actual URL
      if (url.includes('uddg=')) {
        const match = url.match(/uddg=([^&]+)/);
        if (match) {
          url = decodeURIComponent(match[1]);
        }
      }
      
      if (title && url && !url.includes('duckduckgo.com')) {
        results.push({ title, snippet, url });
      }
    });
    
    console.log(`    🔍 Web search for "${query.slice(0, 40)}..." found ${results.length} results`);
    
    // If DuckDuckGo fails or returns too few results, try fallbacks
    if (results.length < 2) {
      // Try Bing fallback
      const bingResults = await bingSearch(query, maxResults);
      if (bingResults.success) {
        results.push(...bingResults.results.filter(r => !results.find(e => e.url === r.url)));
      }
      
      // If still not enough, try Google
      if (results.length < 2) {
        const googleResults = await googleScrape(query, maxResults);
        if (googleResults.success) {
          results.push(...googleResults.results.filter(r => !results.find(e => e.url === r.url)));
        }
      }
    }
    
    return { success: true, results };
  } catch (error) {
    console.error(`Web search failed for ${query}:`, error.message);
    
    // Try fallbacks on error too
    let results = [];
    try {
      const bingResults = await bingSearch(query, maxResults);
      if (bingResults.success) {
        results.push(...bingResults.results);
      }
    } catch (e) { /* ignore */ }
    
    if (results.length < 2) {
      try {
        const googleResults = await googleScrape(query, maxResults);
        if (googleResults.success) {
          results.push(...googleResults.results.filter(r => !results.find(e => e.url === r.url)));
        }
      } catch (e) { /* ignore */ }
    }
    
    if (results.length > 0) {
      return { success: true, results };
    }
    
    return { success: false, results: [], error: error.message };
  }
}

// Fetch and extract content from a URL
async function fetchAndExtract(url, maxChars = 3000) {
  try {
    const response = await fetchWithTimeout(url, 30000);
    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }
    
    const html = await response.text();
    const $ = cheerio.load(html);
    
    // Remove unwanted elements
    $('script, style, nav, footer, header, iframe, noscript, aside, .sidebar, .ad, .advertisement, .cookie').remove();
    
    // Get main content
    const title = $('title').text().trim();
    const mainContent = $('main, article, .content, #content, .main, #main, .post, .article-body')
      .first()
      .text()
      .replace(/\s+/g, ' ')
      .trim();
    
    const bodyText = mainContent || $('body').text().replace(/\s+/g, ' ').trim();
    
    return {
      success: true,
      title,
      content: bodyText.slice(0, maxChars),
      url
    };
  } catch (error) {
    return { success: false, error: error.message, url };
  }
}

// Comprehensive web research for a company
export async function conductWebResearch(companyName, websiteUrl) {
  console.log(`    🌐 Conducting web research for: ${companyName}`);
  
  const results = {
    companyInfo: [],
    linkedinInfo: null,
    crunchbaseInfo: null,
    reviewsInfo: [],
    generalInfo: []
  };
  
  // Search queries to run
  const searches = [
    { query: `"${companyName}" company overview about`, type: 'companyInfo' },
    { query: `"${companyName}" CEO founder leadership team`, type: 'companyInfo' },
    { query: `"${companyName}" revenue employees size funding`, type: 'companyInfo' },
    { query: `site:linkedin.com/company "${companyName}"`, type: 'linkedin' },
    { query: `site:crunchbase.com "${companyName}"`, type: 'crunchbase' },
    { query: `"${companyName}" reviews customers testimonials`, type: 'reviews' }
  ];
  
  // Run searches in parallel (2 at a time to avoid rate limiting)
  for (let i = 0; i < searches.length; i += 2) {
    const batch = searches.slice(i, i + 2);
    const batchResults = await Promise.all(
      batch.map(s => webSearch(s.query, 3))
    );
    
    for (let j = 0; j < batch.length; j++) {
      const searchResult = batchResults[j];
      const searchType = batch[j].type;
      
      if (searchResult.success && searchResult.results.length > 0) {
        if (searchType === 'linkedin') {
          results.linkedinInfo = searchResult.results[0];
        } else if (searchType === 'crunchbase') {
          results.crunchbaseInfo = searchResult.results[0];
        } else if (searchType === 'reviews') {
          results.reviewsInfo = searchResult.results;
        } else {
          results.companyInfo.push(...searchResult.results);
        }
      }
    }
    
    // Small delay between batches
    if (i + 2 < searches.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  
  // Fetch content from top results (limit to 3 to save time)
  const urlsToFetch = [
    ...results.companyInfo.slice(0, 2).map(r => r.url),
    results.linkedinInfo?.url,
    results.crunchbaseInfo?.url
  ].filter(Boolean).slice(0, 4);
  
  const fetchedContent = [];
  for (const url of urlsToFetch) {
    // Skip PDFs and other non-HTML
    if (url.match(/\.(pdf|doc|docx|xls|xlsx|ppt|pptx)$/i)) continue;
    
    const content = await fetchAndExtract(url, 2000);
    if (content.success) {
      fetchedContent.push(content);
      console.log(`    📄 Fetched content from: ${url.slice(0, 60)}...`);
    }
  }
  
  results.fetchedContent = fetchedContent;
  results.totalSearchResults = results.companyInfo.length + results.reviewsInfo.length;
  
  // Additional research sources
  try {
    console.log('    📚 Checking Wikipedia...');
    const wikiResult = await searchWikipedia(companyName);
    if (wikiResult.success) {
      results.wikipediaInfo = wikiResult;
      console.log(`    ✓ Found Wikipedia article: ${wikiResult.title}`);
    }
  } catch (e) { /* ignore */ }
  
  try {
    console.log('    📈 Checking financial data...');
    const financeResult = await searchYahooFinance(companyName);
    if (financeResult.success && financeResult.results.length > 0) {
      results.financeInfo = financeResult.results;
      console.log(`    ✓ Found ${financeResult.results.length} financial records`);
    }
  } catch (e) { /* ignore */ }
  
  try {
    console.log('    📰 Checking industry news...');
    const newsResult = await searchIndustryNews(companyName);
    if (newsResult.success) {
      results.industryNews = newsResult.news;
      console.log(`    ✓ Found ${newsResult.news.length} industry news articles`);
    }
  } catch (e) { /* ignore */ }
  
  // Search Reddit for company discussions
  try {
    console.log('    💬 Checking Reddit discussions...');
    const redditResult = await searchReddit(companyName);
    if (redditResult.success && redditResult.posts.length > 0) {
      results.redditPosts = redditResult.posts;
      console.log(`    ✓ Found ${redditResult.posts.length} Reddit discussions`);
    }
  } catch (e) { /* ignore */ }
  
  // Search SEC filings for public companies
  try {
    console.log('    📋 Checking SEC filings...');
    const secResult = await searchSECFilings(companyName);
    if (secResult.success && secResult.filings.length > 0) {
      results.secFilings = secResult.filings;
      console.log(`    ✓ Found ${secResult.filings.length} SEC filings`);
    }
  } catch (e) { /* ignore */ }
  
  console.log(`    ✅ Web research complete: ${results.totalSearchResults} search results, ${fetchedContent.length} pages fetched`);
  
  return results;
}

// Scrape team/leadership page for real names
export async function scrapeTeamPage(baseUrl) {
  const teamPaths = ['/team', '/leadership', '/our-team', '/about/team', '/about/leadership', '/people', '/attorneys', '/professionals', '/management'];
  
  for (const path of teamPaths) {
    try {
      const url = new URL(path, baseUrl).href;
      const response = await fetchWithTimeout(url, 10000);
      
      if (!response.ok) continue;
      
      const html = await response.text();
      const $ = cheerio.load(html);
      
      $('script, style, nav, footer, header').remove();
      
      // Extract people names and roles
      const people = [];
      
      // Look for common patterns
      $('h3, h4, .name, .person-name, .team-member-name, .attorney-name').each((_, el) => {
        const name = $(el).text().trim();
        const parent = $(el).parent();
        const role = parent.find('.title, .role, .position, .job-title').first().text().trim() || 
                     $(el).next().text().trim().slice(0, 100);
        
        if (name.length > 3 && name.length < 50 && name.includes(' ') && !name.includes('©')) {
          people.push({ name, role: role.slice(0, 100) });
        }
      });
      
      // Also look for structured data
      $('[itemtype*="Person"]').each((_, el) => {
        const name = $(el).find('[itemprop="name"]').text().trim();
        const role = $(el).find('[itemprop="jobTitle"]').text().trim();
        if (name.length > 3) {
          people.push({ name, role });
        }
      });
      
      if (people.length > 0) {
        return { success: true, people: people.slice(0, 20), url };
      }
    } catch (error) {
      continue;
    }
  }
  
  return { success: false, people: [] };
}

// Scrape careers page for hiring signals
export async function scrapeCareersPage(baseUrl) {
  const careerPaths = ['/careers', '/jobs', '/join-us', '/work-with-us', '/careers/open-positions', '/about/careers'];
  
  for (const path of careerPaths) {
    try {
      const url = new URL(path, baseUrl).href;
      const response = await fetchWithTimeout(url, 10000);
      
      if (!response.ok) continue;
      
      const html = await response.text();
      const $ = cheerio.load(html);
      
      $('script, style, nav, footer').remove();
      
      const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
      
      // Count job listings
      const jobCount = ($('.job-listing, .job-item, .position, .career-item, .opening').length) ||
                       (bodyText.match(/apply now|view job|learn more/gi) || []).length;
      
      // Extract job titles
      const jobs = [];
      $('h2, h3, h4, .job-title, .position-title').each((_, el) => {
        const title = $(el).text().trim();
        if (title.length > 5 && title.length < 100 && 
            (title.match(/manager|director|analyst|engineer|specialist|coordinator|assistant|associate|executive/i))) {
          jobs.push(title);
        }
      });
      
      if (jobCount > 0 || jobs.length > 0) {
        return { success: true, jobCount, jobs: jobs.slice(0, 10), url };
      }
    } catch (error) {
      continue;
    }
  }
  
  return { success: false, jobCount: 0, jobs: [] };
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
    // Format team members if available
    const teamSection = scrapedData.teamMembers?.length > 0 
      ? `TEAM/LEADERSHIP (${scrapedData.teamMembers.length} people found):\n${scrapedData.teamMembers.map(p => `- ${p.name}${p.role ? ` (${p.role})` : ''}`).join('\n')}`
      : 'NO TEAM DATA FOUND';
    
    // Format careers info if available
    const careersSection = scrapedData.careersInfo 
      ? `HIRING STATUS: ${scrapedData.careersInfo.jobCount || 0} open positions\nOpen roles: ${scrapedData.careersInfo.jobs?.join(', ') || 'Unknown'}`
      : 'NO CAREERS DATA FOUND';
    
    // Format press releases if available
    const pressSection = scrapedData.pressReleases?.releases?.length > 0
      ? `PRESS RELEASES/ANNOUNCEMENTS:\n${scrapedData.pressReleases.releases.map(r => `- ${r.title} (${r.pubDate})`).join('\n')}`
      : '';
    
    // Format executive news if available
    const execSection = scrapedData.executiveNews?.mentions?.length > 0
      ? `EXECUTIVE/LEADERSHIP NEWS:\n${scrapedData.executiveNews.mentions.map(m => `- ${m.title}`).join('\n')}`
      : '';
    
    // Format job news if available
    const jobSection = scrapedData.jobNews?.jobs?.length > 0
      ? `HIRING/GROWTH NEWS:\n${scrapedData.jobNews.jobs.map(j => `- ${j.title}`).join('\n')}`
      : '';
    
    // Format web research data if available
    const webResearchSection = scrapedData.webResearch?.fetchedContent?.length > 0
      ? `WEB SEARCH RESULTS (${scrapedData.webResearch.fetchedContent.length} pages):\n${scrapedData.webResearch.fetchedContent.map(c => `[${c.title}] (${c.url}):\n${c.content.slice(0, 1500)}`).join('\n\n')}`
      : '';
    
    const webSearchSnippets = scrapedData.webResearch?.companyInfo?.length > 0
      ? `SEARCH SNIPPETS:\n${scrapedData.webResearch.companyInfo.map(r => `- ${r.title}: ${r.snippet}`).join('\n')}`
      : '';
    
    const linkedinInfo = scrapedData.webResearch?.linkedinInfo
      ? `LINKEDIN: ${scrapedData.webResearch.linkedinInfo.title} - ${scrapedData.webResearch.linkedinInfo.snippet}`
      : '';
    
    const crunchbaseInfo = scrapedData.webResearch?.crunchbaseInfo
      ? `CRUNCHBASE: ${scrapedData.webResearch.crunchbaseInfo.title} - ${scrapedData.webResearch.crunchbaseInfo.snippet}`
      : '';
    
    const prompt = `You are an expert B2B sales researcher. This is research attempt #${attempt}. Analyze ALL available data thoroughly and provide detailed, actionable insights.

COMPANY: ${companyName}
WEBSITE: ${scrapedData.url}

═══════════════════════════════════════════
WEBSITE INTELLIGENCE
═══════════════════════════════════════════
Title: ${scrapedData.title}
Meta Description: ${scrapedData.metaDescription}
Main Headings: ${scrapedData.headings?.h1s?.join(', ') || 'None found'}
Sub Headings: ${scrapedData.headings?.h2s?.join(', ') || 'None found'}

MAIN CONTENT:
${scrapedData.bodyText?.slice(0, 2500) || 'No content extracted'}

${scrapedData.aboutPageContent ? `ABOUT PAGE:\n${scrapedData.aboutPageContent.slice(0, 1500)}` : ''}

${scrapedData.extendedPages?.length > 0 ? `ADDITIONAL PAGES:\n${scrapedData.extendedPages.map(p => `[${p.path}]: ${p.content.slice(0, 400)}`).join('\n')}` : ''}

═══════════════════════════════════════════
WEB SEARCH INTELLIGENCE (from Google/DuckDuckGo)
═══════════════════════════════════════════
${webSearchSnippets || 'No web search snippets found'}

${linkedinInfo}
${crunchbaseInfo}

${webResearchSection || 'No additional web content fetched'}

═══════════════════════════════════════════
PEOPLE INTELLIGENCE
═══════════════════════════════════════════
${teamSection}

═══════════════════════════════════════════
HIRING/GROWTH INTELLIGENCE
═══════════════════════════════════════════
${careersSection}
${jobSection}

═══════════════════════════════════════════
NEWS INTELLIGENCE
═══════════════════════════════════════════
${scrapedData.news?.articles?.length > 0 ? `RECENT NEWS (${scrapedData.news.articles.length} articles):\n${scrapedData.news.articles.map(a => `- ${a.title} (${a.pubDate})`).join('\n')}` : 'NO RECENT NEWS FOUND'}

${pressSection}
${execSection}

═══════════════════════════════════════════
OUR SERVICE (what we're selling):
${serviceProfile || 'AI automation solutions for business operations'}

═══════════════════════════════════════════
CRITICAL RULES - READ CAREFULLY:
═══════════════════════════════════════════
1. DO NOT INVENT OR HALLUCINATE FACTS. Only include information that appears VERBATIM in the scraped data above.
2. Every personalizedHook MUST include a citation in parentheses: (source: website), (per press release Nov 2024), (from careers page), etc.
3. If you cannot find a specific fact in the data, DO NOT MAKE IT UP. Leave the field empty or say "Not found in data".
4. researchQuality score MUST reflect whether you have REAL cited facts, not whether the fields are filled.

═══════════════════════════════════════════
SCORING CRITERIA (strict assessment):
- Score 9-10: EXCELLENT - Has 3+ hooks with explicit citations referencing specific data points found in the scraped content
- Score 7-8: GOOD - Has 2+ hooks with citations, with data verifiable from scraped content
- Score 5-6: BASIC - Only 1 hook with citation, or citations without dates/specifics
- Score 1-4: POOR - No hooks have citations, or data cannot be verified from scraped content

Return a JSON object with these fields:
{
  "companyOverview": "Detailed 3-4 sentence summary citing SPECIFIC facts FROM THE DATA ABOVE (e.g., 'Founded in 2015, headquartered in Houston, 500+ employees per LinkedIn')",
  "industryVertical": "Their specific industry/niche",
  "companySize": "Estimate with source (e.g., '~2,000 employees based on job listings', '$500M+ revenue per SEC filing')",
  "keyServices": ["SPECIFIC services from website - quote actual service names found in data"],
  "potentialPainPoints": ["SPECIFIC pain points with reasoning (e.g., 'Scaling logistics - hiring 15 operations roles per careers page')"],
  "recentTriggers": ["SPECIFIC events with dates/sources (e.g., 'Acquired ABC Corp in Oct 2024 per press release')"],
  "personalizedHooks": [
    "HOOK WITH CITATION: Example: 'Your recent expansion into the Midwest (announced Nov 2024 per press release) suggests you're scaling operations rapidly'",
    "HOOK WITH CITATION: Example: 'With John Smith joining as CTO (per LinkedIn Nov 2024), I imagine AI automation is now a priority'",
    "HOOK WITH CITATION: Example: 'Your focus on \"seamless logistics\" (per your homepage) aligns with what our AI solutions deliver'",
    "HOOK WITH CITATION: Example: 'I noticed you're hiring 10 data analysts (per careers page) - we could automate 40% of that workflow'",
    "ONLY include hooks where you found the fact in the data above. Do not invent hooks."
  ],
  "keyPeople": ["Name - Title (source: LinkedIn/website/news) - ONLY if found in data"],
  "hiringInsights": "Specific insights from job listings with numbers - ONLY if found in data",
  "competitiveAdvantage": "What makes them unique - quote from their messaging if found",
  "outreachAngle": "The BEST angle citing specific evidence from the data",
  "researchQuality": "Score 1-10 based on how many hooks have REAL citations from the data above",
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
    teamPage: null,
    careersPage: null,
    news: null,
    pressReleases: null,
    jobNews: null,
    executiveNews: null,
    extendedPages: [],
    servicesPages: [],
    webResearch: null
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
      // PASS 1: Standard research + team page + careers + WEB SEARCH
      if (attempt === 1) {
        console.log(`    📄 Pass 1: Multi-source intelligence gathering...`);
        attemptLog.strategies.push('standard_scrape', 'web_search');
        
        // Parallel scraping for speed - including web search
        const [mainSite, aboutPage, teamPage, careersPage, news, webResearch] = await Promise.all([
          scrapeWebsite(websiteUrl),
          scrapeAboutPage(websiteUrl),
          scrapeTeamPage(websiteUrl),
          scrapeCareersPage(websiteUrl),
          searchCompanyNews(companyName),
          conductWebResearch(companyName, websiteUrl)
        ]);
        
        accumulatedData.mainSite = mainSite;
        accumulatedData.aboutPage = aboutPage;
        accumulatedData.teamPage = teamPage;
        accumulatedData.careersPage = careersPage;
        accumulatedData.news = news;
        accumulatedData.webResearch = webResearch;
        
        if (teamPage.success) {
          console.log(`    👥 Found ${teamPage.people?.length || 0} team members`);
        }
        if (careersPage.success) {
          console.log(`    💼 Found ${careersPage.jobCount || 0} job listings`);
        }
        if (webResearch.totalSearchResults > 0) {
          console.log(`    🌐 Web search found ${webResearch.totalSearchResults} results, fetched ${webResearch.fetchedContent?.length || 0} pages`);
        }
      }
      
      // PASS 2: Extended intelligence - executive news, press releases, hiring signals
      if (attempt >= 2 && accumulatedData.mainSite?.success) {
        console.log(`    📄 Pass 2: Extended intelligence gathering...`);
        attemptLog.strategies.push('extended_intelligence');
        
        // Parallel multi-source news search
        const [extendedNews, pressReleases, jobNews, executiveNews] = await Promise.all([
          searchCompanyNewsExtended(companyName),
          searchPressReleases(companyName),
          searchCompanyJobs(companyName),
          searchExecutives(companyName)
        ]);
        
        accumulatedData.news = extendedNews;
        accumulatedData.pressReleases = pressReleases;
        accumulatedData.jobNews = jobNews;
        accumulatedData.executiveNews = executiveNews;
        
        console.log(`    📰 News: ${extendedNews.articles?.length || 0}, Press: ${pressReleases.releases?.length || 0}, Jobs: ${jobNews.jobs?.length || 0}, Execs: ${executiveNews.mentions?.length || 0}`);
        
        // Scrape additional pages
        const moreAboutPages = await scrapeExtendedPages(websiteUrl, EXTENDED_ABOUT_PATHS);
        accumulatedData.extendedPages = [...accumulatedData.extendedPages, ...moreAboutPages];
        
        const servicePages = await scrapeExtendedPages(websiteUrl, EXTENDED_SERVICE_PATHS);
        accumulatedData.servicesPages = [...accumulatedData.servicesPages, ...servicePages];
      }
      
      // PASS 3: Deep dive - alternative URLs, retry team page with more paths
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
          
          // Retry team page on alt URL
          if (!accumulatedData.teamPage?.success) {
            accumulatedData.teamPage = await scrapeTeamPage(altUrl);
          }
        }
      }
      
      // Run AI analysis with all accumulated data
      if (accumulatedData.mainSite?.success || accumulatedData.webResearch?.fetchedContent?.length > 0) {
        console.log(`    🤖 AI analysis (attempt ${attempt})...`);
        
        const combinedData = {
          ...accumulatedData.mainSite,
          aboutPageContent: accumulatedData.aboutPage?.bodyText || '',
          teamMembers: accumulatedData.teamPage?.people || [],
          careersInfo: accumulatedData.careersPage?.success ? {
            jobCount: accumulatedData.careersPage.jobCount,
            jobs: accumulatedData.careersPage.jobs
          } : null,
          news: accumulatedData.news,
          pressReleases: accumulatedData.pressReleases,
          jobNews: accumulatedData.jobNews,
          executiveNews: accumulatedData.executiveNews,
          extendedPages: [...accumulatedData.extendedPages, ...accumulatedData.servicesPages],
          webResearch: accumulatedData.webResearch
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
