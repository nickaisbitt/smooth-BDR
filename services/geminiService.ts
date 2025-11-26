
import { GoogleGenAI, Type } from "@google/genai";
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
 * Robust JSON extraction helper.
 * Finds the first valid JSON object or array in a string.
 */
function extractJson(text: string): any {
    try {
        // 1. Try direct parse
        return JSON.parse(text);
    } catch (e) {
        // 2. Try finding JSON block
        const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
        if (jsonMatch) {
            try {
                return JSON.parse(jsonMatch[0]);
            } catch (e2) {
                console.warn("JSON regex match failed parse", e2);
            }
        }
        // 3. Fallback: Return empty object or array based on guess
        if (text.trim().startsWith('[')) return [];
        return {};
    }
}

/**
 * Executes an API call with exponential backoff for 429 errors.
 * If retries fail and an OpenRouter key exists, it triggers the fallback.
 */
async function withHybridEngine<T>(
    primaryOperation: () => Promise<T>, 
    fallbackOperation: () => Promise<T>,
    retries = 5, 
    backoff = 15000 // Increased to 15s to respect 15RPM limit
): Promise<T> {
    try {
        return await primaryOperation();
    } catch (error: any) {
        // Deep inspection for various error formats (Google SDK, Fetch, etc.)
        const isQuotaError = 
            error?.status === 429 || 
            error?.code === 429 ||
            error?.error?.code === 429 ||
            error?.message?.includes('429') || 
            error?.message?.includes('quota') ||
            error?.message?.includes('RESOURCE_EXHAUSTED');

        if (isQuotaError) {
            if (retries > 0) {
                console.warn(`⚠️ Primary Quota hit. Retrying in ${backoff/1000}s...`);
                await delay(backoff);
                return withHybridEngine(primaryOperation, fallbackOperation, retries - 1, backoff * 1.5);
            } else {
                // Check for Backup Key
                const openRouterKey = loadOpenRouterKey();
                if (openRouterKey) {
                    console.log("🔄 Switching to OpenRouter Fallback Engine...");
                    return await fallbackOperation();
                } else {
                    // Re-throw specific error so App.tsx knows it was a quota issue
                    throw new Error("QUOTA_EXHAUSTED");
                }
            }
        }
        throw error;
    }
}

/**
 * Calls OpenRouter API as a fallback
 */
async function callOpenRouter(
    model: string, 
    messages: { role: string, content: string }[], 
    responseSchema?: any
): Promise<string> {
    const key = loadOpenRouterKey();
    if (!key) throw new Error("No OpenRouter Key available for fallback");

    const payload: any = {
        model: model,
        messages: messages,
        temperature: 0.7,
    };
    
    // Markdown stripping helper
    const stripMarkdown = (str: string) => {
        return str.replace(/```json/g, '').replace(/```/g, '').trim();
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
                "HTTP-Referer": "https://smoothai.com", // Required by OpenRouter
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
        if (responseSchema) {
            content = stripMarkdown(content);
        }
        return content;
    } catch (e) {
        console.error("OpenRouter Call Failed", e);
        throw e;
    }
}

// --- SERVICES ---

/**
 * Generates a "Master Plan" containing 6 distinct sub-niches.
 */
export const generateMasterPlan = async (pastStrategies: string[]): Promise<StrategyNode[]> => {
    const historyContext = pastStrategies.slice(-15).join("; ");
    const systemPrompt = `Role: Head of Growth for Smooth AI. Context: Systematic attack plan. Avoid: [${historyContext}]`;
    const userPrompt = `
      TASK:
      1. Choose a Major Industry we haven't targeted recently (Old World industries preferred).
      2. Generate 6 distinct "Search Strategies" for sub-niches.
      3. Return ONLY a JSON array. 
      Example: [{"sector": "HVAC Supply (Midwest)", "query": "HVAC wholesale distributors in Ohio", "rationale": "Paper invoices."}]
    `;

    return withHybridEngine(
        // Primary (Google)
        async () => {
            if (!apiKey) throw new Error("API Key missing");
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: systemPrompt + userPrompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                sector: { type: Type.STRING },
                                query: { type: Type.STRING },
                                rationale: { type: Type.STRING },
                            }
                        }
                    }
                }
            });
            const plans = extractJson(response.text || "[]");
            return plans.map((p: any) => ({ id: uuidv4(), sector: p.sector, query: p.query, rationale: p.rationale, status: 'pending' }));
        },
        // Fallback (OpenRouter)
        async () => {
            const jsonStr = await callOpenRouter(
                "google/gemini-2.0-flash-001", // Or 'openai/gpt-4o-mini'
                [
                    { role: "system", content: systemPrompt + " Return strictly valid JSON." },
                    { role: "user", content: userPrompt }
                ],
                true
            );
            const plans = extractJson(jsonStr || "[]");
            if (plans.plans) return plans.plans.map((p: any) => ({ id: uuidv4(), sector: p.sector, query: p.query, rationale: p.rationale, status: 'pending' }));
            return plans.map((p: any) => ({ id: uuidv4(), sector: p.sector, query: p.query, rationale: p.rationale, status: 'pending' }));
        }
    );
};

