import { ServiceProfile, Lead, LeadStatus, AnalysisResult, StrategyNode, DecisionMaker, TriggerEvent, EmailDraft } from "../types";
import { v4 as uuidv4 } from 'uuid';

// --- SMOOTH AI KNOWLEDGE BASE ---
const SMOOTH_AI_CONTEXT = `
WHO WE ARE:
Smooth AI Consulting. 
Motto: "Don't Just Hire. Evolve."
Mission: Replace Manual Admin Chaos with a Digital Workforce.
CONTACT: nick@smoothaiconsultancy.com

OUR SUCCESSFUL CASE STUDIES (Use these to compare leads against):
1. LOGISTICS (Regional Logistics Co):
   - Problem: Dispatch team drowning in manual calls and messy scheduling.
   - Solution: Automated Dispatch System.
   - Result: -15hrs Admin/Week, $45k Annual Savings.
   
2. LEGAL (Boutique Firm):
   - Problem: Partners wasting hours reviewing standard boilerplate contracts.
   - Solution: Document Review AI.
   - Result: 20hrs -> 2hrs/week, Zero missed clauses.

3. HEALTHCARE (Dental Practice Group):
   - Problem: Front desk overwhelmed, missing patient calls.
   - Solution: Voice + SMS Booking Agent.
   - Result: 24/7 Answering, +18% New Patients.

OUR TECH STACK:
OpenAI, Anthropic, AWS, Google Cloud, Azure, n8n, LangChain, Pinecone, Zapier, Stack Explorer.
`;

// --- UTILS ---

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Robust JSON extraction that handles Markdown blocks, plain text preambles, and messy AI output.
 */
function extractJson(text: string): any {
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch (e) {
        let cleanText = text.replace(/```json/g, '').replace(/```/g, '');
        
        const firstOpen = cleanText.search(/(\{|\[)/);
        const lastClose = cleanText.search(/(\}|\])(?=[^}\]]*$)/);
        
        if (firstOpen !== -1 && lastClose !== -1) {
            cleanText = cleanText.substring(firstOpen, lastClose + 1);
            try {
                return JSON.parse(cleanText);
            } catch (e2) {
                const aggressiveClean = cleanText.replace(/"hiring"\|"news"/g, '"hiring"'); 
                try {
                     return JSON.parse(aggressiveClean);
                } catch (e3) {
                     console.warn("JSON Parse Failed even after cleanup:", cleanText);
                }
            }
        }
        
        if (text.trim().startsWith('[')) return [];
        return {};
    }
}

// COST TRACKING CALLBACK
export let onCostIncrement: ((cents: number) => void) | null = null;
export const setCostCallback = (cb: (cents: number) => void) => { onCostIncrement = cb; };

/**
 * Make a chat completion call via the backend API
 */
async function chatCompletion(
    systemPrompt: string,
    userPrompt: string,
    model: string = "meta-llama/llama-3.3-70b-instruct",
    retries: number = 3
): Promise<string> {
    if (onCostIncrement) onCostIncrement(0.01);
    
    try {
        const response = await fetch('/api/ai/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ systemPrompt, userPrompt, model })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'AI request failed');
        }
        
        const data = await response.json();
        return data.content || "";
    } catch (error: any) {
        if (retries > 0 && (error.message?.includes('429') || error.message?.includes('rate'))) {
            console.warn(`Rate limit hit. Retrying in 2s...`);
            await delay(2000);
            return chatCompletion(systemPrompt, userPrompt, model, retries - 1);
        }
        throw error;
    }
}

export const testOpenRouterConnection = async (): Promise<boolean> => {
    try {
        const result = await chatCompletion("You are a helpful assistant.", "Say hello in one word.");
        return !!result;
    } catch (e) {
        console.error("OpenRouter Test Failed", e);
        throw e;
    }
};

// --- SERVICES ---

