
import React, { useState, useEffect } from 'react';
import { AgentLog, GlobalStats, SMTPConfig, GoogleSheetsConfig } from '../types';

interface Props {
  logs: AgentLog[];
  stats: GlobalStats;
  smtpConfig: SMTPConfig;
  sheetsConfig: GoogleSheetsConfig;
  onClearLogs: () => void;
  onTestAI: () => Promise<void>;
  onTestEmail: () => Promise<void>;
}

export const DebugView: React.FC<Props> = ({ logs, stats, smtpConfig, sheetsConfig, onClearLogs, onTestAI, onTestEmail }) => {
  const [activeTab, setActiveTab] = useState<'health' | 'logs'>('health');
  const [storageUsage, setStorageUsage] = useState<number>(0);
  const [isRunningTest, setIsRunningTest] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    // Calculate LocalStorage usage approximation
    let total = 0;
    for (let x in localStorage) {
        if (localStorage.hasOwnProperty(x)) {
            total += ((localStorage[x].length * 2));
        }
    }
    setStorageUsage(total / 1024); // KB
  }, []);

  const runTest = async (name: string, fn: () => Promise<void>) => {
      setIsRunningTest(true);
      setTestResult(null);
      try {
          await fn();
          setTestResult(`✅ ${name} Passed`);
      } catch (e: any) {
          setTestResult(`❌ ${name} Failed: ${e.message}`);
      } finally {
          setIsRunningTest(false);
      }
  };

  const getStatusColor = (ok: boolean) => ok ? 'text-green-600 bg-green-50 border-green-200' : 'text-red-600 bg-red-50 border-red-200';

  return (
    <div className="bg-slate-50 min-h-screen p-6 animate-fadeIn font-mono">
      <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
            System Diagnostics
          </h1>
          <div className="flex bg-white rounded-lg p-1 border border-slate-200">
              <button onClick={() => setActiveTab('health')} className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${activeTab === 'health' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-900'}`}>System Health</button>
              <button onClick={() => setActiveTab('logs')} className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${activeTab === 'logs' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-900'}`}>Raw Logs</button>
          </div>
      </div>

      {activeTab === 'health' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* SYSTEM VITALS */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Vitals</h3>
                  <div className="space-y-4">
                      <div className="flex justify-between items-center pb-2 border-b border-slate-50">
                          <span className="text-sm font-medium text-slate-600">Storage Usage</span>
                          <span className={`text-xs font-bold px-2 py-1 rounded border ${storageUsage > 4500 ? 'bg-red-50 text-red-600 border-red-100' : 'bg-slate-50 text-slate-600 border-slate-100'}`}>
                              {storageUsage.toFixed(2)} KB / 5000 KB
                          </span>
                      </div>
                      <div className="flex justify-between items-center pb-2 border-b border-slate-50">
                          <span className="text-sm font-medium text-slate-600">Total Ops</span>
                          <span className="text-xs font-bold text-slate-800">{stats?.totalOperations || 0}</span>
                      </div>
                      <div className="flex justify-between items-center pb-2 border-b border-slate-50">
                          <span className="text-sm font-medium text-slate-600">Est. Cost</span>
                          <span className="text-xs font-bold text-slate-800">${((stats?.estimatedCost || 0) / 100).toFixed(4)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                          <span className="text-sm font-medium text-slate-600">Version</span>
                          <span className="text-xs font-bold text-slate-400">v2.6.0-stable</span>
                      </div>
                  </div>
              </div>

              {/* CONFIG CHECK */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Configuration Status</h3>
                  <div className="space-y-3">
                      <div className={`p-3 rounded-lg border flex justify-between items-center ${getStatusColor(!!smtpConfig.host && !!smtpConfig.user)}`}>
                          <span className="text-xs font-bold flex items-center gap-2">
                              ✉️ SMTP Bridge
                          </span>
                          <span className="text-[10px] uppercase font-bold">{!!smtpConfig.host && !!smtpConfig.user ? 'Configured' : 'Missing'}</span>
                      </div>
                      <div className={`p-3 rounded-lg border flex justify-between items-center ${getStatusColor(!!sheetsConfig.scriptUrl)}`}>
                          <span className="text-xs font-bold flex items-center gap-2">
                              📊 Google Sheets
                          </span>
                          <span className="text-[10px] uppercase font-bold">{!!sheetsConfig.scriptUrl ? 'Connected' : 'Disconnected'}</span>
                      </div>
                      <div className={`p-3 rounded-lg border flex justify-between items-center ${getStatusColor(true)}`}>
                          <span className="text-xs font-bold flex items-center gap-2">
                              🤖 Gemini API
                          </span>
                          <span className="text-[10px] uppercase font-bold">Active</span>
                      </div>
                  </div>
              </div>

              {/* TEST BENCH */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 md:col-span-2">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Diagnostic Tools</h3>
                  <div className="flex gap-4 items-center">
                      <button 
                        onClick={() => runTest('AI Connection', onTestAI)}
                        disabled={isRunningTest}
                        className="px-4 py-2 bg-purple-50 text-purple-700 border border-purple-200 rounded-lg text-xs font-bold hover:bg-purple-100 disabled:opacity-50"
                      >
                          Test Neural Engine
                      </button>
                      <button 
                        onClick={() => runTest('Email Relay', onTestEmail)}
                        disabled={isRunningTest}
                        className="px-4 py-2 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-xs font-bold hover:bg-blue-100 disabled:opacity-50"
                      >
                          Test Email Relay
                      </button>
                      
                      {isRunningTest && <span className="text-xs text-slate-400 animate-pulse">Running diagnostics...</span>}
                      {testResult && (
                          <span className={`text-xs font-bold px-3 py-1.5 rounded border ${testResult.includes('Passed') ? 'bg-green-100 text-green-700 border-green-200' : 'bg-red-100 text-red-700 border-red-200'}`}>
                              {testResult}
                          </span>
                      )}
                  </div>
              </div>
          </div>
      )}

      {activeTab === 'logs' && (
          <div className="bg-slate-900 rounded-xl shadow-lg border border-slate-800 p-4 h-[600px] flex flex-col">
              <div className="flex justify-between items-center mb-4 border-b border-slate-800 pb-2">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">System Logs ({logs.length})</h3>
                  <button onClick={onClearLogs} className="text-[10px] text-red-400 hover:text-red-300 font-bold uppercase">Clear Logs</button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-1 font-mono text-[10px]">
                  {logs.length === 0 && <span className="text-slate-600 italic">No logs recorded.</span>}
                  {logs.slice().reverse().map(log => (
                      <div key={log.id} className="flex gap-3 hover:bg-white/5 p-1 rounded">
                          <span className="text-slate-500 shrink-0">{new Date(log.timestamp).toISOString().split('T')[1].slice(0,8)}</span>
                          <span className={`
                              ${log.type === 'error' ? 'text-red-400 font-bold' : ''}
                              ${log.type === 'warning' ? 'text-yellow-400' : ''}
                              ${log.type === 'success' ? 'text-green-400' : ''}
                              ${log.type === 'action' ? 'text-blue-400' : 'text-slate-300'}
                          `}>
                              [{log.type.toUpperCase()}] {log.message}
                          </span>
                      </div>
                  ))}
              </div>
          </div>
      )}
    </div>
  );
};
