
import React, { useState, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Lead, LeadStatus, ServiceProfile, AgentLog, StrategyNode, ViewType, SMTPConfig, GoogleSheetsConfig, GlobalStats, IntegrationConfig, Shortcut } from './types';
import { PipelineTable } from './components/PipelineTable';
import { PipelineBoard } from './components/PipelineBoard';
import { StatCard } from './components/StatCard';
import { Sidebar } from './components/Sidebar';
import { AgentTerminal } from './components/AgentTerminal';
import { StrategyQueue } from './components/StrategyQueue';
import { AnalyticsView } from './components/AnalyticsView';
import { QualityControlView } from './components/QualityControlView';
import { DebugView } from './components/DebugView';
import { CalendarView } from './components/CalendarView'; // NEW
import { LinkedInView } from './components/LinkedInView'; // NEW
import { findLeads, analyzeLeadFitness, generateEmailSequence, generateMasterPlan, findDecisionMaker, findTriggers, setCostCallback, withHybridEngine, testOpenRouterConnection } from './services/geminiService';
import { 
    saveLeadsToStorage, loadLeadsFromStorage, saveStrategies, loadStrategies,
    saveLogs, loadLogs, saveProfile, loadProfile, saveSMTPConfig, loadSMTPConfig,
    saveSheetsConfig, loadSheetsConfig, clearStorage, saveOpenRouterKey, loadOpenRouterKey,
    exportDatabase, importDatabase, saveBlacklist, loadBlacklist, saveStats, loadStats,
    saveIntegrationConfig, loadIntegrationConfig, manageStorageQuota
} from './services/storageService';
import { fetchLeadsFromSheet, saveLeadsToSheet } from './services/googleSheetsService';
import { sendViaServer } from './services/emailService';
import { syncLeadToWebhook } from './services/integrationService';
import { MOCK_LEADS } from './services/mockData'; // NEW
import { GoogleGenAI } from "@google/genai";

const DEFAULT_PROFILE: ServiceProfile = {
  companyName: "Smooth AI Consulting",
  description: "Operational AI Consultancy.",
  valueProposition: "We replace manual functions with AI.",
  senderName: "Nick",
  contactEmail: "nick@smoothaiconsultancy.com",
  theme: 'light'
};

