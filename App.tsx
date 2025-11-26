
import React, { useState, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Lead, LeadStatus, ServiceProfile, AgentLog, StrategyNode, ViewType, EmailJSConfig } from './types';
import { PipelineTable } from './components/PipelineTable';
import { PipelineBoard } from './components/PipelineBoard';
import { StatCard } from './components/StatCard';
import { Sidebar } from './components/Sidebar';
import { AgentTerminal } from './components/AgentTerminal';
import { StrategyQueue } from './components/StrategyQueue';
import { AnalyticsView } from './components/AnalyticsView';
import { findLeads, analyzeLeadFitness, generateEmailSequence, generateMasterPlan, findDecisionMaker, findTriggers } from './services/geminiService';
import { 
    saveLeadsToStorage, loadLeadsFromStorage, 
    saveStrategies, loadStrategies,
    saveLogs, loadLogs,
    saveProfile, loadProfile,
    saveEmailConfig, loadEmailConfig,
    clearStorage, saveOpenRouterKey, loadOpenRouterKey,
    exportDatabase, importDatabase
} from './services/storageService';
import { sendViaEmailJS } from './services/emailService';

// Default Profile for Smooth AI
const DEFAULT_PROFILE: ServiceProfile = {
  companyName: "Smooth AI Consulting",
  description: "We are an Operational AI Consultancy. We don't just hire; we evolve businesses by replacing manual admin chaos with a digital workforce.",
  valueProposition: "We replace manual functions (data entry, scheduling, support) with AI.",
  senderName: "Nick",
  contactEmail: "nick@smoothaiconsultancy.com"
};

