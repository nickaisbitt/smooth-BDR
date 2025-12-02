import React, { useState, useEffect } from 'react';
import { TrendingUp, Mail, MessageSquare, Zap } from 'lucide-react';

interface EngagedLead {
  id: string;
  companyName: string;
  email: string;
  engagement_score: number;
  emails_sent: number;
  replies_received: number;
  last_activity: number;
}

interface Props {
  active: boolean;
}

export const EngagedLeadsPanel: React.FC<Props> = ({ active }) => {
  const [engagedLeads, setEngagedLeads] = useState<EngagedLead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!active) return;
    
    const fetchEngagement = async () => {
      try {
        const response = await fetch('/api/leads/engagement-stats');
        if (response.ok) {
          const data = await response.json();
          setEngagedLeads(data.topEngagedLeads.slice(0, 5));
        }
      } catch (error) {
        console.error('Failed to fetch engagement stats:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchEngagement();
    const interval = setInterval(fetchEngagement, 5000);
    return () => clearInterval(interval);
  }, [active]);

  const getEngagementColor = (score: number) => {
    if (score >= 80) return 'bg-green-100 text-green-900 border-green-300';
    if (score >= 60) return 'bg-blue-100 text-blue-900 border-blue-300';
    if (score >= 40) return 'bg-yellow-100 text-yellow-900 border-yellow-300';
    if (score >= 20) return 'bg-orange-100 text-orange-900 border-orange-300';
    return 'bg-slate-100 text-slate-900 border-slate-300';
  };

  const getEngagementLabel = (score: number) => {
    if (score >= 80) return '🔥 Very High';
    if (score >= 60) return '👍 High';
    if (score >= 40) return '💬 Medium';
    if (score >= 20) return '📊 Low';
    return '❄️ None';
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-amber-500" />
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">🔥 Most Engaged Leads</h3>
        </div>
        <span className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded-full font-semibold">
          {engagedLeads.length} hot leads
        </span>
      </div>

      {loading ? (
        <div className="text-center py-8 text-slate-500">Loading engagement data...</div>
      ) : engagedLeads.length === 0 ? (
        <div className="text-center py-8 text-slate-500">No engagement data yet. Send some emails first!</div>
      ) : (
        <div className="space-y-3">
          {engagedLeads.map((lead) => (
            <div key={lead.id} className={`p-3 rounded-lg border-2 transition-all hover:shadow-md ${getEngagementColor(lead.engagement_score)}`}>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="font-bold text-sm">{lead.companyName}</p>
                  <p className="text-xs opacity-75">{lead.email}</p>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold">{lead.engagement_score}</div>
                  <div className="text-xs font-semibold">{getEngagementLabel(lead.engagement_score)}</div>
                </div>
              </div>
              
              <div className="flex items-center justify-between text-xs opacity-80 border-t border-current pt-2">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <Mail className="w-3 h-3" /> {lead.emails_sent} sent
                  </span>
                  <span className="flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" /> {lead.replies_received} replies
                  </span>
                </div>
                <span className="text-[10px]">
                  {lead.last_activity ? new Date(lead.last_activity).toLocaleTimeString() : 'No activity'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
        <p className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-2">
          <TrendingUp className="w-3 h-3" />
          Engagement Score = (replies × 40) + (opens × 20) + (time × 10)
        </p>
      </div>
    </div>
  );
};
