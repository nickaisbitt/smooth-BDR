
import { GoogleGenAI } from "@google/genai";
import { ServiceProfile, Lead, LeadStatus, AnalysisResult, StrategyNode, DecisionMaker, TriggerEvent, EmailDraft } from "../types";
import { v4 as uuidv4 } from 'uuid';
import { loadOpenRouterKey } from './storageService';

// Initialize Gemini client (Primary)
const apiKey = process.env.API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

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
        // 1. Try direct parse
        return JSON.parse(text);
    } catch (e) {
        // 2. Remove Markdown code blocks if present
        let cleanText = text.replace(/```json/g, '').replace(/```/g, '');
        
        // 3. Find the first '{' or '[' and the last '}' or ']'
        const firstOpen = cleanText.search(/(\{|\[)/);
        const lastClose = cleanText.search(/(\}|\])(?=[^}\]]*$)/);
        
        if (firstOpen !== -1 && lastClose !== -1) {
            cleanText = cleanText.substring(firstOpen, lastClose + 1);
            try {
                return JSON.parse(cleanText);
            } catch (e2) {
                // 4. Aggressive Cleanup for "Laziness" (e.g. "type": "hiring"|"news")
                // This regex removes the |"news" part if the AI blindly copied the prompt structure
                const aggressiveClean = cleanText.replace(/"hiring"\|"news"/g, '"hiring"'); 
                try {
                     return JSON.parse(aggressiveClean);
                } catch (e3) {
                     console.warn("JSON Parse Failed even after cleanup:", cleanText);
                }
            }
        }
        
        // 4. Fallback for array literals in text
        if (text.trim().startsWith('[')) return [];
        return {};
    }
}

// COST TRACKING CALLBACK
export let onCostIncrement: ((cents: number) => void) | null = null;
export const setCostCallback = (cb: (cents: number) => void) => { onCostIncrement = cb; };

/**
 * Executes an API call with exponential backoff for 429/500 errors.
 */
export async function withHybridEngine<T>(
    primaryOperation: () => Promise<T>, 
    fallbackOperation: () => Promise<T>,
    retries = 5, 
    backoff = 5000 
): Promise<T> {
    // Increment Operation Count (free tier default)
    if (onCostIncrement) onCostIncrement(0); 

    try {
        return await primaryOperation();
    } catch (error: any) {
        const isQuotaError = error?.status === 429 || error?.code === 429 || error?.error?.code === 429 || error?.message?.includes('429') || error?.message?.includes('quota') || error?.message?.includes('RESOURCE_EXHAUSTED');
        const isServerError = error?.status === 500 || error?.code === 500 || error?.error?.code === 500 || error?.message?.includes('Internal error') || error?.status === 503;

        if (isQuotaError || isServerError) {
            console.warn(`⚠️ Engine Warning: ${isQuotaError ? 'Quota Limit' : 'Server Error'}. Retrying in ${backoff}ms...`);
            if (retries > 0) {
                await delay(backoff);
                return withHybridEngine(primaryOperation, fallbackOperation, retries - 1, backoff * 1.5);
            } else {
                const openRouterKey = loadOpenRouterKey();
                if (openRouterKey) {
                    console.log("🔄 Switching to OpenRouter Fallback Engine...");
                    return await fallbackOperation();
                } else {
                    throw new Error(isQuotaError ? "QUOTA_EXHAUSTED" : "SERVER_ERROR");
                }
            }
        }
        throw error;
    }
}

async function callOpenRouter(model: string, messages: { role: string, content: string }[], responseSchema?: any): Promise<string> {
    const key = loadOpenRouterKey();
    if (!key) throw new Error("No OpenRouter Key available for fallback");

    // Estimate Cost (Rough approximation: $0.0001 per call for flash models)
    if (onCostIncrement) onCostIncrement(0.01);

    const payload: any = {
        model: model,
        messages: messages,
        temperature: 0.7,
    };
    
    if (responseSchema && !model.includes('sonar')) {
         payload.response_format = { type: "json_object" };
    }

    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${key}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://smoothai.com",
                "X-Title": "Smooth AI AutoBDR"
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`OpenRouter Error: ${err}`);
        }

        const data = await response.json();
        let content = data.choices?.[0]?.message?.content || "";
        return content;
    } catch (e) {
        throw e;
    }
}

export const testOpenRouterConnection = async (): Promise<boolean> => {
    try {
        const result = await callOpenRouter("google/gemini-2.0-flash-001", [{ role: "user", content: "ping" }], false);
        return !!result;
    } catch (e) {
        console.error("OpenRouter Test Failed", e);
        throw e;
    }
};

// --- SERVICES ---

