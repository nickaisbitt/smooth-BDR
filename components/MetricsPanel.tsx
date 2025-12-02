import React from 'react';

interface MetricsData {
  pipeline: {
    sent: number;
    pending: number;
    awaiting_approval: number;
    failed: number;
  };
  queues: {
    prospects: number;
    research: number;
    drafts: number;
  };
  velocity: {
    sent_last_hour: number;
  };
  quality: {
    avg_research_quality: number;
    approved_emails: number;
  };
}

interface Props {
  metrics: MetricsData | null;
}

export const MetricsPanel: React.FC<Props> = ({ metrics }) => {
  if (!metrics) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6">
        <p className="text-sm text-slate-500">Loading metrics...</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6">
      <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-4">📊 Real-time Pipeline Metrics</h2>
      
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* Pipeline Status */}
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-900/40 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
          <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 mb-1">✉️ Emails Sent</p>
          <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">{metrics.pipeline.sent}</p>
          <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">{metrics.velocity.sent_last_hour} this hour</p>
        </div>

        {/* Pending */}
        <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 dark:from-yellow-900/20 dark:to-yellow-900/40 rounded-lg p-4 border border-yellow-200 dark:border-yellow-800">
          <p className="text-xs font-semibold text-yellow-600 dark:text-yellow-400 mb-1">⏳ Pending Send</p>
          <p className="text-2xl font-bold text-yellow-900 dark:text-yellow-100">{metrics.pipeline.pending}</p>
          <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">In queue</p>
        </div>

        {/* Awaiting Approval */}
        <div className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-900/40 rounded-lg p-4 border border-purple-200 dark:border-purple-800">
          <p className="text-xs font-semibold text-purple-600 dark:text-purple-400 mb-1">🔍 Awaiting Review</p>
          <p className="text-2xl font-bold text-purple-900 dark:text-purple-100">{metrics.pipeline.awaiting_approval}</p>
          <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">Under review</p>
        </div>

        {/* Failed */}
        <div className="bg-gradient-to-br from-red-50 to-red-100 dark:from-red-900/20 dark:to-red-900/40 rounded-lg p-4 border border-red-200 dark:border-red-800">
          <p className="text-xs font-semibold text-red-600 dark:text-red-400 mb-1">❌ Failed</p>
          <p className="text-2xl font-bold text-red-900 dark:text-red-100">{metrics.pipeline.failed}</p>
          <p className="text-xs text-red-600 dark:text-red-400 mt-1">Retry queue</p>
        </div>
      </div>

      {/* Quality & Queue Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Research Quality */}
        <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-900/20 dark:to-emerald-900/40 rounded-lg p-4 border border-emerald-200 dark:border-emerald-800">
          <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 mb-1">⭐ Avg Quality</p>
          <p className="text-2xl font-bold text-emerald-900 dark:text-emerald-100">{metrics.quality.avg_research_quality.toFixed(1)}/10</p>
          <div className="w-full bg-emerald-200 dark:bg-emerald-800 rounded-full h-1.5 mt-2">
            <div className="bg-emerald-600 dark:bg-emerald-400 h-1.5 rounded-full" style={{width: `${(metrics.quality.avg_research_quality / 10) * 100}%`}}></div>
          </div>
        </div>

        {/* Approved Emails */}
        <div className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-900/40 rounded-lg p-4 border border-green-200 dark:border-green-800">
          <p className="text-xs font-semibold text-green-600 dark:text-green-400 mb-1">✅ Approved</p>
          <p className="text-2xl font-bold text-green-900 dark:text-green-100">{metrics.quality.approved_emails}</p>
          <p className="text-xs text-green-600 dark:text-green-400 mt-1">Passed review</p>
        </div>

        {/* Queue Depth */}
        <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 dark:from-indigo-900/20 dark:to-indigo-900/40 rounded-lg p-4 border border-indigo-200 dark:border-indigo-800">
          <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 mb-1">📋 Queue Depth</p>
          <p className="text-sm text-indigo-900 dark:text-indigo-100 font-medium">
            <span className="block">Research: {metrics.queues.research}</span>
            <span className="block">Prospects: {metrics.queues.prospects}</span>
            <span className="block">Drafts: {metrics.queues.drafts}</span>
          </p>
        </div>
      </div>

      {/* Status Indicator */}
      <div className="mt-4 p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
        <p className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-2">
          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
          Pipeline Health: <strong>OPTIMAL</strong> - All systems operational, sustainable throughput maintained
        </p>
      </div>
    </div>
  );
};
