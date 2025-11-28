
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
  const [storageBreakdown, setStorageBreakdown] = useState<Record<string, string>>({});
  const [totalStorage, setTotalStorage] = useState(0);
  const [latency, setLatency] = useState<string>('Checking...');
  const [isRunningTest, setIsRunningTest] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    // 1. Storage Breakdown
    let total = 0;
    const breakdown: Record<string, string> = {};
    for (let x in localStorage) {
        if (localStorage.hasOwnProperty(x)) {
            const size = localStorage[x].length * 2;
            total += size;
            breakdown[x] = (size / 1024).toFixed(2) + ' KB';
        }
    }
    setStorageBreakdown(breakdown);
    setTotalStorage(total / 1024);

    // 2. Latency
    const start = Date.now();
    fetch(window.location.origin).then(() => {
        setLatency(`${Date.now() - start}ms`);
    }).catch(() => setLatency('Offline'));
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

  return (
    <div className="bg-slate-50 min-h-screen p-6 animate-fadeIn font-mono">
      <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            System Diagnostics
          </h1>
          <div className="flex bg-white rounded-lg p-1 border border-slate-200">
              <button onClick={() => setActiveTab('health')} className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${activeTab === 'health' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-900'}`}>System Health</button>
              <button onClick={() => setActiveTab('logs')} className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${activeTab === 'logs' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-900'}`}>Raw Logs</button>
          </div>
      </div>

      {activeTab === 'health' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* SYSTEM VITALS */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Vitals</h3>
                  <div className="space-y-3">
                      <div className="flex justify-between items-center border-b border-slate-50 pb-2">
                          <span className="text-sm font-medium text-slate-600">Client Latency</span>
                          <span className={`text-xs font-bold px-2 py-1 rounded border ${latency === 'Offline' ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>{latency}</span>
                      </div>
                      <div className="flex justify-between items-center border-b border-slate-50 pb-2">
                          <span className="text-sm font-medium text-slate-600">Total Storage</span>
                          <span className={`text-xs font-bold px-2 py-1 rounded border ${totalStorage > 4500 ? 'bg-red-50 text-red-600' : 'bg-slate-50 text-slate-600'}`}>{totalStorage.toFixed(2)} KB</span>
                      </div>
                      <div className="flex justify-between items-center">
                          <span className="text-sm font-medium text-slate-600">Environment</span>
                          <span className="text-xs font-bold text-slate-500">{process.env.NODE_ENV || 'development'}</span>
                      </div>
                  </div>
              </div>

              {/* STORAGE BREAKDOWN */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Storage Usage</h3>
                  <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
                      {Object.entries(storageBreakdown).map(([key, size]) => (
                          <div key={key} className="flex justify-between items-center text-xs">
                              <span className="text-slate-500 truncate w-40" title={key}>{key.replace('smooth_ai_', '')}</span>
                              <span className="font-mono font-bold text-slate-700">{size}</span>
                          </div>
                      ))}
                  </div>
              </div>

              {/* TEST BENCH */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Test Bench</h3>
                  <div className="flex flex-col gap-2">
                      <button onClick={() => runTest('AI Engine', onTestAI)} disabled={isRunningTest} className="w-full py-2 bg-purple-50 text-purple-700 border border-purple-200 rounded-lg text-xs font-bold hover:bg-purple-100 disabled:opacity-50 text-left px-4">⚡ Test Neural Engine</button>
                      <button onClick={() => runTest('Email SMTP', onTestEmail)} disabled={isRunningTest} className="w-full py-2 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-xs font-bold hover:bg-blue-100 disabled:opacity-50 text-left px-4">✉️ Test Email Relay</button>
                      {testResult && (
                          <div className={`mt-2 text-xs font-bold p-2 rounded ${testResult.includes('Passed') ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                              {testResult}
                          </div>
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
                          <span className="text-slate-500 shrink-0">{new Date(log.timestamp).toLocaleTimeString()}</span>
                          <span className={`
                              ${log.type === 'error' ? 'text-red-400 font-bold' : ''}
                              ${log.type === 'warning' ? 'text-yellow-400' : ''}
                              ${log.type === 'success' ? 'text-green-400' : ''}
                              ${log.type === 'action' ? 'text-blue-400' : 'text-slate-300'}
                          `}>
                              {log.message}
                          </span>
                      </div>
                  ))}
              </div>
          </div>
      )}
    </div>
  );
};