export const generateMasterPlan = async (pastStrategies: string[]): Promise<StrategyNode[]> => {
    const historyContext = pastStrategies.slice(-15).join("; ");
    const systemPrompt = `Role: Head of Growth for Smooth AI. Context: Systematic attack plan. Avoid: [${historyContext}]`;
    const userPrompt = `
      TASK:
      1. Use Google Search to identify 6 'Old World' industries facing operational headwinds right now.
      2. Focus on: Logistics, HVAC, Manufacturing, Legal, Dentistry, Wholesale.
      3. Generate 6 distinct "Search Strategies".
      4. Return ONLY a JSON array. 
      Example: [{"sector": "HVAC Supply (Midwest)", "query": "HVAC wholesale distributors in Ohio", "rationale": "Paper invoices."}]
    `;

    return withHybridEngine(
        async () => {
            if (!apiKey) throw new Error("API Key missing");
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: systemPrompt + userPrompt,
                config: { tools: [{ googleSearch: {} }] }
            });
            const text = response.text || "[]";
            const extracted = extractJson(text);
            let plans: any[] = [];
            if (Array.isArray(extracted)) plans = extracted;
            else if (extracted && Array.isArray(extracted.plans)) plans = extracted.plans;
            else if (extracted && Array.isArray(extracted.strategies)) plans = extracted.strategies;
            else throw new Error("AI generated invalid plan format");

            return plans.map((p: any) => ({ 
                id: uuidv4(), sector: p.sector || "Unknown", query: p.query || "Strategy", rationale: p.rationale || "Automated", status: 'pending' 
            }));
        },
        async () => {
            const jsonStr = await callOpenRouter("google/gemini-2.0-flash-001", [{ role: "system", content: systemPrompt + " Return JSON array." }, { role: "user", content: userPrompt }], true);
            const extracted = extractJson(jsonStr || "[]");
            let plans: any[] = [];
             if (Array.isArray(extracted)) plans = extracted;
            else if (extracted && Array.isArray(extracted.plans)) plans = extracted.plans;
            else return [];
            return plans.map((p: any) => ({ id: uuidv4(), sector: p.sector, query: p.query, rationale: p.rationale, status: 'pending' }));
        }
    );
};

export const findLeads = async (query: string, blacklist: string[] = []): Promise<{ leads: Partial<Lead>[], urls: string[] }> => {
  const promptText = `
    Role: Expert BDR.
    Task: Find 5-8 ACTUAL operating companies matching: "${query}".
    
    CRITICAL FILTERS (Do Not Fail These):
    1. EXCLUDE Directories (Yelp, LinkedIn, Clutch, YellowPages, BBB).
    2. EXCLUDE domains containing: [${blacklist.join(', ')}].
    3. EXCLUDE Government (.gov) or Education (.edu).
    4. MUST be a private business website.
    
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
                  
                  // Clean URL
                  url = url.replace(/\/$/, ''); // Remove trailing slash
                  if (!url.startsWith('http')) url = `https://${url}`;
                  
                  // Logic Check: Is it a directory?
                  const isDirectory = /yelp|linkedin|clutch|yellowpages|bbb|facebook|instagram/i.test(url);
                  const isBlocked = blacklist.some(term => url.toLowerCase().includes(term.toLowerCase()) || name.toLowerCase().includes(term.toLowerCase()));
                  
                  // B2B FILTER: Reject personal emails or bad domains
                  const isPersonal = /gmail\.com|yahoo\.com|hotmail\.com|outlook\.com|aol\.com/i.test(url);
                  
                  if (!isBlocked && !isDirectory && !isPersonal && name.length > 2 && desc.length > 5) {
                      leads.push({ companyName: name, website: url, description: desc, status: LeadStatus.NEW });
                  }
              }
          }
      });
      return leads;
  };

  return withHybridEngine(
      async () => {
          if (!apiKey) throw new Error("API Key missing");
          const response = await ai.models.generateContent({
              model: 'gemini-2.5-flash',
              contents: promptText,
              config: { tools: [{ googleSearch: {} }], temperature: 0.7 },
          });
          
          const text = response.text || "";
          const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
          const validGroundingUrls = groundingChunks.map(c => c.web?.uri).filter(u => u && !u.includes('yelp') && !u.includes('linkedin')) as string[];
          
          return { leads: processLeads(text), urls: validGroundingUrls };
      },
      async () => {
          // Use valid Perplexity model ID
          const text = await callOpenRouter("perplexity/sonar", [{ role: "user", content: promptText }]);
          return { leads: processLeads(text), urls: [] };
      }
  );
};

