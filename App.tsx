
import React, { useState, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Lead, LeadStatus, ServiceProfile, AgentLog, StrategyNode, ViewType, SMTPConfig, GoogleSheetsConfig, GlobalStats } from './types';
import { PipelineTable } from './components/PipelineTable';
import { PipelineBoard } from './components/PipelineBoard';
import { StatCard } from './components/StatCard';
import { Sidebar } from './components/Sidebar';
import { AgentTerminal } from './components/AgentTerminal';
import { StrategyQueue } from './components/StrategyQueue';
import { AnalyticsView } from './components/AnalyticsView';
import { QualityControlView } from './components/QualityControlView';
import { findLeads, analyzeLeadFitness, generateEmailSequence, generateMasterPlan, findDecisionMaker, findTriggers, setCostCallback } from './services/geminiService';
import { 
    saveLeadsToStorage, loadLeadsFromStorage, saveStrategies, loadStrategies,
    saveLogs, loadLogs, saveProfile, loadProfile, saveSMTPConfig, loadSMTPConfig,
    saveSheetsConfig, loadSheetsConfig, clearStorage, saveOpenRouterKey, loadOpenRouterKey,
    exportDatabase, importDatabase, saveBlacklist, loadBlacklist, saveStats, loadStats
} from './services/storageService';

const DEFAULT_PROFILE: ServiceProfile = {
  companyName: "Smooth AI Consulting",
  description: "Operational AI Consultancy.",
  valueProposition: "We replace manual functions with AI.",
  senderName: "Nick",
  contactEmail: "nick@smoothaiconsultancy.com"
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
  
  // Rate Limiting
  const [cooldownTime, setCooldownTime] = useState(0);
  const [maxCooldown, setMaxCooldown] = useState(60);

  // Refs for loop stability
  const isGrowthEngineActiveRef = useRef(isGrowthEngineActive);
  const leadsRef = useRef(leads); 
  const strategyQueueRef = useRef(strategyQueue);

  // EFFECTS: Persist Data
  useEffect(() => { saveLeadsToStorage(leads); leadsRef.current = leads; }, [leads]);
  useEffect(() => { saveStrategies(strategyQueue); strategyQueueRef.current = strategyQueue; }, [strategyQueue]);
  useEffect(() => { saveLogs(logs); }, [logs]);
  useEffect(() => { saveBlacklist(blacklist); }, [blacklist]);
  useEffect(() => { saveStats(stats); }, [stats]);

  // Sync Growth Engine Ref
  useEffect(() => {
    isGrowthEngineActiveRef.current = isGrowthEngineActive;
    if (isGrowthEngineActive && cooldownTime === 0) runGrowthCycle();
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
    // Safety Checks
    if (!isGrowthEngineActiveRef.current || cooldownTime > 0) return;

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
                } catch (e) {
                     // If Master Plan fails, wait and retry
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
            
            for (const lead of newCandidates) {
                if (!isGrowthEngineActiveRef.current || cooldownTime > 0) break;
                const success = await handleAnalyze(lead, true);
                if (!success) break; // If analysis fails (quota/error), stop batch
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
            setTimeout(() => runGrowthCycle(), 10000);
        }
    }
  };

  const qualifiedCount = leads.filter(l => l.status === LeadStatus.QUALIFIED).length;
  const pendingReviewCount = leads.filter(l => l.status === LeadStatus.QUALIFIED && !l.lastContactedAt).length;

  return (
    <div className="flex min-h-screen bg-slate-50 font-sans text-slate-900">
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
                         const csv = "Company,Website,Score,Status\n" + leads.map(l => `${l.companyName},${l.website},${l.analysis?.score || 0},${l.status}`).join('\n');
                         const blob = new Blob([csv], { type: 'text/csv' });
                         const url = window.URL.createObjectURL(blob);
                         const a = document.createElement('a');
                         a.href = url; a.download = 'leads.csv'; a.click();
                    }}
                />
             </div>
        )}
        
        {/* VIEW: QUALITY CONTROL */}
        {currentView === 'quality_control' && (
            <div className="h-full animate-fadeIn">
                <QualityControlView 
                    leads={leads} 
                    onApprove={(l) => { /* Logic is technically 'do nothing' as it's already qualified, but maybe move to contacted? For now just keep. */ }}
                    onReject={(l) => setLeads(prev => prev.map(p => p.id === l.id ? {...p, status: LeadStatus.UNQUALIFIED} : p))}
                />
            </div>
        )}
        
        {/* VIEW: ANALYTICS */}
        {currentView === 'analytics' && <AnalyticsView leads={leads} />}

        {/* VIEW: SETTINGS */}
        {currentView === 'settings' && (
            <div className="max-w-xl mx-auto space-y-6 pb-20 animate-fadeIn">
                <h1 className="text-2xl font-bold text-slate-800">System Configuration</h1>
                
                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                    <h3 className="font-bold mb-2">Sender Identity</h3>
                    <input className="w-full border p-2 rounded mb-2 text-sm" value={serviceProfile.senderName} onChange={e => setServiceProfile({...serviceProfile, senderName: e.target.value})} placeholder="Your Name" />
                    <input className="w-full border p-2 rounded mb-2 text-sm" value={serviceProfile.contactEmail} onChange={e => setServiceProfile({...serviceProfile, contactEmail: e.target.value})} placeholder="Email Address" />
                    <button onClick={() => { saveProfile(serviceProfile); addLog("Profile Saved", 'success'); }} className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-bold">Save Identity</button>
                </div>

                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                    <h3 className="font-bold mb-2">Negative Filter (Blacklist)</h3>
                    <p className="text-xs text-slate-500 mb-2">The AI will strictly ignore domains containing these words.</p>
                    <textarea 
                        className="w-full border p-2 rounded text-xs" 
                        rows={4}
                        value={blacklist.join(', ')}
                        onChange={(e) => setBlacklist(e.target.value.split(',').map(s => s.trim()))}
                        placeholder="agency, competitor, marketing..."
                    />
                </div>

                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                     <h3 className="font-bold mb-2">OpenRouter API Key</h3>
                     <p className="text-xs text-slate-500 mb-2">Required for Hybrid Engine fallback.</p>
                     <input type="password" value={customApiKey} onChange={e => setCustomApiKey(e.target.value)} className="w-full border p-2 rounded mb-2 text-sm" placeholder="sk-or-..." />
                     <button onClick={() => { saveOpenRouterKey(customApiKey); addLog("Key Saved", 'success'); }} className="bg-slate-900 text-white px-4 py-2 rounded text-sm font-bold">Save Key</button>
                </div>

                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                     <h3 className="font-bold mb-2">Data Management</h3>
                     <div className="flex gap-4">
                        <button onClick={handleBackup} className="border border-slate-300 px-4 py-2 rounded text-sm font-bold hover:bg-slate-50">Download Backup</button>
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