function App() {
  const [currentView, setCurrentView] = useState<ViewType>('dashboard');
  
  // --- PERSISTENT STATE (LAZY LOADED) ---
  const [leads, setLeads] = useState<Lead[]>(() => loadLeadsFromStorage());
  const [strategyQueue, setStrategyQueue] = useState<StrategyNode[]>(() => loadStrategies());
  const [logs, setLogs] = useState<AgentLog[]>(() => loadLogs());
  const [serviceProfile, setServiceProfile] = useState<ServiceProfile>(() => loadProfile() || DEFAULT_PROFILE);
  const [customApiKey, setCustomApiKey] = useState(() => loadOpenRouterKey());
  const [emailJsConfig, setEmailJsConfig] = useState<EmailJSConfig>(() => loadEmailConfig());
  
  // --- UI STATE ---
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());
  const [pipelineMode, setPipelineMode] = useState<'table' | 'board'>('table');
  const [isGrowthEngineActive, setIsGrowthEngineActive] = useState(false);
  const [isAutoSendEnabled, setIsAutoSendEnabled] = useState(false);
  const [isProfileDirty, setIsProfileDirty] = useState(false);
  
  // Rate Limiting UI
  const [cooldownTime, setCooldownTime] = useState(0);
  const [maxCooldown, setMaxCooldown] = useState(60); // For progress bar calc

  // Refs for Loop Management
  const isGrowthEngineActiveRef = useRef(isGrowthEngineActive);
  const leadsRef = useRef(leads); 
  const strategyQueueRef = useRef(strategyQueue);

  // --- PERSISTENCE EFFECTS ---
  useEffect(() => { saveLeadsToStorage(leads); leadsRef.current = leads; }, [leads]);
  useEffect(() => { saveStrategies(strategyQueue); strategyQueueRef.current = strategyQueue; }, [strategyQueue]);
  useEffect(() => { saveLogs(logs); }, [logs]);

  // --- ENGINE LOOP ---
  useEffect(() => {
    isGrowthEngineActiveRef.current = isGrowthEngineActive;
    if (isGrowthEngineActive) {
        if (cooldownTime > 0) {
            addLog(`Engine waiting for cooldown (${cooldownTime}s)...`, 'warning');
        } else {
            addLog("Initializing Autonomous Agent...", 'action');
            runGrowthCycle();
        }
    } else {
        if (logs.length > 0 && logs[logs.length-1].message !== "Agent paused by user.") {
            addLog("Agent paused by user.", 'warning');
        }
    }
  }, [isGrowthEngineActive]);

  // Cooldown Timer
  useEffect(() => {
    let interval: any;
    if (cooldownTime > 0) {
        interval = setInterval(() => {
            setCooldownTime(prev => {
                if (prev <= 1) {
                    if (isGrowthEngineActiveRef.current) {
                         setTimeout(() => runGrowthCycle(), 1000);
                    }
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
    }
    return () => clearInterval(interval);
  }, [cooldownTime]);


  // --- HELPERS ---

  const addLog = (message: string, type: AgentLog['type'] = 'info') => {
    const newLog: AgentLog = {
        id: uuidv4(),
        timestamp: Date.now(),
        message,
        type
    };
    setLogs(prev => {
        const updated = [...prev.slice(-99), newLog]; 
        return updated;
    });
  };

  const handleSaveKey = () => {
      saveOpenRouterKey(customApiKey);
      addLog("Custom API Key saved. Hybrid Engine Enabled.", 'success');
      alert("Key Saved! The agent will now use this key if the primary quota fails.");
  };

  const handleSaveProfile = () => {
      saveProfile(serviceProfile);
      setIsProfileDirty(false);
      addLog("Sender Identity Updated.", 'success');
      alert("Profile Saved.");
  };
  
  const handleSaveEmailConfig = () => {
      saveEmailConfig(emailJsConfig);
      addLog("EmailJS Configuration Saved.", 'success');
      alert("Email Settings Saved! Auto-Send is now available.");
  };

  const handleBackup = () => {
      const data = exportDatabase();
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `smooth_ai_backup_${new Date().toISOString().split('T')[0]}.json`;
      link.click();
      addLog("Database exported successfully.", 'success');
  };

  const handleRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
          const json = event.target?.result as string;
          if (importDatabase(json)) {
              alert("Database Restored! Page will reload.");
              window.location.reload();
          } else {
              alert("Failed to restore database. Invalid file.");
          }
      };
      reader.readAsText(file);
  };

  const handleMarkContacted = (lead: Lead) => {
      setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, status: LeadStatus.CONTACTED, lastUpdated: Date.now() } : l));
      addLog(`Marked ${lead.companyName} as CONTACTED.`, 'success');
  };

  const exportCSV = () => {
    if (leads.length === 0) return;
    const headers = ["Company", "Website", "Status", "Score", "Reasoning", "Decision Maker", "Role", "Tech Stack", "Pain Points", "Trigger", "Email 1 Subject", "Email 1 Body"];
    const rows = leads.map(l => [
        l.companyName, 
        l.website, 
        l.status, 
        l.analysis?.score || 0,
        `"${(l.analysis?.reasoning || '').replace(/"/g, '""')}"`,
        l.decisionMaker?.name || '',
        l.decisionMaker?.role || '',
        `"${(l.techStack || []).join(', ')}"`,
        `"${(l.analysis?.painPoints || []).join('; ')}"`,
        l.triggers?.[0]?.description || '',
        `"${(l.emailSequence?.[0]?.subject || '').replace(/"/g, '""')}"`,
        `"${(l.emailSequence?.[0]?.body || '').replace(/"/g, '""')}"`
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "smooth_ai_prospects.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleManualStrategy = (sector: string, query: string) => {
      const newNode: StrategyNode = {
          id: uuidv4(),
          sector,
          query,
          rationale: "Manual Override Strategy",
          status: 'pending'
      };
      setStrategyQueue(prev => [newNode, ...prev]); 
      addLog(`Manual Strategy Injected: ${sector}`, 'action');
  };

  const handleHuntDecisionMaker = async (lead: Lead) => {
      addLog(`Hunting Decision Maker for ${lead.companyName}...`, 'action');
      setAnalyzingIds(prev => new Set(prev).add(lead.id));
      
      try {
          const dm = await findDecisionMaker(lead.companyName, lead.website);
          if (dm) {
              setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, decisionMaker: dm } : l));
              addLog(`Found ${dm.role}: ${dm.name}`, 'success');
              
              if (lead.analysis && lead.analysis.score > 65) {
                   const sequence = await generateEmailSequence({ ...lead, decisionMaker: dm }, serviceProfile, lead.analysis, lead.triggers || []);
                   setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, emailSequence: sequence } : l));
              }
          } else {
              addLog(`Could not identify specific decision maker for ${lead.companyName}.`, 'warning');
          }
      } catch (e: any) {
          if (e.message?.includes("QUOTA_EXHAUSTED")) {
              addLog("Quota Limit Hit during Hunt. Try again later.", "error");
          } else {
              console.error(e);
          }
      } finally {
          setAnalyzingIds(prev => {
                const next = new Set(prev);
                next.delete(lead.id);
                return next;
          });
      }
  };

  const runGrowthCycle = async () => {
    if (!isGrowthEngineActiveRef.current) return;
    if (cooldownTime > 0) return;

    try {
        let currentStrategy: StrategyNode | null = strategyQueueRef.current.find(s => s.status === 'active') || null;

        if (!currentStrategy) {
            const pending = strategyQueueRef.current.find(s => s.status === 'pending');
            if (pending) {
                addLog(`Activating Strategy: ${pending.sector}`, 'action');
                setStrategyQueue(prev => prev.map(s => s.id === pending.id ? { ...s, status: 'active' } : s));
                currentStrategy = { ...pending, status: 'active' };
                await new Promise(r => setTimeout(r, 100));
            } else {
                addLog("Funnel Empty. Generating new Industry Master Plan...", 'action');
                const pastStrategies = Array.from(new Set(leadsRef.current.map(l => l.foundVia).filter(Boolean))) as string[];
                try {
                    const newPlan = await generateMasterPlan(pastStrategies);
                    setStrategyQueue(prev => [...prev, ...newPlan]);
                    addLog(`Master Plan Created: ${newPlan.length} new sectors targeted.`, 'success');
                    if (isGrowthEngineActiveRef.current) setTimeout(() => runGrowthCycle(), 2000);
                    return;
                } catch (e: any) {
                    if (e.message?.includes("QUOTA") || e.message?.includes("429")) {
                         throw e; 
                    }
                    addLog("Failed to generate plan. Retrying...", 'error');
                    if (isGrowthEngineActiveRef.current) setTimeout(() => runGrowthCycle(), 8000);
                    return;
                }
            }
        }

        if (!currentStrategy) return;

        addLog(`Executing Search: "${currentStrategy.query}"`, 'action');
        const { leads: foundLeads, urls } = await findLeads(currentStrategy.query);
        
        if (!foundLeads || foundLeads.length === 0) {
            addLog(`Sector ${currentStrategy.sector} yielded no results. Marking complete.`, 'warning');
            completeStrategy(currentStrategy.id);
            if (isGrowthEngineActiveRef.current) setTimeout(() => runGrowthCycle(), 5000);
            return;
        }

        addLog(`Identified ${foundLeads.length} potential targets in ${currentStrategy.sector}.`, 'success');

        const newCandidates: Lead[] = [];
        const existingDomains = new Set(leadsRef.current.map(l => l.website));

        foundLeads.forEach(fl => {
            if (fl.website && !existingDomains.has(fl.website)) {
                newCandidates.push({
                    id: uuidv4(),
                    companyName: fl.companyName || "Unknown",
                    website: fl.website || "",
                    description: fl.description || "",
                    status: LeadStatus.NEW,
                    sourceUrl: urls[0],
                    foundVia: currentStrategy?.sector, 
                    createdAt: Date.now(),
                    lastUpdated: Date.now()
                });
            }
        });

        if (newCandidates.length > 0) {
            setLeads(prev => [...newCandidates, ...prev]);
            addLog(`Imported ${newCandidates.length} new leads.`, 'info');
            
            addLog(`Analyzing new cohort (30s delay for quota safety)...`, 'action');
            for (const lead of newCandidates) {
                if (!isGrowthEngineActiveRef.current) break;
                if (cooldownTime > 0) break;

                addLog(`Analyzing: ${lead.companyName}...`, 'info');
                const success = await handleAnalyze(lead, true); 
                
                if (!success) break;

                await new Promise(r => setTimeout(r, 30000)); 
            }
        } else {
             addLog("All leads were duplicates.", 'warning');
        }

        addLog(`Sector ${currentStrategy.sector} conquest complete.`, 'success');
        completeStrategy(currentStrategy.id);

        if (isGrowthEngineActiveRef.current) {
            addLog("Sector cooldown (10s)...", 'info');
            setTimeout(() => runGrowthCycle(), 10000);
        }

    } catch (error: any) {
        const isQuota = error?.message?.includes('QUOTA') || error?.message?.includes('429') || error.message === 'QUOTA_EXHAUSTED';

        if (isQuota) {
             const sleepTime = 90;
             setMaxCooldown(sleepTime);
             setCooldownTime(sleepTime);
             addLog(`⛔ Quota Hit. Cooling down for ${sleepTime}s...`, 'warning');
        } else {
            console.error(error);
            addLog(`CRITICAL: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
            if (isGrowthEngineActiveRef.current) {
                setTimeout(() => runGrowthCycle(), 10000);
            }
        }
    }
  };

  const completeStrategy = (id: string) => {
      setStrategyQueue(prev => prev.map(s => s.id === id ? { ...s, status: 'completed' } : s));
  };

  const handleAnalyze = async (lead: Lead, isBackground = false): Promise<boolean> => {
    if (!isBackground) {
        setAnalyzingIds(prev => new Set(prev).add(lead.id));
        addLog(`Manual Analysis requested for ${lead.companyName}`, 'action');
    } else {
        setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, status: LeadStatus.ANALYZING } : l));
    }

    try {
      const { analysis, techStack } = await analyzeLeadFitness(lead, serviceProfile);
      
      let dm: any = null;
      let triggers: any[] = [];
      let emailSequence: any[] = [];

      if (analysis.score > 60) {
          addLog(`High potential (${analysis.score}%). Hunting Decision Maker...`, 'action');
          dm = await findDecisionMaker(lead.companyName, lead.website);
          if (dm) addLog(`Identified ${dm.role}: ${dm.name}`, 'success');

          addLog(`Scanning for News/Hiring signals...`, 'info');
          triggers = await findTriggers(lead.companyName, lead.website);
          if (triggers.length > 0) addLog(`Found ${triggers.length} triggers! (${triggers[0].type})`, 'success');
          
          addLog(`Drafting 3-step campaign...`, 'info');
          emailSequence = await generateEmailSequence({ ...lead, decisionMaker: dm, techStack }, serviceProfile, analysis, triggers);
      }

      setLeads(prev => prev.map(l => l.id === lead.id ? {
        ...l,
        analysis,
        decisionMaker: dm,
        techStack,
        triggers,
        emailSequence,
        status: analysis.score > 60 ? LeadStatus.QUALIFIED : LeadStatus.UNQUALIFIED,
        lastUpdated: Date.now()
      } : l));
      
      if (isAutoSendEnabled && analysis.score > 60 && emailSequence.length > 0 && emailJsConfig.publicKey) {
          addLog(`🚀 Auto-Sending Day 0 Email to ${lead.companyName}...`, 'action');
          const sent = await sendViaEmailJS(
              emailJsConfig, 
              lead.decisionMaker?.name || 'Partner', 
              lead.companyName, 
              emailSequence[0].subject, 
              emailSequence[0].body, 
              serviceProfile.senderName || 'Nick'
          );
          
          if (sent) {
              addLog("Email Sent Successfully!", 'success');
              handleMarkContacted(lead);
          } else {
              addLog("Failed to auto-send email.", 'error');
          }
      }

      return true;

    } catch (error: any) {
      if (error?.message?.includes("QUOTA_EXHAUSTED") || error?.message?.includes("429")) {
          setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, status: LeadStatus.NEW } : l));
          
          if (isBackground) {
              throw error; 
          } else {
              setCooldownTime(60);
              setMaxCooldown(60);
              addLog("Analysis failed: Quota Exceeded. Cooldown started.", "error");
          }
          return false;
      }
      
      console.error(error);
      addLog(`Analysis Failed for ${lead.companyName}`, 'error');
      setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, status: LeadStatus.NEW } : l));
      return false;
    } finally {
        if (!isBackground) {
            setAnalyzingIds(prev => {
                const next = new Set(prev);
                next.delete(lead.id);
                return next;
            });
        }
    }
  };

  const qualifiedCount = leads.filter(l => l.status === LeadStatus.QUALIFIED).length;
  const totalValue = qualifiedCount * 1500; 
  const isUsingBackupKey = !!customApiKey;

  return (
    <div className="flex min-h-screen bg-slate-50 font-sans text-slate-900">
      <Sidebar currentView={currentView} onViewChange={setCurrentView} />

      <main className="flex-1 p-6 lg:p-10 overflow-y-auto h-screen flex flex-col">
        
        {currentView === 'dashboard' && (
            <>
                <div className="flex flex-col xl:flex-row gap-8 items-start mb-8">
                    <div className="xl:w-1/3 w-full">
                        <div className="flex justify-between items-start">
                             <div>
                                <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Mission Control</h1>
                                <p className="text-slate-500 mt-1 mb-6">Operational AI Sourcing Agent v0.0.1</p>
                             </div>
                             {isUsingBackupKey && (
                                 <span className="text-[10px] font-bold bg-blue-100 text-blue-800 px-2 py-1 rounded border border-blue-200">
                                     HYBRID MODE: ACTIVE
                                 </span>
                             )}
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4 mb-4">
                            <StatCard 
                                title="Pipeline Value" 
                                value={`$${totalValue.toLocaleString()}`} 
                                trend="+12%" 
                                trendUp={true} 
                                colorTheme="blue" 
                            />
                            <StatCard 
                                title="Qualified Leads" 
                                value={qualifiedCount} 
                                trend="+4" 
                                trendUp={true} 
                                colorTheme="purple"
                            />
                        </div>
                        
                        {emailJsConfig.publicKey && (
                            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm mb-4 flex items-center justify-between">
                                <div>
                                    <h3 className="text-xs font-bold text-slate-700 uppercase">Auto-Send Mode</h3>
                                    <p className="text-[10px] text-slate-500">Automatically email qualified leads.</p>
                                </div>
                                <button 
                                    onClick={() => setIsAutoSendEnabled(!isAutoSendEnabled)}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isAutoSendEnabled ? 'bg-green-500' : 'bg-slate-200'}`}
                                >
                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isAutoSendEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="xl:w-2/3 w-full flex flex-col lg:flex-row gap-4">
                         <div className="flex-1 flex flex-col gap-2">
                             <div className="flex items-center justify-between">
                                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Neural Agent Feed</h2>
                                
                                {cooldownTime > 0 ? (
                                    <div className="flex items-center gap-2 flex-1 mx-4">
                                        <div className="text-[10px] font-bold text-yellow-600 whitespace-nowrap">COOLDOWN</div>
                                        <div className="h-2 w-full bg-yellow-100 rounded-full overflow-hidden">
                                            <div 
                                                className="h-full bg-yellow-500 transition-all duration-1000 ease-linear"
                                                style={{ width: `${(cooldownTime / maxCooldown) * 100}%` }}
                                            />
                                        </div>
                                        <div className="text-[10px] font-mono text-yellow-600 w-8">{cooldownTime}s</div>
                                    </div>
                                ) : (
                                    <button 
                                        onClick={() => setIsGrowthEngineActive(!isGrowthEngineActive)}
                                        className={`px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-md ${
                                            isGrowthEngineActive 
                                            ? 'bg-white text-red-500 hover:bg-red-50 border border-red-100' 
                                            : 'bg-slate-900 text-white hover:bg-slate-800'
                                        }`}
                                    >
                                        {isGrowthEngineActive ? 'STOP ENGINE' : 'START GROWTH ENGINE'}
                                    </button>
                                )}
                            </div>
                            <AgentTerminal logs={logs} active={isGrowthEngineActive} />
                         </div>
                         <div className="w-full lg:w-72">
                             <StrategyQueue queue={strategyQueue} active={isGrowthEngineActive} onAddStrategy={handleManualStrategy} />
                         </div>
                    </div>
                </div>

                <div className="flex-1 min-h-[400px] flex flex-col">
                    <div className="flex justify-between items-center mb-4">
                         <div className="flex bg-slate-100 p-1 rounded-lg">
                             <button 
                                onClick={() => setPipelineMode('table')} 
                                className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${pipelineMode === 'table' ? 'bg-white shadow text-slate-800' : 'text-slate-400'}`}
                             >
                                 Table
                             </button>
                             <button 
                                onClick={() => setPipelineMode('board')} 
                                className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${pipelineMode === 'board' ? 'bg-white shadow text-slate-800' : 'text-slate-400'}`}
                             >
                                 Kanban
                             </button>
                         </div>
                    </div>

                    {pipelineMode === 'table' ? (
                        <PipelineTable 
                            leads={leads.slice(0, 50)} 
                            onAnalyze={(lead) => handleAnalyze(lead)} 
                            onHunt={(lead) => handleHuntDecisionMaker(lead)}
                            onMarkContacted={handleMarkContacted}
                            analyzingIds={analyzingIds}
                            onExport={exportCSV}
                        />
                    ) : (
                        <PipelineBoard 
                            leads={leads}
                            onAnalyze={(lead) => handleAnalyze(lead)}
                            onMarkContacted={handleMarkContacted}
                            analyzingIds={analyzingIds}
                        />
                    )}

                    {leads.length > 50 && pipelineMode === 'table' && (
                        <div className="text-center py-4 text-xs text-slate-400">
                            Showing recent 50 of {leads.length} leads. View all in Prospects tab.
                        </div>
                    )}
                </div>
            </>
        )}

        {currentView === 'prospects' && (
            <div className="flex flex-col h-full">
                <div className="mb-6 flex justify-between items-end">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900">All Prospects</h1>
                        <p className="text-slate-500">Manage and export your entire lead database.</p>
                    </div>
                    <button onClick={exportCSV} className="bg-white border border-slate-200 text-slate-700 font-bold py-2 px-4 rounded-xl shadow-sm hover:bg-slate-50 text-sm">
                        Export CSV
                    </button>
                </div>
                <div className="flex-1">
                     <PipelineTable 
                        leads={leads} 
                        onAnalyze={(lead) => handleAnalyze(lead)} 
                        onHunt={(lead) => handleHuntDecisionMaker(lead)}
                        onMarkContacted={handleMarkContacted}
                        analyzingIds={analyzingIds} 
                    />
                </div>
            </div>
        )}

         {currentView === 'analytics' && (
            <div className="h-full">
                <AnalyticsView leads={leads} />
            </div>
        )}

        {currentView === 'settings' && (
             <div className="max-w-2xl mx-auto w-full mt-10 pb-20">
                <h1 className="text-2xl font-bold text-slate-900 mb-6">System Settings</h1>
                
                <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6 shadow-sm">
                    <div className="flex items-center gap-3 mb-4">
                         <div className="p-2 bg-purple-50 rounded-lg text-purple-600">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                         </div>
                         <div>
                            <h3 className="font-bold text-slate-800">Sender Identity</h3>
                            <p className="text-xs text-slate-500">Configure who the AI "pretends" to be.</p>
                         </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4 mb-4">
                         <div>
                             <label className="block text-xs font-bold text-slate-700 mb-2 uppercase tracking-wide">Sender Name</label>
                             <input 
                                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 outline-none"
                                value={serviceProfile.senderName || ''}
                                onChange={(e) => { setServiceProfile({...serviceProfile, senderName: e.target.value}); setIsProfileDirty(true); }}
                                placeholder="Nick"
                             />
                         </div>
                         <div>
                             <label className="block text-xs font-bold text-slate-700 mb-2 uppercase tracking-wide">Email Address</label>
                             <input 
                                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 outline-none"
                                value={serviceProfile.contactEmail || ''}
                                onChange={(e) => { setServiceProfile({...serviceProfile, contactEmail: e.target.value}); setIsProfileDirty(true); }}
                                placeholder="nick@smoothaiconsultancy.com"
                             />
                         </div>
                    </div>

                    <div className="flex justify-end">
                         {isProfileDirty && (
                             <button 
                                onClick={handleSaveProfile}
                                className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-bold hover:bg-purple-700 transition-colors animate-fadeIn"
                            >
                                Save Identity
                            </button>
                         )}
                    </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6 shadow-sm">
                    <div className="flex items-center gap-3 mb-4">
                         <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
                         </div>
                         <div>
                            <h3 className="font-bold text-slate-800">Hybrid Engine</h3>
                            <p className="text-xs text-slate-500">OpenRouter Backup Configuration.</p>
                         </div>
                    </div>
                    
                    <div className="mb-4">
                        <label className="block text-xs font-bold text-slate-700 mb-2 uppercase tracking-wide">OpenRouter API Key</label>
                        <input 
                            type="password" 
                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 outline-none"
                            placeholder="sk-or-v1-..."
                            value={customApiKey}
                            onChange={(e) => setCustomApiKey(e.target.value)}
                        />
                    </div>
                    <button 
                        onClick={handleSaveKey}
                        className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors"
                    >
                        Save Configuration
                    </button>
                </div>
                
                <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6 shadow-sm">
                    <div className="flex items-center gap-3 mb-4">
                         <div className="p-2 bg-green-50 rounded-lg text-green-600">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                         </div>
                         <div>
                            <h3 className="font-bold text-slate-800">EmailJS Bridge</h3>
                            <p className="text-xs text-slate-500">Hostinger SMTP Integration.</p>
                         </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-700 mb-2 uppercase tracking-wide">Service ID</label>
                            <input 
                                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-sm"
                                placeholder="service_xyz"
                                value={emailJsConfig.serviceId}
                                onChange={(e) => setEmailJsConfig({...emailJsConfig, serviceId: e.target.value})}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-700 mb-2 uppercase tracking-wide">Template ID</label>
                            <input 
                                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-sm"
                                placeholder="template_xyz"
                                value={emailJsConfig.templateId}
                                onChange={(e) => setEmailJsConfig({...emailJsConfig, templateId: e.target.value})}
                            />
                        </div>
                         <div className="col-span-2">
                            <label className="block text-xs font-bold text-slate-700 mb-2 uppercase tracking-wide">Public Key</label>
                            <input 
                                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-sm"
                                placeholder="user_xyz"
                                value={emailJsConfig.publicKey}
                                onChange={(e) => setEmailJsConfig({...emailJsConfig, publicKey: e.target.value})}
                            />
                        </div>
                    </div>
                     <button 
                        onClick={handleSaveEmailConfig}
                        className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
                    >
                        Save Email Settings
                    </button>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
                    <h3 className="font-bold text-slate-800 mb-4">Database Management</h3>
                    <p className="text-sm text-slate-500 mb-4">
                        Backup your leads to a JSON file or restore from a previous backup.
                    </p>
                    
                    <div className="flex gap-4 mb-6">
                         <button 
                            onClick={handleBackup}
                            className="px-4 py-2 border border-slate-200 bg-slate-50 rounded-lg text-sm font-bold text-slate-700 hover:bg-slate-100 transition-colors flex items-center gap-2"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                            Download Backup
                        </button>
                        <label className="px-4 py-2 border border-slate-200 bg-slate-50 rounded-lg text-sm font-bold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer flex items-center gap-2">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                            Restore Backup
                            <input type="file" className="hidden" accept=".json" onChange={handleRestore} />
                        </label>
                    </div>

                    <div className="pt-6 border-t border-slate-100">
                        <button 
                            onClick={() => { 
                                if(confirm("WARNING: This will delete ALL leads and logs. Are you sure?")) {
                                    clearStorage(); 
                                    setLeads([]); 
                                    setLogs([]); 
                                    setStrategyQueue([]); 
                                    addLog("System Memory Wiped.", 'warning');
                                }
                            }} 
                            className="px-4 py-2 border border-red-200 text-red-600 bg-red-50 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors"
                        >
                            Factory Reset Data
                        </button>
                    </div>
                </div>
            </div>
        )}
      </main>
    </div>
  );
}

export default App;