function App() {
  const [currentView, setCurrentView] = useState<ViewType>('dashboard');
  
  // STATE
  const [leads, setLeads] = useState<Lead[]>(() => loadLeadsFromStorage());
  const [strategyQueue, setStrategyQueue] = useState<StrategyNode[]>(() => loadStrategies());
  const [logs, setLogs] = useState<AgentLog[]>(() => loadLogs());
  const [serviceProfile, setServiceProfile] = useState<ServiceProfile>(() => loadProfile() || DEFAULT_PROFILE);
  const [customApiKey, setCustomApiKey] = useState(() => loadOpenRouterKey());
  const [smtpConfig, setSmtpConfig] = useState<SMTPConfig>(() => loadSMTPConfig());
  const [sheetsConfig, setSheetsConfig] = useState<GoogleSheetsConfig>(() => loadSheetsConfig());
  const [blacklist, setBlacklist] = useState<string[]>(() => loadBlacklist());
  const [stats, setStats] = useState<GlobalStats>(() => loadStats());
  
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());
  const [isGrowthEngineActive, setIsGrowthEngineActive] = useState(false);
  
  // CIRCUIT BREAKER STATE
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);

  // Rate Limiting
  const [cooldownTime, setCooldownTime] = useState(0);
  const [maxCooldown, setMaxCooldown] = useState(60);

  // Refs for loop stability
  const isGrowthEngineActiveRef = useRef(isGrowthEngineActive);
  const leadsRef = useRef(leads); 
  const strategyQueueRef = useRef(strategyQueue);
  
  // Wake Lock Ref
  const wakeLockRef = useRef<any>(null);

  // Theme Init
  useEffect(() => {
    if (serviceProfile.theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [serviceProfile.theme]);

  // Garbage Collector Hook
  useEffect(() => {
    const gcInterval = setInterval(() => {
      manageStorageQuota();
    }, 60000); // Check every minute
    return () => clearInterval(gcInterval);
  }, []);

  // OPEN TRACKING POLLER (v3.0)
  useEffect(() => {
      const pollOpens = async () => {
          try {
              const res = await fetch('/api/track/status');
              if (res.ok) {
                  const data = await res.json();
                  // data is { leadId: [{type: 'OPEN', timestamp: ...}] }
                  let hasUpdates = false;
                  const updatedLeads = leadsRef.current.map(l => {
                      if (data[l.id] && l.status !== LeadStatus.OPENED && l.status !== LeadStatus.QUALIFIED) { // Don't demote qualified
                          hasUpdates = true;
                          return { ...l, status: LeadStatus.OPENED };
                      }
                      return l;
                  });
                  if (hasUpdates) setLeads(updatedLeads);
              }
          } catch (e) { /* ignore polling errors */ }
      };
      
      const interval = setInterval(pollOpens, 30000); // Check every 30s
      return () => clearInterval(interval);
  }, []);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        // Ctrl/Cmd + K: Toggle Dashboard/Prospects (Command Palette style)
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            setCurrentView(prev => prev === 'dashboard' ? 'prospects' : 'dashboard');
        }
        // Shift + A: Analyze first New Lead
        if (e.shiftKey && e.key === 'A') {
            const firstNew = leads.find(l => l.status === LeadStatus.NEW);
            if (firstNew && !analyzingIds.has(firstNew.id)) {
                handleAnalyze(firstNew);
            }
        }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [leads, analyzingIds]);

  // EFFECTS: Persist Data
  useEffect(() => { saveLeadsToStorage(leads); leadsRef.current = leads; }, [leads]);
  useEffect(() => { saveStrategies(strategyQueue); strategyQueueRef.current = strategyQueue; }, [strategyQueue]);
  useEffect(() => { saveLogs(logs); }, [logs]);
  useEffect(() => { saveBlacklist(blacklist); }, [blacklist]);
  useEffect(() => { saveStats(stats); }, [stats]);

  // Sync Growth Engine Ref & Handle Wake Lock
  useEffect(() => {
    isGrowthEngineActiveRef.current = isGrowthEngineActive;
    if (isGrowthEngineActive && cooldownTime === 0) {
        runGrowthCycle();
        
        // Request Wake Lock
        const requestWakeLock = async () => {
            if ('wakeLock' in navigator) {
                try {
                    wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
                    addLog("⚡ High Performance Mode: Screen Wake Lock Active", 'success');
                } catch (err) {
                    console.warn("Wake Lock Error:", err);
                }
            }
        };
        requestWakeLock();
    } else {
        // Release Wake Lock
        if (wakeLockRef.current) {
            wakeLockRef.current.release()
                .then(() => { wakeLockRef.current = null; })
                .catch((e: any) => console.log(e));
        }
    }
    
    return () => {
        if (wakeLockRef.current) wakeLockRef.current.release();
    };
  }, [isGrowthEngineActive]);

  // Init Cost Callback
  useEffect(() => {
      setCostCallback((cost) => {
          setStats(prev => ({
              ...prev,
              totalOperations: prev.totalOperations + 1,
              estimatedCost: prev.estimatedCost + cost
          }));
      });
  }, []);

  // Cooldown Timer
  useEffect(() => {
    let interval: any;
    if (cooldownTime > 0) {
        interval = setInterval(() => {
            setCooldownTime(prev => {
                if (prev <= 1) {
                    // Auto resume if active
                    if (isGrowthEngineActiveRef.current) setTimeout(() => runGrowthCycle(), 1000);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
    }
    return () => clearInterval(interval);
  }, [cooldownTime]);

  const addLog = (message: string, type: AgentLog['type'] = 'info') => {
    setLogs(prev => [...prev.slice(-99), { id: uuidv4(), timestamp: Date.now(), message, type }]);
  };

  const handleBackup = () => {
      const blob = new Blob([exportDatabase()], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `smooth_ai_backup_${new Date().toISOString().split('T')[0]}.json`;
      link.click();
  };

  const handleCloudSync = async () => {
      addLog("Syncing to Google Sheets...", 'info');
      const success = await saveLeadsToSheet(sheetsConfig.scriptUrl, leads);
      if (success) addLog("Cloud Sync Complete", 'success');
      else addLog("Cloud Sync Failed", 'error');
  };

  const handleTestSheets = async () => {
      if (!sheetsConfig.scriptUrl) { alert("Please enter a Script URL first."); return; }
      const success = await saveLeadsToSheet(sheetsConfig.scriptUrl, []);
      if (success) alert("✅ Connection Successful! App can talk to Google Sheet.");
      else alert("❌ Connection Failed. Check URL or Permissions.");
  }
  
  const handleCloudLoad = async () => {
      if (!confirm("This will overwrite your local data with Cloud data. Continue?")) return;
      addLog("Loading from Google Sheets...", 'info');
      const remoteLeads = await fetchLeadsFromSheet(sheetsConfig.scriptUrl);
      if (remoteLeads) {
          setLeads(remoteLeads);
          addLog(`Loaded ${remoteLeads.length} leads from Cloud`, 'success');
      } else {
          addLog("Cloud Load Failed", 'error');
      }
  };

  const handleDemoLoad = () => {
      if (!confirm("Load Demo Data? This is for testing only.")) return;
      setLeads(prev => [...MOCK_LEADS, ...prev]);
      addLog("Demo Data Loaded", 'success');
  };

  const handleTestAI = async () => {
      // Simple test call
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: 'Test connection',
      });
  };

  const handleTestOpenRouter = async () => {
      try {
          const success = await testOpenRouterConnection();
          if (success) alert("✅ OpenRouter Key is Valid!");
          else alert("❌ OpenRouter Test Failed.");
      } catch (e: any) {
          alert(`❌ Error: ${e.message}`);
      }
  };

  const handleTestEmail = async () => {
      try {
        const result = await sendViaServer(
            smtpConfig,
            'test_id',
            serviceProfile.senderName || "Test",
            "Test Email from Smooth AI",
            "This is a diagnostic test email.",
            serviceProfile.senderName || "System",
            serviceProfile.contactEmail
        );
        if (result) alert("✅ Email Sent Successfully! Check your inbox.");
        else alert("❌ Email Send Failed. Check Server Logs.");
      } catch (e: any) {
          alert(`❌ Error: ${e.message}`);
      }
  };

  const handleAnalyze = async (lead: Lead, isBackground = false): Promise<boolean> => {
    if (!isBackground) setAnalyzingIds(prev => new Set(prev).add(lead.id));

    try {
      const { analysis, techStack } = await analyzeLeadFitness(lead, serviceProfile);
      
      let dm: any = null, triggers: any[] = [], emailSequence: any[] = [];

      // Only burn tokens on Sequence Gen if they are qualified
      if (analysis.score > 60) {
          addLog(`Qualified ${lead.companyName} (${analysis.score}). Deep diving...`, 'success');
          dm = await findDecisionMaker(lead.companyName, lead.website);
          triggers = await findTriggers(lead.companyName, lead.website);
          emailSequence = await generateEmailSequence({ ...lead, decisionMaker: dm, techStack }, serviceProfile, analysis, triggers);
          
          // Automated A/B Testing Logic
          const variant = Math.random() > 0.5 ? 'B' : 'A';
          if (emailSequence.length > 0 && emailSequence[0].alternativeSubject) {
              emailSequence[0].variantLabel = variant;
              if (variant === 'B') {
                   // Swap subjects for display/sending convenience
                   const temp = emailSequence[0].subject;
                   emailSequence[0].subject = emailSequence[0].alternativeSubject;
                   emailSequence[0].alternativeSubject = temp;
              }
          }
          lead.activeVariant = variant;
      } else {
          addLog(`Disqualified ${lead.companyName} (${analysis.score}).`, 'warning');
      }

      setLeads(prev => prev.map(l => l.id === lead.id ? {
        ...l, analysis, decisionMaker: dm, techStack, triggers, emailSequence,
        status: analysis.score > 60 ? LeadStatus.QUALIFIED : LeadStatus.UNQUALIFIED,
        lastUpdated: Date.now(),
        activeVariant: lead.activeVariant 
      } : l));
      return true;

    } catch (e: any) {
        if (e.message?.includes('QUOTA') || e.message?.includes('429')) {
            if (!isBackground) { setCooldownTime(60); setMaxCooldown(60); }
            return false;
        }
        console.error(e);
        return false;
    } finally {
        if (!isBackground) setAnalyzingIds(prev => { const n = new Set(prev); n.delete(lead.id); return n; });
    }
  };

  const runGrowthCycle = async () => {
    // Safety Checks & Circuit Breaker
    if (!isGrowthEngineActiveRef.current || cooldownTime > 0) return;
    if (consecutiveFailures >= 3) {
        addLog("🚨 CIRCUIT BREAKER TRIPPED. Engine Stopped.", 'error');
        setIsGrowthEngineActive(false);
        setConsecutiveFailures(0);
        return;
    }

    try {
        // 1. SELECT STRATEGY
        let currentStrategy: StrategyNode | null = strategyQueueRef.current.find(s => s.status === 'active') || null;

        if (!currentStrategy) {
            const pending = strategyQueueRef.current.find(s => s.status === 'pending');
            if (pending) {
                setStrategyQueue(prev => prev.map(s => s.id === pending.id ? { ...s, status: 'active' } : s));
                currentStrategy = { ...pending, status: 'active' };
            } else {
                addLog("Funnel Empty. Generating Master Plan...", 'action');
                try {
                    const newPlan = await generateMasterPlan(leadsRef.current.map(l => l.foundVia || '').filter(Boolean));
                    setStrategyQueue(prev => [...prev, ...newPlan]);
                    if (isGrowthEngineActiveRef.current) setTimeout(() => runGrowthCycle(), 2000);
                    return;
                } catch (e: any) {
                     addLog(`Plan Failed: ${e.message}`, 'error');
                     setConsecutiveFailures(prev => prev + 1);
                     setTimeout(() => runGrowthCycle(), 8000); return;
                }
            }
        }

        // 2. EXECUTE SEARCH
        addLog(`Executing: ${currentStrategy.query}`, 'action');
        const { leads: foundLeads } = await findLeads(currentStrategy.query, blacklist);
        
        if (!foundLeads.length) {
            addLog(`No results for ${currentStrategy.sector}. Skipping.`, 'warning');
            setStrategyQueue(prev => prev.map(s => s.id === currentStrategy!.id ? { ...s, status: 'completed' } : s));
            setTimeout(() => runGrowthCycle(), 2000);
            return;
        }

        // 3. FILTER DUPLICATES
        const newCandidates: Lead[] = [];
        const existing = new Set(leadsRef.current.map(l => l.website));

        foundLeads.forEach(fl => {
            if (fl.website && !existing.has(fl.website)) {
                newCandidates.push({
                    id: uuidv4(), 
                    companyName: fl.companyName || "Unknown", 
                    website: fl.website || "", 
                    description: fl.description || "",
                    status: LeadStatus.NEW, 
                    foundVia: currentStrategy!.sector, 
                    createdAt: Date.now(), 
                    lastUpdated: Date.now()
                });
            }
        });

        // 4. BATCH ANALYZE
        if (newCandidates.length) {
            setLeads(prev => [...newCandidates, ...prev]);
            addLog(`Found ${newCandidates.length} new candidates. Starting Deep Analysis...`, 'info');
            setConsecutiveFailures(0); // Reset failures on success
            
            for (const lead of newCandidates) {
                if (!isGrowthEngineActiveRef.current || cooldownTime > 0) break;
                const success = await handleAnalyze(lead, true);
                if (!success) {
                    setConsecutiveFailures(prev => prev + 1);
                    break; 
                }
                await new Promise(r => setTimeout(r, 20000)); // 20s delay between analyses
            }
        } else {
            addLog("All found leads were duplicates.", 'warning');
        }

        // 5. COMPLETE STRATEGY
        setStrategyQueue(prev => prev.map(s => s.id === currentStrategy!.id ? { ...s, status: 'completed' } : s));
        if (isGrowthEngineActiveRef.current) setTimeout(() => runGrowthCycle(), 5000);

    } catch (e: any) {
        if (e.message?.includes('QUOTA') || e.message?.includes('429')) { 
            setCooldownTime(90); setMaxCooldown(90); 
        } else {
            console.error(e);
            setConsecutiveFailures(prev => prev + 1);
            setTimeout(() => runGrowthCycle(), 10000);
        }
    }
  };

  const qualifiedCount = leads.filter(l => l.status === LeadStatus.QUALIFIED).length;
  
  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950 font-sans text-slate-900 dark:text-slate-100 transition-colors">
      <Sidebar currentView={currentView} onViewChange={setCurrentView} />

      <main className="flex-1 p-4 lg:p-8 overflow-y-auto h-screen flex flex-col">
        {/* VIEW: DASHBOARD */}
        {currentView === 'dashboard' && (
            <div className="flex flex-col gap-6 animate-fadeIn">
                 <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                     <StatCard title="Pipeline Value" value={`$${(qualifiedCount * 1500).toLocaleString()}`} trend="Potential" colorTheme="blue" />
                     <StatCard title="Qualified Leads" value={qualifiedCount} trend="+4" colorTheme="green" />
                     <StatCard title="Est. Cost" value={`$${(stats.estimatedCost).toFixed(2)}`} trend={`${stats.totalOperations} Ops`} colorTheme="purple" />
                     <StatCard title="A/B Test" value={`${stats.abTestWins.A} vs ${stats.abTestWins.B}`} trend="A vs B Wins" colorTheme="pink" />
                 </div>

                 <div className="flex flex-col xl:flex-row gap-6 h-auto min-h-[400px]">
                     <div className="flex-1 flex flex-col gap-2">
                        <AgentTerminal logs={logs} active={isGrowthEngineActive} />
                        {cooldownTime > 0 ? (
                            <div className="w-full bg-yellow-100 h-2 rounded-full overflow-hidden relative">
                                <div className="absolute top-0 left-0 w-full h-full flex items-center justify-center text-[8px] font-bold text-yellow-800 z-10">COOLING DOWN ({cooldownTime}s)</div>
                                <div className="bg-yellow-500 h-full transition-all duration-1000 ease-linear" style={{width: `${(cooldownTime/maxCooldown)*100}%`}}></div>
                            </div>
                        ) : (
                            <button 
                                onClick={() => setIsGrowthEngineActive(!isGrowthEngineActive)} 
                                className={`w-full py-3 text-xs font-bold rounded-lg shadow-sm transition-all active:scale-95 ${isGrowthEngineActive ? 'bg-white text-red-500 border border-red-200' : 'bg-slate-900 text-white hover:bg-slate-800'}`}
                            >
                                {isGrowthEngineActive ? 'STOP NEURAL AGENT' : 'START GROWTH ENGINE'}
                            </button>
                        )}
                        {isGrowthEngineActive && (
                             <div className="text-[10px] text-green-500 font-mono text-center flex justify-center items-center gap-1">
                                 <svg className="w-3 h-3 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                                 HIGH PERFORMANCE MODE ACTIVE
                             </div>
                        )}
                        {consecutiveFailures > 0 && (
                            <div className="text-[10px] text-red-500 font-bold text-center animate-pulse">
                                Warning: {consecutiveFailures}/3 Failures Detected
                            </div>
                        )}
                     </div>
                     <div className="w-full xl:w-80">
                         <StrategyQueue queue={strategyQueue} active={isGrowthEngineActive} onAddStrategy={(s,q) => setStrategyQueue(prev => [{id: uuidv4(), sector:s, query:q, rationale:'Manual', status:'pending'}, ...prev])} />
                     </div>
                 </div>

                 <div className="flex-1 min-h-[400px]">
                     <PipelineTable leads={leads} onAnalyze={handleAnalyze} analyzingIds={analyzingIds} onHunt={(l) => addLog("Hunt triggered", 'info')} />
                 </div>
            </div>
        )}

        {/* VIEW: PROSPECTS */}
        {currentView === 'prospects' && (
             <div className="h-full animate-fadeIn">
                <PipelineTable 
                    leads={leads} 
                    onAnalyze={handleAnalyze} 
                    analyzingIds={analyzingIds} 
                    onMarkContacted={(l) => setLeads(prev => prev.map(p => p.id === l.id ? {...p, status: LeadStatus.CONTACTED, lastContactedAt: Date.now()} : p))}
                    onAddManualLead={(l) => setLeads(prev => [l, ...prev])}
                    onExport={() => {
                         const csv = "Company,Website,Score,Status,Reasoning\n" + leads.map(l => `${l.companyName},${l.website},${l.analysis?.score || 0},${l.status},"${l.analysis?.reasoning?.replace(/"/g, '""') || ''}"`).join('\n');
                         const blob = new Blob([csv], { type: 'text/csv' });
                         const url = window.URL.createObjectURL(blob);
                         const a = document.createElement('a');
                         a.href = url; a.download = 'leads.csv'; a.click();
                    }}
                />
             </div>
        )}
        
        {/* VIEW: CALENDAR */}
        {currentView === 'calendar' && <CalendarView leads={leads} />}

        {/* VIEW: LINKEDIN */}
        {currentView === 'linkedin' && <LinkedInView />}
        
        {/* VIEW: QUALITY CONTROL */}
        {currentView === 'quality_control' && (
            <div className="h-full animate-fadeIn">
                <QualityControlView 
                    leads={leads} 
                    onApprove={(l) => { /* Logic handled in component or extended later */ }}
                    onReject={(l) => setLeads(prev => prev.map(p => p.id === l.id ? {...p, status: LeadStatus.UNQUALIFIED} : p))}
                />
            </div>
        )}
        
        {/* VIEW: DEBUG */}
        {currentView === 'debug' && (
             <div className="h-full animate-fadeIn">
                 <DebugView 
                    logs={logs}
                    stats={stats}
                    smtpConfig={smtpConfig}
                    sheetsConfig={sheetsConfig}
                    onClearLogs={() => setLogs([])}
                    onTestAI={handleTestAI}
                    onTestEmail={handleTestEmail}
                 />
             </div>
        )}
        
        {/* VIEW: ANALYTICS */}
        {currentView === 'analytics' && <AnalyticsView leads={leads} />}

        {/* VIEW: SETTINGS */}
        {currentView === 'settings' && (
            <div className="max-w-xl mx-auto space-y-6 pb-20 animate-fadeIn text-slate-800 dark:text-slate-200">
                <h1 className="text-2xl font-bold">System Configuration</h1>
                
                {/* Profile */}
                <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                    <h3 className="font-bold mb-2">Sender Identity</h3>
                    <input className="w-full border dark:border-slate-700 bg-transparent p-2 rounded mb-2 text-sm" value={serviceProfile.senderName} onChange={e => setServiceProfile({...serviceProfile, senderName: e.target.value})} placeholder="Your Name" />
                    <input className="w-full border dark:border-slate-700 bg-transparent p-2 rounded mb-2 text-sm" value={serviceProfile.contactEmail} onChange={e => setServiceProfile({...serviceProfile, contactEmail: e.target.value})} placeholder="Email Address" />
                    <div className="flex items-center gap-2 mt-2">
                        <label className="text-xs font-bold">Theme:</label>
                        <button onClick={() => setServiceProfile({...serviceProfile, theme: serviceProfile.theme === 'dark' ? 'light' : 'dark'})} className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded text-xs">
                            {serviceProfile.theme === 'dark' ? '🌙 Dark' : '☀️ Light'}
                        </button>
                    </div>
                    <button onClick={() => { saveProfile(serviceProfile); addLog("Profile Saved", 'success'); }} className="mt-3 bg-blue-600 text-white px-4 py-2 rounded text-sm font-bold">Save Identity</button>
                </div>

                {/* Cloud Sync */}
                <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                    <h3 className="font-bold mb-2">Cloud Integrations</h3>
                    <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
                         <label className="text-xs font-bold text-slate-500 block mb-1">Google Sheets Script URL</label>
                         <input className="w-full border dark:border-slate-700 bg-transparent p-2 rounded text-sm mb-2" value={sheetsConfig.scriptUrl} onChange={e => setSheetsConfig({scriptUrl: e.target.value})} placeholder="https://script.google.com/..." />
                         <div className="flex gap-2">
                            <button onClick={() => { saveSheetsConfig(sheetsConfig); addLog("Sheets Config Saved", 'success'); }} className="bg-slate-900 dark:bg-slate-700 text-white px-3 py-1.5 rounded text-xs font-bold">Save</button>
                            <button onClick={handleTestSheets} className="bg-blue-50 text-blue-600 px-3 py-1.5 rounded text-xs font-bold border border-blue-200">Test Connection</button>
                            <button onClick={handleCloudSync} className="bg-green-600 text-white px-3 py-1.5 rounded text-xs font-bold">Sync to Cloud</button>
                            <button onClick={handleCloudLoad} className="bg-slate-200 text-slate-700 px-3 py-1.5 rounded text-xs font-bold">Load from Cloud</button>
                         </div>
                    </div>
                </div>

                {/* Email Server */}
                <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                     <h3 className="font-bold mb-2">Email Relay (Hostinger/SMTP)</h3>
                     <p className="text-xs text-slate-500 mb-2">Requires Node.js server running.</p>
                     <div className="grid grid-cols-2 gap-2 mb-2">
                        <input className="border dark:border-slate-700 bg-transparent p-2 rounded text-sm" placeholder="Host (smtp.hostinger.com)" value={smtpConfig.host} onChange={e => setSmtpConfig({...smtpConfig, host: e.target.value})} />
                        <input className="border dark:border-slate-700 bg-transparent p-2 rounded text-sm" placeholder="Port (465)" value={smtpConfig.port} onChange={e => setSmtpConfig({...smtpConfig, port: e.target.value})} />
                        <input className="border dark:border-slate-700 bg-transparent p-2 rounded text-sm" placeholder="User (email)" value={smtpConfig.user} onChange={e => setSmtpConfig({...smtpConfig, user: e.target.value})} />
                        <input className="border dark:border-slate-700 bg-transparent p-2 rounded text-sm" placeholder="Password" type="password" value={smtpConfig.pass} onChange={e => setSmtpConfig({...smtpConfig, pass: e.target.value})} />
                     </div>
                     <div className="mb-2">
                        <label className="text-xs font-bold text-slate-500">Public URL (For Open Tracking)</label>
                        <input className="w-full border dark:border-slate-700 bg-transparent p-2 rounded text-sm" placeholder="https://your-site.com" value={smtpConfig.publicUrl || ''} onChange={e => setSmtpConfig({...smtpConfig, publicUrl: e.target.value})} />
                     </div>
                     <div className="flex gap-2">
                         <button onClick={() => { saveSMTPConfig(smtpConfig); addLog("SMTP Config Saved", 'success'); alert("✅ Settings Saved"); }} className="bg-slate-900 dark:bg-slate-700 text-white px-4 py-2 rounded text-sm font-bold">Save SMTP</button>
                         <button onClick={handleTestEmail} className="bg-blue-50 text-blue-600 px-4 py-2 rounded text-sm font-bold border border-blue-200">Test Connection</button>
                     </div>
                </div>
                
                <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                    <h3 className="font-bold mb-2">Negative Filter (Blacklist)</h3>
                    <textarea 
                        className="w-full border dark:border-slate-700 bg-transparent p-2 rounded text-xs" 
                        rows={4}
                        value={blacklist.join(', ')}
                        onChange={(e) => setBlacklist(e.target.value.split(',').map(s => s.trim()))}
                        placeholder="agency, competitor, marketing..."
                    />
                </div>

                <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                     <h3 className="font-bold mb-2">OpenRouter API Key</h3>
                     <input type="password" value={customApiKey} onChange={e => setCustomApiKey(e.target.value)} className="w-full border dark:border-slate-700 bg-transparent p-2 rounded mb-2 text-sm" placeholder="sk-or-..." />
                     <div className="flex gap-2">
                        <button onClick={() => { saveOpenRouterKey(customApiKey); addLog("Key Saved", 'success'); }} className="bg-slate-900 dark:bg-slate-700 text-white px-4 py-2 rounded text-sm font-bold">Save Key</button>
                        <button onClick={handleTestOpenRouter} className="bg-purple-50 text-purple-600 px-4 py-2 rounded text-sm font-bold border border-purple-200">Test Key</button>
                     </div>
                </div>

                <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                     <h3 className="font-bold mb-2">Data Management</h3>
                     <div className="flex gap-4">
                        <button onClick={handleBackup} className="border border-slate-300 dark:border-slate-600 px-4 py-2 rounded text-sm font-bold hover:bg-slate-50 dark:hover:bg-slate-800">Download Backup</button>
                        <button onClick={handleDemoLoad} className="text-blue-600 text-sm font-bold hover:underline">Load Demo Data</button>
                        <button onClick={() => { if(confirm("Are you sure? This will wipe everything.")) { clearStorage(); window.location.reload(); }}} className="text-red-500 text-sm font-bold hover:underline">Factory Reset</button>
                     </div>
                </div>
            </div>
        )}
      </main>
    </div>
  );
}

export default App;