export const generateMasterPlan = async (pastStrategies: string[]): Promise<StrategyNode[]> => {
    const historyContext = pastStrategies.slice(-15).join("; ");
    const systemPrompt = `Role: Head of Growth for Smooth AI. You are creating a systematic attack plan for outbound prospecting. Avoid these previously used strategies: [${historyContext}]`;
    const userPrompt = `
      TASK:
      1. Identify 6 'Old World' industries facing operational headwinds right now.
      2. Focus on: Logistics, HVAC, Manufacturing, Legal, Dentistry, Wholesale.
      3. Generate 6 distinct "Search Strategies" for finding leads.
      4. Return ONLY a JSON array. No other text.
      Example format: [{"sector": "HVAC Supply (Midwest)", "query": "HVAC wholesale distributors in Ohio", "rationale": "Paper invoices."}]
    `;

    const text = await chatCompletion(systemPrompt, userPrompt);
    const extracted = extractJson(text);
    let plans: any[] = [];
    if (Array.isArray(extracted)) plans = extracted;
    else if (extracted && Array.isArray(extracted.plans)) plans = extracted.plans;
    else if (extracted && Array.isArray(extracted.strategies)) plans = extracted.strategies;
    else return [];

    return plans.map((p: any) => ({ 
        id: uuidv4(), 
        sector: p.sector || "Unknown", 
        query: p.query || "Strategy", 
        rationale: p.rationale || "Automated", 
        status: 'pending' 
    }));
};

export const findLeads = async (query: string, blacklist: string[] = []): Promise<{ leads: Partial<Lead>[], urls: string[] }> => {
  const systemPrompt = "You are an expert BDR (Business Development Representative) helping find qualified B2B leads.";
  const userPrompt = `
    Task: Find 5-8 ACTUAL operating companies matching: "${query}".
    
    CRITICAL FILTERS (Do Not Fail These):
    1. EXCLUDE Directories (Yelp, LinkedIn, Clutch, YellowPages, BBB).
    2. EXCLUDE domains containing: [${blacklist.join(', ')}].
    3. EXCLUDE Government (.gov) or Education (.edu).
    4. MUST be a private business website.
    
    B2B FILTER:
    - REJECT if URL contains: gmail, yahoo, hotmail, outlook, facebook, instagram, twitter.
    
    OUTPUT FORMAT (Pipe Delimited):
    || Company Name || Website URL || 1-sentence description ||
  `;

  const processLeads = (text: string) => {
      const leads: Partial<Lead>[] = [];
      const lines = text.split('\n');
      lines.forEach(line => {
          if (line.includes('||')) {
              const parts = line.split('||').map(p => p.trim()).filter(p => p.length > 0);
              if (parts.length >= 3) {
                  const name = parts[0];
                  let url = parts[1];
                  const desc = parts[2];
                  
                  url = url.replace(/\/$/, '');
                  if (!url.startsWith('http')) url = `https://${url}`;
                  
                  const isDirectory = /yelp|linkedin|clutch|yellowpages|bbb|facebook|instagram/i.test(url);
                  const isBlocked = blacklist.some(term => url.toLowerCase().includes(term.toLowerCase()) || name.toLowerCase().includes(term.toLowerCase()));
                  const isPersonal = /gmail\.com|yahoo\.com|hotmail\.com|outlook\.com|aol\.com|protonmail/i.test(url);
                  
                  if (!isBlocked && !isDirectory && !isPersonal && name.length > 2 && desc.length > 5) {
                      leads.push({ companyName: name, website: url, description: desc, status: LeadStatus.NEW });
                  }
              }
          }
      });
      return leads;
  };

  const text = await chatCompletion(systemPrompt, userPrompt);
  return { leads: processLeads(text), urls: [] };
};

export const findDecisionMaker = async (companyName: string, website: string): Promise<DecisionMaker | null> => {
    const systemPrompt = "You are a research assistant helping find decision makers at companies.";
    const userPrompt = `Task: Find CEO/Owner/Founder of "${companyName}" (${website}). 
    Try to find direct email (e.g. first@company.com) or generic (hello@company.com).
    Return JSON only: { "name": "Full Name", "role": "Title", "linkedinUrl": "URL", "email": "found_or_guessed_email" }. 
    If not found, guess based on common email patterns for the company domain.`;
    
    const text = await chatCompletion(systemPrompt, userPrompt);
    return extractJson(text) || null;
};

export const findTriggers = async (companyName: string, website: string): Promise<TriggerEvent[]> => {
    const systemPrompt = "You are a research assistant finding business signals and triggers.";
    const userPrompt = `Task: Find active hiring (e.g. "Admin", "Dispatcher"), news, or expansion signals for "${companyName}" (${website}). 
    Return JSON Array only: [{ "type": "hiring", "description": "Hiring 3 admins", "sourceUrl": "url" }]. 
    If no hiring, look for "news". 
    The "type" field must be one of: "hiring", "news", "growth", "other". Pick one.`;
    
    const text = await chatCompletion(systemPrompt, userPrompt);
    return extractJson(text) || [];
}

