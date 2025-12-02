import React, { useState, useEffect, useCallback } from 'react';
import { 
  Activity, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  RefreshCw, 
  Users, 
  Search, 
  FileText, 
  Send, 
  Inbox,
  AlertTriangle,
  ChevronRight,
  Plus,
  Power,
  ToggleLeft,
  ToggleRight,
  X,
  Loader,
  Download
} from 'lucide-react';

interface AgentStatus {
  name: string;
  status: string;
  health: string;
  processed: number;
  errors: number;
  current_item: string | null;
  last_heartbeat: number;
  started_at: number;
  enabled: number;
}

interface AgentLog {
  id: number;
  agent_name: string;
  level: string;
  message: string;
  details?: string;
  created_at: number;
}

interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  low_quality?: number;
}

interface AgentDashboardProps {
  apiBase?: string;
  leads?: any[];
  selectedAgent?: string | null;
}

export default function AgentDashboard({ apiBase = '/api', leads = [], selectedAgent }: AgentDashboardProps) {
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [queues, setQueues] = useState<Record<string, QueueStats>>({});
  const [loading, setLoading] = useState(true);
  const [showAddProspect, setShowAddProspect] = useState(false);
  const [newProspect, setNewProspect] = useState({ companyName: '', websiteUrl: '', contactEmail: '', contactName: '' });
  const [adding, setAdding] = useState(false);
  const [masterEnabled, setMasterEnabled] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [selectedAgentObj, setSelectedAgentObj] = useState<AgentStatus | null>(null);
  const [agentLogs, setAgentLogs] = useState<AgentLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ total: number; message: string } | null>(null);
  const [selectedActivityLog, setSelectedActivityLog] = useState<AgentLog | null>(null);
  const [activityDraft, setActivityDraft] = useState<any>(null);
  const [loadingDraft, setLoadingDraft] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const [agentRes, queueRes] = await Promise.all([
        fetch(`${apiBase}/agents/status`),
        fetch(`${apiBase}/agents/queues`)
      ]);
      
      const agentData = await agentRes.json();
      const queueData = await queueRes.json();
      
      if (agentData.agents) setAgents(agentData.agents);
      if (queueData.queues) setQueues(queueData.queues);
      if (agentData.masterEnabled !== undefined) setMasterEnabled(agentData.masterEnabled);
    } catch (error) {
      console.error('Failed to fetch agent status:', error);
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  const toggleAgent = async (agentName: string, currentEnabled: boolean) => {
    setToggling(agentName);
    try {
      await fetch(`${apiBase}/agents/toggle/${agentName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !currentEnabled })
      });
      fetchStatus();
    } catch (error) {
      console.error('Failed to toggle agent:', error);
    } finally {
      setToggling(null);
    }
  };

  const toggleMaster = async () => {
    setToggling('master');
    try {
      await fetch(`${apiBase}/automation/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !masterEnabled })
      });
      setMasterEnabled(!masterEnabled);
      fetchStatus();
    } catch (error) {
      console.error('Failed to toggle master:', error);
    } finally {
      setToggling(null);
    }
  };

  const syncLeadsToAgents = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      // Get leads from localStorage if not passed as prop
      let leadsToSync = leads;
      if (!leadsToSync || leadsToSync.length === 0) {
        const storedData = localStorage.getItem('smooth_ai_crm_db_v1');
        if (storedData) {
          leadsToSync = JSON.parse(storedData);
        }
      }
      
      if (!leadsToSync || leadsToSync.length === 0) {
        setSyncResult({ total: 0, message: 'No leads found to sync' });
        return;
      }
      
      const res = await fetch(`${apiBase}/agents/sync-leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leads: leadsToSync })
      });
      
      const data = await res.json();
      if (data.success) {
        setSyncResult({ total: data.total, message: data.message });
        fetchStatus();
      } else {
        setSyncResult({ total: 0, message: data.error || 'Sync failed' });
      }
    } catch (error) {
      console.error('Failed to sync leads:', error);
      setSyncResult({ total: 0, message: 'Failed to sync leads' });
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Auto-load logs for selected agent from navigation
  useEffect(() => {
    if (selectedAgent && agents.length > 0) {
      const agent = agents.find(a => a.name === selectedAgent);
      if (agent) {
        handleAgentClick(agent);
      }
    }
  }, [selectedAgent, agents, handleAgentClick]);

  const fetchAgentLogs = useCallback(async (agentName: string) => {
    setLoadingLogs(true);
    try {
      const res = await fetch(`${apiBase}/agents/logs?agent=${agentName}&limit=50`);
      const data = await res.json();
      if (data.logs) setAgentLogs(data.logs);
    } catch (error) {
      console.error('Failed to fetch agent logs:', error);
      setAgentLogs([]);
    } finally {
      setLoadingLogs(false);
    }
  }, [apiBase]);

  const handleAgentClick = (agent: AgentStatus) => {
    setSelectedAgentObj(agent);
    fetchAgentLogs(agent.name);
  };

  const closeAgentDetail = () => {
    setSelectedAgentObj(null);
    setAgentLogs([]);
  };

  const extractCompanyName = (message: string): string | null => {
    // Extract company name from messages like:
    // "Email generated for: | Company Name (..."
    // "Generating email for: Company Name (quality: 8/10)"
    // "Email generated and queued for Company Name"
    const patterns = [
      /for:\s+\|\s+(.+?)\s*\(/,  // "for: | Company Name ("
      /for\s+(.+?)\s*\(/,         // "for Company Name ("
      /Email generated for (.+?)$/,  // at end of message
    ];
    
    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match && match[1]) {
        const name = match[1].trim();
        // Clean up any extra characters
        if (name && name.length > 0 && name !== '|') {
          return name;
        }
      }
    }
    return null;
  };

  const fetchDraft = useCallback(async (companyName: string) => {
    if (!companyName) return;
    console.log('[DEBUG] Fetching draft for:', companyName);
    setLoadingDraft(true);
    try {
      const encoded = encodeURIComponent(companyName);
      const url = `${apiBase}/agents/draft/${encoded}`;
      console.log('[DEBUG] API URL:', url);
      const res = await fetch(url);
      const data = await res.json();
      console.log('[DEBUG] API response:', data);
      if (data.success && data.draft) {
        console.log('[DEBUG] Setting draft:', data.draft);
        setActivityDraft(data.draft);
      } else {
        console.log('[DEBUG] No draft found or API failed');
      }
    } catch (error) {
      console.error('[DEBUG] Failed to fetch draft:', error);
    } finally {
      setLoadingDraft(false);
    }
  }, [apiBase]);

  const handleActivityClick = (log: AgentLog) => {
    console.log('[DEBUG] Activity clicked:', log.message);
    setSelectedActivityLog(log);
    setActivityDraft(null);
    
    // Try to fetch draft if this is an email generation activity
    if (log.message.includes('Email generated') || log.message.includes('Generating email') || log.message.includes('email')) {
      const companyName = extractCompanyName(log.message);
      console.log('[DEBUG] Extracted company name:', companyName);
      if (companyName) {
        fetchDraft(companyName);
      }
    }
  };

  const formatDateTime = (timestamp: number) => {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const getAgentIcon = (name: string) => {
    switch (name) {
      case 'prospect-finder': return <Users className="w-5 h-5" />;
      case 'research': return <Search className="w-5 h-5" />;
      case 'email-generator': return <FileText className="w-5 h-5" />;
      case 'email-sender': return <Send className="w-5 h-5" />;
      case 'inbox': return <Inbox className="w-5 h-5" />;
      default: return <Activity className="w-5 h-5" />;
    }
  };

  const getHealthBadge = (health: string) => {
    switch (health) {
      case 'healthy':
        return <span className="flex items-center gap-1 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
          <CheckCircle2 className="w-3 h-3" /> Running
        </span>;
      case 'stale':
        return <span className="flex items-center gap-1 text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">
          <AlertTriangle className="w-3 h-3" /> Stale
        </span>;
      case 'stopped':
        return <span className="flex items-center gap-1 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
          <XCircle className="w-3 h-3" /> Stopped
        </span>;
      default:
        return <span className="flex items-center gap-1 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
          <Clock className="w-3 h-3" /> Unknown
        </span>;
    }
  };

  const formatTime = (timestamp: number) => {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  };

  const handleAddProspect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProspect.companyName || !newProspect.websiteUrl) return;
    
    setAdding(true);
    try {
      const res = await fetch(`${apiBase}/agents/prospect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newProspect)
      });
      
      const data = await res.json();
      if (data.success) {
        setNewProspect({ companyName: '', websiteUrl: '', contactEmail: '', contactName: '' });
        setShowAddProspect(false);
        fetchStatus();
      }
    } catch (error) {
      console.error('Failed to add prospect:', error);
    } finally {
      setAdding(false);
    }
  };

  const totalPending = Object.values(queues).reduce((sum, q) => sum + (q?.pending || 0), 0);
  const totalProcessing = Object.values(queues).reduce((sum, q) => sum + (q?.processing || 0), 0);
  const totalCompleted = Object.values(queues).reduce((sum, q) => sum + (q?.completed || 0), 0);
  const healthyAgents = agents.filter(a => a.health === 'healthy').length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Agent Dashboard</h2>
          <p className="text-gray-500">Multi-agent BDR system status</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={toggleMaster}
            disabled={toggling === 'master'}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors font-medium ${
              masterEnabled 
                ? 'bg-green-600 hover:bg-green-700 text-white' 
                : 'bg-gray-700 hover:bg-gray-800 text-white'
            }`}
          >
            <Power className={`w-4 h-4 ${toggling === 'master' ? 'animate-pulse' : ''}`} />
            {masterEnabled ? 'Engine Running' : 'Engine Stopped'}
          </button>
          <button
            onClick={syncLeadsToAgents}
            disabled={syncing}
            className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            <Download className={`w-4 h-4 ${syncing ? 'animate-pulse' : ''}`} />
            {syncing ? 'Syncing...' : 'Sync Leads to Agents'}
          </button>
          <button
            onClick={() => setShowAddProspect(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Prospect
          </button>
          <button
            onClick={fetchStatus}
            className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {syncResult && (
        <div className={`p-4 rounded-lg ${syncResult.total > 0 ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {syncResult.total > 0 ? (
                <CheckCircle2 className="w-5 h-5 text-green-600" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-yellow-600" />
              )}
              <span className={syncResult.total > 0 ? 'text-green-800' : 'text-yellow-800'}>
                {syncResult.message}
              </span>
            </div>
            <button 
              onClick={() => setSyncResult(null)}
              className="text-gray-500 hover:text-gray-700"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500 mb-1">Active Agents</div>
          <div className="text-3xl font-bold text-green-600">{healthyAgents}/{agents.length || 5}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500 mb-1">Pending Items</div>
          <div className="text-3xl font-bold text-yellow-600">{totalPending}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500 mb-1">Processing</div>
          <div className="text-3xl font-bold text-blue-600">{totalProcessing}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500 mb-1">Completed</div>
          <div className="text-3xl font-bold text-gray-700">{totalCompleted}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Agent Status</h3>
          <div className="space-y-3">
            {agents.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Activity className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p>No agents running</p>
                <p className="text-sm">Start the agent supervisor to see status</p>
              </div>
            ) : (
              agents.map((agent) => (
                <div 
                  key={agent.name} 
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors"
                  onClick={() => handleAgentClick(agent)}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${agent.health === 'healthy' && agent.enabled ? 'bg-green-100 text-green-600' : 'bg-gray-200 text-gray-500'}`}>
                      {getAgentIcon(agent.name)}
                    </div>
                    <div>
                      <div className="font-medium text-gray-900 capitalize">{agent.name.replace('-', ' ')}</div>
                      <div className="text-xs text-gray-500">
                        {agent.processed} processed | {agent.errors} errors
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      {getHealthBadge(agent.health)}
                      <div className="text-xs text-gray-400 mt-1">
                        Last: {formatTime(agent.last_heartbeat)}
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleAgent(agent.name, !!agent.enabled); }}
                      disabled={toggling === agent.name}
                      className={`p-1.5 rounded-lg transition-all ${
                        agent.enabled 
                          ? 'text-green-600 hover:bg-green-50' 
                          : 'text-gray-400 hover:bg-gray-100'
                      }`}
                      title={agent.enabled ? 'Disable agent' : 'Enable agent'}
                    >
                      {agent.enabled ? (
                        <ToggleRight className={`w-6 h-6 ${toggling === agent.name ? 'animate-pulse' : ''}`} />
                      ) : (
                        <ToggleLeft className={`w-6 h-6 ${toggling === agent.name ? 'animate-pulse' : ''}`} />
                      )}
                    </button>
                    <ChevronRight className="w-4 h-4 text-gray-400" />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Pipeline Queues</h3>
          <div className="space-y-4">
            {['prospect', 'research', 'draft', 'email'].map((queueName) => {
              const q = queues[queueName] || { pending: 0, processing: 0, completed: 0, failed: 0 };
              const total = q.pending + q.processing + q.completed + q.failed + (q.low_quality || 0);
              const icons: Record<string, React.ReactNode> = {
                prospect: <Users className="w-4 h-4" />,
                research: <Search className="w-4 h-4" />,
                draft: <FileText className="w-4 h-4" />,
                email: <Send className="w-4 h-4" />
              };
              const displayNames: Record<string, string> = {
                prospect: 'CRM',
                research: 'Research',
                draft: 'Draft',
                email: 'Email'
              };
              
              return (
                <div key={queueName} className="p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500">{icons[queueName]}</span>
                      <span className="font-medium">{displayNames[queueName]} Queue</span>
                    </div>
                    <span className="text-sm text-gray-500">{total} total</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded">
                      {q.pending} pending
                    </span>
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                      {q.processing} processing
                    </span>
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">
                      {q.completed} done
                    </span>
                    {(q.failed > 0 || (q.low_quality || 0) > 0) && (
                      <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">
                        {q.failed + (q.low_quality || 0)} failed
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="text-xs text-gray-500 mb-2">Pipeline Flow</div>
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-1 text-gray-600">
                <Users className="w-4 h-4" />
                CRM
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400" />
              <div className="flex items-center gap-1 text-gray-600">
                <Search className="w-4 h-4" />
                Research
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400" />
              <div className="flex items-center gap-1 text-gray-600">
                <FileText className="w-4 h-4" />
                Draft
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400" />
              <div className="flex items-center gap-1 text-gray-600">
                <Send className="w-4 h-4" />
                Send
              </div>
            </div>
          </div>
        </div>
      </div>

      {showAddProspect && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">Add Prospect to Pipeline</h3>
            <form onSubmit={handleAddProspect} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Company Name *</label>
                <input
                  type="text"
                  value={newProspect.companyName}
                  onChange={(e) => setNewProspect({ ...newProspect, companyName: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Acme Corp"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Website URL *</label>
                <input
                  type="url"
                  value={newProspect.websiteUrl}
                  onChange={(e) => setNewProspect({ ...newProspect, websiteUrl: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="https://acme.com"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contact Email</label>
                <input
                  type="email"
                  value={newProspect.contactEmail}
                  onChange={(e) => setNewProspect({ ...newProspect, contactEmail: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="john@acme.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contact Name</label>
                <input
                  type="text"
                  value={newProspect.contactName}
                  onChange={(e) => setNewProspect({ ...newProspect, contactName: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="John Smith"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddProspect(false)}
                  className="flex-1 border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={adding}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
                >
                  {adding ? 'Adding...' : 'Add to Pipeline'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedAgent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${ selectedAgentObj?.health === 'healthy' && selectedAgent.enabled ? 'bg-green-100 text-green-600' : 'bg-gray-200 text-gray-500'}`}>
                  {getAgentIcon(selectedAgent.name)}
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 capitalize">
                    { selectedAgentObj?.name.replace('-', ' ')} Agent
                  </h3>
                  <p className="text-sm text-gray-500">Activity & Status Details</p>
                </div>
              </div>
              <button
                onClick={closeAgentDetail}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="p-5 border-b border-gray-100">
              <div className="grid grid-cols-4 gap-4">
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-gray-900">{ selectedAgentObj?.processed}</div>
                  <div className="text-xs text-gray-500">Processed</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-red-600">{ selectedAgentObj?.errors}</div>
                  <div className="text-xs text-gray-500">Errors</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <div className={`text-sm font-medium ${ selectedAgentObj?.health === 'healthy' ? 'text-green-600' : 'text-yellow-600'}`}>
                    { selectedAgentObj?.health}
                  </div>
                  <div className="text-xs text-gray-500">Health</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <div className={`text-sm font-medium ${ selectedAgentObj?.enabled ? 'text-green-600' : 'text-gray-500'}`}>
                    { selectedAgentObj?.enabled ? 'Enabled' : 'Disabled'}
                  </div>
                  <div className="text-xs text-gray-500">Status</div>
                </div>
              </div>
              <div className="mt-3 flex gap-4 text-xs text-gray-500">
                <span>Started: {formatDateTime(selectedAgent.started_at)}</span>
                <span>Last heartbeat: {formatDateTime(selectedAgent.last_heartbeat)}</span>
                { selectedAgentObj?.current_item && (
                  <span className="text-blue-600">Working on: { selectedAgentObj?.current_item}</span>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <h4 className="text-sm font-semibold text-gray-700 mb-3">Recent Activity</h4>
              {loadingLogs ? (
                <div className="flex items-center justify-center py-8">
                  <Loader className="w-6 h-6 text-blue-600 animate-spin" />
                  <span className="ml-2 text-gray-500">Loading activity...</span>
                </div>
              ) : agentLogs.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Activity className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p>No recent activity</p>
                  <p className="text-sm">Activity will appear here as the agent processes items</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {agentLogs.map((log) => (
                    <div 
                      key={log.id} 
                      onClick={() => handleActivityClick(log)}
                      className="flex items-start gap-3 p-3 bg-gray-50 hover:bg-gray-100 rounded-lg text-sm cursor-pointer transition-colors group"
                    >
                      <div className={`w-2 h-2 mt-1.5 rounded-full flex-shrink-0 ${
                        log.level === 'error' 
                          ? 'bg-red-500' 
                          : log.level === 'success' || log.level === 'info' && log.message.includes('complete')
                          ? 'bg-green-500'
                          : log.level === 'warn'
                          ? 'bg-yellow-500'
                          : 'bg-blue-500'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900 group-hover:text-blue-600 transition-colors">
                            {log.message}
                          </span>
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            log.level === 'error' ? 'bg-red-100 text-red-700' :
                            log.level === 'warn' ? 'bg-yellow-100 text-yellow-700' :
                            log.level === 'success' ? 'bg-green-100 text-green-700' :
                            'bg-blue-100 text-blue-700'
                          }`}>
                            {log.level}
                          </span>
                        </div>
                        {log.details && (
                          <p className="text-gray-600 mt-0.5 truncate">{log.details}</p>
                        )}
                        <div className="text-xs text-gray-400 mt-1">
                          {formatDateTime(log.created_at)}
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-blue-600 transition-colors flex-shrink-0 mt-0.5" />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-gray-200 flex justify-between items-center">
              <button
                onClick={() => fetchAgentLogs(selectedAgent.name)}
                className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
              >
                <RefreshCw className={`w-4 h-4 ${loadingLogs ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); toggleAgent(selectedAgent.name, !!selectedAgent.enabled); }}
                disabled={toggling === selectedAgent.name}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                  selectedAgent.enabled 
                    ? 'bg-red-50 text-red-600 hover:bg-red-100' 
                    : 'bg-green-50 text-green-600 hover:bg-green-100'
                }`}
              >
                { selectedAgentObj?.enabled ? (
                  <>
                    <ToggleRight className="w-4 h-4" />
                    Disable Agent
                  </>
                ) : (
                  <>
                    <ToggleLeft className="w-4 h-4" />
                    Enable Agent
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedActivityLog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-full max-w-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${
                  selectedActivityLog.level === 'error' 
                    ? 'bg-red-500' 
                    : selectedActivityLog.level === 'success' || selectedActivityLog.level === 'info' && selectedActivityLog.message.includes('complete')
                    ? 'bg-green-500'
                    : selectedActivityLog.level === 'warn'
                    ? 'bg-yellow-500'
                    : 'bg-blue-500'
                }`} />
                <h3 className="text-lg font-semibold text-gray-900">Activity Details</h3>
              </div>
              <button
                onClick={() => setSelectedActivityLog(null)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase">Message</label>
                <p className="text-gray-900 mt-1 break-words">{selectedActivityLog.message}</p>
              </div>

              {selectedActivityLog.details && (
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase">Details</label>
                  <p className="text-gray-700 mt-1 break-words whitespace-pre-wrap">{selectedActivityLog.details}</p>
                </div>
              )}

              {(selectedActivityLog.message.includes('Email') || selectedActivityLog.message.includes('email')) && !activityDraft && !loadingDraft && (
                <div className="flex items-center justify-center py-4 bg-yellow-50 rounded-lg border border-yellow-200">
                  <span className="text-sm text-yellow-700">No draft found for this activity</span>
                </div>
              )}

              {loadingDraft && (
                <div className="flex items-center justify-center py-4 bg-blue-50 rounded-lg">
                  <Loader className="w-5 h-5 text-blue-600 animate-spin mr-2" />
                  <span className="text-sm text-blue-600">Loading email draft...</span>
                </div>
              )}

              {activityDraft && (
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg p-4 border border-blue-200">
                  <div className="mb-3">
                    <label className="text-xs font-medium text-blue-900 uppercase">Email Subject</label>
                    <p className="text-blue-900 font-semibold mt-1">{activityDraft.email_subject || activityDraft.subject || '(No subject)'}</p>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-blue-900 uppercase">Email Body</label>
                    <p className="text-blue-800 mt-1 break-words whitespace-pre-wrap text-sm leading-relaxed">{activityDraft.email_body || activityDraft.body || '(No body)'}</p>
                  </div>
                  {activityDraft.research_quality && (
                    <div className="mt-3 pt-3 border-t border-blue-200">
                      <span className="text-xs font-medium text-blue-900">Research Quality: </span>
                      <span className="text-xs font-bold text-blue-900">{activityDraft.research_quality}/10</span>
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-3 gap-3 pt-2 border-t border-gray-200">
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">Level</div>
                  <span className={`inline-block text-xs font-medium px-2 py-1 rounded ${
                    selectedActivityLog.level === 'error' ? 'bg-red-100 text-red-700' :
                    selectedActivityLog.level === 'warn' ? 'bg-yellow-100 text-yellow-700' :
                    selectedActivityLog.level === 'success' ? 'bg-green-100 text-green-700' :
                    'bg-blue-100 text-blue-700'
                  }`}>
                    {selectedActivityLog.level}
                  </span>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">Agent</div>
                  <div className="text-sm font-medium text-gray-900 truncate capitalize">{selectedActivityLog.agent_name?.replace('-', ' ')}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">Time</div>
                  <div className="text-sm font-medium text-gray-900">{formatTime(selectedActivityLog.created_at)}</div>
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xs text-gray-500 mb-1">Full Timestamp</div>
                <div className="text-sm text-gray-700">{formatDateTime(selectedActivityLog.created_at)}</div>
              </div>
            </div>

            <div className="mt-6 flex gap-2 justify-end">
              <button
                onClick={() => setSelectedActivityLog(null)}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
