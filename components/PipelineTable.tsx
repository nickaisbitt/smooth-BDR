
import React, { useState } from 'react';
import { Lead, LeadStatus, EmailDraft } from '../types';

interface Props {
  leads: Lead[];
  onAnalyze: (lead: Lead) => void;
  onHunt?: (lead: Lead) => void;
  onMarkContacted?: (lead: Lead) => void;
  analyzingIds: Set<string>;
  onExport?: () => void;
}

const EmailSequenceViewer = ({ sequence, decisionMaker, onMarkContacted }: { sequence: EmailDraft[], decisionMaker?: any, onMarkContacted?: () => void }) => {
    const [step, setStep] = useState(0);
    const draft = sequence[step];

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        alert("Copied to clipboard!");
    };

    return (
        <details className="relative inline-block text-left">
            <summary className="list-none cursor-pointer text-xs font-bold text-blue-600 bg-blue-50 border border-blue-100 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-colors shadow-sm whitespace-nowrap">
                Review Campaign ({sequence.length})
            </summary>
            <div className="absolute right-0 mt-2 w-[400px] bg-white rounded-xl shadow-2xl border border-slate-200 p-5 z-50 text-left hidden group-open:block ring-1 ring-black/5">
                <div className="flex justify-between items-center mb-4">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Outreach Sequence</span>
                    <button 
                        onClick={onMarkContacted}
                        className="text-[10px] font-bold text-green-600 hover:text-green-800 bg-green-50 px-2 py-1 rounded border border-green-100"
                    >
                        ✓ Mark Sent
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex gap-1 mb-4 bg-slate-100 p-1 rounded-lg">
                    {sequence.map((s, i) => (
                        <button 
                            key={i}
                            onClick={(e) => { e.preventDefault(); setStep(i); }}
                            className={`flex-1 text-[10px] font-bold py-1.5 rounded-md transition-all ${step === i ? 'bg-white shadow text-slate-800' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                            Day {s.delayDays}
                        </button>
                    ))}
                </div>

                <div className="space-y-3">
                    <div className="flex justify-between">
                         <div>
                            <p className="text-[10px] text-slate-400 font-medium">Context</p>
                            <p className="text-xs font-bold text-purple-600">{draft.context}</p>
                         </div>
                         <div className="text-right">
                             <p className="text-[10px] text-slate-400 font-medium">Target</p>
                             <p className="text-xs font-bold text-slate-800">{decisionMaker?.name || 'Lead'}</p>
                         </div>
                    </div>
                    
                    <div>
                        <div className="flex justify-between items-end mb-1">
                            <p className="text-[10px] text-slate-400 font-medium">Subject</p>
                            <button onClick={() => copyToClipboard(draft.subject)} className="text-[9px] text-blue-500 hover:underline">Copy</button>
                        </div>
                        <p className="text-sm font-bold text-slate-800 bg-slate-50 p-2 rounded border border-slate-100">{draft.subject}</p>
                    </div>

                    <div>
                        <div className="flex justify-between items-end mb-1">
                            <p className="text-[10px] text-slate-400 font-medium">Body</p>
                            <button onClick={() => copyToClipboard(draft.body)} className="text-[9px] text-blue-500 hover:underline">Copy Body</button>
                        </div>
                        <div className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-100 max-h-40 overflow-y-auto">
                            {draft.body}
                        </div>
                    </div>

                    {/* ACTIONS BAR */}
                    <div className="pt-3 border-t border-slate-100 mt-2">
                        <a 
                            href={`mailto:${decisionMaker ? '' : ''}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`}
                            target="_blank"
                            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-2 rounded-lg transition-colors"
                        >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                            Open in Mail App
                        </a>
                        <p className="text-[9px] text-center text-slate-400 mt-2">
                            Opens Outlook, Apple Mail, or Default Client
                        </p>
                    </div>
                </div>
            </div>
        </details>
    );
};

export const PipelineTable: React.FC<Props> = ({ leads, onAnalyze, onHunt, onMarkContacted, analyzingIds, onExport }) => {
  const getStatusBadge = (status: LeadStatus) => {
    switch (status) {
      case LeadStatus.NEW: 
        return <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded-md text-[10px] font-bold border border-slate-200">NEW</span>;
      case LeadStatus.ANALYZING: 
        return <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded-md text-[10px] font-bold border border-yellow-200 flex items-center gap-1 w-fit"><span className="w-1.5 h-1.5 bg-yellow-500 rounded-full animate-pulse"></span> AI BUSY</span>;
      case LeadStatus.QUALIFIED: 
        return <span className="px-2 py-1 bg-green-100 text-green-700 rounded-md text-[10px] font-bold border border-green-200">QUALIFIED</span>;
      case LeadStatus.CONTACTED: 
        return <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-md text-[10px] font-bold border border-blue-200">CONTACTED</span>;
      case LeadStatus.UNQUALIFIED: 
        return <span className="px-2 py-1 bg-red-50 text-red-400 rounded-md text-[10px] font-bold border border-red-100">POOR FIT</span>;
      default: return null;
    }
  };

  const getScoreColor = (score?: number) => {
    if (score === undefined) return 'bg-slate-200';
    if (score > 80) return 'bg-green-500';
    if (score > 50) return 'bg-yellow-400';
    return 'bg-red-400';
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden h-full flex flex-col">
      <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
        <div className="flex items-center gap-3">
             <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Prospect Pipeline</h2>
             <span className="text-xs text-slate-400 font-medium bg-slate-100 px-2 py-0.5 rounded-full">{leads.length}</span>
        </div>
        {onExport && (
            <button onClick={onExport} className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Export CSV
            </button>
        )}
      </div>
      
      <div className="overflow-x-auto flex-1">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 bg-white z-10 shadow-sm">
            <tr className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
              <th className="px-6 py-3 border-b border-slate-100">Company</th>
              <th className="px-6 py-3 border-b border-slate-100">Fit</th>
              <th className="px-6 py-3 border-b border-slate-100">Decision Maker</th>
              <th className="px-6 py-3 border-b border-slate-100">Strategy Source</th>
              <th className="px-6 py-3 border-b border-slate-100">Tech & Analysis</th>
              <th className="px-6 py-3 border-b border-slate-100 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {leads.length === 0 ? (
                <tr>
                    <td colSpan={6} className="px-6 py-20 text-center">
                        <div className="text-slate-300 mb-2">
                            <svg className="w-12 h-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                        </div>
                        <p className="text-slate-500 font-medium text-sm">Pipeline is empty.</p>
                        <p className="text-slate-400 text-xs">Start the Growth Engine or Add Strategy manually.</p>
                    </td>
                </tr>
            ) : (
                leads.map((lead) => (
                <tr key={lead.id} className="group hover:bg-blue-50/30 transition-colors">
                    <td className="px-6 py-4 align-top w-1/5">
                        <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded bg-slate-100 text-slate-500 flex items-center justify-center font-bold text-xs shrink-0">
                                {lead.companyName.substring(0,1).toUpperCase()}
                            </div>
                            <div>
                                <div className="font-bold text-slate-800 text-sm leading-tight mb-1">{lead.companyName}</div>
                                <a href={lead.website} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline block truncate max-w-[150px]">
                                    {lead.website}
                                </a>
                                <p className="text-[10px] text-slate-400 mt-1 line-clamp-2 leading-relaxed">{lead.description}</p>
                                {/* Trigger Badge */}
                                {lead.triggers && lead.triggers.length > 0 && (
                                    <span className="inline-flex items-center gap-1 mt-2 px-1.5 py-0.5 bg-red-50 text-red-600 rounded border border-red-100 text-[9px] font-bold uppercase tracking-wide">
                                        🚨 {lead.triggers[0].type} Detected
                                    </span>
                                )}
                            </div>
                        </div>
                    </td>
                    
                    <td className="px-6 py-4 align-top">
                        <div className="flex flex-col gap-2">
                            {getStatusBadge(lead.status)}
                            {lead.analysis && (
                                <div className="flex items-center gap-2 mt-1">
                                    <div className="w-12 h-1 bg-slate-100 rounded-full overflow-hidden">
                                        <div className={`h-full rounded-full ${getScoreColor(lead.analysis.score)}`} style={{ width: `${lead.analysis.score}%` }}></div>
                                    </div>
                                    <span className="text-[10px] font-mono font-bold text-slate-600">{lead.analysis.score}%</span>
                                </div>
                            )}
                        </div>
                    </td>

                    <td className="px-6 py-4 align-top">
                        {lead.decisionMaker ? (
                            <div className="bg-blue-50/50 p-2 rounded-lg border border-blue-50">
                                <p className="text-xs font-bold text-slate-800">{lead.decisionMaker.name}</p>
                                <p className="text-[10px] text-slate-500">{lead.decisionMaker.role}</p>
                                {lead.decisionMaker.linkedinUrl && (
                                    <a href={lead.decisionMaker.linkedinUrl} target="_blank" className="text-[10px] text-blue-500 hover:underline block mt-1">LinkedIn ↗</a>
                                )}
                            </div>
                        ) : lead.status !== LeadStatus.NEW && onHunt ? (
                             <button 
                                onClick={() => onHunt(lead)}
                                disabled={analyzingIds.has(lead.id)}
                                className="text-[10px] font-bold text-purple-600 bg-purple-50 px-2 py-1 rounded border border-purple-100 hover:bg-purple-100 transition-colors w-full"
                            >
                                {analyzingIds.has(lead.id) ? 'Hunting...' : '+ Find CEO'}
                            </button>
                        ) : <span className="text-slate-300 text-[10px]">-</span>}
                    </td>

                    <td className="px-6 py-4 align-top">
                        {lead.foundVia ? (
                            <span className="inline-block px-2 py-1 bg-slate-100 text-slate-500 text-[10px] font-medium rounded border border-slate-200 truncate max-w-[120px]" title={lead.foundVia}>
                                {lead.foundVia}
                            </span>
                        ) : <span className="text-slate-300 text-[10px]">-</span>}
                    </td>

                    <td className="px-6 py-4 align-top w-1/4">
                        {lead.analysis ? (
                            <div className="flex flex-col gap-2">
                                <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                                    <p className="text-[10px] font-bold text-slate-600 mb-1">STRATEGY</p>
                                    <p className="text-[10px] text-slate-500 italic">"{lead.analysis.suggestedAngle}"</p>
                                </div>
                                {lead.techStack && lead.techStack.length > 0 && (
                                     <div className="flex flex-wrap gap-1">
                                        {lead.techStack.slice(0,3).map((tech, i) => (
                                            <span key={i} className="px-1.5 py-0.5 bg-slate-100 text-slate-500 text-[9px] rounded font-medium border border-slate-200">{tech}</span>
                                        ))}
                                     </div>
                                )}
                            </div>
                        ) : (
                            <span className="text-xs text-slate-400 italic">Waiting for agent...</span>
                        )}
                    </td>

                    <td className="px-6 py-4 align-top text-right">
                        <div className="flex flex-col items-end gap-2">
                            {lead.status === LeadStatus.NEW ? (
                                <button 
                                    onClick={() => onAnalyze(lead)}
                                    disabled={analyzingIds.has(lead.id)}
                                    className="text-xs font-semibold bg-white border border-slate-200 text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-all disabled:opacity-50 shadow-sm whitespace-nowrap"
                                >
                                    {analyzingIds.has(lead.id) ? '...' : 'Analyze'}
                                </button>
                            ) : lead.emailSequence ? (
                                <EmailSequenceViewer 
                                    sequence={lead.emailSequence} 
                                    decisionMaker={lead.decisionMaker} 
                                    onMarkContacted={() => onMarkContacted && onMarkContacted(lead)}
                                />
                            ) : (
                                <span className="text-xs text-slate-400">-</span>
                            )}
                        </div>
                    </td>
                </tr>
                ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