export const findDecisionMaker = async (companyName: string, website: string): Promise<DecisionMaker | null> => {
    // UPDATED PROMPT: Aggressively hunt for email addresses
    const prompt = `Task: Find CEO/Owner/Founder of "${companyName}" (${website}). 
    CRITICAL: HUNT FOR EMAIL ADDRESSES. Try to find direct email (e.g. first@company.com) or generic (hello@company.com).
    Return JSON: { "name": "Full Name", "role": "Title", "linkedinUrl": "URL", "email": "found_or_guessed_email" }. 
    If not found, guess based on common patterns.`;
    
    return withHybridEngine(
        async () => {
            if (!apiKey) throw new Error("API Key missing");
            const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt, config: { tools: [{ googleSearch: {} }] } });
            return extractJson(response.text || "");
        },
        async () => {
            // Use valid Perplexity model ID
            const jsonStr = await callOpenRouter("perplexity/sonar", [{ role: "user", content: prompt }]);
            return extractJson(jsonStr) || null;
        }
    );
};

export const findTriggers = async (companyName: string, website: string): Promise<TriggerEvent[]> => {
    const prompt = `Task: Find active hiring (e.g. "Admin", "Dispatcher"), news, or expansion signals for "${companyName}" (${website}). Return JSON Array: [{ "type": "hiring", "description": "Hiring 3 admins", "sourceUrl": "url" }]. If no hiring, look for "news". Choose ONE type.`;
    return withHybridEngine(
        async () => {
             if (!apiKey) throw new Error("API Key missing");
             const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt, config: { tools: [{ googleSearch: {} }] } });
            return extractJson(response.text || "") || [];
        },
        async () => {
            // Use valid Perplexity model ID
            const jsonStr = await callOpenRouter("perplexity/sonar", [{ role: "user", content: prompt }]);
            return extractJson(jsonStr) || [];
        }
    );
}

export const analyzeLeadFitness = async (lead: Lead, profile: ServiceProfile): Promise<{analysis: AnalysisResult, techStack: string[]}> => {
  const prompt = `
    Analyze lead: ${lead.companyName} (${lead.website}) for Smooth AI (Operational Automation).
    ${SMOOTH_AI_CONTEXT}
    
    TASK:
    1. Estimate Tech Spend/Budget.
    2. Identify Competitors.
    3. Analyze Sentiment (Glassdoor/Reviews for manual work complaints).

    SCORING RULES:
    - If they look like a SaaS/Tech/Agency -> SCORE < 20 (Unqualified).
    - If they look like a manual business (Construction, Logistics, Law, Medical) -> SCORE > 70.
    - If they mention "Fax", "Paper", "Call to book" -> SCORE > 90.

    OUTPUT JSON: { "score": number, "reasoning": "Be harsh and specific.", "suggestedAngle": "Automation hook", "painPoints": ["..."], "techStack": ["..."], "budgetEstimate": "e.g. $5k/mo", "competitors": ["..."], "employeeSentiment": "Negative/Positive" }
  `;

  return withHybridEngine(
      async () => {
        if (!apiKey) throw new Error("API Key missing");
        const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt, config: { tools: [{ googleSearch: {} }] } });
        const res = extractJson(response.text || "{}");
        return { analysis: { score: res.score || 0, reasoning: res.reasoning || "No analysis", suggestedAngle: res.suggestedAngle || "General", painPoints: res.painPoints || [], budgetEstimate: res.budgetEstimate, competitors: res.competitors, employeeSentiment: res.employeeSentiment }, techStack: res.techStack || [] };
      },
      async () => {
          const jsonStr = await callOpenRouter("google/gemini-2.0-flash-001", [{ role: "user", content: prompt + " Return JSON." }], true);
          const res = extractJson(jsonStr || "{}");
           return { analysis: { score: res.score || 0, reasoning: res.reasoning || "No analysis", suggestedAngle: res.suggestedAngle || "General", painPoints: res.painPoints || [], budgetEstimate: res.budgetEstimate, competitors: res.competitors, employeeSentiment: res.employeeSentiment }, techStack: res.techStack || [] };
      }
  );
};

export const generateEmailSequence = async (lead: Lead, profile: ServiceProfile, analysis: AnalysisResult, triggers: TriggerEvent[]): Promise<EmailDraft[]> => {
    const contactName = lead.decisionMaker?.name ? lead.decisionMaker.name.split(' ')[0] : "Team";
    const senderInfo = profile.senderName ? `${profile.senderName}` : profile.companyName;

    const triggerContext = triggers.length > 0 ? `Trigger: ${triggers[0].description}` : `Hook: ${analysis.suggestedAngle}`;

    const prompt = `
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
      
      OUTPUT JSON Array:
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

    return withHybridEngine(
        async () => {
            if (!apiKey) throw new Error("API Key missing");
            const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt, config: { responseMimeType: "application/json" } });
            return extractJson(response.text || "[]");
        },
        async () => {
            const jsonStr = await callOpenRouter("google/gemini-2.0-flash-001", [{ role: "user", content: prompt + " Return JSON array." }], true);
            return extractJson(jsonStr || "[]");
        }
    );
};