/**
 * Sources leads using Google Search Grounding (Primary) or Perplexity (Fallback).
 */
export const findLeads = async (query: string): Promise<{ leads: Partial<Lead>[], urls: string[] }> => {
  const promptText = `
    Role: Expert BDR.
    Task: Find 5-8 ACTUAL operating companies matching: "${query}".
    STRICT RULES:
    1. IGNORE directories (Yelp, LinkedIn, Clutch).
    2. Look for DIRECT company websites.
    3. Focus on "Old World" businesses (Logistics, Legal, Manufacturing) with likely manual processes.
    
    OUTPUT FORMAT:
    Do NOT output JSON. Output a list where each company is on a single line formatted EXACTLY like this:
    || Company Name || Website URL || 1-sentence description ||
  `;

  return withHybridEngine(
      // Primary: Google with Grounding
      async () => {
          if (!apiKey) throw new Error("API Key missing");
          const response = await ai.models.generateContent({
              model: 'gemini-2.5-flash',
              contents: promptText,
              // ENABLED Google Maps and Search tools
              config: { tools: [{ googleSearch: {} }, { googleMaps: {} }], temperature: 0.7 },
          });
          
          const text = response.text || "";
          const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
          
          const validGroundingUrls = groundingChunks
              .map(c => c.web?.uri)
              .filter(u => u && !u.includes('yelp') && !u.includes('linkedin')) as string[];
              
          // Extract Google Maps URIs
          const validMapUrls = groundingChunks
              .map(c => c.maps?.uri)
              .filter(u => u) as string[];
          
          return { leads: parseLeads(text), urls: [...validGroundingUrls, ...validMapUrls] };
      },
      // Fallback: OpenRouter (Perplexity for Search capability)
      async () => {
          // Use Perplexity Sonar if possible for "Live Search" capability via OpenRouter
          const fallbackModel = "perplexity/sonar-small-online"; 
          
          const text = await callOpenRouter(
              fallbackModel,
              [{ role: "user", content: promptText }]
          );
          
          return { leads: parseLeads(text), urls: [] }; // Grounding URLs hard to extract from raw text without metadata
      }
  );
};

function parseLeads(text: string): Partial<Lead>[] {
    const leads: Partial<Lead>[] = [];
    const lines = text.split('\n');
    lines.forEach(line => {
        if (line.includes('||')) {
            const parts = line.split('||').map(p => p.trim()).filter(p => p.length > 0);
            if (parts.length >= 3) {
                const name = parts[0];
                let url = parts[1];
                const desc = parts[2];
                if (!url.startsWith('http')) url = `https://${url}`;
                if (name.length > 2 && desc.length > 5) {
                    leads.push({ companyName: name, website: url, description: desc, status: LeadStatus.NEW });
                }
            }
        }
    });
    return leads;
}

/**
 * Hunts for the Decision Maker (CEO/Founder/Owner).
 */
export const findDecisionMaker = async (companyName: string, website: string): Promise<DecisionMaker | null> => {
    const prompt = `
        Task: Find the CEO, Founder, or Owner of "${companyName}" (${website}).
        Return strictly JSON: { "name": "Full Name", "role": "Title", "linkedinUrl": "URL (optional)" }
        If not found, return null.
    `;

    return withHybridEngine(
        async () => {
            if (!apiKey) throw new Error("API Key missing");
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: { 
                    tools: [{ googleSearch: {} }],
                    // responseMimeType: "application/json" // REMOVED: Cannot use with tools
                }
            });
            const text = response.text;
            if (!text) return null;
            return extractJson(text);
        },
        async () => {
            const jsonStr = await callOpenRouter(
                "perplexity/sonar-small-online", 
                [{ role: "user", content: prompt }]
            );
            return extractJson(jsonStr) || null;
        }
    );
};

/**
 * Finds Trigger Events (News, Hiring, Expansion).
 */
export const findTriggers = async (companyName: string, website: string): Promise<TriggerEvent[]> => {
    const prompt = `
        Task: Find recent hiring, news, or expansion signals for "${companyName}" (${website}).
        Look for: "Hiring Data Entry", "New Office", "Acquisition", "Growing".
        
        Return JSON Array: 
        [{ "type": "hiring"|"news"|"growth", "description": "Hiring 3 admins", "sourceUrl": "url" }]
        
        If nothing significant found, return empty array.
    `;

    return withHybridEngine(
        async () => {
             if (!apiKey) throw new Error("API Key missing");
             const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: { 
                    tools: [{ googleSearch: {} }],
                    // responseMimeType: "application/json" // REMOVED: Cannot use with tools
                }
            });
            const text = response.text;
            if (!text) return [];
            return extractJson(text);
        },
        async () => {
            const jsonStr = await callOpenRouter(
                "perplexity/sonar-small-online", 
                [{ role: "user", content: prompt }]
            );
            return extractJson(jsonStr) || [];
        }
    );
}

/**
 * Analyzes a specific lead.
 */