export const analyzeLeadFitness = async (lead: Lead, profile: ServiceProfile): Promise<{analysis: AnalysisResult, techStack: string[]}> => {
  const systemPrompt = "You are an expert B2B sales analyst evaluating lead fitness for an AI consulting firm.";
  const userPrompt = `
    Analyze lead: ${lead.companyName} (${lead.website}) for Smooth AI (Operational Automation).
    ${SMOOTH_AI_CONTEXT}
    
    TASK:
    1. Estimate Tech Spend/Budget.
    2. Identify Competitors.
    3. Analyze Sentiment (Glassdoor/Reviews for manual work complaints).

    SCORING RULES:
    - DISQUALIFY (< 20): "Tech-Native" companies (e.g. DoorDash, Uber, SaaS products). They don't need basic automation.
    - DISQUALIFY (< 20): "Global Enterprise" / "Fortune 500" (e.g. FedEx, Amazon, Walmart). They are too big for our boutique model.
    - DISQUALIFY (< 20): "Agencies" or "Consultancies" (Competitors).
    
    - QUALIFY (> 70): "Old World" Mid-Market (Regional Trucking, Local Law Firm, Mid-sized Manufacturer, HVAC Distributor).
    - JACKPOT (> 90): Website mentions "Fax", "Download PDF Form", "Call to book", or looks outdated.

    OUTPUT JSON only: { "score": number, "reasoning": "Be harsh. Explain why they are a fit or NOT.", "suggestedAngle": "Automation hook", "painPoints": ["..."], "techStack": ["..."], "budgetEstimate": "e.g. $5k/mo", "competitors": ["..."], "employeeSentiment": "Negative/Positive" }
  `;

  const text = await chatCompletion(systemPrompt, userPrompt);
  const res = extractJson(text);
  return { 
      analysis: { 
          score: res.score || 0, 
          reasoning: res.reasoning || "No analysis", 
          suggestedAngle: res.suggestedAngle || "General", 
          painPoints: res.painPoints || [], 
          budgetEstimate: res.budgetEstimate, 
          competitors: res.competitors, 
          employeeSentiment: res.employeeSentiment 
      }, 
      techStack: res.techStack || [] 
  };
};

export const generateEmailSequence = async (lead: Lead, profile: ServiceProfile, analysis: AnalysisResult, triggers: TriggerEvent[]): Promise<EmailDraft[]> => {
    const contactName = lead.decisionMaker?.name ? lead.decisionMaker.name.split(' ')[0] : "Team";
    const senderInfo = profile.senderName ? `${profile.senderName}` : profile.companyName;

    const triggerContext = triggers.length > 0 ? `Trigger: ${triggers[0].description}` : `Hook: ${analysis.suggestedAngle}`;

    const systemPrompt = "You are an expert cold email copywriter for B2B sales.";
    const userPrompt = `
      You are the Head of Growth for Smooth AI.
      Write a 3-Email Cold Sequence from ${senderInfo} to ${contactName} at ${lead.companyName}.
      
      REFLECTIVE AI TASK:
      1. Draft the email first (internal thought).
      2. CRITIQUE it: Is it too long? Too salesy? Does it reference the case study?
      3. REWRITE it to be punchy, direct, and valuable.
      
      CONTEXT:
      - Trigger: ${triggerContext}
      - Offer: We automate manual chaos (see case studies in knowledge base).
      
      A/B TESTING TASK:
      - Subject A: A direct question about operations.
      - Subject B: A value-first statement about ${analysis.suggestedAngle}.
      
      OUTPUT JSON Array only:
      [
        { 
            "subject": "Subject A", 
            "alternativeSubject": "Subject B",
            "body": "Email 1 Body (Polished)", 
            "delayDays": 0, 
            "context": "Initial Hook",
            "variantLabel": "A",
            "critique": "Draft 1 was generic. I polished it to reference their specific tech stack."
        },
        { "subject": "Re: [Subject A]", "body": "Email 2 Body (Case Study)", "delayDays": 3, "context": "Value Add", "critique": "Added specific metrics." },
        { "subject": "Re: [Subject A]", "body": "Email 3 Body (Breakup)", "delayDays": 7, "context": "Breakup", "critique": "Kept it low friction." }
      ]
    `;

    const text = await chatCompletion(systemPrompt, userPrompt);
    return extractJson(text) || [];
};
