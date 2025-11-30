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
  Loader
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
  timestamp: number;
  agent: string;
  action: string;
  item_id?: string;
  details?: string;
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
}

export default function AgentDashboard({ apiBase = '/api' }: AgentDashboardProps) {
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [queues, setQueues] = useState<Record<string, QueueStats>>({});
  const [loading, setLoading] = useState(true);
  const [showAddProspect, setShowAddProspect] = useState(false);
  const [newProspect, setNewProspect] = useState({ companyName: '', websiteUrl: '', contactEmail: '', contactName: '' });
  const [adding, setAdding] = useState(false);
  const [masterEnabled, setMasterEnabled] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentStatus | null>(null);
  const [agentLogs, setAgentLogs] = useState<AgentLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

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

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

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
                <div key={agent.name} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
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
                      onClick={() => toggleAgent(agent.name, !!agent.enabled)}
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
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Pipeline Queues</h3>
          <div className="space-y-4">
            {['prospect', 'research', 'draft'].map((queueName) => {
              const q = queues[queueName] || { pending: 0, processing: 0, completed: 0, failed: 0 };
              const total = q.pending + q.processing + q.completed + q.failed + (q.low_quality || 0);
              const icons: Record<string, React.ReactNode> = {
                prospect: <Users className="w-4 h-4" />,
                research: <Search className="w-4 h-4" />,
                draft: <FileText className="w-4 h-4" />
              };
              
              return (
                <div key={queueName} className="p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500">{icons[queueName]}</span>
                      <span className="font-medium capitalize">{queueName} Queue</span>
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
                Prospect
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
    </div>
  );
}
