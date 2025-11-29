import React, { useState, useEffect } from 'react';
import { RefreshCw, Play, Pause, Mail, Inbox, Clock, AlertTriangle, CheckCircle, XCircle, Zap } from 'lucide-react';

interface AutomationStats {
  isRunning: boolean;
  emailsSentToday: number;
  dailyLimit: number;
  queue: {
    pending: number;
    sent: number;
    failed: number;
  };
  replies: {
    total: number;
    interested: number;
    questions: number;
    declined: number;
  };
  recentLogs: Array<{
    id: number;
    type: string;
    message: string;
    details: string;
    created_at: number;
  }>;
}

interface QueueEmail {
  id: number;
  lead_name: string;
  to_email: string;
  subject: string;
  sequence_step: number;
  scheduled_for: number;
  status: string;
  sent_at?: number;
  last_error?: string;
}

interface Props {
  smtpConfig: any;
  leads: any[];
}

export const SystemStatusView: React.FC<Props> = ({ smtpConfig, leads }) => {
  const [stats, setStats] = useState<AutomationStats | null>(null);
  const [queue, setQueue] = useState<{ pending: QueueEmail[]; sent: QueueEmail[]; failed: QueueEmail[] }>({ pending: [], sent: [], failed: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dailyLimit, setDailyLimit] = useState(50);
  const [activeTab, setActiveTab] = useState<'overview' | 'queue' | 'replies' | 'logs'>('overview');

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/automation/status');
      if (res.ok) {
        const data = await res.json();
        setStats(data);
        setDailyLimit(data.dailyLimit);
      }
    } catch (e) {
      console.error("Failed to fetch stats");
    }
  };

  const fetchQueue = async () => {
    try {
      const res = await fetch('/api/automation/queue');
      if (res.ok) {
        const data = await res.json();
        setQueue(data);
      }
    } catch (e) {
      console.error("Failed to fetch queue");
    }
  };

  const syncToBackend = async () => {
    try {
      await fetch('/api/automation/sync-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leads })
      });
      await fetch('/api/automation/sync-smtp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ smtpConfig })
      });
    } catch (e) {
      console.error("Sync failed");
    }
  };

  useEffect(() => {
    fetchStats();
    fetchQueue();
    syncToBackend();
    const interval = setInterval(() => {
      fetchStats();
      fetchQueue();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    syncToBackend();
  }, [leads, smtpConfig]);

  const toggleAutomation = async () => {
    setLoading(true);
    try {
      await syncToBackend();
      const res = await fetch('/api/automation/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !stats?.isRunning })
      });
      if (res.ok) {
        await fetchStats();
      }
    } catch (e) {
      setError('Failed to toggle automation');
    }
    setLoading(false);
  };

  const updateLimit = async () => {
    try {
      await fetch('/api/automation/daily-limit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: dailyLimit })
      });
      await fetchStats();
    } catch (e) {
      setError('Failed to update limit');
    }
  };

  const processReplies = async () => {
    setLoading(true);
    try {
      await fetch('/api/automation/process-replies', { method: 'POST' });
      await fetchStats();
    } catch (e) {
      setError('Failed to process replies');
    }
    setLoading(false);
  };

  const sendQueued = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/automation/send-queued', { method: 'POST' });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        await fetchStats();
        await fetchQueue();
      }
    } catch (e) {
      setError('Failed to send queued emails');
    }
    setLoading(false);
  };

  const retryFailed = async () => {
    try {
      await fetch('/api/automation/retry-failed', { method: 'POST' });
      await fetchQueue();
    } catch (e) {
      setError('Failed to retry');
    }
  };

  const formatTime = (ts: number) => {
    const date = new Date(ts);
    return date.toLocaleString();
  };

  const formatRelativeTime = (ts: number) => {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 p-6 animate-fadeIn">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Zap className="w-6 h-6 text-yellow-500" />
            Automation Control Center
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            {stats?.isRunning ? 'System is actively running' : 'System is paused'}
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => { fetchStats(); fetchQueue(); }}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700 text-sm font-medium transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <button
            onClick={toggleAutomation}
            disabled={loading}
            className={`flex items-center gap-2 px-6 py-2 rounded-lg text-white text-sm font-bold transition-all ${
              stats?.isRunning
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-green-500 hover:bg-green-600'
            }`}
          >
            {stats?.isRunning ? (
              <>
                <Pause className="w-4 h-4" />
                Stop Automation
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Start Automation
              </>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {error}
          <button onClick={() => setError('')} className="ml-auto text-red-500 hover:text-red-700">×</button>
        </div>
      )}

      <div className="flex gap-2 mb-6 border-b border-slate-200">
        {['overview', 'queue', 'replies', 'logs'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as any)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${
              activeTab === tab
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase text-slate-400">Emails Today</span>
              <Mail className="w-5 h-5 text-blue-500" />
            </div>
            <div className="text-3xl font-bold text-slate-800">
              {stats?.emailsSentToday || 0}
              <span className="text-lg text-slate-400">/{stats?.dailyLimit || 50}</span>
            </div>
            <div className="mt-2 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all"
                style={{ width: `${((stats?.emailsSentToday || 0) / (stats?.dailyLimit || 50)) * 100}%` }}
              />
            </div>
          </div>

          <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase text-slate-400">Email Queue</span>
              <Clock className="w-5 h-5 text-purple-500" />
            </div>
            <div className="text-3xl font-bold text-slate-800">{stats?.queue?.pending || 0}</div>
            <p className="text-sm text-slate-500 mt-1">
              {stats?.queue?.sent || 0} sent • {stats?.queue?.failed || 0} failed
            </p>
          </div>

          <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase text-slate-400">Replies Analyzed</span>
              <Inbox className="w-5 h-5 text-green-500" />
            </div>
            <div className="text-3xl font-bold text-slate-800">{stats?.replies?.total || 0}</div>
            <p className="text-sm text-slate-500 mt-1">
              {stats?.replies?.interested || 0} interested • {stats?.replies?.questions || 0} questions
            </p>
          </div>

          <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase text-slate-400">Daily Limit</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={dailyLimit}
                onChange={(e) => setDailyLimit(parseInt(e.target.value) || 50)}
                className="w-20 px-2 py-1 border border-slate-200 rounded text-lg font-bold"
                min={1}
                max={200}
              />
              <button
                onClick={updateLimit}
                className="px-3 py-1 bg-slate-100 hover:bg-slate-200 rounded text-sm font-medium"
              >
                Update
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
            <h3 className="font-bold text-slate-700 mb-4 flex items-center justify-between">
              Quick Actions
              <span className={`text-xs px-2 py-1 rounded-full ${stats?.isRunning ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                {stats?.isRunning ? 'ACTIVE' : 'PAUSED'}
              </span>
            </h3>
            <div className="space-y-3">
              <button
                onClick={sendQueued}
                disabled={loading || !smtpConfig?.host}
                className="w-full flex items-center gap-3 p-3 bg-blue-50 hover:bg-blue-100 rounded-lg text-blue-700 font-medium transition-colors disabled:opacity-50"
              >
                <Mail className="w-5 h-5" />
                Send Queued Emails Now
                {queue.pending.length > 0 && (
                  <span className="ml-auto bg-blue-200 text-blue-800 text-xs px-2 py-0.5 rounded-full">
                    {queue.pending.length}
                  </span>
                )}
              </button>
              <button
                onClick={processReplies}
                disabled={loading}
                className="w-full flex items-center gap-3 p-3 bg-purple-50 hover:bg-purple-100 rounded-lg text-purple-700 font-medium transition-colors disabled:opacity-50"
              >
                <Inbox className="w-5 h-5" />
                Analyze New Replies
              </button>
              {queue.failed.length > 0 && (
                <button
                  onClick={retryFailed}
                  className="w-full flex items-center gap-3 p-3 bg-orange-50 hover:bg-orange-100 rounded-lg text-orange-700 font-medium transition-colors"
                >
                  <RefreshCw className="w-5 h-5" />
                  Retry Failed Emails ({queue.failed.length})
                </button>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
            <h3 className="font-bold text-slate-700 mb-4">Recent Activity</h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {stats?.recentLogs?.slice(0, 10).map(log => (
                <div key={log.id} className="flex items-start gap-2 text-sm p-2 rounded hover:bg-slate-50">
                  {log.type.includes('SENT') || log.type.includes('SUCCESS') ? (
                    <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                  ) : log.type.includes('FAILED') || log.type.includes('ERROR') ? (
                    <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                  ) : (
                    <Clock className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-slate-700 truncate">{log.message}</p>
                    <p className="text-xs text-slate-400">{formatRelativeTime(log.created_at)}</p>
                  </div>
                </div>
              ))}
              {(!stats?.recentLogs || stats.recentLogs.length === 0) && (
                <p className="text-slate-400 text-sm italic text-center py-4">No activity yet</p>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'queue' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
            <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
              <Clock className="w-5 h-5 text-yellow-500" />
              Pending Emails ({queue.pending.length})
            </h3>
            {queue.pending.length === 0 ? (
              <p className="text-slate-400 text-sm italic text-center py-8">No emails in queue</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {queue.pending.map(email => (
                  <div key={email.id} className="flex items-center gap-3 p-3 bg-yellow-50 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-800 truncate">{email.lead_name}</p>
                      <p className="text-sm text-slate-500 truncate">{email.subject}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-slate-400">Step {email.sequence_step + 1}</p>
                      <p className="text-xs text-yellow-600">Scheduled: {formatTime(email.scheduled_for)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
            <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-500" />
              Recently Sent ({queue.sent.length})
            </h3>
            {queue.sent.length === 0 ? (
              <p className="text-slate-400 text-sm italic text-center py-8">No emails sent yet</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {queue.sent.map(email => (
                  <div key={email.id} className="flex items-center gap-3 p-3 bg-green-50 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-800 truncate">{email.lead_name}</p>
                      <p className="text-sm text-slate-500 truncate">{email.subject}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-green-600">Sent: {formatRelativeTime(email.sent_at || 0)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {queue.failed.length > 0 && (
            <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
              <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
                <XCircle className="w-5 h-5 text-red-500" />
                Failed ({queue.failed.length})
                <button
                  onClick={retryFailed}
                  className="ml-auto text-xs bg-red-100 hover:bg-red-200 text-red-700 px-2 py-1 rounded"
                >
                  Retry All
                </button>
              </h3>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {queue.failed.map(email => (
                  <div key={email.id} className="flex items-center gap-3 p-3 bg-red-50 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-800 truncate">{email.lead_name}</p>
                      <p className="text-sm text-red-500 truncate">{email.last_error}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'replies' && (
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
          <h3 className="font-bold text-slate-700 mb-4">Reply Analysis Summary</h3>
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="text-center p-4 bg-green-50 rounded-lg">
              <p className="text-2xl font-bold text-green-600">{stats?.replies?.interested || 0}</p>
              <p className="text-xs text-green-700 uppercase font-medium">Interested</p>
            </div>
            <div className="text-center p-4 bg-blue-50 rounded-lg">
              <p className="text-2xl font-bold text-blue-600">{stats?.replies?.questions || 0}</p>
              <p className="text-xs text-blue-700 uppercase font-medium">Questions</p>
            </div>
            <div className="text-center p-4 bg-red-50 rounded-lg">
              <p className="text-2xl font-bold text-red-600">{stats?.replies?.declined || 0}</p>
              <p className="text-xs text-red-700 uppercase font-medium">Not Interested</p>
            </div>
            <div className="text-center p-4 bg-slate-50 rounded-lg">
              <p className="text-2xl font-bold text-slate-600">{stats?.replies?.total || 0}</p>
              <p className="text-xs text-slate-700 uppercase font-medium">Total</p>
            </div>
          </div>
          <button
            onClick={processReplies}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 p-3 bg-purple-500 hover:bg-purple-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            <Inbox className="w-5 h-5" />
            Analyze Unprocessed Replies Now
          </button>
        </div>
      )}

      {activeTab === 'logs' && (
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm max-h-[600px] overflow-y-auto">
          <h3 className="font-bold text-slate-700 mb-4">Automation Logs</h3>
          <div className="space-y-1 font-mono text-xs">
            {stats?.recentLogs?.map(log => (
              <div key={log.id} className="flex gap-3 py-1 border-b border-slate-50">
                <span className="text-slate-400 shrink-0">{formatTime(log.created_at)}</span>
                <span className={`shrink-0 ${
                  log.type.includes('ERROR') || log.type.includes('FAILED') ? 'text-red-600' :
                  log.type.includes('SUCCESS') || log.type.includes('SENT') ? 'text-green-600' :
                  'text-slate-600'
                }`}>
                  [{log.type}]
                </span>
                <span className="text-slate-700">{log.message}</span>
              </div>
            ))}
            {(!stats?.recentLogs || stats.recentLogs.length === 0) && (
              <p className="text-slate-400 italic text-center py-8">No logs yet</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