export const analyzeLeadFitness = async (lead: Lead, profile: ServiceProfile): Promise<{analysis: AnalysisResult, techStack: string[]}> => {
  const prompt = `
    You are a Senior Automation Consultant for Smooth AI.
    Analyze this lead: ${lead.companyName} (${lead.description}).
    Website: ${lead.website}
    ${SMOOTH_AI_CONTEXT}
    
    TASK:
    1. Search for this company to get up-to-date context about their operations, tech stack, and recent news.
    2. Score fitness (0-100).
       - SCORE HIGH (70-100) IF: Old world industry (Logistics, Construction, Legal, Dental), signals of manual admin (paper forms, 'call to book', dispatching), scaling pains.
       - SCORE LOW (0-40) IF: Tech company, SaaS, Marketing Agency, or Competitor.
    
    3. DETECT TECH STACK: Guess tools they use based on their description/industry (e.g. "Uses Paper", "Salesforce", "Shopify", "Legacy ERP", "Excel").
    
    4. REASONING: Write a detailed justification.
       - Explicitly state the *suspected manual bottleneck* (e.g. "Likely managing 50 drivers via Excel").
       - Explain *why* automation is urgent for them.
       - Reference a specific Smooth AI case study (Logistics, Legal, or Healthcare) if applicable to show fit.
    
    5. Output JSON: { "score": number, "reasoning": string, "suggestedAngle": string, "painPoints": string[], "techStack": string[] }
  `;

  return withHybridEngine(
      // Primary
      async () => {
        if (!apiKey) throw new Error("API Key missing");
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                // ENABLED Search Tool for better context
                tools: [{ googleSearch: {} }],
                // REMOVED Schema/MimeType to be compatible with tools
                // responseMimeType: "application/json",
            }
        });
        const res = extractJson(response.text || "{}");
        return {
            analysis: {
                score: res.score,
                reasoning: res.reasoning,
                suggestedAngle: res.suggestedAngle,
                painPoints: res.painPoints || []
            },
            techStack: res.techStack || []
        };
      },
      // Fallback
      async () => {
          const jsonStr = await callOpenRouter(
              "google/gemini-2.0-flash-001",
              [{ role: "user", content: prompt + " Return strictly valid JSON." }],
              true
          );
          const res = extractJson(jsonStr || "{}");
           return {
            analysis: {
                score: res.score,
                reasoning: res.reasoning,
                suggestedAngle: res.suggestedAngle,
                painPoints: res.painPoints || []
            },
            techStack: res.techStack || []
        };
      }
  );
};

/**
 * Generates a 3-Step Email Sequence.
 */
export const generateEmailSequence = async (lead: Lead, profile: ServiceProfile, analysis: AnalysisResult, triggers: TriggerEvent[]): Promise<EmailDraft[]> => {
    const contactName = lead.decisionMaker?.name ? lead.decisionMaker.name.split(' ')[0] : "Leader";
    const techStackMention = lead.techStack && lead.techStack.length > 0 ? `I noticed you might be using ${lead.techStack[0]}...` : "";
    const senderInfo = profile.senderName ? `${profile.senderName} from ${profile.companyName}` : profile.companyName;
    const signOffEmail = profile.contactEmail ? `(${profile.contactEmail})` : '';

    // Construct Trigger Context
    let triggerContext = "";
    if (triggers.length > 0) {
        triggerContext = `Recent Signal: ${triggers[0].description} (Type: ${triggers[0].type}). Use this as the hook!`;
    } else {
        triggerContext = `Hook: ${analysis.suggestedAngle}`;
    }

    const prompt = `
      Create a 3-Email Cold Outreach Sequence for Smooth AI.
      Target: ${lead.companyName}
      Recipient: ${contactName} (${lead.decisionMaker?.role || 'Exec'}).
      Pain Points: ${analysis.painPoints.join(", ")}
      Tech Stack: ${techStackMention}
      ${triggerContext}
      
      Sign off as: ${senderInfo} ${signOffEmail}
      
      CADENCE:
      1. Day 0: The Hook (Peer-to-peer, direct problem solving).
      2. Day 3: The Value (Reference a Smooth AI Case Study: Logistics/Legal/Dental).
      3. Day 7: The Breakup (Soft close, "Is this not a priority?").

      Return JSON Array:
      [
        { "subject": "string", "body": "string", "delayDays": 0, "context": "Initial Outreach" },
        { "subject": "string", "body": "string", "delayDays": 3, "context": "Value Add" },
        { "subject": "string", "body": "string", "delayDays": 7, "context": "Breakup" }
      ]
    `;

    return withHybridEngine(
        async () => {
            if (!apiKey) throw new Error("API Key missing");
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: { responseMimeType: "application/json" }
            });
            return extractJson(response.text || "[]");
        },
        async () => {
            const jsonStr = await callOpenRouter(
                "google/gemini-2.0-flash-001",
                [{ role: "user", content: prompt + " Return valid JSON array." }],
                true
            );
            return extractJson(jsonStr || "[]");
        }
    );
};
