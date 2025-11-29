import React, { useState, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Lead, LeadStatus, ServiceProfile, AgentLog, StrategyNode, ViewType, SMTPConfig, GoogleSheetsConfig, GlobalStats, Shortcut, IMAPConfig } from './types';
import { PipelineTable } from './components/PipelineTable';
import { PipelineBoard } from './components/PipelineBoard';
import { StatCard } from './components/StatCard';
import { Sidebar } from './components/Sidebar';
import { AgentTerminal } from './components/AgentTerminal';
import { StrategyQueue } from './components/StrategyQueue';
import { AnalyticsView } from './components/AnalyticsView';
import { QualityControlView } from './components/QualityControlView';
import { DebugView } from './components/DebugView';
import { CalendarView } from './components/CalendarView';
import { LinkedInView } from './components/LinkedInView';
import { InboxView } from './components/InboxView';
import { findLeads, analyzeLeadFitness, generateEmailSequence, generateMasterPlan, findDecisionMaker, findTriggers, setCostCallback, testOpenRouterConnection } from './services/geminiService';
import { 
    saveLeadsToStorage, loadLeadsFromStorage, saveStrategies, loadStrategies,
    saveLogs, loadLogs, saveProfile, loadProfile, saveSMTPConfig, loadSMTPConfig,
    saveSheetsConfig, loadSheetsConfig, clearStorage, saveOpenRouterKey, loadOpenRouterKey,
    exportDatabase, importDatabase, saveBlacklist, loadBlacklist, saveStats, loadStats,
    manageStorageQuota, saveIMAPConfig, loadIMAPConfig
} from './services/storageService';
import { fetchLeadsFromSheet, saveLeadsToSheet } from './services/googleSheetsService';
import { sendViaServer } from './services/emailService';
import { MOCK_LEADS } from './services/mockData';

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
  const [imapConfig, setImapConfig] = useState<IMAPConfig>(() => loadIMAPConfig());
  const [sheetsConfig, setSheetsConfig] = useState<GoogleSheetsConfig>(() => loadSheetsConfig());
  const [blacklist, setBlacklist] = useState<string[]>(() => loadBlacklist());
  const [stats, setStats] = useState<GlobalStats>(() => loadStats());
  
  // UI STATUS STATE
  const [smtpStatus, setSmtpStatus] = useState<string>('');
  const [imapStatus, setImapStatus] = useState<string>('');
  const [sheetsStatus, setSheetsStatus] = useState<string>('');
  const [routerStatus, setRouterStatus] = useState<string>('');
  
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

  // --- GOOGLE SHEETS AUTO-SYNC ENGINE ---
  
  // 1. Auto-Load on Startup
  useEffect(() => {
    if (sheetsConfig.scriptUrl) {
        addLog("☁️ Connecting to Google Sheets...", 'info');
        setSheetsStatus("Syncing...");
        fetchLeadsFromSheet(sheetsConfig.scriptUrl).then(remoteLeads => {
            if (remoteLeads && remoteLeads.length > 0) {
                // Determine if we should merge or overwrite? For safety, we overwrite local with cloud if cloud has data.
                // Or merge? Let's stick to Cloud as Truth for now.
                setLeads(remoteLeads);
                addLog(`✅ Database loaded from Cloud (${remoteLeads.length} records)`, 'success');
                setSheetsStatus("☁️ Synced");
            } else {
                setSheetsStatus("☁️ Connected");
            }
        }).catch(err => {
            addLog("❌ Cloud Load Failed", 'error');
            setSheetsStatus("❌ Error");
        });
    }
  }, [sheetsConfig.scriptUrl]); // Run once on mount if URL exists

  // 2. Auto-Save on Change (Debounced)
  useEffect(() => {
      if (!sheetsConfig.scriptUrl) return;

      const handler = setTimeout(async () => {
          setSheetsStatus('♻️ Saving...');
          const success = await saveLeadsToSheet(sheetsConfig.scriptUrl, leads);
          if (success) setSheetsStatus('☁️ Synced');
          else setSheetsStatus('❌ Save Failed');
      }, 3000); // Wait 3 seconds after last change

      return () => clearTimeout(handler);
  }, [leads, sheetsConfig.scriptUrl]);


  // OPEN TRACKING POLLER (v3.0)
  useEffect(() => {
      const pollOpens = async () => {
          try {
              const res = await fetch('/api/track/status');
              if (res.ok) {
                  const data = await res.json();
                  let hasUpdates = false;
                  const updatedLeads = leadsRef.current.map(l => {
                      if (data[l.id] && l.status !== LeadStatus.OPENED && l.status !== LeadStatus.QUALIFIED) {
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
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            setCurrentView(prev => prev === 'dashboard' ? 'prospects' : 'dashboard');
        }
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

  const handleTestSheets = async () => {
      if (!sheetsConfig.scriptUrl) { setSheetsStatus("⚠️ Missing URL"); return; }
      setSheetsStatus("Testing...");
      const success = await saveLeadsToSheet(sheetsConfig.scriptUrl, []);
      if (success) setSheetsStatus("✅ Connected");
      else setSheetsStatus("❌ Failed");
      setTimeout(() => setSheetsStatus(''), 3000);
  }
  
  const handleCloudLoad = async () => {
      if (!sheetsConfig.scriptUrl) { setSheetsStatus("⚠️ Missing URL"); return; }
      if (!confirm("Overwrite local data with Cloud data?")) return;
      addLog("Loading from Google Sheets...", 'info');
      setSheetsStatus('Loading...');
      const remoteLeads = await fetchLeadsFromSheet(sheetsConfig.scriptUrl);
      if (remoteLeads) {
          setLeads(remoteLeads);
          addLog(`Loaded ${remoteLeads.length} leads from Cloud`, 'success');
          setSheetsStatus('✅ Loaded');
      } else {
          addLog("Cloud Load Failed", 'error');
          setSheetsStatus('❌ Error');
      }
      setTimeout(() => setSheetsStatus(''), 3000);
  };

  const handleDemoLoad = () => {
      if (!confirm("Load Demo Data?")) return;
      setLeads(prev => [...MOCK_LEADS, ...prev]);
      addLog("Demo Data Loaded", 'success');
  };

  const handleTestAI = async () => {
      try {
          const success = await testOpenRouterConnection();
          addLog(success ? "AI Connection OK" : "AI Connection Failed", success ? 'success' : 'error');
      } catch (e: any) {
          addLog(`AI Error: ${e.message}`, 'error');
      }
  };

  const handleTestOpenRouter = async () => {
      setRouterStatus("Testing...");
      try {
          const success = await testOpenRouterConnection();
          if (success) setRouterStatus("✅ Active");
          else setRouterStatus("❌ Failed");
      } catch (e: any) {
          setRouterStatus("❌ Error");
      }
      setTimeout(() => setRouterStatus(''), 3000);
  };

  const handleTestEmail = async () => {
      setSmtpStatus("Sending...");
      try {
        const result = await sendViaServer(
            smtpConfig,
            'test_id',
            serviceProfile.contactEmail || "nick@smoothaiconsultancy.com",
            serviceProfile.senderName || "Nick",
            "Smooth AI Test",
            "This confirms your SMTP relay is working.",
            serviceProfile.senderName || "System",
            serviceProfile.contactEmail
        );
        if (result) setSmtpStatus("✅ Sent");
        else setSmtpStatus("❌ Failed");
      } catch (e: any) {
          setSmtpStatus(`❌ ${e.message}`);
      }
      setTimeout(() => setSmtpStatus(''), 3000);
  };

  const handleSaveImapConfig = async () => {
      setImapStatus("Saving...");
      try {
        const res = await fetch('/api/imap/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(imapConfig)
        });
        if (res.ok) {
            saveIMAPConfig(imapConfig);
            setImapStatus("✅ Saved");
            addLog("IMAP Config Saved", 'success');
        } else {
            setImapStatus("❌ Failed");
        }
      } catch (e: any) {
          setImapStatus(`❌ ${e.message}`);
      }
      setTimeout(() => setImapStatus(''), 3000);
  };

  const handleTestImap = async () => {
      setImapStatus("Testing...");
      try {
        const res = await fetch('/api/imap/test', { method: 'POST' });
        const data = await res.json();
        if (res.ok && data.success) {
            setImapStatus("✅ Connected");
            addLog("IMAP connection successful", 'success');
        } else {
            setImapStatus(`❌ ${data.error || 'Failed'}`);
        }
      } catch (e: any) {
          setImapStatus(`❌ ${e.message}`);
      }
      setTimeout(() => setImapStatus(''), 5000);
  };

  const handleDeleteLead = (leadId: string) => {
      if (confirm("Are you sure you want to delete this lead?")) {
          setLeads(prev => prev.filter(l => l.id !== leadId));
          addLog("Lead deleted", 'warning');
      }
  };

  const handleUpdateLead = (updatedLead: Lead) => {
      setLeads(prev => prev.map(l => l.id === updatedLead.id ? updatedLead : l));
      addLog("Lead updated manually", 'info');
  };

  const handleAnalyze = async (lead: Lead, isBackground = false): Promise<boolean> => {
    if (!isBackground) setAnalyzingIds(prev => new Set(prev).add(lead.id));

    try {
      const { analysis, techStack } = await analyzeLeadFitness(lead, serviceProfile);
      
      let dm: any = null, triggers: any[] = [], emailSequence: any[] = [];

      if (analysis.score > 60) {
          addLog(`Qualified ${lead.companyName} (${analysis.score}). Deep diving...`, 'success');
          dm = await findDecisionMaker(lead.companyName, lead.website);
          triggers = await findTriggers(lead.companyName, lead.website);
          emailSequence = await generateEmailSequence({ ...lead, decisionMaker: dm, techStack }, serviceProfile, analysis, triggers);
          
          const variant = Math.random() > 0.5 ? 'B' : 'A';
          if (emailSequence.length > 0 && emailSequence[0].alternativeSubject) {
              emailSequence[0].variantLabel = variant;
              if (variant === 'B') {
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
    if (!isGrowthEngineActiveRef.current || cooldownTime > 0) return;
    if (consecutiveFailures >= 3) {
        addLog("🚨 CIRCUIT BREAKER TRIPPED. Engine Stopped.", 'error');
        setIsGrowthEngineActive(false);
        setConsecutiveFailures(0);
        return;
    }

    try {
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

        addLog(`Executing: ${currentStrategy.query}`, 'action');
        const { leads: foundLeads } = await findLeads(currentStrategy.query, blacklist);
        
        if (!foundLeads.length) {
            addLog(`No results for ${currentStrategy.sector}. Skipping.`, 'warning');
            setStrategyQueue(prev => prev.map(s => s.id === currentStrategy!.id ? { ...s, status: 'completed' } : s));
            setTimeout(() => runGrowthCycle(), 2000);
            return;
        }

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

        if (newCandidates.length) {
            setLeads(prev => [...newCandidates, ...prev]);
            addLog(`Found ${newCandidates.length} new candidates. Starting Deep Analysis...`, 'info');
            setConsecutiveFailures(0); 
            
            for (const lead of newCandidates) {
                if (!isGrowthEngineActiveRef.current || cooldownTime > 0) break;
                const success = await handleAnalyze(lead, true);
                if (!success) {
                    setConsecutiveFailures(prev => prev + 1);
                    break; 
                }
                await new Promise(r => setTimeout(r, 20000));
            }
        } else {
            addLog("All found leads were duplicates.", 'warning');
        }

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
        {/* Sync Status Badge (Top Right) */}
        {sheetsConfig.scriptUrl && (
            <div className="absolute top-4 right-4 z-50">
                <span className={`text-[10px] font-bold px-3 py-1.5 rounded-full shadow-sm border transition-all ${
                    sheetsStatus.includes('Synced') ? 'bg-green-100 text-green-700 border-green-200' :
                    sheetsStatus.includes('Error') ? 'bg-red-100 text-red-700 border-red-200' :
                    'bg-slate-100 text-slate-600 border-slate-200'
                }`}>
                    {sheetsStatus || "☁️ Cloud Active"}
                </span>
            </div>
        )}

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
                     <PipelineTable 
                        leads={leads} 
                        onAnalyze={handleAnalyze} 
                        analyzingIds={analyzingIds} 
                        onHunt={(l) => addLog("Hunt triggered", 'info')} 
                        onUpdateLead={handleUpdateLead}
                        onDeleteLead={handleDeleteLead}
                    />
                 </div>
            </div>
        )}

        {currentView === 'prospects' && (
             <div className="h-full animate-fadeIn">
                <PipelineTable 
                    leads={leads} 
                    onAnalyze={handleAnalyze} 
                    analyzingIds={analyzingIds} 
                    onMarkContacted={(l) => setLeads(prev => prev.map(p => p.id === l.id ? {...p, status: LeadStatus.CONTACTED, lastContactedAt: Date.now()} : p))}
                    onAddManualLead={(l) => setLeads(prev => [l, ...prev])}
                    onUpdateLead={handleUpdateLead}
                    onDeleteLead={handleDeleteLead}
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
        
        {currentView === 'calendar' && <CalendarView leads={leads} />}
        {currentView === 'linkedin' && <LinkedInView />}
        {currentView === 'inbox' && <InboxView leads={leads} />}
        {currentView === 'quality_control' && <QualityControlView leads={leads} onApprove={()=>{}} onReject={(l) => setLeads(prev => prev.map(p => p.id === l.id ? {...p, status: LeadStatus.UNQUALIFIED} : p))} />}
        {currentView === 'debug' && <DebugView logs={logs} stats={stats} smtpConfig={smtpConfig} sheetsConfig={sheetsConfig} onClearLogs={() => setLogs([])} onTestAI={handleTestAI} onTestEmail={handleTestEmail} />}
        {currentView === 'analytics' && <AnalyticsView leads={leads} />}

        {currentView === 'settings' && (
            <div className="max-w-xl mx-auto space-y-6 pb-20 animate-fadeIn text-slate-800 dark:text-slate-200">
                <h1 className="text-2xl font-bold">System Configuration</h1>
                
                {/* Profile */}
                <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm relative">
                    <h3 className="font-bold mb-2">Sender Identity</h3>
                    <input className="w-full border dark:border-slate-700 bg-transparent p-2 rounded mb-2 text-sm" value={serviceProfile.senderName} onChange={e => setServiceProfile({...serviceProfile, senderName: e.target.value})} placeholder="Your Name" />
                    <input className="w-full border dark:border-slate-700 bg-transparent p-2 rounded mb-2 text-sm" value={serviceProfile.contactEmail} onChange={e => setServiceProfile({...serviceProfile, contactEmail: e.target.value})} placeholder="Email Address" />
                    <button onClick={() => { saveProfile(serviceProfile); addLog("Profile Saved", 'success'); }} className="mt-3 bg-blue-600 text-white px-4 py-2 rounded text-sm font-bold">Save Identity</button>
                </div>

                {/* Cloud Sync (Webhooks Removed, Sheets Kept) */}
                <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                    <h3 className="font-bold mb-2">Cloud Integrations</h3>
                    <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
                         <label className="text-xs font-bold text-slate-500 block mb-1">Google Sheets Script URL</label>
                         <input className="w-full border dark:border-slate-700 bg-transparent p-2 rounded text-sm mb-2" value={sheetsConfig.scriptUrl} onChange={e => setSheetsConfig({scriptUrl: e.target.value})} placeholder="https://script.google.com/..." />
                         <div className="flex gap-2 items-center">
                            <button onClick={() => { saveSheetsConfig(sheetsConfig); addLog("Sheets Config Saved", 'success'); }} className="bg-slate-900 dark:bg-slate-700 text-white px-3 py-1.5 rounded text-xs font-bold">Save</button>
                            <button onClick={handleTestSheets} className="bg-blue-50 text-blue-600 px-3 py-1.5 rounded text-xs font-bold border border-blue-200">Test Connection</button>
                            {sheetsStatus && <span className="text-xs font-bold animate-fadeIn">{sheetsStatus}</span>}
                         </div>
                    </div>
                </div>

                {/* Email Server */}
                <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                     <h3 className="font-bold mb-2">Email Relay (Hostinger/SMTP)</h3>
                     <div className="grid grid-cols-2 gap-2 mb-2">
                        <input className="border dark:border-slate-700 bg-transparent p-2 rounded text-sm" placeholder="Host" value={smtpConfig.host} onChange={e => setSmtpConfig({...smtpConfig, host: e.target.value})} />
                        <input className="border dark:border-slate-700 bg-transparent p-2 rounded text-sm" placeholder="Port" value={smtpConfig.port} onChange={e => setSmtpConfig({...smtpConfig, port: e.target.value})} />
                        <input className="border dark:border-slate-700 bg-transparent p-2 rounded text-sm" placeholder="User" value={smtpConfig.user} onChange={e => setSmtpConfig({...smtpConfig, user: e.target.value})} />
                        <input className="border dark:border-slate-700 bg-transparent p-2 rounded text-sm" placeholder="Pass" type="password" value={smtpConfig.pass} onChange={e => setSmtpConfig({...smtpConfig, pass: e.target.value})} />
                     </div>
                     <div className="mb-2">
                        <input className="w-full border dark:border-slate-700 bg-transparent p-2 rounded text-sm" placeholder="Public URL (for Tracking Pixel)" value={smtpConfig.publicUrl || ''} onChange={e => setSmtpConfig({...smtpConfig, publicUrl: e.target.value})} />
                     </div>
                     <div className="flex gap-2 items-center">
                         <button onClick={() => { saveSMTPConfig(smtpConfig); addLog("SMTP Config Saved", 'success'); setSmtpStatus('✅ Saved'); setTimeout(()=>setSmtpStatus(''), 2000); }} className="bg-slate-900 dark:bg-slate-700 text-white px-4 py-2 rounded text-sm font-bold">Save SMTP</button>
                         <button onClick={handleTestEmail} className="bg-blue-50 text-blue-600 px-4 py-2 rounded text-sm font-bold border border-blue-200">Test Connection</button>
                         {smtpStatus && <span className="text-xs font-bold animate-fadeIn">{smtpStatus}</span>}
                     </div>
                </div>

                {/* IMAP Inbox Settings */}
                <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                     <h3 className="font-bold mb-2">Email Inbox (IMAP)</h3>
                     <p className="text-xs text-slate-500 mb-3">Configure IMAP to sync incoming emails and link them to leads.</p>
                     <div className="grid grid-cols-2 gap-2 mb-2">
                        <input className="border dark:border-slate-700 bg-transparent p-2 rounded text-sm" placeholder="Host" value={imapConfig.host} onChange={e => setImapConfig({...imapConfig, host: e.target.value})} />
                        <input className="border dark:border-slate-700 bg-transparent p-2 rounded text-sm" placeholder="Port" value={imapConfig.port} onChange={e => setImapConfig({...imapConfig, port: e.target.value})} />
                        <input className="border dark:border-slate-700 bg-transparent p-2 rounded text-sm" placeholder="Username" value={imapConfig.user} onChange={e => setImapConfig({...imapConfig, user: e.target.value})} />
                        <input className="border dark:border-slate-700 bg-transparent p-2 rounded text-sm" placeholder="Password" type="password" value={imapConfig.pass} onChange={e => setImapConfig({...imapConfig, pass: e.target.value})} />
                     </div>
                     <div className="flex items-center gap-2 mb-3">
                        <input type="checkbox" id="imapSecure" checked={imapConfig.secure} onChange={e => setImapConfig({...imapConfig, secure: e.target.checked})} className="rounded" />
                        <label htmlFor="imapSecure" className="text-sm text-slate-600 dark:text-slate-400">Use TLS/SSL</label>
                     </div>
                     <div className="flex gap-2 items-center">
                         <button onClick={handleSaveImapConfig} className="bg-slate-900 dark:bg-slate-700 text-white px-4 py-2 rounded text-sm font-bold">Save IMAP</button>
                         <button onClick={handleTestImap} className="bg-blue-50 text-blue-600 px-4 py-2 rounded text-sm font-bold border border-blue-200">Test Connection</button>
                         {imapStatus && <span className="text-xs font-bold animate-fadeIn">{imapStatus}</span>}
                     </div>
                </div>

                {/* OpenRouter Key */}
                <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm border-dashed border-2">
                     <h3 className="font-bold mb-2">OpenRouter API Key</h3>
                     <input type="password" value={customApiKey} onChange={e => setCustomApiKey(e.target.value)} className="w-full border dark:border-slate-700 bg-transparent p-2 rounded mb-2 text-sm" placeholder="sk-or-..." />
                     <div className="flex gap-2 items-center">
                        <button onClick={() => { saveOpenRouterKey(customApiKey); addLog("Key Saved", 'success'); }} className="bg-slate-900 dark:bg-slate-700 text-white px-4 py-2 rounded text-sm font-bold">Save Key</button>
                        <button onClick={handleTestOpenRouter} className="bg-purple-50 text-purple-600 px-4 py-2 rounded text-sm font-bold border border-purple-200">Test Key</button>
                        {routerStatus && <span className="text-xs font-bold animate-fadeIn">{routerStatus}</span>}
                     </div>
                </div>

                {/* Blacklist */}
                <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                    <h3 className="font-bold mb-2">Negative Filter (Blacklist)</h3>
                    <textarea className="w-full border dark:border-slate-700 bg-transparent p-2 rounded text-xs" rows={4} value={blacklist.join(', ')} onChange={(e) => setBlacklist(e.target.value.split(',').map(s => s.trim()))} />
                </div>
            </div>
        )}
      </main>
    </div>
  );
}

export default App;